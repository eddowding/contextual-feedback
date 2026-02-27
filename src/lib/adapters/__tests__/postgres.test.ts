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
      expect(call[0]).toContain('resolved_at = $');
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

  describe('bulkUpdate', () => {
    it('wraps in transaction', async () => {
      pool.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'Done' })] })
        .mockResolvedValueOnce({}); // COMMIT

      const adapter = createPostgresAdapter({ pool });
      await adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }]);

      expect(pool.query).toHaveBeenCalledWith('BEGIN');
      expect(pool.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back on error', async () => {
      pool.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({}); // ROLLBACK

      const adapter = createPostgresAdapter({ pool });
      await expect(adapter.bulkUpdate!([{ id: 'fb_1', status: 'Done' }])).rejects.toThrow('DB error');

      expect(pool.query).toHaveBeenCalledWith('ROLLBACK');
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
