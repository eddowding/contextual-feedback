import type {
  Deps,
  AnthropicLike,
  AnthropicMessageResponse,
  CursorStore,
  CursorState,
  AuditSink,
  Escalator,
  EscalationItem,
  RetryQueue,
  CostGovernor,
  DailyQuotaStore,
  Clock,
} from '../types';
import type { TriageClient, TriageResponse, ResolveResponse, Resolution, TriageAuditRecord } from '../lib-imports';
import { createNullLogger } from '../logger';

/** A controllable clock for deterministic tests. */
export function fakeClock(startMs = 1_700_000_000_000): Clock & { set(ms: number): void; advance(ms: number): void } {
  let cur = startMs;
  return {
    now: () => cur,
    nowIso: () => new Date(cur).toISOString(),
    set: (ms: number) => { cur = ms; },
    advance: (ms: number) => { cur += ms; },
  };
}

export function fakeTriageClient(
  overrides: Partial<TriageClient> = {}
): TriageClient & { resolveCalls: Resolution[][] } {
  const resolveCalls: Resolution[][] = [];
  const client: TriageClient & { resolveCalls: Resolution[][] } = {
    resolveCalls,
    async getTriage(): Promise<TriageResponse> {
      return { items: [], summary: { pending: 0, inReview: 0, total: 0 } };
    },
    async resolve(resolutions: Resolution[]): Promise<ResolveResponse> {
      resolveCalls.push(resolutions);
      return { updated: [], notFound: [], failed: [] };
    },
    ...overrides,
  };
  return client;
}

/** Fake Anthropic client returning a scripted parsed_output per call. */
export function fakeAnthropic(
  responses: AnthropicMessageResponse[]
): AnthropicLike & { createCalls: Record<string, unknown>[]; countCalls: Record<string, unknown>[] } {
  const createCalls: Record<string, unknown>[] = [];
  const countCalls: Record<string, unknown>[] = [];
  let i = 0;
  return {
    createCalls,
    countCalls,
    messages: {
      async create(body: Record<string, unknown>): Promise<AnthropicMessageResponse> {
        createCalls.push(body);
        const res = responses[i] ?? responses[responses.length - 1];
        i += 1;
        return res;
      },
      async countTokens(body: Record<string, unknown>) {
        countCalls.push(body);
        return { input_tokens: 100 };
      },
    },
  };
}

export function okResponse(parsed: unknown, usage?: Partial<AnthropicMessageResponse['usage']>): AnthropicMessageResponse {
  return {
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50, ...usage },
    parsed_output: parsed,
  };
}

export function fakeCursorStore(initial?: CursorState): CursorStore & { state: CursorState } {
  const holder = { state: initial ?? { cursorSubmittedAt: null, seenIds: [] } };
  return {
    get state() { return holder.state; },
    async load() { return holder.state; },
    async save(s: CursorState) { holder.state = s; },
  };
}

export function fakeAuditSink(): AuditSink & { records: TriageAuditRecord[] } {
  const records: TriageAuditRecord[] = [];
  return {
    records,
    async append(rs: TriageAuditRecord[]) { records.push(...rs); },
  };
}

export function fakeEscalator(): Escalator & { batches: EscalationItem[][] } {
  const batches: EscalationItem[][] = [];
  return {
    batches,
    async notify(items: EscalationItem[]) { batches.push(items); },
  };
}

export function fakeRetryQueue(): RetryQueue {
  return {
    async enqueue() {},
    async dueIds() { return []; },
    async notYetDueIds() { return []; },
    async recordOutcome() {},
    async exhaustedIds() { return []; },
    async drop() {},
  };
}

export function fakeCostGovernor(allowed = true): CostGovernor {
  return {
    async preflight() { return { allowed, estimatedUsd: 0.01 }; },
    async record() {},
    async withinDailyBudget() { return true; },
    async acquireSlot() {},
  };
}

/** In-memory daily auto-resolve counter for tests. */
export function fakeDailyQuotaStore(initial = 0): DailyQuotaStore & { count: number } {
  const holder = { count: initial };
  return {
    get count() { return holder.count; },
    async todayCount() { return holder.count; },
    async add(_now: number, n: number) { holder.count += n; return holder.count; },
  };
}

export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    triageClient: fakeTriageClient(),
    anthropic: fakeAnthropic([okResponse({ decisions: [] })]),
    cursorStore: fakeCursorStore(),
    auditSink: fakeAuditSink(),
    escalator: fakeEscalator(),
    retryQueue: fakeRetryQueue(),
    costGovernor: fakeCostGovernor(),
    dailyQuotaStore: fakeDailyQuotaStore(),
    clock: fakeClock(),
    logger: createNullLogger(),
    runId: 'run_test',
    ...overrides,
  };
}
