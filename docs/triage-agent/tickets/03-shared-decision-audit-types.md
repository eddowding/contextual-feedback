# 03 — Shared decision & audit-record types  [lib]

## Title
Export `TriageDisposition`, `TriageDecision`, and `TriageAuditRecord` types from the library.

## Context
The classifier's structured output (ticket 06), the policy engine (ticket 08), the
audit log (ticket 10), and any future admin dashboard all need to agree on one shape
for "a triage decision" and "an audit record". Defining these once in the library —
the same place `TriageItem`, `FeedbackStatus`, and `FeedbackCategory` live — prevents
the service and the host app from drifting.

## Scope
**In:** Type-only additions to `src/lib/ai.ts` (or a new `src/lib/triage-types.ts`
re-exported from `./ai`). A runtime constant `TRIAGE_DISPOSITIONS` for validation.
**Out:** Any logic that produces or consumes these types (other tickets).

## Detailed spec
- `TRIAGE_DISPOSITIONS = ['spam','praise','duplicate','question','actionable','unclear'] as const`
  and `type TriageDisposition = typeof TRIAGE_DISPOSITIONS[number]`.
- `TriageDecision` — the per-item structured verdict the model returns (one per index):
  ```ts
  interface TriageDecision {
    index: number;                 // 1-based, correlates to formatTriageBatch idByIndex
    disposition: TriageDisposition;
    confidence: number;            // 0..1
    category: FeedbackCategory | null;
    injectionSuspected: boolean;
    note: string;                  // model's 1-line rationale (becomes adminNotes basis)
    duplicateOfIndex?: number | null;
  }
  ```
- `TriageAuditRecord` — exactly as in `README.md` §8. Reuse `FeedbackStatus` /
  `FeedbackCategory` from `src/lib/types.ts`.
- All exported via the `contextual-feedback/ai` subpath.
- No behaviour — types + the one `as const` array only. The JSON schema for the model
  (ticket 06) is **derived from** these types but defined service-side (the library
  must stay Anthropic-free).

## Acceptance criteria
- [ ] `TriageDecision`, `TriageAuditRecord`, `TriageDisposition`, `TRIAGE_DISPOSITIONS` all exported from `contextual-feedback/ai`.
- [ ] `TriageAuditRecord` fields and union literals match `README.md` §8.
- [ ] `category` / `toStatus` reference the library's `FeedbackCategory` / `FeedbackStatus`, not string.
- [ ] No new dependencies; no runtime logic beyond the `as const` array.

## Test plan (vitest)
- A type-level test (`expectTypeOf` or a compile-only fixture) asserting a sample
  `TriageDecision` and `TriageAuditRecord` literal type-check.
- `TRIAGE_DISPOSITIONS` includes exactly the six dispositions and is `readonly`.

## Dependencies
None.

## Recommended model: **Sonnet**
Straight type declarations against a spec already written in the README.

## Estimated size: **S**
