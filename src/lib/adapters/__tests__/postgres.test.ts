import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPostgresAdapter } from '../postgres';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb_123',
    user_email: 'user@test.com',
    page_url: 'https://example.com',
    feedback_text: 'Test feedback',
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

describe('createPostgresAdapter', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  describe('table name validation', () => {
    it('accepts valid table names', () => {
      expect(() => createPostgresAdapter({ pool, tableName: 'feedback' })).not.toThrow();
      expect(() => createPostgresAdapter({ pool, tableName: 'my_feedback' })).not.toThrow();
      expect(() => createPostgresAdapter({ pool, tableName: 'public.feedback' })).not.toThrow();
      expect(() => createPostgresAdapter({ pool, tableName: '_private' })).not.toThrow();
    });

    it('rejects table names with SQL injection attempts', () => {
      expect(() => createPostgresAdapter({ pool, tableName: 'feedback; DROP TABLE users' }))
        .toThrow('Invalid table name');
      expect(() => createPostgresAdapter({ pool, tableName: "feedback' OR '1'='1" }))
        .toThrow('Invalid table name');
      expect(() => createPostgresAdapter({ pool, tableName: 'feed back' }))
        .toThrow('Invalid table name');
      expect(() => createPostgresAdapter({ pool, tableName: '' }))
        .toThrow('Invalid table name');
      expect(() => createPostgresAdapter({ pool, tableName: '123start' }))
        .toThrow('Invalid table name');
    });
  });

  describe('getAll', () => {
    it('queries all rows without status filter', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow()] });

      const adapter = createPostgresAdapter({ pool });
      const results = await adapter.getAll();

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM feedback'),
        []
      );
      expect(results).toHaveLength(1);
      expect(results[0].userEmail).toBe('user@test.com');
    });

    it('filters by status using parameterized query', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.getAll('Pending');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        ['Pending']
      );
    });
  });

  describe('getById', () => {
    it('uses parameterized query for id', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow()] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.getById('fb_123');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['fb_123']
      );
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const adapter = createPostgresAdapter({ pool });
      const result = await adapter.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('add', () => {
    it('inserts without id/timestamps (DB generates them)', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow()] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.add({
        userEmail: 'user@test.com',
        pageUrl: 'https://example.com',
        feedbackText: 'Test',
      });

      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('INSERT INTO feedback');
      // DB generates UUID — id should not appear as a standalone column
      expect(call[0]).not.toMatch(/\bid\b\s*,/);
      expect(call[0]).not.toContain('created_at'); // DB generates timestamps
      expect(call[1]).toContain('user@test.com');
      expect(call[1]).toContain('Pending');
    });

    it('includes category in insert', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ category: 'bug' })] });

      const adapter = createPostgresAdapter({ pool });
      const result = await adapter.add({
        userEmail: 'user@test.com',
        pageUrl: 'https://example.com',
        feedbackText: 'Test',
        category: 'bug',
      });

      expect(pool.query.mock.calls[0][1]).toContain('bug');
      expect(result.category).toBe('bug');
    });
  });

  describe('update', () => {
    it('builds parameterized SET clauses', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ status: 'Done' })] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.update('fb_123', { status: 'Done', adminNotes: 'Fixed' });

      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('UPDATE feedback SET');
      expect(call[0]).toContain('status = $');
      expect(call[0]).toContain('admin_notes = $');
      expect(call[0]).toContain('resolved_at = COALESCE(resolved_at, $');
      expect(call[1]).toContain('fb_123');
      expect(call[1]).toContain('Done');
      expect(call[1]).toContain('Fixed');
    });

    it('sets resolved_at for Done status', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ status: 'Done' })] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.update('fb_123', { status: 'Done' });

      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('resolved_at');
      // resolved_at should be a non-null ISO string
      const resolvedAtValue = call[1].find((v: unknown) =>
        typeof v === 'string' && v.includes('T') && v !== 'Done'
      );
      expect(resolvedAtValue).toBeTruthy();
    });

    it.each(['Done', 'Rejected'] as const)(
      'preserves an existing resolved_at via COALESCE when re-applying %s',
      async (status) => {
        pool.query.mockResolvedValue({ rows: [makeRow({ status })] });

        const adapter = createPostgresAdapter({ pool });
        await adapter.update('fb_123', { status });

        // COALESCE keeps the original resolution timestamp on retried/idempotent
        // RESOLVE calls instead of overwriting it with a fresh one.
        expect(pool.query.mock.calls[0][0]).toContain('resolved_at = COALESCE(resolved_at, $');
      }
    );

    it('clears resolved_at with a plain assignment for In Review', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ status: 'In Review' })] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.update('fb_123', { status: 'In Review' });

      const call = pool.query.mock.calls[0];
      expect(call[0]).not.toContain('COALESCE');
      expect(call[0]).toContain('resolved_at = $');
      expect(call[1]).toContain(null);
    });

    it('clears resolved_at for Pending status', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ status: 'Pending' })] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.update('fb_123', { status: 'Pending' });

      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('resolved_at');
      expect(call[1]).toContain(null);
    });

    it('updates category', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow({ category: 'feature' })] });

      const adapter = createPostgresAdapter({ pool });
      await adapter.update('fb_123', { category: 'feature' });

      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('category = $');
      expect(call[1]).toContain('feature');
    });
  });

  describe('delete', () => {
    it('returns true when a row is returned and uses a parameterized RETURNING query', async () => {
      pool.query.mockResolvedValue({ rows: [{ id: 'fb_123' }] });

      const adapter = createPostgresAdapter({ pool });
      const deleted = await adapter.delete!('fb_123');

      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM feedback WHERE id = $1 RETURNING id',
        ['fb_123']
      );
      expect(deleted).toBe(true);
    });

    it('returns false when no row is returned (missing id)', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const adapter = createPostgresAdapter({ pool });
      expect(await adapter.delete!('missing')).toBe(false);
    });

    it('does not depend on rowCount (RETURNING is driver-agnostic)', async () => {
      // The declared pool type has no rowCount; a successful delete must report
      // true from the RETURNING rows alone, even when the driver omits rowCount.
      pool.query.mockResolvedValue({ rows: [{ id: 'fb_123' }] });

      const adapter = createPostgresAdapter({ pool });
      expect(await adapter.delete!('fb_123')).toBe(true);
    });
  });

  describe('query error propagation', () => {
    // The API layer's 500 handling relies on adapter errors propagating.
    it('getAll rejects when pool.query rejects', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const adapter = createPostgresAdapter({ pool });
      await expect(adapter.getAll()).rejects.toThrow('connection refused');
    });

    it('add rejects when pool.query rejects', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const adapter = createPostgresAdapter({ pool });
      await expect(
        adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'x' })
      ).rejects.toThrow('connection refused');
    });

    it('update rejects when pool.query rejects', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const adapter = createPostgresAdapter({ pool });
      await expect(adapter.update('fb_123', { status: 'Done' })).rejects.toThrow(
        'connection refused'
      );
    });
  });

  describe('bulkUpdate', () => {
    function createMockPoolWithClient() {
      const client = {
        query: vi.fn(),
        release: vi.fn(),
      };
      const poolWithConnect = {
        query: vi.fn(),
        connect: vi.fn().mockResolvedValue(client),
      };
      return { poolWithConnect, client };
    }

    it('runs the whole transaction on a single checked-out client when pool.connect exists', async () => {
      const { poolWithConnect, client } = createMockPoolWithClient();
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'Done' })] })
        .mockResolvedValueOnce({}); // COMMIT

      const adapter = createPostgresAdapter({ pool: poolWithConnect });
      const results = await adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }]);

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query.mock.calls[1][0]).toContain('UPDATE feedback SET');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      // Nothing runs through the pool itself — that would use other connections.
      expect(poolWithConnect.query).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalledOnce();
      expect(results.updated).toHaveLength(1);
      // Atomic adapter: success means no per-item failures.
      expect(results.failed).toHaveLength(0);
    });

    it('rolls back on the same client and still releases it on error', async () => {
      const { poolWithConnect, client } = createMockPoolWithClient();
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({}); // ROLLBACK

      const adapter = createPostgresAdapter({ pool: poolWithConnect });
      await expect(adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }])).rejects.toThrow('DB error');

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
      expect(poolWithConnect.query).not.toHaveBeenCalled();
    });

    it('wraps in a transaction on the bare connection when there is no connect()', async () => {
      pool.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'Done' })] })
        .mockResolvedValueOnce({}); // COMMIT

      const adapter = createPostgresAdapter({ pool });
      await adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }]);

      expect(pool.query).toHaveBeenCalledWith('BEGIN');
      expect(pool.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back on error without connect()', async () => {
      pool.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({}); // ROLLBACK

      const adapter = createPostgresAdapter({ pool });
      await expect(adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }])).rejects.toThrow('DB error');

      expect(pool.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('falls back to the bare connection when connect() is a pg Client connect (rejects when already connected)', async () => {
      const clientLikePool = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [makeRow({ status: 'Done' })] })
          .mockResolvedValueOnce({}), // COMMIT
        connect: vi.fn().mockRejectedValue(new Error('Client has already been connected')),
      };

      const adapter = createPostgresAdapter({ pool: clientLikePool });
      const results = await adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }]);

      expect(clientLikePool.query).toHaveBeenCalledWith('BEGIN');
      expect(clientLikePool.query).toHaveBeenCalledWith('COMMIT');
      expect(results.updated).toHaveLength(1);
    });
  });

  describe('getCount', () => {
    it('returns parsed count', async () => {
      pool.query.mockResolvedValue({ rows: [{ count: '42' }] });

      const adapter = createPostgresAdapter({ pool });
      const count = await adapter.getCount!();
      expect(count).toBe(42);
    });
  });

  describe('rowToFeedback mapping', () => {
    it('maps category and resolvedAt from row', async () => {
      pool.query.mockResolvedValue({
        rows: [makeRow({ category: 'bug', resolved_at: '2025-06-01T00:00:00Z' })],
      });

      const adapter = createPostgresAdapter({ pool });
      const results = await adapter.getAll();

      expect(results[0].category).toBe('bug');
      expect(results[0].resolvedAt).toBe('2025-06-01T00:00:00Z');
    });

    it('returns undefined for null category and resolved_at', async () => {
      pool.query.mockResolvedValue({ rows: [makeRow()] });

      const adapter = createPostgresAdapter({ pool });
      const results = await adapter.getAll();

      expect(results[0].category).toBeUndefined();
      expect(results[0].resolvedAt).toBeUndefined();
    });
  });

  describe('custom table name', () => {
    it('uses custom table name in queries', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const adapter = createPostgresAdapter({ pool, tableName: 'my_feedback' });
      await adapter.getAll();

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM my_feedback'),
        []
      );
    });
  });
});
