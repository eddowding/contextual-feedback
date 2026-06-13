import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { AnthropicLike, AnthropicUsage, Clock, CostGovernor, Logger } from './types';

/**
 * Per-model pricing in USD per million tokens. THE SINGLE SOURCE of model prices
 * (README §6). cacheRead is the discounted read price for cached input.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
};

function pricingFor(model: string): ModelPricing {
  const p = PRICING[model];
  if (!p) {
    // Unknown model → price defensively at the most expensive tier so an
    // unconfigured model can never under-estimate and blow the budget.
    return { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 };
  }
  return p;
}

/** Cost of a call given its usage and model price. */
export function costOf(usage: AnthropicUsage, model: string): number {
  const p = pricingFor(model);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  // input_tokens excludes cache reads in the SDK's accounting; price them apart.
  const freshInput = Math.max(0, usage.input_tokens);
  return (
    (freshInput / 1_000_000) * p.inputPerMTok +
    (cacheRead / 1_000_000) * p.cacheReadPerMTok +
    (usage.output_tokens / 1_000_000) * p.outputPerMTok
  );
}

interface DailyState {
  /** UTC date key YYYY-MM-DD. */
  day: string;
  spentUsd: number;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface CostGovernorConfig {
  maxSpendPerRunUsd: number;
  maxSpendPerDayUsd: number;
  requestsPerMin: number;
  dailyStorePath: string;
}

export interface CostGovernorDeps {
  anthropic: AnthropicLike;
  clock: Clock;
  logger: Logger;
  /** Injectable sleep (ms) so the rate limiter is testable with a fake clock. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Cost governor: pre-flight estimate (via count_tokens, NEVER a heuristic
 * tokenizer), daily spend cap (persisted per UTC day), and a token-bucket rate
 * limiter. `withinDailyBudget()` gates the orchestrator's escalate-everything
 * branch when the day's cap is hit.
 */
export function createCostGovernor(config: CostGovernorConfig, deps: CostGovernorDeps): CostGovernor {
  const { anthropic, clock, logger } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let daily: DailyState | null = null;
  // Spend projected within the CURRENT run by preflight estimates (reset by the
  // orchestrator between runs by constructing a fresh governor, or naturally via
  // record() reconciling to actuals). Tracked to enforce maxSpendPerRunUsd.
  let runProjectedUsd = 0;

  // ---- token-bucket rate limiter ----------------------------------------
  const capacity = Math.max(1, config.requestsPerMin);
  let tokens = capacity;
  let lastRefillMs = clock.now();
  const refillPerMs = capacity / 60_000;

  async function loadDaily(): Promise<DailyState> {
    const today = utcDay(clock.now());
    if (daily && daily.day === today) return daily;
    try {
      const raw = await fs.readFile(config.dailyStorePath, 'utf8');
      const parsed = JSON.parse(raw) as DailyState;
      daily = parsed.day === today ? parsed : { day: today, spentUsd: 0 };
    } catch {
      daily = { day: today, spentUsd: 0 };
    }
    return daily;
  }

  async function saveDaily(): Promise<void> {
    if (!daily) return;
    await fs.mkdir(dirname(config.dailyStorePath), { recursive: true });
    const tmp = `${config.dailyStorePath}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(daily), 'utf8');
    await fs.rename(tmp, config.dailyStorePath);
  }

  function refill(): void {
    const now = clock.now();
    const elapsed = now - lastRefillMs;
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
      lastRefillMs = now;
    }
  }

  return {
    async preflight(args): Promise<{ allowed: boolean; estimatedUsd: number; reason?: string }> {
      const state = await loadDaily();
      let inputTokens: number;
      try {
        const count = await anthropic.messages.countTokens({
          model: args.model,
          system: args.system,
          messages: [{ role: 'user', content: args.userPrompt }],
        });
        inputTokens = count.input_tokens;
      } catch (err) {
        logger.warn('count_tokens failed; denying to be safe', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { allowed: false, estimatedUsd: 0, reason: 'count_tokens failed' };
      }

      const outputAllowance = args.expectedOutputTokens ?? 2000;
      const estimatedUsd = costOf(
        { input_tokens: inputTokens, output_tokens: outputAllowance },
        args.model
      );

      // Deny if this call would push the RUN over its cap.
      if (runProjectedUsd + estimatedUsd > config.maxSpendPerRunUsd) {
        return {
          allowed: false,
          estimatedUsd,
          reason: `run budget: ${(runProjectedUsd + estimatedUsd).toFixed(4)} > ${config.maxSpendPerRunUsd}`,
        };
      }
      // Deny if this call would push the DAY over its cap.
      if (state.spentUsd + estimatedUsd > config.maxSpendPerDayUsd) {
        return {
          allowed: false,
          estimatedUsd,
          reason: `daily budget: ${(state.spentUsd + estimatedUsd).toFixed(4)} > ${config.maxSpendPerDayUsd}`,
        };
      }

      runProjectedUsd += estimatedUsd;
      return { allowed: true, estimatedUsd };
    },

    async record(usage: AnthropicUsage, model: string): Promise<void> {
      const state = await loadDaily();
      const actual = costOf(usage, model);
      state.spentUsd += actual;
      await saveDaily();
    },

    async withinDailyBudget(): Promise<boolean> {
      const state = await loadDaily();
      return state.spentUsd < config.maxSpendPerDayUsd;
    },

    async acquireSlot(): Promise<void> {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      // Not enough tokens — wait until one refills. With a fake clock the test
      // advances time; in production this is a real sleep.
      const needMs = Math.ceil((1 - tokens) / refillPerMs);
      await sleep(needMs);
      refill();
      tokens = Math.max(0, tokens - 1);
    },
  };
}
