import { Feedback } from './types';

/**
 * Format feedback items into a structured markdown string optimized for AI agent consumption.
 *
 * Use this to generate prompts for AI agents that need to understand and act on user feedback.
 *
 * @example
 * ```ts
 * import { formatForAI } from 'contextual-feedback/ai';
 *
 * const feedback = await adapter.getAll('Pending');
 * const markdown = formatForAI(feedback);
 * // Pass `markdown` to your AI agent as context
 * ```
 */
export function formatForAI(items: Feedback[]): string {
  if (items.length === 0) {
    return '## Feedback Triage (0 items)\n\nNo feedback items to review.';
  }

  const lines: string[] = [];
  lines.push(`## Feedback Triage (${items.length} item${items.length !== 1 ? 's' : ''})`);
  lines.push('');

  items.forEach((item, index) => {
    let page = item.pageUrl;
    try {
      page = new URL(item.pageUrl).pathname;
    } catch {
      // Keep original if not a valid URL
    }

    const section = item.context || 'General';
    lines.push(`### ${index + 1}. [${item.status}] ${section} — ${page}`);
    lines.push(`> ${item.feedbackText}`);
    lines.push(`- From: ${item.userEmail}`);
    lines.push(`- ID: ${item.id}`);
    if (item.category) {
      lines.push(`- Category: ${item.category}`);
    }
    if (item.elementId) {
      lines.push(`- Element: #${item.elementId}`);
    }
    if (item.adminNotes) {
      lines.push(`- Admin Notes: ${item.adminNotes}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
