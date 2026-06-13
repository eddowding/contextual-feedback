import { describe, it, expect, vi } from 'vitest';
import { runOnce } from '../run';
import { loadConfig } from '../config';
import { fakeDeps } from './helpers';
import { createNullLogger } from '../logger';

const config = loadConfig({
  FEEDBACK_API_BASE_URL: 'https://app/api/feedback',
  FEEDBACK_API_TOKEN: 'tok',
  ANTHROPIC_API_KEY: 'sk-ant-x',
});

describe('runOnce (skeleton)', () => {
  it('resolves with a RunSummary using fully-faked Deps and no network', async () => {
    const deps = fakeDeps({ runId: 'run_abc' });
    const summary = await runOnce(config, deps);
    expect(summary).toEqual({
      runId: 'run_abc',
      polled: 0,
      classified: 0,
      autoResolved: 0,
      escalated: 0,
      failed: 0,
    });
  });

  it('emits run start/end logs', async () => {
    const info = vi.fn();
    const logger = { ...createNullLogger(), info };
    const deps = fakeDeps({ logger, runId: 'run_log' });
    await runOnce(config, deps);
    const messages = info.mock.calls.map(c => c[0]);
    expect(messages).toContain('run start');
    expect(messages).toContain('run end');
  });
});
