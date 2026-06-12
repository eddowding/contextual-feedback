import { buildFeedbackSchemaSql } from '../schema';
import { computeResolvedAt, Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

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
  maybeSingle(): SupabaseQueryBuilder;
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

function isResolvedStatus(status: FeedbackStatus | undefined): boolean {
  return status === 'Done' || status === 'Rejected';
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

  /**
   * When re-applying a resolved status (Done/Rejected), keep the original
   * resolution timestamp so retried/idempotent RESOLVE calls — or a PATCH that
   * re-sends status while editing adminNotes — don't corrupt
   * resolution-latency history. PostgREST can't express COALESCE in an update,
   * so fetch the current value first. Fetch errors (e.g. missing row) are
   * deliberately ignored: the subsequent update returns no rows and the
   * caller handles that as before.
   */
  async function preserveResolvedAt(
    id: string,
    updates: FeedbackUpdate,
    updateData: Record<string, unknown>
  ): Promise<void> {
    if (!isResolvedStatus(updates.status)) return;

    const { data, error } = await client
      .from(tableName)
      .select('resolved_at')
      .eq('id', id)
      .single();

    if (error) return;
    const existing = (data as Record<string, unknown> | null)?.resolved_at;
    if (existing) {
      updateData.resolved_at = existing;
    }
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
      // .maybeSingle(), not .single(): .single() reports an error (PGRST116)
      // when zero rows match, which would make a missing id throw instead of
      // resolving null as the FeedbackAdapter contract requires.
      const { data, error } = await client.from(tableName).select('*').eq('id', id).maybeSingle();

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
      if (!rows[0]) {
        // Common under RLS: anon INSERT granted but not SELECT, so the insert
        // succeeds yet returns no representation. Surface an actionable error
        // instead of a TypeError from rowToFeedback(undefined).
        throw new Error(
          "Insert succeeded but returned no row — check the table's RLS SELECT policy"
        );
      }
      return rowToFeedback(rows[0]);
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const updateData = buildUpdateData(updates);
      await preserveResolvedAt(id, updates, updateData);

      const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows[0] ? rowToFeedback(rows[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      // .select() makes PostgREST return the deleted rows, so the boolean
      // honours the adapter contract (true only when a row existed and was
      // deleted) — a bare delete reports no error for zero affected rows.
      const { data, error } = await client.from(tableName).delete().eq('id', id).select();

      if (error) return false;
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows.length > 0;
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
        await preserveResolvedAt(id, update, updateData);

        const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

        // PostgREST has no multi-statement transactions, so earlier updates in
        // this loop are already committed when a later one fails. Throwing here
        // would persist partial updates and then report total failure — instead
        // skip the item so it surfaces in the caller's not-updated diff (the
        // RESOLVE endpoint's `notFound` list) and can be retried.
        if (error) {
          console.error(`bulkUpdate failed for id "${id}": ${error.message}`);
          continue;
        }
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
 * SQL schema for creating the feedback table in Supabase.
 *
 * @deprecated Use `SUPABASE_SETUP_SQL` from 'contextual-feedback/setup'
 * instead — it is the same DDL (both are built from the shared base in
 * lib/schema.ts). This alias will be removed before 1.0.
 */
export const SUPABASE_SCHEMA = buildFeedbackSchemaSql('NOW()');
