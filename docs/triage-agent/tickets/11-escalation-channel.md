# 11 — Escalation channel  [svc]

## Title
Push a human-readable summary for every escalated item to Slack / webhook / email.

## Context
Escalation = the bot set the item to `In Review` (claimed for a human) without a terminal
decision. The human queue *is* "feedback in `In Review`" — already visible via the host
app's admin UI and `GET /api/feedback?status=In Review`. This ticket adds the **push
notification** on top so humans don't have to poll. See `README.md` §4, §"escalation".

## Scope
**In:** An `Escalator` interface (`notify(items: EscalationItem[]): Promise<void>`) with
`slack` / `webhook` / `email` / `none` implementations selected by
`config.escalation.type`.
**Out:** The decision to escalate (policy, 08), the RESOLVE write that sets In Review (09).

## Detailed spec
- `EscalationItem` = `{ feedbackId, summaryNote, category, disposition, confidence,
   injectionSuspected, page, section }` — note: **no raw feedback text or submitter email**
  in the default channel payload (the text is untrusted and may be hostile; the summary
  note is the model's sanitised one-liner). A `config.escalation.includeText` opt-in can
  add the (still-blockquoted/inlined) text for trusted internal channels.
- Implementations:
  - `none` — no-op (default for dry-run validation).
  - `webhook` — POST a JSON array to `config.escalation.target`.
  - `slack` — POST a Slack-formatted message (Block Kit or text) to an incoming-webhook URL.
  - `email` — batched digest to an address (one message per run, not per item).
- **Batch per run**, not per item — one notification carrying all escalations from the
  run, to avoid alert spam.
- **Injection-flagged items are highlighted** (e.g. a ⚠ prefix / distinct colour) so a
  human reviews them first.
- Failures to notify are logged and **do not** fail the run (the In Review status is
  already persisted; the notification is best-effort). A persistent notify failure raises
  an ops alarm but never blocks resolution or cursor advance.
- The escalation payload is built from the audit records / plan — no extra model call.

## Acceptance criteria
- [ ] One batched notification per run containing all escalated items.
- [ ] Default payload excludes raw feedback text and submitter email; includes the sanitised note.
- [ ] `includeText` opt-in adds blockquoted/inlined text only.
- [ ] Injection-flagged items are visually distinguished.
- [ ] A notify failure is logged + alarmed but does not throw out of the run.
- [ ] `type: 'none'` is a clean no-op.

## Test plan (vitest)
- `webhook` escalator with a fake fetch → POSTs the expected JSON array; injection item flagged.
- Default payload assertion: no `from` email, no raw `feedback` field present.
- `includeText: true` → text present and blockquoted.
- Fake transport throws → `notify` resolves (logged), run continues.
- `none` → no network calls.

## Dependencies
04 (config/Deps), 08 (which items escalated), 10 (audit records as source).

## Recommended model: **Sonnet**
Straightforward transport adapters with a clear payload contract.

## Estimated size: **S**
