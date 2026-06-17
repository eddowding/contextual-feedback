// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FeedbackProvider, useFeedback } from '../FeedbackProvider';

function ModeToggle() {
  const { toggleFeedbackMode } = useFeedback();
  return (
    <button type="button" onClick={toggleFeedbackMode}>
      toggle-mode
    </button>
  );
}

function renderWithSection() {
  return render(
    <FeedbackProvider>
      <ModeToggle />
      <section data-feedback-context="Pricing Table" data-feedback-id="pricing">
        <a href="/pricing">Pricing link</a>
      </section>
    </FeedbackProvider>
  );
}

describe('FeedbackHoverHandler', () => {
  afterEach(() => {
    cleanup();
  });

  it('marks the page and shows the central button while feedback mode is on', () => {
    renderWithSection();

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(true);
    expect(document.querySelector('.cf-central-button')).toBeTruthy();

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
    expect(document.querySelector('.cf-central-button')).toBeNull();
  });

  it('opens the dialog for the clicked section', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    // Clicking an interactive child of the section is intercepted and
    // targets the enclosing section.
    fireEvent.click(screen.getByText('Pricing link'));

    expect(screen.getByText('Send Feedback')).toBeTruthy();
    expect(screen.getByText('Pricing Table')).toBeTruthy();
  });

  it('targets sections added to the DOM after feedback mode was enabled', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const late = document.createElement('div');
    late.setAttribute('data-feedback-context', 'Late Section');
    late.textContent = 'late-section';
    document.body.appendChild(late);

    try {
      fireEvent.click(late);
      expect(screen.getByText('Send Feedback')).toBeTruthy();
      expect(screen.getByText('Late Section')).toBeTruthy();
    } finally {
      document.body.removeChild(late);
    }
  });

  it('opens a General Page dialog from the central button', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    fireEvent.click(screen.getByText('General Feedback'));

    expect(screen.getByText('Send Feedback')).toBeTruthy();
    // Opening the dialog exits feedback mode
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
  });

  it('exits feedback mode on Escape', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
    expect(document.querySelector('.cf-central-button')).toBeNull();
  });

  it('makes sections keyboard-operable and restores attributes on exit', () => {
    renderWithSection();
    const section = document.querySelector<HTMLElement>('[data-feedback-context]')!;

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(section.getAttribute('tabindex')).toBe('0');
    expect(section.getAttribute('role')).toBe('button');
    expect(section.getAttribute('aria-label')).toBe('Give feedback about Pricing Table');

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(section.hasAttribute('tabindex')).toBe(false);
    expect(section.hasAttribute('role')).toBe(false);
    expect(section.hasAttribute('aria-label')).toBe(false);
  });

  it('preserves pre-existing tabindex/role/aria-label across feedback mode', () => {
    render(
      <FeedbackProvider>
        <ModeToggle />
        <div
          data-feedback-context="Custom"
          tabIndex={-1}
          role="region"
          aria-label="Custom region"
        />
      </FeedbackProvider>
    );
    const section = document.querySelector<HTMLElement>('[data-feedback-context]')!;

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(section.getAttribute('role')).toBe('button');

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(section.getAttribute('tabindex')).toBe('-1');
    expect(section.getAttribute('role')).toBe('region');
    expect(section.getAttribute('aria-label')).toBe('Custom region');
  });

  it('opens the dialog when Enter is pressed on a focused section', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const section = document.querySelector<HTMLElement>('[data-feedback-context]')!;
    section.focus();
    fireEvent.keyDown(section, { key: 'Enter' });

    expect(screen.getByText('Send Feedback')).toBeTruthy();
    expect(screen.getByText('Pricing Table')).toBeTruthy();
  });

  it('opens the dialog when Space is pressed on a focused section', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const section = document.querySelector<HTMLElement>('[data-feedback-context]')!;
    section.focus();
    fireEvent.keyDown(section, { key: ' ' });

    expect(screen.getByText('Send Feedback')).toBeTruthy();
  });

  it('focuses the central button when feedback mode activates', () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const centralButton = document.querySelector('.cf-central-button');
    expect(document.activeElement).toBe(centralButton);
  });

  it('announces feedback mode via a polite live region', async () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const region = document.querySelector('.cf-sr-only[role="status"]');
    expect(region).toBeTruthy();
    await waitFor(() =>
      expect(region?.textContent).toContain('Feedback mode on')
    );

    fireEvent.click(screen.getByText('toggle-mode'));
    expect(document.querySelector('.cf-sr-only[role="status"]')).toBeNull();
  });

  it('makes sections added after activation keyboard-operable', async () => {
    renderWithSection();
    fireEvent.click(screen.getByText('toggle-mode'));

    const late = document.createElement('div');
    late.setAttribute('data-feedback-context', 'Late Section');
    late.textContent = 'late-section';
    document.body.appendChild(late);

    try {
      await waitFor(() => expect(late.getAttribute('role')).toBe('button'));
      expect(late.getAttribute('tabindex')).toBe('0');
      expect(late.getAttribute('aria-label')).toBe('Give feedback about Late Section');
    } finally {
      document.body.removeChild(late);
    }
  });
});
