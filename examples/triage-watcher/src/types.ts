/**
 * Service-internal seams: the injectable collaborators (`Deps`) every later
 * ticket implements against, plus the narrow Anthropic surface the classifier
 * (06) and judge (07) use. Keeping `AnthropicLike` narrow (not the full SDK
 * type) lets the model passes be unit-tested with a tiny fake — the real
 * `new Anthropic()` is only constructed in the entrypoint.
 */
import type {
  TriageClient,
  TriageAuditRecord,
  FeedbackStatus,
  FeedbackCategory,
} from './lib-imports';

// ---------------------------------------------------------------------------
// Anthropic surface (narrow)
// ---------------------------------------------------------------------------

/** Token-usage subset we read off a response / count_tokens call. */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** The subset of a `messages.create` response the watcher consumes. */
export interface AnthropicMessageResponse {
  stop_reason: string | null;
  usage: AnthropicUsage;
  /** Structured-output parsed payload (SDK `parsed_output`). */
  parsed_output?: unknown;
  /** Raw content blocks; fallback parse target when parsed_output is absent. */
  content?: Array<{ type: string; text?: string }>;
}

export interface AnthropicTokenCount {
  input_tokens: number;
}

/**
 * Narrow interface over `@anthropic-ai/sdk`'s `client.messages`. The real SDK
 * client satisfies this structurally; tests pass a fake.
 */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<AnthropicMessageResponse>;
    countTokens(body: Record<string, unknown>): Promise<AnthropicTokenCount>;
  };
}

// ---------------------------------------------------------------------------
// Cross-cutting collaborators
// ---------------------------------------------------------------------------

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface Clock {
  /** ms since epoch. */
  now(): number;
  /** ISO 8601 string of the current instant. */
  nowIso(): string;
}

// ---------------------------------------------------------------------------
// Durable stores (interfaces here; implementations in their tickets)
// ---------------------------------------------------------------------------

export interface CursorState {
  cursorSubmittedAt: string | null;
  seenIds: string[];
}

export interface CursorStore {
  load(): Promise<CursorState>;
  save(state: CursorState): Promise<void>;
}

export interface AuditSink {
  append(records: TriageAuditRecord[]): Promise<void>;
}

export interface EscalationItem {
  feedbackId: string;
  summaryNote: string;
  category: FeedbackCategory | null;
  disposition: string;
  confidence: number;
  injectionSuspected: boolean;
  page?: string;
  section?: string;
  /** Optional raw feedback text — only attached when escalation.includeText. */
  text?: string;
}

export interface Escalator {
  notify(items: EscalationItem[]): Promise<void>;
}

export interface RetryRecord {
  attempts: number;
  nextDueAt: number;
}

export interface RetryQueue {
  enqueue(id: string, now: number): Promise<void>;
  /** Ids whose nextDueAt <= now (eligible to be retried this run). */
  dueIds(now: number): Promise<string[]>;
  /** Ids currently held back (nextDueAt > now) — excluded from the batch. */
  notYetDueIds(now: number): Promise<string[]>;
  /** Clear an id after a non-failed outcome. */
  recordOutcome(id: string): Promise<void>;
  /** Ids that have hit the attempt cap and must be force-escalated. */
  exhaustedIds(): Promise<string[]>;
  /** Drop an exhausted id once it has been force-escalated. */
  drop(id: string): Promise<void>;
}

export interface CostGovernor {
  /** Estimate the call's cost and allow/deny against the run budget. */
  preflight(
    args: { system: string; userPrompt: string; model: string; expectedOutputTokens?: number }
  ): Promise<{ allowed: boolean; estimatedUsd: number; reason?: string }>;
  /** Accrue actual usage toward the daily total. */
  record(usage: AnthropicUsage, model: string): Promise<void>;
  /** False once the daily cap is reached. */
  withinDailyBudget(): Promise<boolean>;
  /** Block until a request slot is free (token-bucket rate limit). */
  acquireSlot(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Deps & run output
// ---------------------------------------------------------------------------

export interface Deps {
  triageClient: TriageClient;
  anthropic: AnthropicLike;
  cursorStore: CursorStore;
  auditSink: AuditSink;
  escalator: Escalator;
  retryQueue: RetryQueue;
  costGovernor: CostGovernor;
  clock: Clock;
  logger: Logger;
  /** Per-run correlation id. NEVER interpolated into a cached prompt prefix. */
  runId: string;
}

export interface RunSummary {
  runId: string;
  polled: number;
  classified: number;
  autoResolved: number;
  escalated: number;
  failed: number;
}

export type ToStatus = FeedbackStatus;
export type Category = FeedbackCategory | null;
