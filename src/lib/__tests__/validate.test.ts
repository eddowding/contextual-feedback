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

  it('returns error for empty feedback text', () => {
    const errors = validateFeedbackInput({ feedbackText: '   ' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'feedbackText',
      message: 'Feedback text is required',
    });
  });

  it('returns error for feedback text exceeding 5000 chars', () => {
    const errors = validateFeedbackInput({ feedbackText: 'a'.repeat(5001) });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('feedbackText');
    expect(errors[0].message).toContain('5000');
  });

  it('returns error for empty page URL', () => {
    const errors = validateFeedbackInput({ pageUrl: '   ' });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('returns error for page URL exceeding 2000 chars', () => {
    const errors = validateFeedbackInput({ pageUrl: 'https://example.com/' + 'a'.repeat(2000) });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('pageUrl');
  });

  it('returns error for invalid email (missing @)', () => {
    const errors = validateFeedbackInput({ userEmail: 'notanemail' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: 'userEmail',
      message: 'Invalid email format',
    });
  });

  it('allows empty email (optional field)', () => {
    const errors = validateFeedbackInput({ userEmail: '' });
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

  it('returns no errors when no fields provided', () => {
    const errors = validateFeedbackInput({});
    expect(errors).toEqual([]);
  });

  it('accepts valid categories', () => {
    for (const cat of ['bug', 'feature', 'praise', 'question', 'other'] as const) {
      const errors = validateFeedbackInput({ category: cat });
      expect(errors).toEqual([]);
    }
  });

  it('rejects invalid category', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = validateFeedbackInput({ category: 'invalid' as any });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('category');
  });

  it('allows undefined category', () => {
    const errors = validateFeedbackInput({ feedbackText: 'Test' });
    expect(errors).toEqual([]);
  });
});
