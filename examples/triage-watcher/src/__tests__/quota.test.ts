import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileDailyQuotaStore } from '../quota';

const tmpFiles: string[] = [];
function tmpPath(): string {
  const p = join(tmpdir(), `quota-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => { for (const p of tmpFiles.splice(0)) await fs.rm(p, { force: true }); });

const DAY1 = Date.UTC(2025, 0, 1, 12, 0, 0);
const DAY1_LATER = Date.UTC(2025, 0, 1, 23, 0, 0);
const DAY2 = Date.UTC(2025, 0, 2, 0, 30, 0);

describe('createFileDailyQuotaStore', () => {
  it('starts at zero when no file exists', async () => {
    const store = createFileDailyQuotaStore(tmpPath());
    expect(await store.todayCount(DAY1)).toBe(0);
  });

  it('accumulates within the same UTC day', async () => {
    const store = createFileDailyQuotaStore(tmpPath());
    expect(await store.add(DAY1, 3)).toBe(3);
    expect(await store.add(DAY1_LATER, 4)).toBe(7);
    expect(await store.todayCount(DAY1_LATER)).toBe(7);
  });

  it('persists across instances so the cap binds across runs', async () => {
    const path = tmpPath();
    await createFileDailyQuotaStore(path).add(DAY1, 5);
    // A fresh instance (simulating the next scheduler tick) sees the prior total.
    const next = createFileDailyQuotaStore(path);
    expect(await next.todayCount(DAY1)).toBe(5);
    expect(await next.add(DAY1, 2)).toBe(7);
  });

  it('resets across a UTC day boundary', async () => {
    const path = tmpPath();
    await createFileDailyQuotaStore(path).add(DAY1, 9);
    const next = createFileDailyQuotaStore(path);
    expect(await next.todayCount(DAY2)).toBe(0);
  });
});
