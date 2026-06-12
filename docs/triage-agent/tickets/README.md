# Triage Agent — Ticket Index

Build order is top-to-bottom: dependencies are always lower-numbered. Library tickets
(01–03) land first so the service can import shared types/clients; the service tickets
(04–14) then build the pipeline, with the orchestrator (14) integrating everything last.

**Legend** — In-lib?: ✅ implemented inside `contextual-feedback`; ❌ implemented in the
separate watcher service. Model: recommended agent model for *building the ticket*.

| # | Title | Model | Size | Depends on | In-lib? |
|---|-------|-------|------|------------|---------|
| 01 | Typed TRIAGE/RESOLVE client | Sonnet | S | — | ✅ |
| 02 | Hardened batch formatter for the classifier | Opus | S | — | ✅ |
| 03 | Shared decision & audit-record types | Sonnet | S | — | ✅ |
| 04 | Watcher service skeleton & config | Sonnet | M | 01, 03 | ❌ |
| 05 | Cursor + seen-set idempotency store | Opus | M | 01, 04 | ❌ |
| 06 | Pass-1 mechanical classifier (Sonnet 4.6) | Opus | M | 02, 03, 04 | ❌ |
| 07 | Pass-2 judgement re-classifier (Opus 4.8) | Opus | M | 02, 03, 04, 06 | ❌ |
| 08 | Decision policy engine | Opus | M | 03, 06, 07 | ❌ |
| 09 | RESOLVE applier | Sonnet | S | 01, 02, 04, 08 | ❌ |
| 10 | Append-only audit log | Sonnet | S | 03, 08, 09 | ❌ |
| 11 | Escalation channel | Sonnet | S | 04, 08, 10 | ❌ |
| 12 | Cost governor | Opus | M | 04, 06, 07 | ❌ |
| 13 | Retry queue for RESOLVE `failed` ids | Sonnet | M | 05, 08, 09, 11 | ❌ |
| 14 | Orchestrator, scheduler, e2e tests & runbook | Opus | L | 01–13 | ❌ |

## Runtime model choices (the watcher's own Claude calls — not the build model above)

| Stage | Model | Why |
|-------|-------|-----|
| Pass 1 — mechanical classification (all items) | `claude-sonnet-4-6` | Cheap, fast; settles spam/praise/duplicate |
| Pass 2 — judgement (actionable / low-confidence subset only) | `claude-opus-4-8` | Decides auto-close vs escalate; runs on the minority of items |

Both passes use adaptive thinking, structured output (`output_config.format`), **no
tools**, and treat feedback text as untrusted data (see `../README.md` §5).

## Suggested milestones

- **M1 — Library helpers (01–03):** ship the typed client, hardened formatter, and shared
  types. Independently useful to any consumer; no Anthropic dependency.
- **M2 — Dry-run pipeline (04–10):** classify + plan + audit, with RESOLVE writes gated
  behind `dryRun`. Validate the policy against real traffic by reading the audit log.
- **M3 — Go-live hardening (11–14):** escalation push, cost caps, retry queue, full
  orchestration + scheduler. Flip `dryRun` to false once M2's audit log looks right.
