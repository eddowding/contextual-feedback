import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuditRecords, createJsonlAuditSink } from '../audit';
import { fakeClock } from './helpers';
import type { PlannedResolution } from '../policy';
import type { ApplyResult } from '../applier';
import type { TriageAuditRecord } from '../lib-imports';

function entry(over: Partial<PlannedResolution> & { index: number }): PlannedResolution {
  return {
    action: 'auto-resolve', toStatus: 'Done', category: 'praise', note: 'ok',
    disposition: 'praise', confidence: 0.95, injectionSuspected: false, policyOverride: false,
    ...over,
  };
}

const tmpFiles: string[] = [];
function tmpPath(): string {
  const p = join(tmpdir(), `audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => { for (const p of tmpFiles.splice(0)) await fs.rm(p, { force: true }); });

describe('buildAuditRecords', () => {
  const idByIndex = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' };
  const submittedAtByIndex = { 1: 't1', 2: 't2', 3: 't3', 4: 't4' };

  it('maps action/resolveResult/model per item over a mixed plan', () => {
    const plan = [
      entry({ index: 1, action: 'auto-resolve' }),                  // updated → auto-resolve, sonnet
      entry({ index: 2, action: 'escalate', toStatus: 'In Review', disposition: 'actionable' }), // updated → escalate, opus (judged)
      entry({ index: 3, action: 'auto-resolve' }),                  // failed
      entry({ index: 4, action: 'escalate', toStatus: 'In Review', policyOverride: true }),       // notFound → dropped, policy
    ];
    const applyResult: ApplyResult = {
      updated: ['a', 'b'], notFound: ['d'], failed: ['c'], dryRun: [],
      byId: { a: 'updated', b: 'updated', c: 'failed', d: 'notFound' },
    };
    const records = buildAuditRecords({
      runId: 'run_x', plan, applyResult, idByIndex, submittedAtByIndex,
      judgedIndices: new Set([2]), clock: fakeClock(),
    });
    expect(records).toHaveLength(4);
    const byId = Object.fromEntries(records.map(r => [r.feedbackId, r]));
    expect(byId.a.action).toBe('auto-resolve');
    expect(byId.a.model).toBe('sonnet');
    expect(byId.a.toStatus).toBe('Done');
    expect(byId.b.action).toBe('escalate');
    expect(byId.b.model).toBe('opus');
    expect(byId.c.action).toBe('failed');
    expect(byId.c.resolveResult).toBe('failed');
    expect(byId.c.toStatus).toBeNull();
    expect(byId.d.action).toBe('dropped');
    expect(byId.d.model).toBe('policy');
    expect(byId.d.submittedAt).toBe('t4');
  });

  it('records would-resolve / dry-run for a dry-run apply', () => {
    const plan = [entry({ index: 1, action: 'would-resolve' })];
    const applyResult: ApplyResult = {
      updated: [], notFound: [], failed: [], dryRun: ['a'], byId: { a: 'dry-run' },
    };
    const [rec] = buildAuditRecords({
      runId: 'r', plan, applyResult, idByIndex, submittedAtByIndex,
      judgedIndices: new Set(), clock: fakeClock(),
    });
    expect(rec.action).toBe('would-resolve');
    expect(rec.resolveResult).toBe('dry-run');
    expect(rec.toStatus).toBe('Done'); // intended status preserved for dry-run
  });

  it('persists injectionSuspected', () => {
    const plan = [entry({ index: 1, action: 'escalate', toStatus: 'In Review', injectionSuspected: true, policyOverride: true })];
    const applyResult: ApplyResult = { updated: ['a'], notFound: [], failed: [], dryRun: [], byId: { a: 'updated' } };
    const [rec] = buildAuditRecords({
      runId: 'r', plan, applyResult, idByIndex, submittedAtByIndex, judgedIndices: new Set(), clock: fakeClock(),
    });
    expect(rec.injectionSuspected).toBe(true);
  });
});

describe('createJsonlAuditSink', () => {
  it('appends without modifying prior lines (prefix hash unchanged)', async () => {
    const path = tmpPath();
    const sink = createJsonlAuditSink(path);
    const r = (id: string): TriageAuditRecord => ({
      ts: 't', runId: 'r', feedbackId: id, submittedAt: 's', action: 'auto-resolve',
      toStatus: 'Done', category: 'praise', disposition: 'praise', confidence: 1,
      injectionSuspected: false, model: 'sonnet', note: 'ok', resolveResult: 'updated',
    });
    await sink.append([r('a')]);
    const afterFirst = await fs.readFile(path, 'utf8');
    const prefixHash = createHash('sha256').update(afterFirst).digest('hex');

    await sink.append([r('b')]);
    const afterSecond = await fs.readFile(path, 'utf8');
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(createHash('sha256').update(afterSecond.slice(0, afterFirst.length)).digest('hex')).toBe(prefixHash);
  });

  it('round-trips: appended records parse back to the same objects', async () => {
    const path = tmpPath();
    const sink = createJsonlAuditSink(path);
    const recs: TriageAuditRecord[] = [
      { ts: 't1', runId: 'r', feedbackId: 'a', submittedAt: 's', action: 'auto-resolve', toStatus: 'Done', category: 'praise', disposition: 'praise', confidence: 1, injectionSuspected: false, model: 'sonnet', note: 'n', resolveResult: 'updated' },
      { ts: 't2', runId: 'r', feedbackId: 'b', submittedAt: 's', action: 'escalate', toStatus: 'In Review', category: 'bug', disposition: 'actionable', confidence: 0.8, injectionSuspected: false, model: 'opus', note: 'm', resolveResult: 'updated' },
    ];
    await sink.append(recs);
    const lines = (await fs.readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toEqual(recs);
  });

  it('is a no-op for an empty record array', async () => {
    const path = tmpPath();
    await createJsonlAuditSink(path).append([]);
    await expect(fs.readFile(path, 'utf8')).rejects.toBeTruthy(); // file never created
  });
});
