import type { TriageItem } from './lib-imports';
import type { AnthropicLike, Logger } from './types';
import type { WatcherConfig } from './config';
import { runClassifier, type ClassifyResult } from './classifier-core';
import { PASS2_SYSTEM_PROMPT } from './prompts';

export interface JudgeDeps {
  anthropic: AnthropicLike;
  logger: Logger;
}

/**
 * Pass 2 — judgement re-classification of the ambiguous subset with Opus 4.8
 * (`config.judgeModel`), `effort: high`. The CALLER (policy engine, ticket 08)
 * selects which items to send; this function judges exactly what it is given.
 *
 * Same security posture as Pass 1: formatTriageBatch input, structured output,
 * no tools, index re-validation, injectionSuspected honoured. The Opus system
 * prompt instructs decide-don't-ask and one-line notes with a folded severity
 * for actionable items.
 *
 * IMPORTANT: the returned decisions carry the SUBSET's 1-based indices (i.e.
 * `index` is relative to `subset`, not the original batch). The caller remaps
 * via the subset's own idByIndex / id list — see the orchestrator (ticket 14).
 */
export async function judgeBatch(
  subset: TriageItem[],
  deps: JudgeDeps,
  config: WatcherConfig
): Promise<ClassifyResult> {
  return runClassifier({
    items: subset,
    anthropic: deps.anthropic,
    logger: deps.logger,
    model: config.judgeModel,
    systemPrompt: PASS2_SYSTEM_PROMPT,
    effort: 'high',
  });
}
