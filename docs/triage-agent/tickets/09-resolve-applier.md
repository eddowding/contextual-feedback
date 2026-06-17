# 09 — RESOLVE applier  [svc]

## Title
Apply the action plan via the `RESOLVE` endpoint and split the result into updated/notFound/failed.

## Context
The policy engine (ticket 08) produces a plan of resolutions (real `feedbackId`s mapped
from indices via `idByIndex`). This ticket sends them to `POST /resolve` (via the
ticket-01 client) and interprets the `{ updated, notFound, failed }` response per the
endpoint's documented contract (`handlers.ts`).

## Scope
**In:** An `applyPlan(plan, deps, config): Promise<ApplyResult>` that maps plan indices →
real ids, calls `triageClient.resolve(...)`, and returns
`{ updated, notFound, failed, byId }` for the audit + cursor + retry stages.
**Out:** Building the plan (08), writing audit records (10), the retry loop (13).

## Detailed spec
- Map each `PlannedResolution.index` → real id via the run's `idByIndex` (from ticket 02,
  carried through `Deps`). **Re-check** the id was part of the batch sent (security
  backstop): drop + alarm any plan entry whose index isn't in `idByIndex`.
- Build `resolutions: { id, status, adminNotes, category }[]`. Omit fields the plan
  doesn't set (RESOLVE treats absent fields as no-change).
- **Dry-run:** if any plan entry is `would-resolve` (i.e. `policy.dryRun`), do **not**
  call `resolve`; return an `ApplyResult` with everything tagged `dry-run`.
- Call `triageClient.resolve(resolutions)`. The client returns the body on 200 **and**
  500 (ticket 01) — read `{ updated, notFound, failed }` from both.
- Interpret per `handlers.ts` semantics:
  - `updated` (Feedback[]) → success; emit per-id success for audit; eligible to advance cursor.
  - `notFound` (string[]) → row gone / RLS-filtered; **drop** (audit `dropped`, add to seenIds).
  - `failed` (string[]) → errored; **retry** (do not advance cursor, do not add to seenIds).
- Build a `byId` map so audit (10) and cursor commit (05) can look up each id's outcome.
- Surface the case where the whole call was a 500 with empty `updated` + non-empty
  `failed` → treat the entire batch as `failed` (retry), per `README.md` §9.

## Acceptance criteria
- [ ] Plan indices are mapped to real ids via `idByIndex`; unknown indices are dropped + alarmed.
- [ ] `would-resolve` plans (dry-run) issue **no** RESOLVE call and return `dry-run` outcomes.
- [ ] A 200 response splits correctly into updated/notFound/failed `byId`.
- [ ] A 500 response body is read (not thrown) and `failed` ids are surfaced for retry.
- [ ] Absent plan fields are omitted from the `resolutions` payload (no spurious status changes).

## Test plan (vitest)
- Fake client returns `{updated:[{id:'a'}],notFound:['b'],failed:['c']}` → `byId` has
  a=updated, b=notFound, c=failed.
- Dry-run plan → `resolve` not called; outcomes all `dry-run`.
- Plan entry with an index not in `idByIndex` → dropped + alarm logged; rest still sent.
- 500 body with `failed:['x']` → x surfaced as failed, no throw.

## Dependencies
01 (client), 02 (idByIndex), 08 (plan), 04 (Deps).

## Recommended model: **Sonnet**
Mechanical mapping + response-bucket handling against a precisely documented contract.

## Estimated size: **S**
