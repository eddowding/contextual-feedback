# Triage Watcher — operator runbook

An autonomous companion service for `contextual-feedback`. It polls the library's
`TRIAGE` endpoint, classifies new feedback with Claude (two passes: Sonnet 4.6
mechanical → Opus 4.8 judgement), **auto-resolves the trivial cases** via
`RESOLVE`, and **escalates the judgement calls** to a human. Every automated
action is recorded in an append-only audit log.

See `../../docs/triage-agent/README.md` for the full architecture and security
model. This file is the operator's guide.

## What it does, in one breath

`poll → idempotency filter → cost preflight → classify (Sonnet) → policy →
judge ambiguous subset (Opus) → policy → RESOLVE → audit → advance cursor →
escalate`. Audit is written **before** the cursor advances, so a crash mid-run
re-processes safely rather than losing the trail.

## Install & run

```bash
cd examples/triage-watcher
npm install            # pulls @anthropic-ai/sdk, contextual-feedback, croner
npm run typecheck      # typechecks everything incl. cli.ts (needs the SDK installed)

# one-shot (recommended first — see "Rollout" below)
ANTHROPIC_API_KEY=... FEEDBACK_API_BASE_URL=https://app.example.com/api/feedback \
  FEEDBACK_API_TOKEN=... npm run start -- once

# scheduled (cron) service
... npm run start          # defaults to `serve` (cron at POLL_CRON)
```

## Configuration (env)

Required (no default — the process exits non-zero if missing):

| Var | Meaning |
|-----|---------|
| `FEEDBACK_API_BASE_URL` | Base URL of the host's feedback API, e.g. `https://app/api/feedback` |
| `FEEDBACK_API_TOKEN` | Bearer token the host's `config.authorize` accepts for TRIAGE/RESOLVE |
| `ANTHROPIC_API_KEY` | Claude API key (read by the SDK; validated at startup) |

Everything else has a documented default (see `src/config.ts`). The important ones:

| Var | Default | Notes |
|-----|---------|-------|
| `POLICY_DRY_RUN` | `true` | **Starts in dry-run.** Plans + audits, issues NO RESOLVE writes. |
| `POLL_CRON` | `*/5 * * * *` | Cron schedule; runs are non-overlapping. |
| `CLASSIFY_MODEL` | `claude-sonnet-4-6` | Pass-1 mechanical classifier. |
| `JUDGE_MODEL` | `claude-opus-4-8` | Pass-2 judgement (ambiguous subset only). |
| `POLICY_AUTO_RESOLVE_MIN_CONFIDENCE` | `0.90` | Below this → escalate regardless. |
| `POLICY_SPAM_MIN_CONFIDENCE` | `0.95` | spam must clear this to auto-reject. |
| `POLICY_MAX_AUTO_RESOLVES_PER_RUN` | `10` | Circuit breaker per run. |
| `POLICY_MAX_AUTO_RESOLVES_PER_DAY` | `50` | Circuit breaker per UTC day. |
| `MAX_BATCH` | `25` | Items per run. |
| `MAX_SPEND_PER_RUN_USD` | `0.50` | Pre-flight token estimate × price; over → shrink/defer. |
| `MAX_SPEND_PER_DAY_USD` | `5.00` | When hit → escalate-everything (claim for humans, no classify). |
| `REQUESTS_PER_MIN` | `20` | Token-bucket rate limit. |
| `MAX_RETRY_ATTEMPTS` | `6` | RESOLVE `failed` ids retried with backoff up to this, then force-escalated. |
| `ESCALATION_TYPE` | `none` | `slack` / `webhook` / `email` / `none`. |
| `ESCALATION_TARGET` | — | URL for the channel (incoming-webhook / relay). |
| `ESCALATION_INCLUDE_TEXT` | `false` | Opt-in: include (blockquoted) feedback text — trusted channels only. |

Store paths (`CURSOR_STORE_PATH`, `AUDIT_STORE_PATH`, `RETRY_STORE_PATH`) default
under `./.watcher/`. The daily-spend file sits beside the cursor store.

## Rollout (dry-run first)

1. **Run in dry-run** (`POLICY_DRY_RUN=true`, the default) against real traffic.
   No statuses change; the audit log (`AUDIT_STORE_PATH`, JSONL) records what the
   bot *would* have done (`action: would-resolve`, `resolveResult: dry-run`).
2. **Read the audit log.** Spot-check auto-resolve decisions (spam/praise/dup) and
   escalations. Confirm no `actionable` item was ever marked for auto-close
   (it can't be — the policy forbids it — but verify the disposition split looks
   right). Watch `injectionSuspected` hits.
3. **Tune thresholds** in env if the confidence/quota defaults don't fit your
   traffic.
4. **Flip to live** (`POLICY_DRY_RUN=false`). Keep `MAX_AUTO_RESOLVES_PER_DAY`
   conservative for the first days.

## Alarms (grep the JSON logs on stderr for `ALARM:`)

- `daily budget exhausted — escalate-everything` — the day's spend cap was hit;
  new items are claimed (In Review) for humans without classification until the
  UTC day rolls over.
- `Pass 1/2 classifier error — skipping batch` — Claude refused or errored; no
  writes this run; retried next run.
- `escalation notify failed` — the In Review status is already persisted; the
  push notification is best-effort and did not block the run.
- `retry queue giving up on id` — a RESOLVE `failed` id exhausted its attempts and
  was force-escalated for manual handling.
- `plan entry index not in idByIndex` — a structured-output verdict referenced an
  id not in the batch (impossible with a valid model; the security backstop
  dropped it).

## Safety properties (why this is OK to run autonomously)

- **Feedback is untrusted.** The classifier sees feedback only as blockquoted
  data via the library's `formatTriageBatch`; it has no tools and returns
  structured data only; the service re-validates every index against the batch it
  sent. A prompt injection can at most mislabel its own item.
- **Actionable items are never auto-closed.** Bugs/feature requests always go to a
  human (`In Review`), enforced in code, not by the model.
- **Bounded blast radius.** The only write is `RESOLVE` (status + note + category),
  rate-limited and quota-capped, fully audited, reversible.
- **Crash-safe.** Audit append precedes cursor commit; RESOLVE is idempotent on
  status, so replay is a no-op.

## Tests

Run from the repo root: `npx vitest run examples/triage-watcher`. The end-to-end
test (`src/__tests__/e2e.test.ts`) drives the whole loop against the library's
in-memory adapter + `createApiHandlers` as a fake host, with a scripted fake
Anthropic client — no network, no API key needed.
