# 14 — Orchestrator, scheduler, end-to-end tests & runbook  [svc]

## Title
Wire the full poll→classify→act→audit→escalate loop, schedule it, and prove it end-to-end.

## Context
Every piece exists in isolation (tickets 01–13). This ticket assembles them into the
`runOnce` body, attaches a scheduler with non-overlapping runs, adds an integration test
against an in-memory host app, and writes the operator runbook. See `README.md` §2
sequence and §3 scheduling.

## Scope
**In:** The `runOnce` orchestration; a scheduler (cron, `concurrency: 1`); an end-to-end
test using the library's **memory adapter** + `createApiHandlers` as a fake host;
operator docs (env, dry-run rollout, alarms).
**Out:** Re-implementing any component — this ticket only sequences them.

## Detailed spec
- **`runOnce` sequence** (exact order matters for crash-safety):
  1. `triageClient.getTriage()` → items.
  2. `cursorStore` + `retryQueue` → `fresh` items (exclude seen; exclude not-yet-due failed).
  3. Apply `config.maxBatch` cap.
  4. `costGovernor.preflight` → shrink/defer if over run budget; if daily budget blown →
     escalate-everything path (no classification).
  5. `formatTriageBatch(fresh)` → prompt + `idByIndex`.
  6. `classifyBatch` (Sonnet, ticket 06) → decisions; `costGovernor.record`.
  7. `planActions` (08) → `subsetForJudge` + provisional resolutions.
  8. `judgeBatch` (Opus, 07) on the subset; merge; `costGovernor.record`; `planActions` again → final resolutions.
  9. `applyPlan` (09) → RESOLVE (skipped under dry-run) → `byId` outcomes.
  10. `buildAuditRecords` + `auditSink.append` (10) — **before** step 11.
  11. `cursorStore.commit` (updated/dropped advance; failed don't); `retryQueue.enqueue` failed; `retryQueue.recordOutcome` cleared.
  12. `escalator.notify` (11) for In Review items (best-effort).
  13. Return `RunSummary`.
- **Scheduler:** cron at `config.pollCron`, **non-overlapping** (`concurrency: 1` or a
  process lock) so two ticks can't double-classify. A long run skips the next tick rather
  than stacking.
- **Crash-safety check:** audit append precedes cursor commit (idempotent replay).
- **Rollout:** ship with `dryRun: true`; the runbook documents validating the audit log
  against real traffic, then flipping to live.

## Acceptance criteria
- [ ] End-to-end: seed a memory adapter with spam + praise + a bug + an injection-laced item via `createApiHandlers`; run `runOnce`; assert spam→Rejected, praise→Done, bug→In Review, injection→In Review+flagged, audit log has 4 records, escalation fired for 2.
- [ ] Re-running `runOnce` immediately processes **zero** items (idempotency holds).
- [ ] Dry-run mode writes audit (`would-resolve`) and makes **no** RESOLVE status changes (verify via the adapter).
- [ ] Audit append happens before cursor commit (assert ordering, e.g. via a crash injected between them leaving state replayable).
- [ ] Scheduler does not start a second run while one is in flight.
- [ ] A simulated RESOLVE `failed` id is retried next run and not lost; a `notFound` id is dropped.

## Test plan (vitest)
- Build the fake host from `createApiHandlers({ adapter: memoryAdapter, authorize: ()=>true })`
  and a `triageClient` pointed at it (in-process fetch shim).
- Fake Anthropic client returns scripted decisions for the seeded items.
- Assertions per acceptance criteria; plus a dry-run run asserting adapter statuses unchanged.
- Crash-injection: throw between audit append and cursor commit → re-run reprocesses
  safely (no double RESOLVE because RESOLVE is idempotent on status, and audit shows two attempts).

## Dependencies
01–13 (this is the integration layer). Build last.

## Recommended model: **Opus**
The sequencing — especially the audit-before-cursor ordering, the daily-budget
escalate-everything branch, and the idempotent crash-replay — is where the whole system's
correctness lives; the e2e test design is non-trivial.

## Estimated size: **L**
