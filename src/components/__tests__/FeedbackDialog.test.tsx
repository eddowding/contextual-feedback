// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { FeedbackProvider, useFeedback } from '../FeedbackProvider';

function OpenDialogButton() {
  const { openDialog } = useFeedback();
  return (
    <button type="button" onClick={() => openDialog()}>
      open-dialog
    </button>
  );
}

function getOverlay(): HTMLElement {
  const overlay = document.querySelector('.cf-dialog-overlay');
  if (!overlay) throw new Error('overlay not found');
  return overlay as HTMLElement;
}

describe('FeedbackDialog', () => {
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
    vi.useRealTimers();
  });

  function renderDialog() {
    return render(
      <FeedbackProvider>
        <OpenDialogButton />
      </FeedbackProvider>
    );
  }

  function openAndType(text: string) {
    fireEvent.click(screen.getByText('open-dialog'));
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: text },
    });
  }

  describe('success confirmation', () => {
    it('stays open until the user dismisses it (no auto-close)', async () => {
      vi.useFakeTimers();
      renderDialog();

      openAndType('First feedback');
      fireEvent.click(screen.getByText('Submit Feedback'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Thank you for your feedback!')).toBeTruthy();

      // No timer may dismiss the confirmation — screen-reader users need
      // time to perceive it before the dialog disappears.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByText('Thank you for your feedback!')).toBeTruthy();

      fireEvent.click(screen.getByText('Close'));
      expect(screen.queryByText('Send Feedback')).toBeNull();
    });

    it('announces success via a status region and moves focus to it', async () => {
      renderDialog();

      openAndType('Announced feedback');
      fireEvent.click(screen.getByText('Submit Feedback'));

      await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Thank you for your feedback!');
      expect(document.activeElement).toBe(status);
    });

    it('shows a fresh form when reopened after a success', async () => {
      renderDialog();

      openAndType('First feedback');
      fireEvent.click(screen.getByText('Submit Feedback'));
      await waitFor(() => expect(screen.getByText('Thank you for your feedback!')).toBeTruthy());

      fireEvent.click(screen.getByText('Close'));
      fireEvent.click(screen.getByText('open-dialog'));

      expect(screen.getByText('Submit Feedback')).toBeTruthy();
      expect(screen.queryByText('Thank you for your feedback!')).toBeNull();
    });
  });

  describe('state reset on reopen', () => {
    it('clears a previous submit error when the dialog is reopened', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Server exploded' }), { status: 500 })
      );
      renderDialog();

      openAndType('Failing feedback');
      fireEvent.click(screen.getByText('Submit Feedback'));
      await waitFor(() => expect(screen.getByText('Server exploded')).toBeTruthy());

      fireEvent.click(screen.getByLabelText('Close'));
      fireEvent.click(screen.getByText('open-dialog'));

      expect(screen.queryByText('Server exploded')).toBeNull();
    });
  });

  describe('backdrop dismissal', () => {
    it('closes when a click both starts and ends on the overlay', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      const overlay = getOverlay();
      fireEvent.mouseDown(overlay);
      fireEvent.click(overlay);

      expect(screen.queryByText('Send Feedback')).toBeNull();
    });

    it('does not close on a text-selection drag from the textarea to the backdrop', () => {
      renderDialog();
      openAndType('Precious in-progress feedback');

      // mousedown inside the textarea, mouse released over the backdrop:
      // the browser dispatches the click on the common ancestor (the overlay)
      const textarea = screen.getByLabelText("What's on your mind?");
      fireEvent.mouseDown(textarea);
      fireEvent.click(getOverlay());

      expect(screen.getByText('Send Feedback')).toBeTruthy();
      expect((screen.getByLabelText("What's on your mind?") as HTMLTextAreaElement).value).toBe(
        'Precious in-progress feedback'
      );
    });

    it('does not close when a click inside the dialog bubbles to the overlay', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      const title = screen.getByText('Send Feedback');
      fireEvent.mouseDown(title);
      fireEvent.click(title);

      expect(screen.getByText('Send Feedback')).toBeTruthy();
    });
  });

  describe('portal rendering', () => {
    it('renders the overlay as a direct child of document.body', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      expect(getOverlay().parentElement).toBe(document.body);
    });
  });

  describe('accessibility', () => {
    it('exposes dialog ARIA semantics', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy as string)?.textContent).toBe('Send Feedback');
      const describedBy = dialog.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)?.textContent).toContain(
        'Share your thoughts'
      );
    });

    it('renders submit errors as an alert', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Server exploded' }), { status: 400 })
      );
      renderDialog();

      openAndType('Failing feedback');
      fireEvent.click(screen.getByText('Submit Feedback'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Server exploded'));
    });

    it('traps Tab and Shift+Tab inside the dialog', () => {
      renderDialog();
      openAndType('Trap me');

      const submit = screen.getByText('Submit Feedback');
      submit.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(screen.getByLabelText('Close'));

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(submit);
    });

    it('closes on Escape', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));
      expect(screen.getByText('Send Feedback')).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Send Feedback')).toBeNull();
    });

    it('focuses the textarea on open and restores focus on close', () => {
      renderDialog();
      const opener = screen.getByText('open-dialog');
      opener.focus();
      fireEvent.click(opener);

      expect(document.activeElement).toBe(screen.getByLabelText("What's on your mind?"));

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('email collection', () => {
    it("hides the email field when collectEmail is 'never' (default)", () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      expect(screen.queryByLabelText(/Email/)).toBeNull();
    });

    it("shows an optional email field when collectEmail is 'optional'", () => {
      render(
        <FeedbackProvider collectEmail="optional">
          <OpenDialogButton />
        </FeedbackProvider>
      );
      fireEvent.click(screen.getByText('open-dialog'));

      expect(screen.getByLabelText('Email (optional)')).toBeTruthy();
    });

    it("disables submit until an email is provided when collectEmail is 'required'", () => {
      render(
        <FeedbackProvider collectEmail="required">
          <OpenDialogButton />
        </FeedbackProvider>
      );
      openAndType('Needs an email');

      const submit = screen.getByText('Submit Feedback') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);

      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'jane@example.com' },
      });
      expect(submit.disabled).toBe(false);
    });
  });

  describe('context selector', () => {
    it('labels the section select and exposes the edit toggle state', () => {
      renderDialog();
      fireEvent.click(screen.getByText('open-dialog'));

      const toggle = screen.getByLabelText('Change section');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(toggle);

      const select = screen.getByLabelText('About:');
      expect(select.tagName).toBe('SELECT');
      expect(document.activeElement).toBe(select);
      expect(screen.getByLabelText('Done editing section').getAttribute('aria-expanded')).toBe(
        'true'
      );
    });
  });
});
