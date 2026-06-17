import { describe, it, expect, vi } from 'vitest';
import { createGuardedTick } from '../scheduler';
import { loadConfig } from '../config';
import { fakeDeps } from './helpers';
import { createNullLogger } from '../logger';
import type { RunSummary } from '../types';

const config = loadConfig({
  FEEDBACK_API_BASE_URL: 'http://h/api/feedback',
  FEEDBACK_API_TOKEN: 't',
  ANTHROPIC_API_KEY: 'k',
});

describe('scheduler non-overlap guard', () => {
  it('skips a tick while a previous run is still in flight', async () => {
    const summary: RunSummary = { runId: 'r', polled: 0, classified: 0, autoResolved: 0, escalated: 0, failed: 0 };
    let resolveRun: (() => void) | null = null;
    let firstCall = true;
    const run = vi.fn(async (): Promise<RunSummary> => {
      if (firstCall) {
        firstCall = false;
        await new Promise<void>(r => { resolveRun = r; }); // first run blocks until released
      }
      return summary;
    });

    const tick = createGuardedTick(
      { logger: createNullLogger(), makeDeps: () => fakeDeps(), run },
      config
    );

    const first = tick();         // starts run, blocks inside
    await Promise.resolve();      // let the run begin
    await Promise.resolve();
    const second = tick();        // should be skipped (run still in flight)
    await second;
    expect(run).toHaveBeenCalledTimes(1); // second tick did NOT start a run

    resolveRun!();
    await first;

    // A later tick after completion runs normally.
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
