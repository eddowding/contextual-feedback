import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { DailyQuotaStore } from './types';

/**
 * Durable per-UTC-day auto-resolve counter (README §7 daily cap). Mirrors the
 * cost governor's daily-spend persistence: a count keyed by UTC day, written
 * atomically (temp file + rename), so the per-day quota binds ACROSS the many
 * short runs a cron scheduler makes rather than resetting to 0 each run.
 */
interface DailyQuotaState {
  /** UTC date key YYYY-MM-DD. */
  day: string;
  autoResolves: number;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createFileDailyQuotaStore(path: string): DailyQuotaStore {
  let state: DailyQuotaState | null = null;

  async function loadFor(now: number): Promise<DailyQuotaState> {
    const today = utcDay(now);
    if (state && state.day === today) return state;
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as DailyQuotaState;
      // A stale file from a previous UTC day resets to 0 for today.
      state =
        parsed.day === today && typeof parsed.autoResolves === 'number'
          ? parsed
          : { day: today, autoResolves: 0 };
    } catch {
      state = { day: today, autoResolves: 0 };
    }
    return state;
  }

  async function persist(): Promise<void> {
    if (!state) return;
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(state), 'utf8');
    await fs.rename(tmp, path);
  }

  return {
    async todayCount(now: number): Promise<number> {
      return (await loadFor(now)).autoResolves;
    },
    async add(now: number, n: number): Promise<number> {
      const s = await loadFor(now);
      s.autoResolves += n;
      await persist();
      return s.autoResolves;
    },
  };
}
