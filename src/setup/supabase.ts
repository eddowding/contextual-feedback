import { buildFeedbackSchemaSql } from '../lib/schema';

/**
 * Complete idempotent Supabase setup SQL (table, indexes, updated_at trigger).
 *
 * Run this in your Supabase dashboard SQL editor or via `supabase db push`.
 * The Supabase JS client cannot execute DDL statements.
 *
 * Built from the shared base DDL in lib/schema.ts so it can never drift from
 * the adapters' POSTGRES_SCHEMA / SUPABASE_SCHEMA constants.
 */
export const SUPABASE_SETUP_SQL = buildFeedbackSchemaSql('NOW()');

/**
 * Row Level Security policies for the feedback table.
 *
 * Assumes:
 * - Authenticated users can INSERT and SELECT their own feedback
 * - Admin users (via is_admin() function) can do everything
 *
 * Apply separately if you want RLS. Skip if you manage access at the API layer.
 */
export const SUPABASE_RLS_SQL = `
-- ============================================================================
-- Admin helper function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
END;
$$;

-- ============================================================================
-- Enable RLS
-- ============================================================================
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Policies
-- ============================================================================

-- Authenticated users can submit feedback — but only as themselves. Binding
-- user_email to the JWT identity stops a user inserting rows attributed to
-- someone else (who would then see forged feedback via feedback_select_own).
CREATE POLICY "feedback_insert_authenticated" ON feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (user_email = (SELECT auth.jwt() ->> 'email') OR (SELECT is_admin()));

-- Authenticated users can read their own feedback
CREATE POLICY "feedback_select_own" ON feedback
  FOR SELECT
  TO authenticated
  USING (user_email = (SELECT auth.jwt() ->> 'email') OR (SELECT is_admin()));

-- Admins can update any feedback
CREATE POLICY "feedback_update_admin" ON feedback
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin()));

-- Admins can delete any feedback
CREATE POLICY "feedback_delete_admin" ON feedback
  FOR DELETE
  TO authenticated
  USING ((SELECT is_admin()));
`;
