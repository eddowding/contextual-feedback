import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { RetryQueue, RetryRecord, Logger, Clock } from './types';

export interface RetryQueueConfig {
  retryStorePath: string;
  maxRetryAttempts: number;
}

export interface RetryQueueDeps {
  clock: Clock;
  logger: Logger;
  /** Injectable jitter in [0,1) so backoff is deterministic in tests. */
  random?: () => number;
}

/** Base backoff 1 min, doubling, capped at 60 min, ± up to 20% jitter. */
export function backoffMs(attempt: number, jitter: number): number {
  const base = 60_000; // 1 minute
  const cap = 60 * 60_000; // 1 hour
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  const jitterFactor = 1 + (jitter * 2 - 1) * 0.2; // 0.8 .. 1.2
  return Math.round(raw * jitterFactor);
}

type Store = Record<string, RetryRecord>;

/**
 * Durable retry queue for RESOLVE `failed` ids (README §9, ticket 13).
 *
 * Failed ids stay re-selectable via the cursor/seen-set (ticket 05 never adds
 * them to seenIds). This queue layers backoff + a cap on top so a persistently
 * failing id isn't hammered every tick. The orchestrator excludes ids that are
 * not-yet-due, and force-escalates ids that exhaust their attempts.
 */
export function createRetryQueue(config: RetryQueueConfig, deps: RetryQueueDeps): RetryQueue {
  const { clock, logger } = deps;
  const random = deps.random ?? Math.random;
  let cache: Store | null = null;

  async function load(): Promise<Store> {
    if (cache) return cache;
    try {
      const raw = await fs.readFile(config.retryStorePath, 'utf8');
      const parsed = JSON.parse(raw) as Store;
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  }

  async function save(store: Store): Promise<void> {
    cache = store;
    await fs.mkdir(dirname(config.retryStorePath), { recursive: true });
    const tmp = `${config.retryStorePath}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fs.rename(tmp, config.retryStorePath);
  }

  return {
    async enqueue(id: string, now: number): Promise<void> {
      const store = await load();
      const prev = store[id];
      const attempts = (prev?.attempts ?? 0) + 1;
      store[id] = { attempts, nextDueAt: now + backoffMs(attempts, random()) };
      await save(store);
    },

    async dueIds(now: number): Promise<string[]> {
      const store = await load();
      return Object.entries(store)
        .filter(([, r]) => r.attempts <= config.maxRetryAttempts && r.nextDueAt <= now)
        .map(([id]) => id);
    },

    async notYetDueIds(now: number): Promise<string[]> {
      const store = await load();
      return Object.entries(store)
        .filter(([, r]) => r.attempts <= config.maxRetryAttempts && r.nextDueAt > now)
        .map(([id]) => id);
    },

    async recordOutcome(id: string): Promise<void> {
      const store = await load();
      if (store[id] !== undefined) {
        delete store[id];
        await save(store);
      }
    },

    async exhaustedIds(): Promise<string[]> {
      const store = await load();
      return Object.entries(store)
        .filter(([, r]) => r.attempts > config.maxRetryAttempts)
        .map(([id]) => id);
    },

    async drop(id: string): Promise<void> {
      const store = await load();
      if (store[id] !== undefined) {
        logger.warn('ALARM: retry queue giving up on id (force-escalated)', {
          id,
          attempts: store[id].attempts,
        });
        delete store[id];
        await save(store);
      }
    },
  };
}

/** The note written when an id is force-escalated after exhausting retries. */
export function exhaustedEscalationNote(attempts: number): string {
  return `[triage] auto-resolve failed ${attempts} times, needs manual handling`;
}
