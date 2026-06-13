import type { WatcherConfig } from './config';
import type { Deps, RunSummary } from './types';
import { runOnce as orchestrate } from './orchestrator';

/**
 * Single-run entrypoint. The full poll → classify → act → audit → escalate body
 * lives in `orchestrator.ts` (ticket 14); this re-export keeps the ticket-04
 * seam (`runOnce(config, deps)`) stable for callers and tests.
 */
export async function runOnce(config: WatcherConfig, deps: Deps): Promise<RunSummary> {
  return orchestrate(config, deps);
}
