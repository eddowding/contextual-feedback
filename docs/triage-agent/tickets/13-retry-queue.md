# 13 — Retry queue for RESOLVE `failed` ids  [svc]

## Title
Retry `RESOLVE` failures with backoff; distinguish them from `notFound` drops.

## Context
`handlers.ts` deliberately splits the RESOLVE response into `failed` (errored — db outage,
RLS misconfig — **retry**) and `notFound` (no matching row — **drop**). The watcher must
honour that distinction: failed ids stay re-selectable and are retried with backoff;
notFound ids are dropped. See `README.md` §9 and ticket 09.

## Scope
**In:** A `RetryQueue` (`enqueue(failedIds, attempt)`, `dueItems(now)`,
`recordOutcome(...)`) with exponential backoff + jitter and a max-attempts alarm; durable
across runs.
**Out:** The RESOLVE call itself (09 owns it — the queue just decides *when* an id is due),
the cursor logic (05 already keeps failed ids selectable).

## Detailed spec
- Because failed ids remain in `TRIAGE` (still Pending/In Review) and are **not** added to
  `seenIds` (ticket 05), the simplest retry is "they get re-selected next run naturally".
  The queue adds **backoff + a cap** on top so a persistently-failing id (e.g. a poisoned
  row) doesn't get hammered every 5 minutes forever.
- State: per failing id, `{ attempts, nextDueAt }`, persisted (default JSON/SQLite,
  `config` path).
- On a `failed` outcome from ticket 09: `enqueue(id, attempts+1)`, set
  `nextDueAt = now + backoff(attempts)` (exponential, capped, jittered).
- The orchestrator (14), when selecting the batch, **excludes** failed ids whose
  `nextDueAt > now` (so the seen-set says "fresh" but the retry queue says "not yet").
- On a later `updated`/`notFound` for a previously-failed id → `recordOutcome` clears it
  from the queue.
- After `maxRetryAttempts` (config, default 6 ≈ several hours of backoff), stop retrying,
  **escalate** the item (force In Review with a note "[triage] auto-resolve failed N times,
  needs manual handling") and raise an ops alarm.
- A whole-batch 500 (all failed) enqueues every id in the batch.

## Acceptance criteria
- [ ] A `failed` id is enqueued with an increasing `nextDueAt` per attempt.
- [ ] An id whose `nextDueAt` is in the future is excluded from the next batch even if the seen-set considers it fresh.
- [ ] A subsequent `updated`/`notFound` clears the id from the queue.
- [ ] After `maxRetryAttempts`, the id is force-escalated with an explanatory note and alarmed (not retried forever).
- [ ] Queue state persists across runs.

## Test plan (vitest)
- Enqueue same id 3× → `nextDueAt` grows exponentially (with jitter bounds).
- `dueItems(now)` with one past-due and one future → only past-due returned.
- Record `updated` for a queued id → removed.
- 7th failure with cap 6 → escalation plan emitted + alarm; id no longer retried.
- Persist + reload → queue intact.

## Dependencies
05 (seen-set interplay), 09 (failed outcomes), 08/11 (escalation on give-up).

## Recommended model: **Sonnet**
Standard backoff-queue mechanics; the only cross-cutting subtlety (seen-set vs
nextDueAt) is explicitly specified above.

## Estimated size: **M**
