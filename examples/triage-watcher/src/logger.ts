import type { Logger, Clock } from './types';

/** Structured JSON-line logger to stderr (so stdout stays clean for piping). */
export function createLogger(base: Record<string, unknown> = {}): Logger {
  function emit(level: string, msg: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({
      level,
      ts: new Date().toISOString(),
      msg,
      ...base,
      ...(meta ?? {}),
    });
    // eslint-disable-next-line no-console
    console.error(line);
  }
  return {
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}

/** Silent logger for tests. */
export function createNullLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

/** Time-based, collision-resistant run id. No crypto dependency required. */
export function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
