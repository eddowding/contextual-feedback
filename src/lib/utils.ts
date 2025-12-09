/**
 * Client-side feedback utilities
 */

/**
 * Detect feedback context from page
 * Finds the topmost visible section with data-feedback-context attribute
 */
export function detectFeedbackContext(): { context: string; elementId?: string } {
  if (typeof window === 'undefined') {
    return { context: 'General Page' };
  }

  // Check URL hash first for explicit section markers
  const hash = window.location.hash.slice(1);
  if (hash) {
    const element = document.getElementById(hash);
    if (element) {
      const context = element.getAttribute('data-feedback-context');
      if (context) {
        return {
          context,
          elementId: element.getAttribute('data-feedback-id') || hash,
        };
      }
    }
  }

  // Find the topmost visible section with data-feedback-context attribute
  const sections = document.querySelectorAll('[data-feedback-context]');
  let bestSection: Element | null = null;
  let bestDistance = Infinity;

  sections.forEach((section) => {
    const rect = section.getBoundingClientRect();
    // Find section closest to top of viewport
    if (rect.top >= -200 && rect.top < bestDistance) {
      bestDistance = rect.top;
      bestSection = section;
    }
  });

  if (bestSection) {
    const htmlElement = bestSection as HTMLElement;
    return {
      context: htmlElement.getAttribute('data-feedback-context') || 'General Page',
      elementId: htmlElement.getAttribute('data-feedback-id') || htmlElement.id || undefined,
    };
  }

  return { context: 'General Page' };
}

/**
 * Get all available feedback contexts on the current page
 * Returns an array of unique context names
 */
export function getPageContexts(): string[] {
  if (typeof window === 'undefined') {
    return ['General Page'];
  }

  const sections = document.querySelectorAll('[data-feedback-context]');
  const contexts = new Set<string>();

  // Always include General Page as an option
  contexts.add('General Page');

  sections.forEach((section) => {
    const context = (section as HTMLElement).getAttribute('data-feedback-context');
    if (context) {
      contexts.add(context);
    }
  });

  return Array.from(contexts).sort();
}
