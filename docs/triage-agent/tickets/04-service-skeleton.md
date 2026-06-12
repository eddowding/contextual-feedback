# 04 — Watcher service skeleton & config  [svc]

## Title
Stand up the triage-watcher service: typed config, dependency wiring, single-run entrypoint.

## Context
Everything that needs the Anthropic SDK, a scheduler, secrets, and durable state lives
outside the library (see `README.md` §1). This ticket creates that deployable and its
config surface so later tickets have a home.

## Scope
**In:** A new package (e.g. `examples/triage-watcher/` in this repo, or a sibling repo):
`package.json` (deps: `@anthropic-ai/sdk`, `contextual-feedback`), `WatcherConfig`
loader (env → typed object with validation/defaults), a `runOnce(config, deps)`
entrypoint that wires the pieces but does nothing yet, structured logging.
**Out:** The poller, classifier, policy, audit, escalation (their own tickets) — this
ticket just defines the seams and a `deps` injection object for them.

## Detailed spec
- `WatcherConfig` per `README.md` §7, loaded from env with safe defaults and **fail-fast
  validation** (missing `apiBaseUrl`/`apiToken`/`ANTHROPIC_API_KEY` → exit non-zero with
  a clear message). `policy.dryRun` defaults **true**.
- A `Deps` interface holding the injectable collaborators: `triageClient`
  (from ticket 01), `anthropic` (the `@anthropic-ai/sdk` client), `cursorStore`
  (ticket 05), `auditSink` (ticket 10), `escalator` (ticket 11), `clock`/`logger`.
  All later tickets implement against `Deps` so the whole pipeline is unit-testable
  with fakes.
- `runOnce(config, deps): Promise<RunSummary>` — the orchestration shell that ticket 14
  fills in. For now it just logs "run start/end" and returns an empty `RunSummary`
  (`{ runId, polled, classified, autoResolved, escalated, failed }`).
- Anthropic client: `new Anthropic()` (resolves `ANTHROPIC_API_KEY` from env per SDK
  default — do not hardcode keys).
- `runId` generated per run (uuid/time-based) and threaded through `Deps` for audit
  correlation — but **kept out of any cached prompt prefix** (see ticket 06 / caching).

## Acceptance criteria
- [ ] `WatcherConfig` loads from env, applies documented defaults, and fails fast on missing secrets.
- [ ] `policy.dryRun` is `true` unless explicitly set false.
- [ ] `runOnce` is callable with a fully-faked `Deps` and returns a `RunSummary` without network access.
- [ ] The Anthropic client is constructed via the SDK default (no inline key).
- [ ] `package.json` depends on `contextual-feedback` and `@anthropic-ai/sdk` only (plus a scheduler in ticket 14).

## Test plan (vitest)
- Config loader: missing `apiToken` → throws/exits; full env → typed object with defaults.
- `runOnce` with fake `Deps` resolves and emits start/end logs; no real fetch/SDK calls.

## Dependencies
01 (triageClient type), 03 (shared types).

## Recommended model: **Sonnet**
Boilerplate config + DI wiring; well-specified, low ambiguity.

## Estimated size: **M**
