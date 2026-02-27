import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
function validateTableName(name: string): string {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name "${name}". Must match /^[a-zA-Z_][a-zA-Z0-9_.]*$/.`);
  }
  return name;
}

interface PostgresConfig {
  /** pg Pool or Client instance */
  pool: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  };
  /** Table name. Defaults to 'feedback' */
  tableName?: string;
}

function rowToFeedback(row: Record<string, unknown>): Feedback {
  return {
    id: row.id as string,
    userEmail: row.user_email as string,
    pageUrl: row.page_url as string,
    feedbackText: row.feedback_text as string,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    adminNotes: (row.admin_notes as string) || undefined,
    context: (row.context as string) || undefined,
    elementId: (row.element_id as string) || undefined,
    category: (row.category as string as Feedback['category']) || undefined,
    resolvedAt: (row.resolved_at as string) || undefined,
  };
}

/** Compute resolvedAt based on status transition */
function computeResolvedAt(status: FeedbackStatus | undefined): string | null | undefined {
  if (status === 'Done' || status === 'Rejected') return new Date().toISOString();
  if (status === 'Pending' || status === 'In Review') return null;
  return undefined; // no status change
}

/**
 * PostgreSQL adapter for feedback storage
 *
 * @example
 * ```ts
 * import { Pool } from 'pg';
 * import { createPostgresAdapter } from 'contextual-feedback/adapters/postgres';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const adapter = createPostgresAdapter({ pool });
 * ```
 */
export function createPostgresAdapter(config: PostgresConfig): FeedbackAdapter {
  const { pool, tableName = 'feedback' } = config;
  const table = validateTableName(tableName);

  function buildUpdateClauses(updates: FeedbackUpdate, now: string) {
    const setClauses: string[] = ['updated_at = $1'];
    const values: unknown[] = [now];
    let paramIndex = 2;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(updates.status);
      paramIndex++;

      const resolvedAt = computeResolvedAt(updates.status);
      if (resolvedAt !== undefined) {
        setClauses.push(`resolved_at = $${paramIndex}`);
        values.push(resolvedAt);
        paramIndex++;
      }
    }

    if (updates.adminNotes !== undefined) {
      setClauses.push(`admin_notes = $${paramIndex}`);
      values.push(updates.adminNotes);
      paramIndex++;
    }

    if (updates.category !== undefined) {
      setClauses.push(`category = $${paramIndex}`);
      values.push(updates.category);
      paramIndex++;
    }

    return { setClauses, values, paramIndex };
  }

  return {
    async getAll(status?: FeedbackStatus): Promise<Feedback[]> {
      const query = status
        ? `SELECT * FROM ${table} WHERE status = $1 ORDER BY created_at DESC`
        : `SELECT * FROM ${table} ORDER BY created_at DESC`;
      const params = status ? [status] : [];

      const result = await pool.query(query, params);
      return result.rows.map(rowToFeedback);
    },

    async getById(id: string): Promise<Feedback | null> {
      const result = await pool.query(
        `SELECT * FROM ${table} WHERE id = $1`,
        [id]
      );
      return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
    },

    async add(input: FeedbackInput): Promise<Feedback> {
      const result = await pool.query(
        `INSERT INTO ${table} (
          user_email, page_url, feedback_text, status,
          context, element_id, category
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          input.userEmail,
          input.pageUrl,
          input.feedbackText,
          'Pending',
          input.context || null,
          input.elementId || null,
          input.category || null,
        ]
      );

      return rowToFeedback(result.rows[0]);
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const now = new Date().toISOString();
      const { setClauses, values, paramIndex } = buildUpdateClauses(updates, now);

      values.push(id);

      const result = await pool.query(
        `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      const result = await pool.query(
        `DELETE FROM ${table} WHERE id = $1`,
        [id]
      );
      return (result as { rowCount?: number }).rowCount === 1;
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      const query = status
        ? `SELECT COUNT(*) as count FROM ${table} WHERE status = $1`
        : `SELECT COUNT(*) as count FROM ${table}`;
      const params = status ? [status] : [];

      const result = await pool.query(query, params);
      return parseInt(result.rows[0].count as string, 10);
    },

    async bulkUpdate(updates: Array<{ id: string } & FeedbackUpdate>): Promise<Feedback[]> {
      const results: Feedback[] = [];

      await pool.query('BEGIN');
      try {
        for (const { id, ...update } of updates) {
          const now = new Date().toISOString();
          const { setClauses, values, paramIndex } = buildUpdateClauses(update, now);

          values.push(id);

          const result = await pool.query(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
          );

          if (result.rows[0]) {
            results.push(rowToFeedback(result.rows[0]));
          }
        }
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }

      return results;
    }
  };
}

/**
 * SQL schema for creating the feedback table
 */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email VARCHAR(255) NOT NULL,
  page_url VARCHAR(2000) NOT NULL,
  feedback_text TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'In Review', 'Done', 'Rejected')),
  category VARCHAR(50)
    CHECK (category IS NULL OR category IN ('bug', 'feature', 'praise', 'question', 'other')),
  context VARCHAR(255),
  element_id VARCHAR(255),
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_updated_at ON feedback;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();
`;
