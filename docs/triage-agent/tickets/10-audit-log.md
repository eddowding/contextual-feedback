# 10 — Append-only audit log  [svc]

## Title
Write one immutable audit record per item per action, before the cursor advances.

## Context
Every automated action must be reconstructable: what the bot did, to which item, why,
which model decided, and the RESOLVE outcome. The record type is defined in the library
(`TriageAuditRecord`, ticket 03); this ticket implements the append-only sink and the
ordering guarantee that makes a crash mid-run safe. See `README.md` §8.

## Scope
**In:** An `AuditSink` (`append(records: TriageAuditRecord[]): Promise<void>`) over
append-only JSONL (default) or a DB table; a `buildAuditRecords(...)` helper that
assembles records from the plan + `ApplyResult`.
**Out:** Metrics/reporting on top of the log (could be a later ticket), escalation (11).

## Detailed spec
- `buildAuditRecords(runId, plan, applyResult, decisions)` → `TriageAuditRecord[]`, one
  per item, populating every field in the ticket-03 shape: `action`, `toStatus`,
  `category`, `disposition`, `confidence`, `injectionSuspected`, `model`
  (`sonnet`/`opus`/`policy` — which pass made the final call), `note`, `resolveResult`
  (`updated`/`notFound`/`failed`/`dry-run`).
- **Append-only.** JSONL sink opens in append mode, one JSON object per line, fsync (or
  the DB equivalent). Never rewrites or deletes prior lines.
- **Ordering guarantee.** The orchestrator (ticket 14) must call `auditSink.append`
  **before** `cursorStore.commit` for the same items, so a crash after audit/before
  cursor-commit just re-processes (idempotent), and a crash after cursor-commit means the
  audit already exists. The sink itself must therefore be durable on return (fsync).
- `runId` is recorded on every line but is **not** part of any cached prompt prefix.
- Records for `failed` items are written too (action `failed`, `resolveResult: failed`)
  so the trail shows attempts, not just successes.

## Acceptance criteria
- [ ] One record per processed item, with all ticket-03 fields populated.
- [ ] The sink only appends; existing lines are never modified (verified by hashing the prefix before/after).
- [ ] `model` correctly reflects which pass decided (policy-only for hard-rule overrides).
- [ ] Dry-run records carry `action: would-resolve`, `resolveResult: dry-run`.
- [ ] `append` resolves only after the data is durable (fsync / committed).

## Test plan (vitest)
- `buildAuditRecords` over a mixed plan (auto-resolve, escalate, failed, dropped) →
  correct `action`/`resolveResult`/`model` per item.
- Append twice → file has both batches, first batch bytes unchanged.
- Injection-flagged item → `injectionSuspected: true` persisted.
- (Integration) append then read back JSONL → parses to the same records.

## Dependencies
03 (record type), 08 (plan), 09 (ApplyResult).

## Recommended model: **Sonnet**
Well-specified serialization + append semantics; the only subtlety (ordering vs cursor)
is owned by the orchestrator in ticket 14.

## Estimated size: **S**
