import { buildFeedbackSchemaSql } from '../schema';
import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
function validateTableName(name: string): string {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name "${name}". Must match /^[a-zA-Z_][a-zA-Z0-9_.]*$/.`);
  }
  return name;
}

interface PostgresQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

interface PostgresPoolClient extends PostgresQueryable {
  release: () => void;
}

interface PostgresConfig {
  /** pg Pool or Client instance */
  pool: PostgresQueryable & {
    /**
     * Present on a pg Pool. Used by bulkUpdate to run all statements on a
     * single checked-out connection so BEGIN/COMMIT form a real transaction.
     */
    connect?: () => Promise<PostgresPoolClient | void>;
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

      if (updates.status === 'Done' || updates.status === 'Rejected') {
        // SQL form of the shared resolvedAt convention (see computeResolvedAt
        // in lib/types.ts and the FeedbackAdapter.update JSDoc): COALESCE
        // preserves the original resolution timestamp when the item is already
        // resolved — retried/idempotent RESOLVE calls must not corrupt
        // resolution-latency history.
        setClauses.push(`resolved_at = COALESCE(resolved_at, $${paramIndex})`);
        values.push(now);
        paramIndex++;
      } else {
        // Pending / In Review — clear any previous resolution
        setClauses.push(`resolved_at = $${paramIndex}`);
        values.push(null);
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
      const runUpdates = async (executor: PostgresQueryable): Promise<Feedback[]> => {
        const results: Feedback[] = [];

        for (const { id, ...update } of updates) {
          const now = new Date().toISOString();
          const { setClauses, values, paramIndex } = buildUpdateClauses(update, now);

          values.push(id);

          const result = await executor.query(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
          );

          if (result.rows[0]) {
            results.push(rowToFeedback(result.rows[0]));
          }
        }

        return results;
      };

      // With a pg Pool, each pool.query() may run on a DIFFERENT connection, so
      // BEGIN/COMMIT through the pool would not form a real transaction (and
      // could leave a connection stuck 'idle in transaction'). Check out a
      // single client and run everything on it. A pg Client also exposes
      // connect() (resolving void / throwing when already connected), so we
      // duck-type the resolved value before trusting it as a pool client.
      let client: PostgresPoolClient | undefined;
      if (typeof pool.connect === 'function') {
        try {
          const candidate = await pool.connect();
          if (
            candidate &&
            typeof candidate.query === 'function' &&
            typeof candidate.release === 'function'
          ) {
            client = candidate;
          }
        } catch {
          // Not a Pool (e.g. an already-connected pg Client) — fall through.
        }
      }

      if (client) {
        try {
          await client.query('BEGIN');
          const results = await runUpdates(client);
          await client.query('COMMIT');
          return results;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }

      // Bare single-connection client: its query() always runs on the one
      // connection, so an explicit transaction is safe and correct here.
      await pool.query('BEGIN');
      try {
        const results = await runUpdates(pool);
        await pool.query('COMMIT');
        return results;
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  };
}

/**
 * SQL schema for creating the feedback table.
 *
 * Built from the shared base DDL in lib/schema.ts (one source of truth across
 * POSTGRES_SCHEMA, SUPABASE_SCHEMA and SUPABASE_SETUP_SQL).
 */
export const POSTGRES_SCHEMA = buildFeedbackSchemaSql('CURRENT_TIMESTAMP');
