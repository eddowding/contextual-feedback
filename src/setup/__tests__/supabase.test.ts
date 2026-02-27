import { describe, it, expect } from 'vitest';
import { SUPABASE_SETUP_SQL, SUPABASE_RLS_SQL } from '../supabase';

describe('SUPABASE_SETUP_SQL', () => {
  it('creates the feedback table', () => {
    expect(SUPABASE_SETUP_SQL).toContain('CREATE TABLE IF NOT EXISTS feedback');
  });

  it('uses UUID primary key with gen_random_uuid()', () => {
    expect(SUPABASE_SETUP_SQL).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
  });

  it('has CHECK constraint on status', () => {
    expect(SUPABASE_SETUP_SQL).toContain("CHECK (status IN ('Pending', 'In Review', 'Done', 'Rejected'))");
  });

  it('has CHECK constraint on category', () => {
    expect(SUPABASE_SETUP_SQL).toContain("category IN ('bug', 'feature', 'praise', 'question', 'other')");
  });

  it('includes resolved_at column', () => {
    expect(SUPABASE_SETUP_SQL).toContain('resolved_at TIMESTAMPTZ');
  });

  it('creates indexes', () => {
    expect(SUPABASE_SETUP_SQL).toContain('idx_feedback_created_at');
    expect(SUPABASE_SETUP_SQL).toContain('idx_feedback_status');
    expect(SUPABASE_SETUP_SQL).toContain('idx_feedback_user_email');
    expect(SUPABASE_SETUP_SQL).toContain('idx_feedback_category');
  });

  it('creates updated_at trigger', () => {
    expect(SUPABASE_SETUP_SQL).toContain('update_feedback_updated_at');
    expect(SUPABASE_SETUP_SQL).toContain('CREATE TRIGGER');
  });
});

describe('SUPABASE_RLS_SQL', () => {
  it('enables RLS', () => {
    expect(SUPABASE_RLS_SQL).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('creates is_admin() function with SECURITY DEFINER', () => {
    expect(SUPABASE_RLS_SQL).toContain('is_admin()');
    expect(SUPABASE_RLS_SQL).toContain('SECURITY DEFINER');
  });

  it('creates insert policy for authenticated users', () => {
    expect(SUPABASE_RLS_SQL).toContain('feedback_insert_authenticated');
    expect(SUPABASE_RLS_SQL).toContain('FOR INSERT');
  });

  it('creates select policy', () => {
    expect(SUPABASE_RLS_SQL).toContain('feedback_select_own');
    expect(SUPABASE_RLS_SQL).toContain('FOR SELECT');
  });

  it('creates update policy for admins', () => {
    expect(SUPABASE_RLS_SQL).toContain('feedback_update_admin');
    expect(SUPABASE_RLS_SQL).toContain('FOR UPDATE');
  });

  it('creates delete policy for admins', () => {
    expect(SUPABASE_RLS_SQL).toContain('feedback_delete_admin');
    expect(SUPABASE_RLS_SQL).toContain('FOR DELETE');
  });
});
