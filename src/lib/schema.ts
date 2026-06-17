/**
 * Single source of truth for the feedback table DDL.
 *
 * The Supabase and Postgres adapters (and the setup helper) all expose this
 * same schema — only the "current timestamp" expression differs between the
 * two flavours. Add new columns/indexes HERE so every exported constant
 * (POSTGRES_SCHEMA, SUPABASE_SCHEMA, SUPABASE_SETUP_SQL) stays in sync.
 *
 * @internal Not part of the public API — consumers should import
 * SUPABASE_SETUP_SQL from 'contextual-feedback/setup' or POSTGRES_SCHEMA
 * from 'contextual-feedback/adapters/postgres'.
 */
export function buildFeedbackSchemaSql(now: 'NOW()' | 'CURRENT_TIMESTAMP'): string {
  return `
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
  created_at TIMESTAMPTZ DEFAULT ${now},
  updated_at TIMESTAMPTZ DEFAULT ${now}
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = ${now};
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_updated_at ON feedback;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();
`;
}
