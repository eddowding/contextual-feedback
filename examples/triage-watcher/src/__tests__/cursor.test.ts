import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectNewItems,
  commit,
  createFileCursorStore,
  isFresh,
  EMPTY_CURSOR_STATE,
  type ProcessedItem,
} from '../cursor';
import type { TriageItem } from '../lib-imports';
import type { CursorState } from '../types';

function item(id: string, submittedAt: string, status: TriageItem['status'] = 'Pending'): TriageItem {
  return {
    id,
    feedback: 'x',
    page: '/p',
    section: 's',
    elementId: null,
    category: null,
    from: 'a@b.c',
    status,
    submittedAt,
  };
}

const tmpFiles: string[] = [];
function tmpPath(): string {
  const p = join(tmpdir(), `cursor-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => {
  for (const p of tmpFiles.splice(0)) await fs.rm(p, { force: true });
});

describe('selectNewItems / isFresh', () => {
  it('treats everything as fresh on first run (empty state)', () => {
    const { fresh } = selectNewItems([item('a', '2025-01-01T00:00:00Z')], EMPTY_CURSOR_STATE);
    expect(fresh.map(f => f.id)).toEqual(['a']);
  });

  it('does not re-select an escalated In Review item already in seenIds', () => {
    const state: CursorState = { cursorSubmittedAt: '2025-01-01T00:00:01Z', seenIds: ['esc'] };
    const items = [item('esc', '2025-01-01T00:00:01Z', 'In Review'), item('new', '2025-01-01T00:00:05Z')];
    const { fresh } = selectNewItems(items, state);
    expect(fresh.map(f => f.id)).toEqual(['new']);
  });

  it('selects an unseen item that ties the cursor second', () => {
    const state: CursorState = { cursorSubmittedAt: '2025-01-01T00:00:00Z', seenIds: ['a'] };
    // a (seen) and b (same second, unseen): only b is fresh.
    const items = [item('a', '2025-01-01T00:00:00Z'), item('b', '2025-01-01T00:00:00Z')];
    const { fresh } = selectNewItems(items, state);
    expect(fresh.map(f => f.id)).toEqual(['b']);
  });

  it('does not select items strictly before the cursor', () => {
    const state: CursorState = { cursorSubmittedAt: '2025-01-02T00:00:00Z', seenIds: [] };
    expect(isFresh(item('old', '2025-01-01T00:00:00Z'), state)).toBe(false);
  });
});

describe('commit', () => {
  it('advances cursor only over updated/dropped, never failed', () => {
    const processed: ProcessedItem[] = [
      { id: 'a', submittedAt: '2025-01-01T00:00:01Z', outcome: 'updated' },
      { id: 'b', submittedAt: '2025-01-01T00:00:09Z', outcome: 'failed' },
      { id: 'c', submittedAt: '2025-01-01T00:00:03Z', outcome: 'dropped' },
    ];
    const next = commit(EMPTY_CURSOR_STATE, processed, 1000);
    // Max over a (01) and c (03) — NOT b (09, failed).
    expect(next.cursorSubmittedAt).toBe('2025-01-01T00:00:03Z');
    expect(next.seenIds).toEqual(['a', 'c']);
    expect(next.seenIds).not.toContain('b'); // failed stays re-selectable
  });

  it('never regresses the cursor', () => {
    const state: CursorState = { cursorSubmittedAt: '2025-06-01T00:00:00Z', seenIds: [] };
    const next = commit(state, [{ id: 'x', submittedAt: '2025-01-01T00:00:00Z', outcome: 'updated' }], 1000);
    expect(next.cursorSubmittedAt).toBe('2025-06-01T00:00:00Z');
  });

  it('bounds seenIds to the window, evicting oldest', () => {
    let state = EMPTY_CURSOR_STATE;
    const window = 10;
    for (let i = 0; i < window + 5; i++) {
      state = commit(state, [{ id: `id${i}`, submittedAt: `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`, outcome: 'updated' }], window);
    }
    expect(state.seenIds.length).toBe(window);
    expect(state.seenIds).toContain('id14'); // newest retained
    expect(state.seenIds).not.toContain('id0'); // oldest evicted
  });

  it('never evicts the cursor-second cohort, even when it exceeds the window', () => {
    // Regression: a fixed-size ring used to evict same-second ids beyond the
    // window, re-admitting them as fresh next run (double-processing). A whole
    // same-second cohort larger than the window must stay remembered.
    const window = 3;
    const sameSecond = '2025-01-01T00:00:05Z';
    const cohort: ProcessedItem[] = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, submittedAt: sameSecond, outcome: 'updated' as const }));
    const next = commit(EMPTY_CURSOR_STATE, cohort, window);
    expect(next.cursorSubmittedAt).toBe(sameSecond);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(next.seenIds).toContain(id);
    // And none of them re-select on the next run.
    const reappear = ['a', 'b', 'c', 'd', 'e'].map(id => item(id, sameSecond));
    expect(selectNewItems(reappear, next).fresh).toEqual([]);
  });

  it('still trims ids that are strictly before the advanced cursor', () => {
    // Ids at an earlier second than the cursor are excluded by isFresh's
    // `> cursor` test, so they can be evicted without risk.
    let state = EMPTY_CURSOR_STATE;
    const window = 2;
    for (let i = 0; i < 5; i++) {
      state = commit(state, [{ id: `id${i}`, submittedAt: `2025-01-01T00:00:0${i}Z`, outcome: 'updated' }], window);
    }
    expect(state.cursorSubmittedAt).toBe('2025-01-01T00:00:04Z');
    expect(state.seenIds).toContain('id4'); // newest (cursor-second) retained
    expect(state.seenIds).not.toContain('id0'); // oldest, before cursor, evicted
  });

  it('two same-second items: both seen after processing, neither re-processed', () => {
    let state = EMPTY_CURSOR_STATE;
    const items = [item('a', '2025-01-01T00:00:00Z'), item('b', '2025-01-01T00:00:00Z')];
    // Run 1: both fresh, both processed updated.
    const run1 = selectNewItems(items, state);
    expect(run1.fresh.map(f => f.id)).toEqual(['a', 'b']);
    state = commit(state, run1.fresh.map(f => ({ id: f.id, submittedAt: f.submittedAt, outcome: 'updated' as const })), 1000);
    // Run 2: same items reappear → none fresh.
    const run2 = selectNewItems(items, state);
    expect(run2.fresh).toEqual([]);
  });
});

describe('createFileCursorStore', () => {
  it('round-trips save/load', async () => {
    const path = tmpPath();
    const store = createFileCursorStore(path);
    const state: CursorState = { cursorSubmittedAt: '2025-01-01T00:00:00Z', seenIds: ['a', 'b'] };
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('returns empty state when the file is absent', async () => {
    const store = createFileCursorStore(tmpPath());
    expect(await store.load()).toEqual(EMPTY_CURSOR_STATE);
  });

  it('leaves prior state intact if a write never completes the rename', async () => {
    const path = tmpPath();
    const store = createFileCursorStore(path);
    const prior: CursorState = { cursorSubmittedAt: '2025-01-01T00:00:00Z', seenIds: ['prior'] };
    await store.save(prior);
    // Simulate a crashed write: a stray temp file with garbage that never got
    // renamed. load() must still read the committed file, not the temp.
    await fs.writeFile(`${path}.tmp.bogus`, '{ corrupt', 'utf8');
    expect(await store.load()).toEqual(prior);
    await fs.rm(`${path}.tmp.bogus`, { force: true });
  });

  it('tolerates a corrupt target file by returning empty state', async () => {
    const path = tmpPath();
    await fs.writeFile(path, 'not json', 'utf8');
    const store = createFileCursorStore(path);
    expect(await store.load()).toEqual(EMPTY_CURSOR_STATE);
  });
});
