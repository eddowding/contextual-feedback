# 08 — Decision policy engine  [svc]

## Title
Map model decisions to actions with confidence thresholds, hard rules, and quotas.

## Context
The model proposes; the policy disposes. This is the deterministic gate that turns
`TriageDecision[]` into concrete `RESOLVE` actions, enforcing the rules the model is
**not** trusted to enforce itself (no auto-close of actionable items, confidence floors,
auto-resolve quotas, injection force-escalation). See `README.md` §4–5.

## Scope
**In:** A pure `planActions(decisions, items, policy, dayCounters): ActionPlan` that
returns `{ subsetForJudge: TriageItem[]; resolutions: PlannedResolution[] }` where each
`PlannedResolution` carries the target status, category, note, and an `action` tag
(`auto-resolve` | `escalate` | `would-resolve`).
**Out:** Calling the judge (it returns `subsetForJudge`; the orchestrator runs ticket 07
then re-plans), the actual RESOLVE HTTP (ticket 09), audit writing (ticket 10).

## Detailed spec
- Pure function, fully unit-testable, **no I/O**.
- **Routing to Opus:** `subsetForJudge` = items whose decision is `actionable` |
  `unclear`, `confidence < policy.autoResolveMinConfidence`, or `injectionSuspected`.
  (The orchestrator calls `planActions` once on Pass-1 output to get `subsetForJudge`,
  runs ticket 07, merges refined decisions, then calls `planActions` again to get final
  `resolutions`. Second call's `subsetForJudge` should be empty.)
- **Action mapping** — implement the table in `README.md` §4 exactly:
  - `spam` ≥ `policy.spamMinConfidence` → `Rejected`, category `other`.
  - `praise` ≥ threshold → `Done`, category `praise`.
  - `duplicate` / FAQ-answerable `question` ≥ threshold → `Done`.
  - `actionable` → **always** `In Review` (escalate), category from decision, note carries severity.
  - `unclear`, low-confidence, or `injectionSuspected` → `In Review`.
- **Hard rules (code, not model):**
  - Never `Done`/`Rejected` an `actionable` decision (override to escalate, log).
  - Below `autoResolveMinConfidence` → escalate regardless of disposition.
  - `injectionSuspected` → escalate, never auto-resolve, flag.
  - **Quota:** count planned auto-resolves; if `> policy.maxAutoResolvesPerRun` or it
    would push the day total over `policy.maxAutoResolvesPerDay`, downgrade the excess to
    escalations (oldest-first or lowest-confidence-first) and flag the circuit-break.
- **Notes:** build `adminNotes` from the README §4 templates, prefix `[auto]` / `[triage]`,
  newline-collapse, truncate to 5000 chars (`MAX_ADMIN_NOTES_LENGTH`).
- **Dry-run:** if `policy.dryRun`, every planned resolve becomes action `would-resolve`
  and the orchestrator skips the HTTP write (ticket 09 honours this).
- Validate every `status`/`category` against `VALID_STATUSES` / `VALID_CATEGORIES` before
  emitting (defence-in-depth; RESOLVE re-checks too).

## Acceptance criteria
- [ ] An `actionable` decision at confidence 0.99 still escalates (never auto-closes).
- [ ] `spam` at 0.96 (≥ spam floor) auto-rejects; `spam` at 0.92 escalates (below floor).
- [ ] `injectionSuspected: true` always escalates and is flagged, even with disposition `praise`.
- [ ] Exceeding `maxAutoResolvesPerRun` downgrades the surplus to escalations and flags it.
- [ ] `dryRun` produces `would-resolve` plans and zero actual statuses to write.
- [ ] Every emitted `status`/`category` is in the valid set; notes ≤ 5000 chars, single-line.
- [ ] Second `planActions` call (post-judge) yields empty `subsetForJudge`.

## Test plan (vitest)
- Table-driven: one case per row of README §4 + each hard rule.
- Quota: 15 auto-resolvable items, `maxAutoResolvesPerRun = 10` → 10 resolve, 5 escalate, flag set.
- Injection: `praise` + `injectionSuspected` → escalate.
- Dry-run: all plans `would-resolve`.
- Note length: a 6000-char model note → truncated to 5000, single line.

## Dependencies
03 (types), 06 + 07 (decisions to map).

## Recommended model: **Opus**
This is the safety core — the table-plus-hard-rules logic must be exhaustively correct,
and the quota/injection overrides are where a subtle bug auto-closes real bugs.

## Estimated size: **M**
