import type { TriageDecision, TriageDisposition } from './lib-imports';
import { TRIAGE_DISPOSITIONS } from './lib-imports';
import type { AnthropicLike, AnthropicMessageResponse, AnthropicUsage, Logger } from './types';
import { DECISIONS_JSON_SCHEMA } from './schema';
import { formatTriageBatch } from './lib-imports';
import type { TriageItem } from './lib-imports';

/**
 * Thrown when the model refuses or the API errors. The orchestrator skips the
 * batch this run on a ClassifierError — no partial actions (README §9).
 */
export class ClassifierError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ClassifierError';
    this.cause = cause;
  }
}

export interface ClassifyResult {
  decisions: TriageDecision[];
  usage: AnthropicUsage;
}

const DISPOSITION_SET = new Set<string>(TRIAGE_DISPOSITIONS);

function isValidDisposition(v: unknown): v is TriageDisposition {
  return typeof v === 'string' && DISPOSITION_SET.has(v);
}

/** Pull the structured payload out of a response, tolerating both parsed_output and raw text. */
function extractParsed(res: AnthropicMessageResponse): unknown {
  if (res.parsed_output !== undefined && res.parsed_output !== null) return res.parsed_output;
  const textBlock = res.content?.find(b => b.type === 'text' && typeof b.text === 'string');
  if (textBlock?.text) {
    try {
      return JSON.parse(textBlock.text);
    } catch {
      throw new ClassifierError('Model output was not parseable JSON');
    }
  }
  throw new ClassifierError('Model returned no structured output');
}

/**
 * Validate + normalise raw decisions against the batch.
 * SECURITY BACKSTOP (README §5.2): every decision.index must be within
 * [1, itemCount] and the disposition must be in the closed set. Anything out of
 * range is DROPPED + logged — a verdict for an index the model wasn't given
 * cannot reach a real item.
 */
export function validateDecisions(
  raw: unknown,
  itemCount: number,
  logger: Logger
): TriageDecision[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new ClassifierError('Structured output was not an object');
  }
  const decisions = (raw as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions)) {
    throw new ClassifierError('Structured output missing decisions array');
  }

  const out: TriageDecision[] = [];
  for (const d of decisions) {
    if (typeof d !== 'object' || d === null) {
      logger.warn('dropping non-object decision');
      continue;
    }
    const dec = d as Record<string, unknown>;
    const index = dec.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > itemCount) {
      logger.warn('dropping decision with out-of-range index', { index, itemCount });
      continue;
    }
    if (!isValidDisposition(dec.disposition)) {
      logger.warn('dropping decision with invalid disposition', { index, disposition: dec.disposition });
      continue;
    }
    const confidenceRaw = dec.confidence;
    const confidence =
      typeof confidenceRaw === 'number' && confidenceRaw >= 0 && confidenceRaw <= 1 ? confidenceRaw : 0;
    const category =
      dec.category === 'bug' ||
      dec.category === 'feature' ||
      dec.category === 'praise' ||
      dec.category === 'question' ||
      dec.category === 'other'
        ? dec.category
        : null;

    out.push({
      index,
      disposition: dec.disposition,
      confidence,
      category,
      injectionSuspected: dec.injectionSuspected === true,
      note: typeof dec.note === 'string' ? dec.note : '',
      duplicateOfIndex:
        typeof dec.duplicateOfIndex === 'number' && Number.isInteger(dec.duplicateOfIndex)
          ? dec.duplicateOfIndex
          : null,
    });
  }
  return out;
}

export interface RunClassifierArgs {
  items: TriageItem[];
  anthropic: AnthropicLike;
  logger: Logger;
  model: string;
  systemPrompt: string;
  effort: 'low' | 'high';
}

/**
 * Shared call path for both passes: builds the cached system prefix + the
 * untrusted batch in the user turn, calls the model with structured output and
 * NO tools, handles refusal/errors, and re-validates indices.
 */
export async function runClassifier(args: RunClassifierArgs): Promise<ClassifyResult> {
  const { items, anthropic, logger, model, systemPrompt, effort } = args;
  if (items.length === 0) {
    return { decisions: [], usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const { prompt } = formatTriageBatch(items);
  // max_tokens sized for the batch; capped. Non-streaming is fine at this size.
  const maxTokens = Math.min(250 * items.length, 16000);

  let res: AnthropicMessageResponse;
  try {
    res = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: {
        effort,
        format: { type: 'json_schema', name: 'triage_decisions', schema: DECISIONS_JSON_SCHEMA },
      },
      // The fixed operator instructions are the cached prefix — frozen, no
      // per-batch data. The volatile batch is the user turn after it.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
      // Explicitly NO tools — the model can only return data (README §5.2).
    });
  } catch (err) {
    throw new ClassifierError(`Anthropic API error for model ${model}`, err);
  }

  if (res.stop_reason === 'refusal') {
    throw new ClassifierError(`Model ${model} refused the batch (stop_reason: refusal)`);
  }

  const parsed = extractParsed(res);
  const decisions = validateDecisions(parsed, items.length, logger);
  return { decisions, usage: res.usage };
}
