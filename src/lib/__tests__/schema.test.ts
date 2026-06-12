import { describe, it, expect } from 'vitest';
import { buildFeedbackSchemaSql } from '../schema';
import { SUPABASE_SCHEMA } from '../adapters/supabase';
import { POSTGRES_SCHEMA } from '../adapters/postgres';
import { SUPABASE_SETUP_SQL } from '../../setup/supabase';

describe('shared feedback schema DDL', () => {
  it('SUPABASE_SETUP_SQL and SUPABASE_SCHEMA are the same DDL (no competing setup constants)', () => {
    expect(SUPABASE_SETUP_SQL).toBe(SUPABASE_SCHEMA);
  });

  it('POSTGRES_SCHEMA is the same DDL modulo the timestamp function', () => {
    expect(POSTGRES_SCHEMA).toBe(buildFeedbackSchemaSql('CURRENT_TIMESTAMP'));
    expect(POSTGRES_SCHEMA.split('CURRENT_TIMESTAMP').join('NOW()')).toBe(SUPABASE_SETUP_SQL);
  });

  it('uses NOW() for the Supabase flavour and CURRENT_TIMESTAMP for Postgres', () => {
    expect(SUPABASE_SETUP_SQL).toContain('DEFAULT NOW()');
    expect(SUPABASE_SETUP_SQL).not.toContain('CURRENT_TIMESTAMP');
    expect(POSTGRES_SCHEMA).toContain('DEFAULT CURRENT_TIMESTAMP');
    expect(POSTGRES_SCHEMA).not.toContain('NOW()');
  });

  it('contains the table, all four indexes and the updated_at trigger', () => {
    const sql = buildFeedbackSchemaSql('NOW()');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS feedback');
    expect(sql).toContain('idx_feedback_created_at');
    expect(sql).toContain('idx_feedback_status');
    expect(sql).toContain('idx_feedback_user_email');
    expect(sql).toContain('idx_feedback_category');
    expect(sql).toContain('CREATE TRIGGER trg_feedback_updated_at');
  });
});
