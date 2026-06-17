import { describe, it, expect } from 'vitest';
import { validateFeedbackInput } from '../types';

describe('validateFeedbackInput', () => {
  it('returns no errors for valid input', () => {
    const errors = validateFeedbackInput({
      feedbackText: 'This is great',
      pageUrl: 'https://example.com/page',
      userEmail: 'user@example.com',
    });
    expect(errors).toEqual([]);
  });

  describe('required fields (full submission, default mode)', () => {
    it('flags missing feedbackText and pageUrl', () => {
      const errors = validateFeedbackInput({});
      const fields = errors.map(e => e.field);
      expect(fields).toContain('feedbackText');
      expect(fields).toContain('pageUrl');
      expect(errors).toHaveLength(2);
    });

    it('flags missing pageUrl when only feedbackText is provided', () => {
      const errors = validateFeedbackInput({ feedbackText: 'Looks good' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        field: 'pageUrl',
        message: 'Page URL is required',
      });
    });

    it('flags missing feedbackText when only pageUrl is provided', () => {
      const errors = validateFeedbackInput({ pageUrl: 'https://example.com' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        field: 'feedbackText',
        message: 'Feedback text is required',
      });
    });
  });

  describe('partial mode', () => {
    const partial = { partial: true } as const;

    it('skips required-ness when fields are absent', () => {
      expect(validateFeedbackInput({}, partial)).toEqual([]);
    });

    it('still validates fields that are present', () => {
      const errors = validateFeedbackInput({ feedbackText: 'a'.repeat(5001) }, partial);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('feedbackText');
    });
  });

  it('returns error for empty feedback text', () => {
    const errors = validateFeedbackInput({ feedbackText: '   ' }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'feedbackText',
      message: 'Feedback text is required',
    });
  });

  it('returns error for feedback text exceeding 5000 chars', () => {
    const errors = validateFeedbackInput({ feedbackText: 'a'.repeat(5001) }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('feedbackText');
    expect(errors[0].message).toContain('5000');
  });

  it('returns error for empty page URL', () => {
    const errors = validateFeedbackInput({ pageUrl: '   ' }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('returns error for page URL exceeding 2000 chars', () => {
    const errors = validateFeedbackInput(
      { pageUrl: 'https://example.com/' + 'a'.repeat(2000) },
      { partial: true }
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('rejects javascript: page URLs (stored XSS vector)', () => {
    const errors = validateFeedbackInput({ pageUrl: "javascript:alert('xss')" }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'pageUrl',
      message: 'Page URL must be an http(s) URL or a relative path',
    });
  });

  it('rejects data: page URLs', () => {
    const errors = validateFeedbackInput(
      { pageUrl: 'data:text/html,<script>1</script>' },
      { partial: true }
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('allows http and https page URLs', () => {
    expect(validateFeedbackInput({ pageUrl: 'http://example.com/page' }, { partial: true })).toEqual([]);
    expect(validateFeedbackInput({ pageUrl: 'https://example.com/page' }, { partial: true })).toEqual([]);
  });

  it('allows relative page URL paths', () => {
    expect(validateFeedbackInput({ pageUrl: '/pricing?tab=1' }, { partial: true })).toEqual([]);
  });

  it('rejects schemeless non-relative page URLs', () => {
    const errors = validateFeedbackInput({ pageUrl: 'example.com/page' }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('returns error for invalid email (missing @)', () => {
    const errors = validateFeedbackInput({ userEmail: 'notanemail' }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'userEmail',
      message: 'Invalid email format',
    });
  });

  it('allows empty email (optional field)', () => {
    const errors = validateFeedbackInput({ userEmail: '' }, { partial: true });
    expect(errors).toEqual([]);
  });

  it('rejects an over-255-char email (user_email is VARCHAR(255)) as a 400, not a DB 500', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'; // 256 chars, valid format
    const errors = validateFeedbackInput({ userEmail: longEmail }, { partial: true });
    expect(errors).toEqual([
      { field: 'userEmail', message: 'Email must be 255 characters or less' },
    ]);
  });

  it('allows an email at exactly 255 chars', () => {
    const email = 'a'.repeat(249) + '@b.com'; // 255 chars
    const errors = validateFeedbackInput({ userEmail: email }, { partial: true });
    expect(errors).toEqual([]);
  });

  it('returns multiple errors at once', () => {
    const errors = validateFeedbackInput({
      feedbackText: '',
      pageUrl: '',
      userEmail: 'bad',
    });
    expect(errors).toHaveLength(3);
    const fields = errors.map(e => e.field);
    expect(fields).toContain('feedbackText');
    expect(fields).toContain('pageUrl');
    expect(fields).toContain('userEmail');
  });

  describe('context and elementId (VARCHAR(255) schema limits)', () => {
    it('allows context and elementId at exactly 255 chars', () => {
      const errors = validateFeedbackInput(
        { context: 'c'.repeat(255), elementId: 'e'.repeat(255) },
        { partial: true }
      );
      expect(errors).toEqual([]);
    });

    it('rejects context exceeding 255 chars (400, not a DB-driven 500)', () => {
      const errors = validateFeedbackInput({ context: 'c'.repeat(256) }, { partial: true });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        field: 'context',
        message: 'Context must be 255 characters or less',
      });
    });

    it('rejects elementId exceeding 255 chars', () => {
      const errors = validateFeedbackInput({ elementId: 'e'.repeat(256) }, { partial: true });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        field: 'elementId',
        message: 'Element ID must be 255 characters or less',
      });
    });

    it('returns error (not TypeError) for non-string context and elementId', () => {
      const errors = validateFeedbackInput(
        { context: 42 as unknown as string, elementId: [] as unknown as string },
        { partial: true }
      );
      expect(errors).toHaveLength(2);
      expect(errors.map(e => e.field)).toEqual(['context', 'elementId']);
    });
  });

  it('accepts valid categories', () => {
    for (const cat of ['bug', 'feature', 'praise', 'question', 'other'] as const) {
      const errors = validateFeedbackInput({ category: cat }, { partial: true });
      expect(errors).toEqual([]);
    }
  });

  it('rejects invalid category', () => {

    const errors = validateFeedbackInput({ category: 'invalid' as any }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('category');
  });

  it('allows undefined category', () => {
    const errors = validateFeedbackInput({ feedbackText: 'Test' }, { partial: true });
    expect(errors).toEqual([]);
  });

  it('returns error (not TypeError) for non-string feedbackText', () => {
    const errors = validateFeedbackInput({ feedbackText: 123 as unknown as string }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'feedbackText',
      message: 'Feedback text must be a string',
    });
  });

  it('returns error (not TypeError) for non-string pageUrl', () => {
    const errors = validateFeedbackInput({ pageUrl: true as unknown as string }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'pageUrl',
      message: 'Page URL must be a string',
    });
  });

  it('returns error (not TypeError) for non-string userEmail', () => {
    const errors = validateFeedbackInput({ userEmail: {} as unknown as string }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'userEmail',
      message: 'Email must be a string',
    });
  });

  it('returns error for null feedbackText', () => {
    const errors = validateFeedbackInput({ feedbackText: null as unknown as string }, { partial: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('feedbackText');
  });
});
