import type { TriageItem } from './lib-imports';
import type { AnthropicLike, Logger } from './types';
import type { WatcherConfig } from './config';
import { runClassifier, type ClassifyResult } from './classifier-core';
import { PASS1_SYSTEM_PROMPT } from './prompts';

export interface ClassifyDeps {
  anthropic: AnthropicLike;
  logger: Logger;
}

/**
 * Pass 1 — mechanical classification of the whole batch with Sonnet 4.6
 * (`config.classifyModel`), `effort: low`. Returns one TriageDecision per input
 * item plus token usage for the cost governor (ticket 12).
 *
 * The model has no tools and returns structured data only; out-of-range indices
 * are dropped by the shared validator (security backstop). A refusal or API
 * error throws ClassifierError so the orchestrator skips the batch this run.
 */
export async function classifyBatch(
  items: TriageItem[],
  deps: ClassifyDeps,
  config: WatcherConfig
): Promise<ClassifyResult> {
  return runClassifier({
    items,
    anthropic: deps.anthropic,
    logger: deps.logger,
    model: config.classifyModel,
    systemPrompt: PASS1_SYSTEM_PROMPT,
    effort: 'low',
  });
}
