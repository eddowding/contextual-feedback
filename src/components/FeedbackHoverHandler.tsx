'use client';

import { useEffect } from 'react';
import { useFeedback } from './FeedbackProvider';

interface SectionA11yOriginals {
  tabIndex: string | null;
  role: string | null;
  ariaLabel: string | null;
}

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

    // Highlight sections via a body-level class (see styles.css:
    // `body.cf-feedback-mode [data-feedback-context]`) so sections mounted
    // after this effect runs — lazy content, route changes — are styled too.
    document.body.classList.add('cf-feedback-mode');

    const activateSection = (section: HTMLElement) => {
      const context = section.getAttribute('data-feedback-context');
      const elementId = section.getAttribute('data-feedback-id');
      if (context) {
        openDialog(context, elementId || undefined);
      }
    };

    // Make sections keyboard-operable (WCAG 2.1.1): focusable, announced as
    // buttons, with an accessible name. Original attribute values are
    // remembered so cleanup restores the elements exactly.
    const decorated = new Map<HTMLElement, SectionA11yOriginals>();
    const decorateSection = (section: HTMLElement) => {
      if (decorated.has(section)) return;
      decorated.set(section, {
        tabIndex: section.getAttribute('tabindex'),
        role: section.getAttribute('role'),
        ariaLabel: section.getAttribute('aria-label'),
      });
      section.tabIndex = 0;
      section.setAttribute('role', 'button');
      const context = section.getAttribute('data-feedback-context');
      section.setAttribute('aria-label', `Give feedback about ${context}`);
    };
    document
      .querySelectorAll<HTMLElement>('[data-feedback-context]')
      .forEach(decorateSection);

    // Decorate sections mounted while feedback mode is active (lazy content,
    // route changes) — mirrors the delegated click handling below.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.hasAttribute('data-feedback-context')) {
            decorateSection(node);
          }
          node
            .querySelectorAll<HTMLElement>('[data-feedback-context]')
            .forEach(decorateSection);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Delegated capture-phase click handler: works for sections added to the
    // DOM at any time, and intercepts before a section's own interactive
    // children so feedback-mode clicks don't trigger links/buttons inside it.
    const handleSectionClick = (e: MouseEvent) => {
      const section = e.target instanceof Element
        ? e.target.closest<HTMLElement>('[data-feedback-context]')
        : null;
      if (!section) return;
      e.preventDefault();
      e.stopPropagation();
      activateSection(section);
    };
    document.addEventListener('click', handleSectionClick, true);

    // Keyboard activation (Enter/Space) for the focused section. Only fires
    // when the section itself is focused, so keys typed into form controls
    // inside a section are left alone.
    const handleSectionKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const section =
        e.target instanceof HTMLElement && e.target.hasAttribute('data-feedback-context')
          ? e.target
          : null;
      if (!section) return;
      e.preventDefault();
      e.stopPropagation();
      activateSection(section);
    };
    document.addEventListener('keydown', handleSectionKeydown, true);

    // Announce mode activation to screen readers — without this, activating
    // "Give feedback" is silent for SR users.
    const liveRegion = document.createElement('div');
    liveRegion.className = 'cf-sr-only';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
    // Populate after insertion so screen readers register the region first.
    const announceTimer = window.setTimeout(() => {
      liveRegion.textContent =
        'Feedback mode on: choose a section or press Escape to exit';
    }, 0);

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

    // Move focus into feedback mode so keyboard users don't have to tab
    // through the whole page to reach the button appended to <body>.
    centralButton.focus();

    // Cleanup function
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleSectionClick, true);
      document.removeEventListener('keydown', handleSectionKeydown, true);
      document.body.classList.remove('cf-feedback-mode');

      observer.disconnect();
      decorated.forEach((original, section) => {
        if (original.tabIndex === null) section.removeAttribute('tabindex');
        else section.setAttribute('tabindex', original.tabIndex);
        if (original.role === null) section.removeAttribute('role');
        else section.setAttribute('role', original.role);
        if (original.ariaLabel === null) section.removeAttribute('aria-label');
        else section.setAttribute('aria-label', original.ariaLabel);
      });

      window.clearTimeout(announceTimer);
      liveRegion.remove();

      centralButton.removeEventListener('click', handleCentralClick);
      if (centralButton.parentNode) {
        document.body.removeChild(centralButton);
      }
    };
  }, [isFeedbackMode, openDialog, toggleFeedbackMode]);

  return null;
}
