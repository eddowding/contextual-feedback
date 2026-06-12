import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseAdapter } from '../supabase';

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'single', 'maybeSingle'] as const;

type RecordingBuilder = {
  [K in (typeof CHAIN_METHODS)[number]]: ReturnType<typeof vi.fn>;
};

/**
 * Recording mock for the Supabase PostgREST client. Each `from()` call
 * produces a fresh builder whose chain methods are vi.fn()s returning the
 * builder, and awaiting the builder resolves the next queued result (or a
 * default empty result). This lets tests assert exactly which methods were
 * called with which arguments, per query.
 */
function createMockClient() {
  const builders: RecordingBuilder[] = [];
  const resultQueue: QueryResult[] = [];
  const defaultResult: QueryResult = { data: [], error: null };

  const makeBuilder = (): RecordingBuilder => {
    const builder = {} as RecordingBuilder & { then: unknown };
    for (const method of CHAIN_METHODS) {
      builder[method] = vi.fn().mockReturnValue(builder);
    }
    builder.then = (resolve: (value: QueryResult) => void) => {
      resolve(resultQueue.length > 0 ? resultQueue.shift()! : defaultResult);
    };
    builders.push(builder);
    return builder;
  };

  const from = vi.fn(() => makeBuilder());

  return {
    client: { from },
    from,
    /** Builders in creation order — one per from() call. */
    builders,
    /** Queue a result; consumed in FIFO order, one per awaited query. */
    queueResult: (result: QueryResult) => {
      resultQueue.push(result);
    },
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb_1',
    user_email: 'user@test.com',
    page_url: 'https://example.com',
    feedback_text: 'Test',
    status: 'Pending',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    admin_notes: null,
    context: null,
    element_id: null,
    category: null,
    resolved_at: null,
    ...overrides,
  };
}

describe('createSupabaseAdapter', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mock = createMockClient();
  });

  const makeAdapter = (tableName?: string) =>
    createSupabaseAdapter({ client: mock.client as any, ...(tableName ? { tableName } : {}) });

  describe('table name', () => {
    it('calls from() with the default table name', async () => {
      await makeAdapter().getAll();
      expect(mock.from).toHaveBeenCalledWith('feedback');
    });

    it('uses a custom table name', async () => {
      await makeAdapter('my_feedback').getAll();
      expect(mock.from).toHaveBeenCalledWith('my_feedback');
    });
  });

  describe('getAll', () => {
    it('returns mapped feedback ordered by created_at descending', async () => {
      mock.queueResult({ data: [makeRow()], error: null });

      const results = await makeAdapter().getAll();

      const builder = mock.builders[0];
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(builder.eq).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].userEmail).toBe('user@test.com');
      expect(results[0].feedbackText).toBe('Test');
    });

    it('filters by status via eq("status", status)', async () => {
      await makeAdapter().getAll('Pending');

      expect(mock.builders[0].eq).toHaveBeenCalledWith('status', 'Pending');
    });

    it('throws on supabase error', async () => {
      mock.queueResult({ data: null, error: { message: 'Auth error' } });

      await expect(makeAdapter().getAll()).rejects.toThrow('Auth error');
    });
  });

  describe('getById', () => {
    it('calls eq("id", id).maybeSingle() and maps the row', async () => {
      mock.queueResult({ data: makeRow({ id: 'fb_42' }), error: null });

      const result = await makeAdapter().getById('fb_42');

      const builder = mock.builders[0];
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('id', 'fb_42');
      expect(builder.maybeSingle).toHaveBeenCalled();
      expect(result?.id).toBe('fb_42');
    });

    it('returns null when no row matches (maybeSingle yields data: null, no error)', async () => {
      // .single() would surface PGRST116 here and break the adapter contract;
      // .maybeSingle() resolves { data: null, error: null } for zero rows.
      mock.queueResult({ data: null, error: null });

      const result = await makeAdapter().getById('missing');

      expect(mock.builders[0].maybeSingle).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('throws on error', async () => {
      mock.queueResult({ data: null, error: { message: 'Auth error' } });

      await expect(makeAdapter().getById('missing')).rejects.toThrow('Auth error');
    });
  });

  describe('add', () => {
    it('inserts a snake_case payload with status Pending and null-coalesced optionals', async () => {
      mock.queueResult({ data: [makeRow()], error: null });

      const result = await makeAdapter().add({
        userEmail: 'user@test.com',
        pageUrl: 'https://example.com',
        feedbackText: 'Test',
      });

      expect(mock.builders[0].insert).toHaveBeenCalledWith({
        user_email: 'user@test.com',
        page_url: 'https://example.com',
        feedback_text: 'Test',
        status: 'Pending',
        context: null,
        element_id: null,
        category: null,
      });
      expect(mock.builders[0].select).toHaveBeenCalled();
      expect(result.id).toBe('fb_1');
      expect(result.status).toBe('Pending');
      expect(result.category).toBeUndefined();
    });

    it('passes through context, elementId and category when provided', async () => {
      mock.queueResult({ data: [makeRow({ category: 'bug' })], error: null });

      await makeAdapter().add({
        userEmail: 'user@test.com',
        pageUrl: 'https://example.com',
        feedbackText: 'Test',
        context: 'Pricing Table',
        elementId: 'pricing',
        category: 'bug',
      });

      expect(mock.builders[0].insert).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'Pricing Table',
          element_id: 'pricing',
          category: 'bug',
        })
      );
    });

    it('throws on insert error', async () => {
      mock.queueResult({ data: null, error: { message: 'Insert failed' } });

      await expect(
        makeAdapter().add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'x' })
      ).rejects.toThrow('Insert failed');
    });

    it('throws an actionable error when the insert returns no rows (e.g. RLS without SELECT)', async () => {
      // Anon INSERT granted but not SELECT: insert().select() succeeds with
      // data: [] — must not crash with a TypeError from rowToFeedback(undefined).
      mock.queueResult({ data: [], error: null });

      await expect(
        makeAdapter().add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'x' })
      ).rejects.toThrow(/RLS SELECT policy/);
    });
  });

  describe('update', () => {
    it.each(['Done', 'Rejected'] as const)(
      'sets resolved_at to an ISO string when first transitioning to %s',
      async (status) => {
        // First query: preserveResolvedAt fetch (no existing resolution)
        mock.queueResult({ data: { resolved_at: null }, error: null });
        // Second query: the update itself
        mock.queueResult({ data: [makeRow({ status })], error: null });

        await makeAdapter().update('fb_1', { status });

        const updateBuilder = mock.builders[1];
        const payload = updateBuilder.update.mock.calls[0][0];
        expect(payload.status).toBe(status);
        expect(payload.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(payload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'fb_1');
      }
    );

    it('preserves the existing resolved_at when re-applying a resolved status', async () => {
      mock.queueResult({ data: { resolved_at: '2025-03-01T12:00:00Z' }, error: null });
      mock.queueResult({ data: [makeRow({ status: 'Done' })], error: null });

      await makeAdapter().update('fb_1', { status: 'Done', adminNotes: 'still fixed' });

      // First builder is the resolved_at lookup
      const fetchBuilder = mock.builders[0];
      expect(fetchBuilder.select).toHaveBeenCalledWith('resolved_at');
      expect(fetchBuilder.eq).toHaveBeenCalledWith('id', 'fb_1');
      expect(fetchBuilder.single).toHaveBeenCalled();

      const payload = mock.builders[1].update.mock.calls[0][0];
      expect(payload.resolved_at).toBe('2025-03-01T12:00:00Z');
      expect(payload.admin_notes).toBe('still fixed');
    });

    it.each(['Pending', 'In Review'] as const)(
      'sets resolved_at to null for %s without fetching the existing row',
      async (status) => {
        mock.queueResult({ data: [makeRow({ status })], error: null });

        await makeAdapter().update('fb_1', { status });

        // Only one query — no preserveResolvedAt lookup
        expect(mock.builders).toHaveLength(1);
        const payload = mock.builders[0].update.mock.calls[0][0];
        expect(payload.resolved_at).toBeNull();
      }
    );

    it('omits status and resolved_at but always sets updated_at when status is absent', async () => {
      mock.queueResult({ data: [makeRow()], error: null });

      await makeAdapter().update('fb_1', { adminNotes: 'note', category: 'feature' });

      expect(mock.builders).toHaveLength(1);
      const payload = mock.builders[0].update.mock.calls[0][0];
      expect(payload).not.toHaveProperty('status');
      expect(payload).not.toHaveProperty('resolved_at');
      expect(payload.admin_notes).toBe('note');
      expect(payload.category).toBe('feature');
      expect(payload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns null when no rows match', async () => {
      mock.queueResult({ data: [], error: null });

      const result = await makeAdapter().update('missing', { adminNotes: 'x' });
      expect(result).toBeNull();
    });

    it('throws on update error', async () => {
      mock.queueResult({ data: null, error: { message: 'Update failed' } });

      await expect(makeAdapter().update('fb_1', { adminNotes: 'x' })).rejects.toThrow(
        'Update failed'
      );
    });
  });

  describe('delete', () => {
    it('returns true when a row was deleted (delete().select() returns it)', async () => {
      mock.queueResult({ data: [makeRow()], error: null });

      const deleted = await makeAdapter().delete!('fb_1');

      const builder = mock.builders[0];
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('id', 'fb_1');
      expect(builder.select).toHaveBeenCalled();
      expect(deleted).toBe(true);
    });

    it('returns false for a missing id (PostgREST reports no error for zero affected rows)', async () => {
      mock.queueResult({ data: [], error: null });

      const deleted = await makeAdapter().delete!('missing');
      expect(deleted).toBe(false);
    });

    it('returns false when error is set', async () => {
      mock.queueResult({ data: null, error: { message: 'RLS denied' } });

      const deleted = await makeAdapter().delete!('fb_1');
      expect(deleted).toBe(false);
    });
  });

  describe('getCount', () => {
    it('uses a head/count query and returns the count', async () => {
      mock.queueResult({ data: null, error: null, count: 7 });

      const count = await makeAdapter().getCount!();

      expect(mock.builders[0].select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(count).toBe(7);
    });

    it('filters by status', async () => {
      mock.queueResult({ data: null, error: null, count: 2 });

      const count = await makeAdapter().getCount!('Done');

      expect(mock.builders[0].eq).toHaveBeenCalledWith('status', 'Done');
      expect(count).toBe(2);
    });

    it('returns 0 when count is null', async () => {
      mock.queueResult({ data: null, error: null, count: null });

      expect(await makeAdapter().getCount!()).toBe(0);
    });

    it('throws on error', async () => {
      mock.queueResult({ data: null, error: { message: 'Count failed' } });

      await expect(makeAdapter().getCount!()).rejects.toThrow('Count failed');
    });
  });

  describe('bulkUpdate', () => {
    it('updates each id and returns the mapped rows', async () => {
      // fb_1: preserve fetch + update; fb_2: preserve fetch + update
      mock.queueResult({ data: { resolved_at: null }, error: null });
      mock.queueResult({ data: [makeRow({ id: 'fb_1', status: 'Done' })], error: null });
      mock.queueResult({ data: { resolved_at: null }, error: null });
      mock.queueResult({ data: [makeRow({ id: 'fb_2', status: 'Rejected' })], error: null });

      const results = await makeAdapter().bulkUpdate!([
        { id: 'fb_1', status: 'Done' },
        { id: 'fb_2', status: 'Rejected' },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('fb_1');
      expect(results[1].id).toBe('fb_2');
      // Update builders (indexes 1 and 3) target the right ids
      expect(mock.builders[1].eq).toHaveBeenCalledWith('id', 'fb_1');
      expect(mock.builders[3].eq).toHaveBeenCalledWith('id', 'fb_2');
    });

    it('skips ids whose update matches no rows', async () => {
      mock.queueResult({ data: { resolved_at: null }, error: null });
      mock.queueResult({ data: [makeRow({ id: 'fb_1', status: 'Done' })], error: null });
      mock.queueResult({ data: null, error: { message: 'not found' } }); // preserve fetch ignored
      mock.queueResult({ data: [], error: null }); // update matches nothing

      const results = await makeAdapter().bulkUpdate!([
        { id: 'fb_1', status: 'Done' },
        { id: 'missing', status: 'Done' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('fb_1');
    });

    it('continues past an item whose update errors and omits it from the results', async () => {
      // PostgREST has no transactions, so earlier updates are already committed
      // when a later one fails — throwing would report total failure after a
      // partial commit. Failed items are skipped and surface in the caller's diff.
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // fb_1: preserve fetch + failing update; fb_2: preserve fetch + successful update
      mock.queueResult({ data: { resolved_at: null }, error: null });
      mock.queueResult({ data: null, error: { message: 'Bulk failed' } });
      mock.queueResult({ data: { resolved_at: null }, error: null });
      mock.queueResult({ data: [makeRow({ id: 'fb_2', status: 'Done' })], error: null });

      const results = await makeAdapter().bulkUpdate!([
        { id: 'fb_1', status: 'Done' },
        { id: 'fb_2', status: 'Done' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('fb_2');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('fb_1'));

      consoleSpy.mockRestore();
    });
  });
});
