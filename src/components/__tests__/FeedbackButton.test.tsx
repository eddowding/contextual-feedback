// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FeedbackProvider } from '../FeedbackProvider';
import { FeedbackButton } from '../FeedbackButton';

describe('FeedbackButton', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when feedback is not activated', () => {
    render(
      <FeedbackProvider urlParam="feedback">
        <FeedbackButton />
      </FeedbackProvider>
    );

    expect(screen.queryByLabelText('Give feedback')).toBeNull();
  });

  it('toggles feedback mode in targeted mode', () => {
    render(
      <FeedbackProvider mode="targeted">
        <FeedbackButton />
      </FeedbackProvider>
    );

    fireEvent.click(screen.getByLabelText('Give feedback'));
    expect(screen.getByLabelText('Exit feedback mode')).toBeTruthy();
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(true);

    fireEvent.click(screen.getByLabelText('Exit feedback mode'));
    expect(screen.getByLabelText('Give feedback')).toBeTruthy();
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
  });

  it('opens the dialog directly in simple mode', () => {
    render(
      <FeedbackProvider mode="simple">
        <FeedbackButton />
      </FeedbackProvider>
    );

    fireEvent.click(screen.getByLabelText('Give feedback'));

    expect(screen.getByText('Send Feedback')).toBeTruthy();
    // Simple mode never enters targeted feedback mode...
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
    // ...and hides the section selector.
    expect(screen.queryByText('About:')).toBeNull();
  });
});
