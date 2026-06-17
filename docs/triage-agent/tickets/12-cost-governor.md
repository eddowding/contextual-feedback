# 12 — Cost governor  [svc]

## Title
Enforce per-run and per-day spend caps and rate limits before/around Claude calls.

## Context
An autonomous loop calling a paid API on a public-submission queue needs hard spend
ceilings — a spam flood must not run up an unbounded bill, and a backlog spike must not
burst the rate limit. See `README.md` §6.

## Scope
**In:** A `CostGovernor` with `preflight(batch, model)` (estimate, allow/deny),
`record(usage, model)` (accrue actuals), `withinDailyBudget()`, and a token-bucket
rate limiter around Claude requests; pricing table for the configured models.
**Out:** The model calls themselves (06/07 call the governor), batching size (that's
`config.maxBatch`, applied by the orchestrator).

## Detailed spec
- **Pre-flight estimate.** Before each Claude call, estimate input tokens with
  `client.messages.count_tokens(model, messages, system)` (per `shared/token-counting.md`
  — never `tiktoken`), add an output allowance, multiply by the model's $/MTok (Sonnet
  4.6 $3/$15; Opus 4.8 $5/$25 — from the pricing table). If the **run's** projected spend
  would exceed `maxSpendPerRunUsd`, **deny** → the orchestrator shrinks the batch or defers.
- **Daily governor.** Track accrued spend for the UTC day (persisted). When
  `maxSpendPerDayUsd` is reached: stop calling Claude for the rest of the day, and have
  the orchestrator **escalate-everything** (set new items to In Review without
  classification) rather than silently dropping them — feedback still gets claimed for a
  human. Log + alarm.
- **Rate limiter.** Token-bucket at `config.requestsPerMin`. The SDK already retries
  429/5xx with backoff; the bucket prevents a backlog from issuing a burst that trips the
  limit in the first place.
- **Record actuals.** After each call, `record(response.usage, model)` accrues real cost
  (input + cache-read + output) so the daily total reflects truth, not just estimates.
- Pricing table lives in service config/constants and is the **only** place model prices
  appear (single source).

## Acceptance criteria
- [ ] `preflight` denies a batch whose estimated cost would breach `maxSpendPerRunUsd`.
- [ ] Token estimation uses `count_tokens`, not a heuristic tokenizer.
- [ ] When the daily cap is hit, no further Claude calls are made and new items are escalated-everything (not dropped).
- [ ] `record` accrues actual `usage` (including cache-read tokens) toward the daily total.
- [ ] The rate limiter caps requests/min to the configured value.
- [ ] Daily total persists across process restarts within the same UTC day.

## Test plan (vitest)
- `preflight` with a fake `count_tokens` returning a high count → denied; low count → allowed.
- Daily total at cap → `withinDailyBudget()` false; orchestrator path escalates-everything (assert via fake).
- `record` accumulates two calls' usage → daily total = sum at correct prices.
- Rate limiter: 30 calls with `requestsPerMin: 20` → second-minute calls delayed (fake clock).
- Restart mid-day → persisted daily total reloaded.

## Dependencies
04 (config/Deps), 06 + 07 (callers that consult it).

## Recommended model: **Opus**
The "what happens when the budget runs out" path (escalate-everything vs drop) is a
correctness-of-behaviour decision with real consequences for users' feedback, and the
estimate/accrual math must be right.

## Estimated size: **M**
