import type { WatcherConfig } from './config';
import type { Deps, RunSummary } from './types';

/**
 * Single-run orchestration shell. Ticket 04 stands up the seam; ticket 14 fills
 * in the full poll → classify → act → audit → escalate body. For now it logs
 * start/end and returns an empty summary so the wiring is testable with fully
 * faked Deps and no network access.
 *
 * NOTE: ticket 14 replaces the body of this function. The signature is stable.
 */
export async function runOnce(_config: WatcherConfig, deps: Deps): Promise<RunSummary> {
  const { logger, runId } = deps;
  logger.info('run start', { runId });

  const summary: RunSummary = {
    runId,
    polled: 0,
    classified: 0,
    autoResolved: 0,
    escalated: 0,
    failed: 0,
  };

  logger.info('run end', { ...summary });
  return summary;
}
