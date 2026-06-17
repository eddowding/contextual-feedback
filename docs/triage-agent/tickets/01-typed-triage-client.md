# 01 — Typed TRIAGE/RESOLVE client  [lib]

## Title
Add a dependency-free typed HTTP client for the `TRIAGE` and `RESOLVE` endpoints.

## Context
The watcher (and any other consumer) needs a typed way to call the two endpoints
`createApiHandlers` exposes (`src/api/handlers.ts`: `TRIAGE` GET, `RESOLVE` POST).
Today a caller would hand-roll `fetch` and re-derive the response shapes. Ship the
shapes and a thin client in the library so the contract is defined once, beside the
handlers that produce it.

## Scope
**In:** A `createTriageClient({ baseUrl, token, fetch? })` returning
`{ getTriage(), resolve(resolutions) }`; request/response types matching the handlers'
JSON exactly; export from the `contextual-feedback/ai` subpath.
**Out:** Polling, retries, batching, any Anthropic code (those are service-side).

## Detailed spec
- New file `src/lib/triage-client.ts`.
- Types must mirror `handlers.ts` byte-for-byte in shape:
  - `TriageResponse = { items: TriageItem[]; summary: { pending: number; inReview: number; total: number } }` — reuse the exported `TriageItem` from `src/lib/ai.ts`.
  - `Resolution = { id: string; status?: FeedbackStatus; adminNotes?: string; category?: FeedbackCategory }` (reuse types from `src/lib/types.ts`).
  - `ResolveResponse = { updated: Feedback[]; notFound: string[]; failed: string[] }`.
- `getTriage()` → `GET {baseUrl}/triage` with `Authorization: Bearer {token}`,
  `Accept: application/json`. Throw a typed `TriageHttpError` (carrying `status`,
  `body`) on non-200.
- `resolve(resolutions)` → `POST {baseUrl}/resolve`, `Content-Type: application/json`
  (required — handlers reject non-JSON with 415), body `{ resolutions }`. Return the
  parsed `ResolveResponse` for **both** 200 and 500 (a 500 still has the
  `{updated, notFound, failed}` body per handlers.ts — surface it, don't throw, so the
  caller can read `failed`). Throw `TriageHttpError` only on other non-2xx/500 codes or
  unparseable bodies.
- Accept an injectable `fetch` (default `globalThis.fetch`) so it is testable and
  runtime-agnostic (Node 18+, edge, workers).
- Zero new dependencies. No retry/backoff here (ticket 13 owns retry).
- Export the client + types from `src/lib/ai.ts`'s public surface (the `./ai`
  subpath already in `package.json` exports) — or add a re-export so
  `import { createTriageClient } from 'contextual-feedback/ai'` works.

## Acceptance criteria
- [ ] `getTriage()` issues a GET with the bearer header and parses `{items, summary}`.
- [ ] `resolve()` issues a JSON POST and returns the parsed body on 200 **and** 500.
- [ ] Non-200/500 (e.g. 401, 415) throws `TriageHttpError` with `status` + `body`.
- [ ] Types compile against the actual `TriageItem` / `Feedback` / `FeedbackStatus` exports; no duplicated literal types.
- [ ] No new entries in `package.json` dependencies.
- [ ] Importable via `contextual-feedback/ai`.

## Test plan (vitest)
- Mock `fetch`; assert method, URL, headers, and JSON body for both calls.
- 200 TRIAGE → returns typed object. 401 → throws `TriageHttpError(status=401)`.
- RESOLVE 500 with `{updated:[],notFound:[],failed:['x']}` → returns body, no throw.
- RESOLVE 415 → throws (proves Content-Type is set so this shouldn't happen in prod,
  but the error path is covered).

## Dependencies
None.

## Recommended model: **Sonnet**
Mechanical typed-client work against a known contract; no deep reasoning needed.

## Estimated size: **S**
