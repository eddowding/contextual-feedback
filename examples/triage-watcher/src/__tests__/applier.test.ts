import { describe, it, expect, vi } from 'vitest';
import { applyPlan } from '../applier';
import { fakeTriageClient } from './helpers';
import { createNullLogger } from '../logger';
import type { PlannedResolution } from '../policy';
import type { ResolveResponse, Feedback } from '../lib-imports';

function fb(id: string): Feedback {
  return {
    id, userEmail: 'a@b.c', pageUrl: '/p', feedbackText: 'x',
    status: 'Done', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
  };
}

function planEntry(over: Partial<PlannedResolution> & { index: number }): PlannedResolution {
  return {
    action: 'auto-resolve', toStatus: 'Done', category: 'praise', note: 'ok',
    disposition: 'praise', confidence: 0.95, injectionSuspected: false, policyOverride: false,
    ...over,
  };
}

describe('applyPlan', () => {
  it('splits a 200 response into updated/notFound/failed byId', async () => {
    const client = fakeTriageClient({
      async resolve(): Promise<ResolveResponse> {
        return { updated: [fb('a')], notFound: ['b'], failed: ['c'] };
      },
    });
    const plan = [planEntry({ index: 1 }), planEntry({ index: 2 }), planEntry({ index: 3 })];
    const idByIndex = { 1: 'a', 2: 'b', 3: 'c' };
    const res = await applyPlan(plan, idByIndex, { triageClient: client, logger: createNullLogger() });
    expect(res.byId).toEqual({ a: 'updated', b: 'notFound', c: 'failed' });
    expect(res.updated).toEqual(['a']);
    expect(res.notFound).toEqual(['b']);
    expect(res.failed).toEqual(['c']);
  });

  it('dry-run (would-resolve) issues no RESOLVE call and returns dry-run outcomes', async () => {
    const resolve = vi.fn();
    const client = fakeTriageClient({ resolve });
    const plan = [planEntry({ index: 1, action: 'would-resolve' }), planEntry({ index: 2, action: 'would-resolve' })];
    const res = await applyPlan(plan, { 1: 'a', 2: 'b' }, { triageClient: client, logger: createNullLogger() });
    expect(resolve).not.toHaveBeenCalled();
    expect(res.byId).toEqual({ a: 'dry-run', b: 'dry-run' });
  });

  it('drops + alarms a plan entry whose index is not in idByIndex; sends the rest', async () => {
    const error = vi.fn();
    const logger = { ...createNullLogger(), error };
    let sent: unknown;
    const client = fakeTriageClient({
      async resolve(resolutions): Promise<ResolveResponse> {
        sent = resolutions;
        return { updated: [fb('a')], notFound: [], failed: [] };
      },
    });
    const plan = [planEntry({ index: 1 }), planEntry({ index: 99 })];
    const res = await applyPlan(plan, { 1: 'a' }, { triageClient: client, logger });
    expect(error).toHaveBeenCalled();
    expect(res.updated).toEqual(['a']);
    expect(sent).toHaveLength(1);
  });

  it('reads a 500 body (failed ids surfaced) without throwing', async () => {
    const client = fakeTriageClient({
      async resolve(): Promise<ResolveResponse> {
        return { updated: [], notFound: [], failed: ['x'] };
      },
    });
    const res = await applyPlan([planEntry({ index: 1 })], { 1: 'x' }, { triageClient: client, logger: createNullLogger() });
    expect(res.failed).toEqual(['x']);
    expect(res.byId.x).toBe('failed');
  });

  it('omits absent fields from the resolutions payload (no spurious changes)', async () => {
    let sent: any;
    const client = fakeTriageClient({
      async resolve(resolutions): Promise<ResolveResponse> {
        sent = resolutions;
        return { updated: [fb('a')], notFound: [], failed: [] };
      },
    });
    // category null and empty note → both omitted; only status sent.
    const plan = [planEntry({ index: 1, category: null, note: '' })];
    await applyPlan(plan, { 1: 'a' }, { triageClient: client, logger: createNullLogger() });
    expect(sent[0]).toEqual({ id: 'a', status: 'Done' });
    expect('category' in sent[0]).toBe(false);
    expect('adminNotes' in sent[0]).toBe(false);
  });

  it('treats an id sent but absent from the response as failed', async () => {
    const client = fakeTriageClient({
      async resolve(): Promise<ResolveResponse> {
        return { updated: [], notFound: [], failed: [] }; // says nothing about 'a'
      },
    });
    const res = await applyPlan([planEntry({ index: 1 })], { 1: 'a' }, { triageClient: client, logger: createNullLogger() });
    expect(res.byId.a).toBe('failed');
  });
});
