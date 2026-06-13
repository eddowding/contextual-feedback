import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetryQueue, backoffMs, exhaustedEscalationNote } from '../retry';
import { createNullLogger } from '../logger';
import { fakeClock } from './helpers';

const tmpFiles: string[] = [];
function tmpPath(): string {
  const p = join(tmpdir(), `retry-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => { for (const p of tmpFiles.splice(0)) await fs.rm(p, { force: true }); });

function makeQueue(path = tmpPath(), maxRetryAttempts = 6) {
  // Fixed jitter (0.5 → factor 1.0) for deterministic backoff in tests.
  return createRetryQueue(
    { retryStorePath: path, maxRetryAttempts },
    { clock: fakeClock(), logger: createNullLogger(), random: () => 0.5 }
  );
}

describe('backoffMs', () => {
  it('grows exponentially with attempts (within jitter bounds)', () => {
    const a1 = backoffMs(1, 0.5); // ~1 min
    const a2 = backoffMs(2, 0.5); // ~2 min
    const a3 = backoffMs(3, 0.5); // ~4 min
    expect(a1).toBeCloseTo(60_000, -3);
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeGreaterThan(a2);
  });

  it('caps at one hour', () => {
    expect(backoffMs(20, 0.5)).toBeLessThanOrEqual(60 * 60_000);
  });

  it('applies jitter within ±20%', () => {
    const lo = backoffMs(1, 0); // factor 0.8
    const hi = backoffMs(1, 0.999); // factor ~1.2
    expect(lo).toBeCloseTo(48_000, -3);
    expect(hi).toBeCloseTo(72_000, -2);
  });
});

describe('createRetryQueue', () => {
  it('enqueues an id with an increasing nextDueAt per attempt', async () => {
    const path = tmpPath();
    const q = makeQueue(path);
    await q.enqueue('a', 0);
    const after1 = JSON.parse(await fs.readFile(path, 'utf8')).a.nextDueAt;
    await q.enqueue('a', 0);
    const after2 = JSON.parse(await fs.readFile(path, 'utf8')).a.nextDueAt;
    expect(after2).toBeGreaterThan(after1);
    expect(JSON.parse(await fs.readFile(path, 'utf8')).a.attempts).toBe(2);
  });

  it('dueIds returns only past-due ids', async () => {
    const q = makeQueue();
    await q.enqueue('past', 0);       // nextDueAt ~60_000
    await q.enqueue('future', 1_000_000); // nextDueAt ~1_060_000
    const due = await q.dueIds(500_000);
    expect(due).toEqual(['past']);
  });

  it('notYetDueIds returns ids held back', async () => {
    const q = makeQueue();
    await q.enqueue('future', 1_000_000);
    expect(await q.notYetDueIds(500_000)).toEqual(['future']);
    expect(await q.notYetDueIds(2_000_000)).toEqual([]);
  });

  it('recordOutcome clears a queued id', async () => {
    const path = tmpPath();
    const q = makeQueue(path);
    await q.enqueue('a', 0);
    await q.recordOutcome('a');
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({});
  });

  it('after maxRetryAttempts the id is exhausted and no longer due/retried', async () => {
    const q = makeQueue(tmpPath(), 6);
    for (let i = 0; i < 7; i++) await q.enqueue('a', 0); // 7th failure, attempts=7 > cap 6
    expect(await q.exhaustedIds()).toEqual(['a']);
    expect(await q.dueIds(Number.MAX_SAFE_INTEGER)).toEqual([]); // not retried anymore
  });

  it('drop removes an exhausted id (after force-escalation)', async () => {
    const path = tmpPath();
    const q = makeQueue(path, 1);
    await q.enqueue('a', 0);
    await q.enqueue('a', 0); // attempts=2 > cap 1 → exhausted
    expect(await q.exhaustedIds()).toEqual(['a']);
    await q.drop('a');
    expect(await q.exhaustedIds()).toEqual([]);
  });

  it('persists and reloads across instances', async () => {
    const path = tmpPath();
    const q1 = makeQueue(path);
    await q1.enqueue('a', 0);
    const q2 = makeQueue(path);
    const due = await q2.dueIds(Number.MAX_SAFE_INTEGER);
    expect(due).toEqual(['a']);
  });

  it('exhaustedEscalationNote includes the attempt count', () => {
    expect(exhaustedEscalationNote(6)).toContain('6 times');
  });
});
