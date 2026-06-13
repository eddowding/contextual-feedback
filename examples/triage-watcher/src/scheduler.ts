import { Cron } from 'croner';
import type { WatcherConfig } from './config';
import type { Deps, RunSummary } from './types';
import type { Logger } from './types';

export interface SchedulerHandle {
  stop(): void;
}

export interface SchedulerDeps {
  logger: Logger;
  /** Factory for a fresh Deps per run (new runId, reloaded stores). */
  makeDeps(): Deps;
  /** The run function (injected so tests don't need the real orchestrator). */
  run(config: WatcherConfig, deps: Deps): Promise<RunSummary>;
}

/**
 * Start the cron scheduler. Runs are NON-OVERLAPPING: a `running` guard skips a
 * tick if the previous run is still in flight (a long run defers the next tick
 * rather than stacking), satisfying the README §3 "two ticks can't
 * double-classify" requirement without an external lock.
 */
export function startScheduler(config: WatcherConfig, deps: SchedulerDeps): SchedulerHandle {
  const { logger, makeDeps, run } = deps;
  let running = false;

  async function tick(): Promise<void> {
    if (running) {
      logger.warn('previous run still in flight — skipping this tick');
      return;
    }
    running = true;
    try {
      const runDeps = makeDeps();
      const summary = await run(config, runDeps);
      logger.info('scheduled run complete', { ...summary });
    } catch (err) {
      logger.error('scheduled run threw', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  }

  // protect: true is croner's own overlap guard; we keep our `running` flag too
  // so the behaviour is explicit and testable independent of the library.
  const job = new Cron(config.pollCron, { protect: true }, () => { void tick(); });
  logger.info('scheduler started', { cron: config.pollCron });

  return { stop: () => job.stop() };
}

/**
 * The bare non-overlap guard, exposed for unit testing without a real cron
 * timer. Returns a `tick` that mirrors the scheduler's overlap behaviour.
 */
export function createGuardedTick(deps: SchedulerDeps, config: WatcherConfig): () => Promise<void> {
  const { logger, makeDeps, run } = deps;
  let running = false;
  return async function tick(): Promise<void> {
    if (running) {
      logger.warn('previous run still in flight — skipping this tick');
      return;
    }
    running = true;
    try {
      await run(config, makeDeps());
    } finally {
      running = false;
    }
  };
}
