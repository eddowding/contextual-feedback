import { describe, it, expect, vi } from 'vitest';
import { runOnce } from '../run';
import { loadConfig } from '../config';
import { fakeDeps, fakeTriageClient, fakeCostGovernor, fakeRetryQueue } from './helpers';
import { createNullLogger } from '../logger';
import type { TriageItem } from '../lib-imports';

const config = loadConfig({
  FEEDBACK_API_BASE_URL: 'https://app/api/feedback',
  FEEDBACK_API_TOKEN: 'tok',
  ANTHROPIC_API_KEY: 'sk-ant-x',
});

const noDryRunConfig = loadConfig({
  FEEDBACK_API_BASE_URL: 'https://app/api/feedback',
  FEEDBACK_API_TOKEN: 'tok',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  POLICY_DRY_RUN: 'false',
});

function pendingItem(id: string): TriageItem {
  return {
    id, feedback: 'x', page: '/p', section: 's', elementId: null,
    category: null, from: 'a@b.c', status: 'Pending', submittedAt: '2025-01-01T00:00:00Z',
  };
}

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

  it('re-queues failed items for retry on the budget-blown escalate-everything path', async () => {
    // Regression: escalateEverything used to drop a failed RESOLVE write from the
    // retry queue (the main path enqueues it). A transient failure for an ordinary
    // item during budget-blown escalation must still be retried.
    const enqueue = vi.fn();
    const deps = fakeDeps({
      triageClient: fakeTriageClient({
        async getTriage() {
          return { items: [pendingItem('fb_1')], summary: { pending: 1, inReview: 0, total: 1 } };
        },
        async resolve() {
          return { updated: [], notFound: [], failed: ['fb_1'] };
        },
      }),
      // Daily budget blown → escalate-everything path (no classification).
      costGovernor: { ...fakeCostGovernor(), async withinDailyBudget() { return false; } },
      retryQueue: { ...fakeRetryQueue(), enqueue },
      runId: 'run_blown',
    });

    const summary = await runOnce(noDryRunConfig, deps);
    expect(summary.failed).toBe(1);
    expect(enqueue).toHaveBeenCalledWith('fb_1', expect.any(Number));
  });
});
