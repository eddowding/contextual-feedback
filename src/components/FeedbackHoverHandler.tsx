'use client';

import { useEffect } from 'react';
import { useFeedback } from './FeedbackProvider';

/**
 * Handles feedback mode: highlights all feedback sections and shows central button
 */
export function FeedbackHoverHandler() {
  const { isFeedbackMode, openDialog, toggleFeedbackMode } = useFeedback();

  useEffect(() => {
    if (!isFeedbackMode) {
      return;
    }

    // ESC key handler to exit feedback mode
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleFeedbackMode();
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Find all elements with feedback context
    const feedbackElements = document.querySelectorAll<HTMLElement>('[data-feedback-context]');

    // Add click handlers and highlights to all feedback sections
    const clickHandlers = new Map<HTMLElement, (e: MouseEvent) => void>();

    feedbackElements.forEach((element) => {
      // Add feedback mode highlight
      element.classList.add('cf-section-active');

      // Add clickable cursor
      element.style.cursor = 'pointer';

      // Create click handler
      const handleClick = (e: MouseEvent) => {
        e.stopPropagation();
        const context = element.getAttribute('data-feedback-context');
        const elementId = element.getAttribute('data-feedback-id');
        if (context) {
          openDialog(context, elementId || undefined);
        }
      };

      element.addEventListener('click', handleClick);
      clickHandlers.set(element, handleClick);
    });

    // Create central "General Feedback" button using DOM methods
    const centralButton = document.createElement('button');
    centralButton.className = 'cf-central-button';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'cf-central-content';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
    svg.appendChild(path);

    const span = document.createElement('span');
    span.textContent = 'General Feedback';

    contentDiv.appendChild(svg);
    contentDiv.appendChild(span);
    centralButton.appendChild(contentDiv);

    const handleCentralClick = (e: MouseEvent) => {
      e.stopPropagation();
      openDialog('General Page', undefined);
    };

    centralButton.addEventListener('click', handleCentralClick);
    document.body.appendChild(centralButton);

    // Cleanup function
    return () => {
      document.removeEventListener('keydown', handleEscape);

      feedbackElements.forEach((element) => {
        element.classList.remove('cf-section-active');
        element.style.cursor = '';
        const handler = clickHandlers.get(element);
        if (handler) {
          element.removeEventListener('click', handler);
        }
      });

      centralButton.removeEventListener('click', handleCentralClick);
      if (centralButton.parentNode) {
        document.body.removeChild(centralButton);
      }
    };
  }, [isFeedbackMode, openDialog, toggleFeedbackMode]);

  return null;
}
