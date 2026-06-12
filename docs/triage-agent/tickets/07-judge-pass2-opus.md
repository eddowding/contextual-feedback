# 07 — Pass-2 judgement re-classifier (Opus 4.8)  [svc]

## Title
Re-judge ambiguous items with Claude Opus 4.8 to decide resolve-vs-escalate.

## Context
Pass 1 (ticket 06, Sonnet) settles noise/niceties cheaply but should not make the
judgement call on `actionable` items or anything low-confidence. Those go to Opus, which
decides whether the item is genuinely closeable or needs a human, and writes the admin
note. Running Opus only on this subset is the core cost control (`README.md` §6).

## Scope
**In:** A `judgeBatch(subset, deps, config): Promise<TriageDecision[]>` calling
`config.judgeModel` ("claude-opus-4-8") over only the items Pass 1 routed to it.
**Out:** The selection of which items to re-judge (that's policy, ticket 08, which calls
this), RESOLVE.

## Detailed spec
- Input: the `TriageItem`s whose Pass-1 decision was `actionable`, `unclear`, or
  `confidence < autoResolveMinConfidence`, **or** `injectionSuspected`. (The caller —
  ticket 08 — computes the subset; this ticket just judges what it's given.)
- Model: **`claude-opus-4-8`**, `thinking: { type: 'adaptive' }`,
  `output_config: { effort: 'high' }` (judgement task).
- Same security posture as ticket 06: `formatTriageBatch` input, structured output, **no
  tools**, index-based correlation, index re-validation, `injectionSuspected` honoured.
- The Opus system prompt additionally asks for: a sharper `disposition` (it may downgrade
  a Pass-1 `actionable` to `duplicate`/`question` if it sees a closeable case, or confirm
  escalation), a **severity 1–5** for actionable items (folded into the note), and a
  crisp one-line `note` suitable as `adminNotes`.
- The system/policy prefix is **cached** and frozen (separate breakpoint from Pass 1,
  since it's a different model — caches are model-scoped, `shared/prompt-caching.md`).
- Opus 4.8 narrates more by default and asks more often — the system prompt must instruct
  it to **decide, not ask** ("you are operating autonomously; never ask a clarifying
  question — escalate instead") and to keep notes to one line. (Per Opus 4.8 migration
  guidance.)
- Returns refined `TriageDecision[]` for the subset, with usage for the cost governor.
- Refusal / error handling identical to ticket 06 (throw, skip batch).

## Acceptance criteria
- [ ] Calls `claude-opus-4-8` with adaptive thinking, `effort: high`, structured output, no tools.
- [ ] Only the ambiguous subset is sent (verified by the caller; this fn judges its input).
- [ ] Returns refined decisions with a one-line `note` and severity folded in for actionable items.
- [ ] System prompt instructs decide-don't-ask; output never contains a question back to a human as the note.
- [ ] Cached/frozen prefix; batch after the breakpoint.
- [ ] Refusal/error → typed error, no partial actions.

## Test plan (vitest)
- Fake client returns refined decisions for a 3-item subset → mapped correctly.
- Assert request: opus model id, `effort: high`, no tools, cache_control on system.
- A Pass-1 `actionable` item the judge confirms → still escalate; one it downgrades to
  `duplicate` with high confidence → eligible for auto-resolve (policy decides in 08).
- Refusal → throws.

## Dependencies
02, 03, 04, 06 (shares the formatter/schema/error patterns).

## Recommended model: **Opus**
The judge prompt is the highest-stakes reasoning surface (it decides what gets
auto-closed); designing it and its guardrails warrants Opus.

## Estimated size: **M**
