import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { TriageItem } from './lib-imports';
import type { CursorState, CursorStore } from './types';

export const EMPTY_CURSOR_STATE: CursorState = { cursorSubmittedAt: null, seenIds: [] };

/**
 * An item is FRESH iff it has not been seen AND it is at-or-after the cursor.
 * Per README §3 idempotency contract:
 *   id ∉ seenIds AND
 *   (cursor == null OR submittedAt > cursor OR (submittedAt == cursor AND id ∉ seenIds))
 * The `id ∉ seenIds` guard makes the equality case safe even before the cursor
 * moves — two items in the same second won't be re-run once both are seen.
 */
export function isFresh(item: TriageItem, state: CursorState): boolean {
  if (state.seenIds.includes(item.id)) return false;
  if (state.cursorSubmittedAt === null) return true;
  if (item.submittedAt > state.cursorSubmittedAt) return true;
  // submittedAt <= cursor and not seen → only fresh on exact-equality ties.
  return item.submittedAt === state.cursorSubmittedAt;
}

/** Pure: the items to process this run. */
export function selectNewItems(items: TriageItem[], state: CursorState): { fresh: TriageItem[] } {
  return { fresh: items.filter(item => isFresh(item, state)) };
}

/** The per-item outcome the cursor needs to decide what advances. */
export interface ProcessedItem {
  id: string;
  submittedAt: string;
  /** updated/dropped advance the cursor + are added to seenIds; failed does neither. */
  outcome: 'updated' | 'dropped' | 'failed';
}

/**
 * Pure: fold processed items into the next state.
 * - Every processed id (incl. failed) is NOT blindly added: only updated/dropped
 *   ids enter seenIds, so failed ids stay re-selectable next run (README §9).
 * - The cursor advances to the max submittedAt among updated/dropped items only.
 * - seenIds is a bounded ring: oldest entries evict once it exceeds the window.
 */
export function commit(
  state: CursorState,
  processed: ProcessedItem[],
  seenIdWindow: number
): CursorState {
  const committed = processed.filter(p => p.outcome === 'updated' || p.outcome === 'dropped');

  // Advance cursor to the max submittedAt over committed items (never regress).
  let cursor = state.cursorSubmittedAt;
  for (const p of committed) {
    if (cursor === null || p.submittedAt > cursor) cursor = p.submittedAt;
  }

  // Append committed ids, preserving order; existing ids keep their position but
  // we de-dupe by rebuilding (newest wins for recency). Then trim to window.
  const next: string[] = [...state.seenIds];
  for (const p of committed) {
    const existingIdx = next.indexOf(p.id);
    if (existingIdx !== -1) next.splice(existingIdx, 1);
    next.push(p.id);
  }
  const trimmed = next.length > seenIdWindow ? next.slice(next.length - seenIdWindow) : next;

  return { cursorSubmittedAt: cursor, seenIds: trimmed };
}

/**
 * Durable cursor store backed by an atomic JSON file (temp-write + rename), so a
 * crash mid-write can't corrupt state. `load()` returns the empty state when the
 * file is absent or unreadable.
 */
export function createFileCursorStore(path: string): CursorStore {
  return {
    async load(): Promise<CursorState> {
      try {
        const raw = await fs.readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as CursorState;
        // Defensive normalisation: tolerate a partially-written/legacy file.
        return {
          cursorSubmittedAt:
            typeof parsed.cursorSubmittedAt === 'string' ? parsed.cursorSubmittedAt : null,
          seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.filter(x => typeof x === 'string') : [],
        };
      } catch {
        return { ...EMPTY_CURSOR_STATE, seenIds: [] };
      }
    },

    async save(state: CursorState): Promise<void> {
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
      const data = JSON.stringify(state);
      // Write fully to a temp file, then atomically rename over the target. The
      // rename is the commit point: a crash before it leaves the prior file
      // intact; a crash after it leaves the complete new file.
      const handle = await fs.open(tmp, 'w');
      try {
        await handle.writeFile(data, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, path);
    },
  };
}
