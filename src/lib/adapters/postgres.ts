import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

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
  };
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

  return {
    async getAll(status?: FeedbackStatus): Promise<Feedback[]> {
      const query = status
        ? `SELECT * FROM ${tableName} WHERE status = $1 ORDER BY created_at DESC`
        : `SELECT * FROM ${tableName} ORDER BY created_at DESC`;
      const params = status ? [status] : [];

      const result = await pool.query(query, params);
      return result.rows.map(rowToFeedback);
    },

    async getById(id: string): Promise<Feedback | null> {
      const result = await pool.query(
        `SELECT * FROM ${tableName} WHERE id = $1`,
        [id]
      );
      return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
    },

    async add(input: FeedbackInput): Promise<Feedback> {
      const id = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const result = await pool.query(
        `INSERT INTO ${tableName} (
          id, user_email, page_url, feedback_text, status,
          context, element_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          id,
          input.userEmail,
          input.pageUrl,
          input.feedbackText,
          'Pending',
          input.context || null,
          input.elementId || null,
          now,
          now
        ]
      );

      return rowToFeedback(result.rows[0]);
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const now = new Date().toISOString();
      const setClauses: string[] = ['updated_at = $1'];
      const values: unknown[] = [now];
      let paramIndex = 2;

      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramIndex}`);
        values.push(updates.status);
        paramIndex++;
      }

      if (updates.adminNotes !== undefined) {
        setClauses.push(`admin_notes = $${paramIndex}`);
        values.push(updates.adminNotes);
        paramIndex++;
      }

      values.push(id);

      const result = await pool.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      const result = await pool.query(
        `DELETE FROM ${tableName} WHERE id = $1`,
        [id]
      );
      return (result as { rowCount?: number }).rowCount === 1;
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      const query = status
        ? `SELECT COUNT(*) as count FROM ${tableName} WHERE status = $1`
        : `SELECT COUNT(*) as count FROM ${tableName}`;
      const params = status ? [status] : [];

      const result = await pool.query(query, params);
      return parseInt(result.rows[0].count as string, 10);
    }
  };
}

/**
 * SQL schema for creating the feedback table
 */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id VARCHAR(100) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  page_url VARCHAR(1000) NOT NULL,
  feedback_text TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  context VARCHAR(255),
  element_id VARCHAR(255),
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
`;
