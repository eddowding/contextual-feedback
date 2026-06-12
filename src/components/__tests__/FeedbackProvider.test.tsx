// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FeedbackProvider, useFeedback } from '../FeedbackProvider';

function OpenDialogButton() {
  const { openDialog } = useFeedback();
  return (
    <button type="button" onClick={() => openDialog()}>
      open-dialog
    </button>
  );
}

async function openDialogTypeAndSubmit(text: string) {
  fireEvent.click(screen.getByText('open-dialog'));
  fireEvent.change(screen.getByLabelText("What's on your mind?"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByText('Submit Feedback'));
}

describe('FeedbackProvider prop wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'fb_1' }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits to the default /api/feedback endpoint', async () => {
    render(
      <FeedbackProvider>
        <OpenDialogButton />
      </FeedbackProvider>
    );

    await openDialogTypeAndSubmit('Default endpoint feedback');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback');
  });

  it('forwards a custom apiEndpoint to the built-in dialog', async () => {
    render(
      <FeedbackProvider apiEndpoint="/api/v2/feedback">
        <OpenDialogButton />
      </FeedbackProvider>
    );

    await openDialogTypeAndSubmit('Custom endpoint feedback');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/feedback');
  });

  it('forwards onSubmit to the built-in dialog, bypassing the API', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <FeedbackProvider onSubmit={onSubmit}>
        <OpenDialogButton />
      </FeedbackProvider>
    );

    await openDialogTypeAndSubmit('Handled by onSubmit');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].feedbackText).toBe('Handled by onSubmit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('useFeedback throws when used outside FeedbackProvider', () => {
    function Naked() {
      useFeedback();
      return null;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Naked />)).toThrow('useFeedback must be used within FeedbackProvider');
    consoleError.mockRestore();
  });

  it('does not render the dialog when urlParam is set and not activated', () => {
    sessionStorage.clear();
    render(
      <FeedbackProvider urlParam="feedback">
        <OpenDialogButton />
      </FeedbackProvider>
    );

    fireEvent.click(screen.getByText('open-dialog'));
    expect(screen.queryByText('Send Feedback')).toBeNull();
  });

  it('only mounts the hover handler in targeted mode', () => {
    function ModeToggle() {
      const { toggleFeedbackMode } = useFeedback();
      return (
        <button type="button" onClick={toggleFeedbackMode}>
          toggle-mode
        </button>
      );
    }

    const { unmount } = render(
      <FeedbackProvider mode="simple">
        <ModeToggle />
      </FeedbackProvider>
    );
    fireEvent.click(screen.getByText('toggle-mode'));
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(false);
    unmount();

    render(
      <FeedbackProvider mode="targeted">
        <ModeToggle />
      </FeedbackProvider>
    );
    fireEvent.click(screen.getByText('toggle-mode'));
    expect(document.body.classList.contains('cf-feedback-mode')).toBe(true);
  });

  it('renders a custom DialogComponent instead of the built-in dialog', async () => {
    function CustomDialog() {
      const { isOpen } = useFeedback();
      if (!isOpen) return null;
      return <div>custom-dialog-content</div>;
    }

    render(
      <FeedbackProvider DialogComponent={CustomDialog}>
        <OpenDialogButton />
      </FeedbackProvider>
    );

    fireEvent.click(screen.getByText('open-dialog'));
    expect(screen.getByText('custom-dialog-content')).toBeTruthy();
    expect(screen.queryByText('Submit Feedback')).toBeNull();
  });

  it('forwards apiEndpoint and onSubmit to a custom DialogComponent', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const received: Array<{ apiEndpoint?: string; onSubmit?: unknown }> = [];

    function CustomDialog(props: { apiEndpoint?: string; onSubmit?: unknown }) {
      received.push(props);
      return null;
    }

    render(
      <FeedbackProvider apiEndpoint="/api/custom" onSubmit={onSubmit} DialogComponent={CustomDialog}>
        <OpenDialogButton />
      </FeedbackProvider>
    );

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].apiEndpoint).toBe('/api/custom');
    expect(received[0].onSubmit).toBe(onSubmit);
  });

  it('keeps the context value referentially stable across parent re-renders', () => {
    const values: unknown[] = [];

    function ValueRecorder() {
      values.push(useFeedback());
      return null;
    }

    const tree = (
      <FeedbackProvider>
        <ValueRecorder />
      </FeedbackProvider>
    );

    const { rerender } = render(tree);
    rerender(
      <FeedbackProvider>
        <ValueRecorder />
      </FeedbackProvider>
    );

    expect(values.length).toBeGreaterThanOrEqual(2);
    // Same identity → useFeedback() consumers don't re-render on parent renders
    expect(values[values.length - 1]).toBe(values[0]);
  });
});
