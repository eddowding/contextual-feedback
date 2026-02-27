/**
 * Complete idempotent Supabase setup SQL.
 *
 * Run this in your Supabase dashboard SQL editor or via `supabase db push`.
 * The Supabase JS client cannot execute DDL statements.
 */
export const SUPABASE_SETUP_SQL = `
-- ============================================================================
-- Table
-- ============================================================================
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

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- ============================================================================
-- Auto-update updated_at trigger
-- ============================================================================
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

-- Authenticated users can submit feedback
CREATE POLICY "feedback_insert_authenticated" ON feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

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
