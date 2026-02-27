import { describe, it, expect } from 'vitest';
import { formatForAI } from '../ai';
import { Feedback } from '../types';

function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'fb_1',
    userEmail: 'user@test.com',
    pageUrl: 'https://example.com/dashboard',
    feedbackText: 'The chart is broken',
    status: 'Pending',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('formatForAI', () => {
  it('returns empty message for no items', () => {
    const result = formatForAI([]);
    expect(result).toContain('0 items');
    expect(result).toContain('No feedback items');
  });

  it('formats a single item with URL path extraction', () => {
    const result = formatForAI([makeFeedback()]);
    expect(result).toContain('1 item)');
    expect(result).toContain('/dashboard');
    expect(result).toContain('The chart is broken');
    expect(result).toContain('user@test.com');
    expect(result).toContain('fb_1');
  });

  it('formats multiple items with numbering', () => {
    const items = [
      makeFeedback({ id: 'fb_1' }),
      makeFeedback({ id: 'fb_2', feedbackText: 'Second issue' }),
    ];
    const result = formatForAI(items);
    expect(result).toContain('2 items');
    expect(result).toContain('### 1.');
    expect(result).toContain('### 2.');
  });

  it('includes context as section name', () => {
    const result = formatForAI([makeFeedback({ context: 'Pricing Table' })]);
    expect(result).toContain('Pricing Table');
  });

  it('shows General when no context', () => {
    const result = formatForAI([makeFeedback({ context: undefined })]);
    expect(result).toContain('General');
  });

  it('includes elementId when present', () => {
    const result = formatForAI([makeFeedback({ elementId: 'pricing' })]);
    expect(result).toContain('#pricing');
  });

  it('does not include Element line when no elementId', () => {
    const result = formatForAI([makeFeedback({ elementId: undefined })]);
    expect(result).not.toContain('Element:');
  });

  it('includes admin notes when present', () => {
    const result = formatForAI([makeFeedback({ adminNotes: 'Investigating' })]);
    expect(result).toContain('Admin Notes: Investigating');
  });

  it('keeps original pageUrl when not a valid URL', () => {
    const result = formatForAI([makeFeedback({ pageUrl: '/relative/path' })]);
    expect(result).toContain('/relative/path');
  });

  it('includes category when present', () => {
    const result = formatForAI([makeFeedback({ category: 'bug' })]);
    expect(result).toContain('Category: bug');
  });

  it('does not include Category line when no category', () => {
    const result = formatForAI([makeFeedback({ category: undefined })]);
    expect(result).not.toContain('Category:');
  });
});
