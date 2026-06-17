// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as root from '../index';

/**
 * The root entry is bundled with a `"use client";` banner (see tsup.config.ts),
 * so it must never re-export server-only runtime values. Those live on the
 * dedicated subpaths ('contextual-feedback/api', '/ai', '/adapters/*',
 * '/setup') — re-exporting them here would let auto-import pull a
 * client-marked module into Next.js route handlers and ship SQL/server logic
 * to the browser bundle.
 */
describe('root entry export surface', () => {
  it('does not re-export server-only runtime values', () => {
    const serverOnly = [
      'createApiHandlers',
      'formatForAI',
      'toTriageItem',
      'createPostgresAdapter',
      'createSupabaseAdapter',
      'createMemoryAdapter',
      'POSTGRES_SCHEMA',
      'SUPABASE_SCHEMA',
      'SUPABASE_SETUP_SQL',
      'SUPABASE_RLS_SQL',
    ];

    for (const name of serverOnly) {
      expect(root, `"${name}" must only be exported from its server subpath`).not.toHaveProperty(name);
    }
  });

  it('still exports the client API', () => {
    expect(root.FeedbackProvider).toBeTypeOf('function');
    expect(root.useFeedback).toBeTypeOf('function');
    expect(root.FeedbackDialog).toBeTypeOf('function');
    expect(root.FeedbackButton).toBeTypeOf('function');
    expect(root.FeedbackList).toBeTypeOf('function');
    expect(root.FeedbackHoverHandler).toBeTypeOf('function');
    expect(root.useUrlParamActivation).toBeTypeOf('function');
    expect(root.validateFeedbackInput).toBeTypeOf('function');
    expect(root.detectFeedbackContext).toBeTypeOf('function');
    expect(root.getPageContexts).toBeTypeOf('function');
  });

  it('exports runtime status/category constants and computeResolvedAt', () => {
    expect(root.VALID_STATUSES).toEqual(['Pending', 'In Review', 'Done', 'Rejected']);
    expect(root.VALID_CATEGORIES).toEqual(['bug', 'feature', 'praise', 'question', 'other']);
    expect(root.computeResolvedAt).toBeTypeOf('function');
  });
});
