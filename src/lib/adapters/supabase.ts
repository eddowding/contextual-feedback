import { buildFeedbackSchemaSql } from '../schema';
import { BulkUpdateResult, computeResolvedAt, Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

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

    if (error) {
      // We can't read the prior value (transient error or missing row). Do NOT
      // keep the optimistic now() buildUpdateData set: omit resolved_at so
      // PostgREST leaves the column untouched, preserving any existing
      // resolution timestamp rather than clobbering it with a fresh now(). (A
      // genuine first-resolution may miss its stamp on a transient error —
      // acceptable vs corrupting resolution-latency history.)
      delete updateData.resolved_at;
      return;
    }
    const existing = (data as Record<string, unknown> | null)?.resolved_at;
    if (existing) {
      updateData.resolved_at = existing;
    }
    // else: no prior value → keep buildUpdateData's now() (genuine first resolve).
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

    async bulkUpdate(updates: Array<{ id: string } & FeedbackUpdate>): Promise<BulkUpdateResult> {
      const results: Feedback[] = [];
      const failed: BulkUpdateResult['failed'] = [];

      // resolved_at preservation needs the current value for items moving to a
      // resolved status. Fetch them ALL in one read up front, rather than one
      // SELECT per item inside the loop (which made a 50-item resolve ~2N
      // round-trips). PostgREST still can't express COALESCE in an update, so
      // this batched read is how we keep the original resolution timestamp.
      const resolvingIds = updates.filter(u => isResolvedStatus(u.status)).map(u => u.id);
      const existingResolvedAt = new Map<string, unknown>();
      let resolvedReadOk = true;
      if (resolvingIds.length > 0) {
        const { data, error } = await client
          .from(tableName)
          .select('id, resolved_at')
          .in('id', resolvingIds);
        if (error) {
          // The pre-read failed: we don't know prior values, so don't overwrite
          // resolved_at for any resolving id (preserve existing timestamps)
          // instead of stamping every one with now() and corrupting history.
          resolvedReadOk = false;
          console.error(`bulkUpdate resolved_at pre-read failed: ${error.message}`);
        } else {
          for (const row of (data ?? []) as Record<string, unknown>[]) {
            if (row.resolved_at) existingResolvedAt.set(row.id as string, row.resolved_at);
          }
        }
      }

      for (const { id, ...update } of updates) {
        const updateData = buildUpdateData(update);
        if (isResolvedStatus(update.status)) {
          if (existingResolvedAt.has(id)) {
            updateData.resolved_at = existingResolvedAt.get(id); // preserve original
          } else if (!resolvedReadOk) {
            delete updateData.resolved_at; // unknown prior value → leave untouched
          }
          // else: read OK + no prior value → keep buildUpdateData's now().
        }

        const { data, error } = await client.from(tableName).update(updateData).eq('id', id).select();

        // PostgREST has no multi-statement transactions, so earlier updates in
        // this loop are already committed when a later one fails. Throwing here
        // would persist partial updates and then report total failure — instead
        // record the item in `failed` so the caller (the RESOLVE endpoint) can
        // report it as a retryable error, distinct from a missing row.
        if (error) {
          console.error(`bulkUpdate failed for id "${id}": ${error.message}`);
          failed.push({ id, error: error.message });
          continue;
        }
        const rows = (data ?? []) as Record<string, unknown>[];
        if (rows[0]) {
          results.push(rowToFeedback(rows[0]));
        }
      }

      return { updated: results, failed };
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
