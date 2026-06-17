# 05 — Cursor + seen-set idempotency store  [svc]

## Title
Implement durable cursor/seen-set so the watcher never re-triages an item.

## Context
`TRIAGE` returns Pending **and** In Review items every call (`handlers.ts`:
`getAll('Pending')` + `getAll('In Review')`). After the bot escalates an item to
`In Review`, that item keeps appearing in `TRIAGE` — so without a seen-set the bot would
re-triage its own escalations forever. `submittedAt` (from `Feedback.createdAt`) is not
unique, so a cursor alone can skip or duplicate ties. We need both. See `README.md` §3.

## Scope
**In:** A `CursorStore` with `load()` / `save()` over durable storage (JSON file or
SQLite), and a pure `selectNewItems(items, state)` that returns the items to process
plus the next state.
**Out:** Polling/HTTP (the client owns that), classification, RESOLVE.

## Detailed spec
- State shape: `{ cursorSubmittedAt: string | null; seenIds: string[] }` (seenIds a
  bounded ring of the most recent `seenIdWindow` ids, default 1000).
- `selectNewItems(items: TriageItem[], state): { fresh: TriageItem[]; }` — pure:
  an item is **fresh** iff `id ∉ seenIds` AND
  (`cursorSubmittedAt == null` OR `submittedAt > cursorSubmittedAt` OR
  (`submittedAt == cursorSubmittedAt` AND `id ∉ seenIds`)).
  (The `id ∉ seenIds` check makes the equality case safe even before the cursor moves.)
- `commit(state, processedItems): newState` — pure: add every processed `id` to
  `seenIds` (trim to window, evicting oldest), set `cursorSubmittedAt` to the **max**
  `submittedAt` among processed items that resulted in `updated`/`dropped` (NOT items
  that came back `failed` — those must remain re-selectable; see `README.md` §9).
- Persistence: `save(state)` writes atomically (temp file + rename, or a single-row
  upsert) so a crash mid-write can't corrupt state. `load()` returns the empty state on
  first run.
- Storage path from `config.cursorStorePath`.

## Acceptance criteria
- [ ] An escalated (now `In Review`) item that reappears in `TRIAGE` is **not** re-selected (it's in `seenIds`).
- [ ] Two items with identical `submittedAt`: first run processes one, both get `seenIds`; neither is re-processed next run.
- [ ] `failed` items are NOT added to `seenIds` and the cursor does not advance past them — they're re-selected next run.
- [ ] `seenIds` never exceeds the configured window (oldest evicted).
- [ ] `save()`/`load()` round-trip; a partial write (simulated) leaves the prior state intact.

## Test plan (vitest)
- Tie case: two items, same second → exactly one processed per the policy, both seen.
- Re-poll with an already-seen In Review item → `fresh` is empty.
- `commit` with a mix of updated + failed → cursor advances only over updated; failed stays selectable.
- Window eviction: push window+5 ids → length == window, newest retained.
- Atomic write: kill between temp-write and rename (mock) → `load()` returns old state.

## Dependencies
04 (config + Deps), 01 (TriageItem via client types).

## Recommended model: **Opus**
The idempotency invariant is the whole point of the watcher and the tie/failed edge
cases are subtle — a bug here means re-triaging or silently dropping real feedback.

## Estimated size: **M**
