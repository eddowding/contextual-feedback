import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

/**
 * Chainable query builder that models the Supabase PostgREST client.
 * Each method returns the builder itself, allowing chaining.
 * Awaiting the builder resolves to { data, error, count? }.
 */
interface SupabaseQueryBuilder {
  select(columns?: string, options?: { count?: string; head?: boolean }): SupabaseQueryBuilder;
  insert(data: Record<string, unknown>): SupabaseQueryBuilder;
  update(data: Record<string, unknown>): SupabaseQueryBuilder;
  delete(): SupabaseQueryBuilder;
  eq(column: string, value: string): SupabaseQueryBuilder;
  in(column: string, values: string[]): SupabaseQueryBuilder;
  order(column: string, options?: { ascending: boolean }): SupabaseQueryBuilder;
  single(): SupabaseQueryBuilder;
  then(resolve: (value: SupabaseQueryResult) => void, reject?: (reason: unknown) => void): void;
}

interface SupabaseQueryResult {
  data: Record<string, unknown>[] | Record<string, unknown> | null;
  error: { message: string } | null;
  count?: number | null;
}

interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
}

interface SupabaseConfig {
  /** Supabase client instance */
  client: SupabaseClient;
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
 * Supabase adapter for feedback storage
 *
 * @example
 * ```ts
 * import { createClient } from '@supabase/supabase-js';
 * import { createSupabaseAdapter } from 'contextual-feedback/adapters/supabase';
 *
 * const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
 * const adapter = createSupabaseAdapter({ client: supabase });
 * ```
 */
export function createSupabaseAdapter(config: SupabaseConfig): FeedbackAdapter {
  const { client, tableName = 'feedback' } = config;

  function buildUpdateData(updates: FeedbackUpdate): Record<string, unknown> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.status !== undefined) {
      updateData.status = updates.status;
      const resolvedAt = computeResolvedAt(updates.status);
      if (resolvedAt !== undefined) {
        updateData.resolved_at = resolvedAt;
      }
    }

    if (updates.adminNotes !== undefined) {
      updateData.admin_notes = updates.adminNotes;
    }

    if (updates.category !== undefined) {
      updateData.category = updates.category;
    }

    return updateData;
  }

  return {
    async getAll(status?: FeedbackStatus): Promise<Feedback[]> {
      let query = client.from(tableName).select('*');

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows.map(rowToFeedback);
    },

    async getById(id: string): Promise<Feedback | null> {
      const { data, error } = await client.from(tableName).select('*').eq('id', id).single();

      if (error) throw new Error(error.message);
      return data ? rowToFeedback(data as Record<string, unknown>) : null;
    },

    async add(input: FeedbackInput): Promise<Feedback> {
      const { data, error } = await client.from(tableName).insert({
        user_email: input.userEmail,
        page_url: input.pageUrl,
        feedback_text: input.feedbackText,
        status: 'Pending',
        context: input.context || null,
        element_id: input.elementId || null,
        category: input.category || null,
      }).select();

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      return rowToFeedback(rows[0]);
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const updateData = buildUpdateData(updates);

      const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows[0] ? rowToFeedback(rows[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      const { error } = await client.from(tableName).delete().eq('id', id);
      return !error;
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      let query = client.from(tableName).select('*', { count: 'exact', head: true });

      if (status) {
        query = query.eq('status', status);
      }

      const result = await query;
      if (result.error) throw new Error(result.error.message);
      return result.count ?? 0;
    },

    async bulkUpdate(updates: Array<{ id: string } & FeedbackUpdate>): Promise<Feedback[]> {
      const results: Feedback[] = [];

      for (const { id, ...update } of updates) {
        const updateData = buildUpdateData(update);

        const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Record<string, unknown>[];
        if (rows[0]) {
          results.push(rowToFeedback(rows[0]));
        }
      }

      return results;
    }
  };
}

/**
 * SQL schema for creating the feedback table in Supabase
 */
export const SUPABASE_SCHEMA = `
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_updated_at ON feedback;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();
`;
