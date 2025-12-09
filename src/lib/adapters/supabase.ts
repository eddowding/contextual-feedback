import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

interface SupabaseConfig {
  /** Supabase client instance */
  client: {
    from: (table: string) => {
      select: (columns?: string) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
      insert: (data: Record<string, unknown>) => { select: () => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }> };
      update: (data: Record<string, unknown>) => { eq: (column: string, value: string) => { select: () => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }> } };
      delete: () => { eq: (column: string, value: string) => Promise<{ error: Error | null }> };
    };
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

  return {
    async getAll(status?: FeedbackStatus): Promise<Feedback[]> {
      let query = client.from(tableName).select('*');

      if (status) {
        query = (query as unknown as { eq: (col: string, val: string) => typeof query }).eq('status', status);
      }

      const { data, error } = await (query as unknown as { order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }> }).order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(rowToFeedback);
    },

    async getById(id: string): Promise<Feedback | null> {
      const { data, error } = await (client.from(tableName).select('*') as unknown as { eq: (col: string, val: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: Error | null }> } }).eq('id', id).single();

      if (error) throw error;
      return data ? rowToFeedback(data) : null;
    },

    async add(input: FeedbackInput): Promise<Feedback> {
      const id = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const { data, error } = await client.from(tableName).insert({
        id,
        user_email: input.userEmail,
        page_url: input.pageUrl,
        feedback_text: input.feedbackText,
        status: 'Pending',
        context: input.context || null,
        element_id: input.elementId || null,
        created_at: now,
        updated_at: now,
      }).select();

      if (error) throw error;
      return rowToFeedback(data![0]);
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.status !== undefined) {
        updateData.status = updates.status;
      }

      if (updates.adminNotes !== undefined) {
        updateData.admin_notes = updates.adminNotes;
      }

      const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

      if (error) throw error;
      return data?.[0] ? rowToFeedback(data[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      const { error } = await client.from(tableName).delete().eq('id', id);
      return !error;
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      let query = client.from(tableName).select('*', { count: 'exact', head: true } as unknown as string);

      if (status) {
        query = (query as unknown as { eq: (col: string, val: string) => typeof query }).eq('status', status);
      }

      const { count, error } = await query as unknown as Promise<{ count: number | null; error: Error | null }>;

      if (error) throw error;
      return count || 0;
    }
  };
}

/**
 * SQL schema for creating the feedback table in Supabase
 */
export const SUPABASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id VARCHAR(100) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  page_url VARCHAR(1000) NOT NULL,
  feedback_text TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  context VARCHAR(255),
  element_id VARCHAR(255),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);

-- Optional: Enable Row Level Security
-- ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
`;
