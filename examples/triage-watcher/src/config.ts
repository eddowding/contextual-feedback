/**
 * Watcher configuration (README §7). Loaded from env into a typed object with
 * documented defaults and fail-fast validation. Secrets are read from env only
 * — never hardcoded, never logged.
 */

export interface PolicyConfig {
  /** Below this, escalate regardless of disposition. Default 0.90. */
  autoResolveMinConfidence: number;
  /** spam must clear this to auto-reject. Default 0.95. */
  spamMinConfidence: number;
  /** Max auto-resolves planned in a single run. Default 10. */
  maxAutoResolvesPerRun: number;
  /** Max auto-resolves across a UTC day. Default 50. */
  maxAutoResolvesPerDay: number;
  /** Plan decisions + write audit but issue NO RESOLVE writes. Default true. */
  dryRun: boolean;
}

export interface EscalationConfig {
  type: 'slack' | 'webhook' | 'email' | 'none';
  target?: string;
  /** Opt-in: include the (blockquoted/inlined) feedback text in the payload. */
  includeText?: boolean;
}

export interface WatcherConfig {
  // Connection to the host app's contextual-feedback API
  apiBaseUrl: string;
  apiToken: string;
  // Scheduling & idempotency
  pollCron: string;
  cursorStorePath: string;
  seenIdWindow: number;
  // Models (the watcher's own Claude calls)
  classifyModel: string;
  judgeModel: string;
  // Policy
  policy: PolicyConfig;
  // Cost
  maxBatch: number;
  maxSpendPerRunUsd: number;
  maxSpendPerDayUsd: number;
  requestsPerMin: number;
  // Failure handling
  maxRetryAttempts: number;
  retryStorePath: string;
  // Audit & escalation
  auditStorePath: string;
  escalation: EscalationConfig;
}

/** Thrown when required config/secrets are missing or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${key} must be a number, got "${raw}"`);
  }
  return parsed;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new ConfigError(`${key} must be a boolean (true/false), got "${raw}"`);
}

function str(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

const VALID_ESCALATION_TYPES = ['slack', 'webhook', 'email', 'none'] as const;

/**
 * Build a validated WatcherConfig from environment variables.
 *
 * Required (no default — missing → ConfigError):
 *   FEEDBACK_API_BASE_URL, FEEDBACK_API_TOKEN, ANTHROPIC_API_KEY
 *
 * Everything else has a documented default. `policy.dryRun` defaults TRUE.
 */
export function loadConfig(env: Env = process.env): WatcherConfig {
  const apiBaseUrl = env.FEEDBACK_API_BASE_URL;
  const apiToken = env.FEEDBACK_API_TOKEN;
  const anthropicKey = env.ANTHROPIC_API_KEY;

  const missing: string[] = [];
  if (!apiBaseUrl || apiBaseUrl.trim() === '') missing.push('FEEDBACK_API_BASE_URL');
  if (!apiToken || apiToken.trim() === '') missing.push('FEEDBACK_API_TOKEN');
  // ANTHROPIC_API_KEY is consumed by the SDK directly, but we fail fast here so
  // the operator gets one clear error instead of an opaque SDK 401 mid-run.
  if (!anthropicKey || anthropicKey.trim() === '') missing.push('ANTHROPIC_API_KEY');
  if (missing.length > 0) {
    throw new ConfigError(`Missing required env var(s): ${missing.join(', ')}`);
  }

  const escalationType = str(env, 'ESCALATION_TYPE', 'none');
  if (!VALID_ESCALATION_TYPES.includes(escalationType as (typeof VALID_ESCALATION_TYPES)[number])) {
    throw new ConfigError(
      `ESCALATION_TYPE must be one of: ${VALID_ESCALATION_TYPES.join(', ')}, got "${escalationType}"`
    );
  }

  return {
    apiBaseUrl: apiBaseUrl as string,
    apiToken: apiToken as string,
    pollCron: str(env, 'POLL_CRON', '*/5 * * * *'),
    cursorStorePath: str(env, 'CURSOR_STORE_PATH', './.watcher/cursor.json'),
    seenIdWindow: num(env, 'SEEN_ID_WINDOW', 1000),
    classifyModel: str(env, 'CLASSIFY_MODEL', 'claude-sonnet-4-6'),
    judgeModel: str(env, 'JUDGE_MODEL', 'claude-opus-4-8'),
    policy: {
      autoResolveMinConfidence: num(env, 'POLICY_AUTO_RESOLVE_MIN_CONFIDENCE', 0.9),
      spamMinConfidence: num(env, 'POLICY_SPAM_MIN_CONFIDENCE', 0.95),
      maxAutoResolvesPerRun: num(env, 'POLICY_MAX_AUTO_RESOLVES_PER_RUN', 10),
      maxAutoResolvesPerDay: num(env, 'POLICY_MAX_AUTO_RESOLVES_PER_DAY', 50),
      dryRun: bool(env, 'POLICY_DRY_RUN', true),
    },
    maxBatch: num(env, 'MAX_BATCH', 25),
    maxSpendPerRunUsd: num(env, 'MAX_SPEND_PER_RUN_USD', 0.5),
    maxSpendPerDayUsd: num(env, 'MAX_SPEND_PER_DAY_USD', 5.0),
    requestsPerMin: num(env, 'REQUESTS_PER_MIN', 20),
    maxRetryAttempts: num(env, 'MAX_RETRY_ATTEMPTS', 6),
    retryStorePath: str(env, 'RETRY_STORE_PATH', './.watcher/retry.json'),
    auditStorePath: str(env, 'AUDIT_STORE_PATH', './.watcher/audit.jsonl'),
    escalation: {
      type: escalationType as EscalationConfig['type'],
      target: env.ESCALATION_TARGET,
      includeText: bool(env, 'ESCALATION_INCLUDE_TEXT', false),
    },
  };
}
