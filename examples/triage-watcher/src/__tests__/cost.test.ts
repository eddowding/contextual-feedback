import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCostGovernor, costOf, PRICING } from '../cost';
import { fakeClock } from './helpers';
import { createNullLogger } from '../logger';
import type { AnthropicLike } from '../types';

const tmpFiles: string[] = [];
function tmpPath(): string {
  const p = join(tmpdir(), `cost-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => { for (const p of tmpFiles.splice(0)) await fs.rm(p, { force: true }); });

function anthropicWithCount(inputTokens: number): AnthropicLike {
  return {
    messages: {
      async create() { return { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }; },
      async countTokens() { return { input_tokens: inputTokens }; },
    },
  };
}

describe('costOf', () => {
  it('prices fresh input + output + cache read at the model rate', () => {
    const usd = costOf(
      { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
      'claude-sonnet-4-6'
    );
    // 3 (input) + 15 (output) + 0.3 (cache read)
    expect(usd).toBeCloseTo(18.3, 5);
  });

  it('prices an unknown model at the most expensive tier', () => {
    const usd = costOf({ input_tokens: 1_000_000, output_tokens: 0 }, 'mystery-model');
    expect(usd).toBeCloseTo(PRICING['claude-opus-4-8'].inputPerMTok, 5);
  });

  it('never returns a negative cost when a usage component is negative', () => {
    // A malformed/proxy-mangled usage object must not yield a negative cost that
    // would SUBTRACT from accumulated daily spend and let the cap be exceeded.
    const usd = costOf(
      { input_tokens: 100, output_tokens: -100_000_000, cache_read_input_tokens: -5_000 },
      'claude-sonnet-4-6'
    );
    expect(usd).toBeGreaterThanOrEqual(0);
  });

  it('clamps each component independently — negative output ignored, input still priced', () => {
    const usd = costOf({ input_tokens: 1_000_000, output_tokens: -1_000_000 }, 'claude-sonnet-4-6');
    expect(usd).toBeCloseTo(PRICING['claude-sonnet-4-6'].inputPerMTok, 6);
  });
});

describe('createCostGovernor.preflight', () => {
  it('allows a low-token call within the run budget', async () => {
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 0.5, maxSpendPerDayUsd: 5, requestsPerMin: 20, dailyStorePath: tmpPath() },
      { anthropic: anthropicWithCount(1000), clock: fakeClock(), logger: createNullLogger() }
    );
    const res = await gov.preflight({ system: 's', userPrompt: 'p', model: 'claude-sonnet-4-6' });
    expect(res.allowed).toBe(true);
    expect(res.estimatedUsd).toBeGreaterThan(0);
  });

  it('denies a call whose estimate breaches the run budget', async () => {
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 0.0001, maxSpendPerDayUsd: 5, requestsPerMin: 20, dailyStorePath: tmpPath() },
      { anthropic: anthropicWithCount(1_000_000), clock: fakeClock(), logger: createNullLogger() }
    );
    const res = await gov.preflight({ system: 's', userPrompt: 'p', model: 'claude-opus-4-8' });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('run budget');
  });

  it('denies (not throws) when count_tokens fails', async () => {
    const anthropic: AnthropicLike = {
      messages: {
        async create() { return { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }; },
        async countTokens() { throw new Error('api down'); },
      },
    };
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 0.5, maxSpendPerDayUsd: 5, requestsPerMin: 20, dailyStorePath: tmpPath() },
      { anthropic, clock: fakeClock(), logger: createNullLogger() }
    );
    const res = await gov.preflight({ system: 's', userPrompt: 'p', model: 'claude-sonnet-4-6' });
    expect(res.allowed).toBe(false);
  });
});

describe('createCostGovernor — daily budget', () => {
  it('record accrues actuals and withinDailyBudget flips at the cap', async () => {
    const path = tmpPath();
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 1, requestsPerMin: 20, dailyStorePath: path },
      { anthropic: anthropicWithCount(10), clock: fakeClock(), logger: createNullLogger() }
    );
    expect(await gov.withinDailyBudget()).toBe(true);
    // 200k output @ opus $25/MTok = $5 → over the $1 cap.
    await gov.record({ input_tokens: 0, output_tokens: 200_000 }, 'claude-opus-4-8');
    expect(await gov.withinDailyBudget()).toBe(false);
  });

  it('sums two calls at the correct prices', async () => {
    const path = tmpPath();
    const clock = fakeClock();
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 100, requestsPerMin: 20, dailyStorePath: path },
      { anthropic: anthropicWithCount(10), clock, logger: createNullLogger() }
    );
    await gov.record({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-sonnet-4-6'); // $3
    await gov.record({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-opus-4-8'); // $5
    const persisted = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(persisted.spentUsd).toBeCloseTo(8, 5);
  });

  it('reloads the persisted daily total within the same UTC day (restart)', async () => {
    const path = tmpPath();
    const clock = fakeClock(Date.UTC(2026, 0, 15, 12, 0, 0));
    const gov1 = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 100, requestsPerMin: 20, dailyStorePath: path },
      { anthropic: anthropicWithCount(10), clock, logger: createNullLogger() }
    );
    await gov1.record({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-sonnet-4-6'); // $3
    // New governor instance (process restart), same UTC day.
    const gov2 = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 100, requestsPerMin: 20, dailyStorePath: path },
      { anthropic: anthropicWithCount(10), clock, logger: createNullLogger() }
    );
    await gov2.record({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-sonnet-4-6'); // +$3
    const persisted = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(persisted.spentUsd).toBeCloseTo(6, 5);
  });

  it('resets the daily total on a new UTC day', async () => {
    const path = tmpPath();
    await fs.writeFile(path, JSON.stringify({ day: '2026-01-14', spentUsd: 99 }), 'utf8');
    const clock = fakeClock(Date.UTC(2026, 0, 15, 1, 0, 0));
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 100, requestsPerMin: 20, dailyStorePath: path },
      { anthropic: anthropicWithCount(10), clock, logger: createNullLogger() }
    );
    expect(await gov.withinDailyBudget()).toBe(true); // yesterday's spend ignored
  });
});

describe('createCostGovernor — rate limiter', () => {
  it('delays once the bucket is drained, using the injected sleep', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(async (ms: number) => { clock.advance(ms); });
    const gov = createCostGovernor(
      { maxSpendPerRunUsd: 100, maxSpendPerDayUsd: 100, requestsPerMin: 20, dailyStorePath: tmpPath() },
      { anthropic: anthropicWithCount(10), clock, logger: createNullLogger(), sleep }
    );
    // Bucket capacity is 20; first 20 acquireSlot calls are instant.
    for (let i = 0; i < 20; i++) await gov.acquireSlot();
    expect(sleep).not.toHaveBeenCalled();
    // 21st must wait for a refill.
    await gov.acquireSlot();
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
