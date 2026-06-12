// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FeedbackList } from '../FeedbackList';
import { Feedback } from '../../lib/types';

function makeItem(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'fb_1',
    userEmail: 'jane@example.com',
    pageUrl: 'https://app.example.com/pricing',
    feedbackText: 'Make the table sortable',
    status: 'Pending',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    context: 'Pricing Table',
    ...overrides,
  };
}

describe('FeedbackList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches feedback on mount and renders it', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([makeItem()]), { status: 200 })
    );

    render(<FeedbackList />);

    await waitFor(() => expect(screen.getByText('jane')).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback');
    expect(screen.getByText('Pricing Table')).toBeTruthy();
  });

  it('passes the status filter as a query parameter', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));

    render(<FeedbackList apiEndpoint="/api/v2/feedback" statusFilter="In Review" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/feedback?status=In%20Review');
  });

  it('shows an error state when the fetch fails', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    render(<FeedbackList />);

    await waitFor(() => expect(screen.getByText('Failed to fetch feedback')).toBeTruthy());
  });

  it('renders the empty state without fetching when initialFeedback is empty', () => {
    render(<FeedbackList initialFeedback={[]} />);

    expect(screen.getByText('No feedback yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('paginates with pageSize', () => {
    const items = [makeItem(), makeItem({ id: 'fb_2', userEmail: 'bob@example.com' })];
    render(<FeedbackList initialFeedback={items} pageSize={1} />);

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByText('jane')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();

    fireEvent.click(screen.getByText('Next'));

    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('jane')).toBeNull();
  });

  it('PATCHes the item endpoint on status change and updates the row', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render(<FeedbackList initialFeedback={[makeItem()]} />);

    fireEvent.change(screen.getByDisplayValue('Pending'), { target: { value: 'Done' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback/fb_1');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).status).toBe('Done');
    await waitFor(() => expect(screen.getByDisplayValue('Done')).toBeTruthy());
  });

  it('uses a custom onStatusChange handler instead of the API', async () => {
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    render(<FeedbackList initialFeedback={[makeItem()]} onStatusChange={onStatusChange} />);

    fireEvent.change(screen.getByDisplayValue('Pending'), { target: { value: 'Done' } });

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('fb_1', 'Done'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies a single item in the 'ai-triage' export shape", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<FeedbackList initialFeedback={[makeItem()]} exportFormat="ai-triage" />);
    fireEvent.click(screen.getByTitle('Copy as JSON'));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      id: 'fb_1',
      feedback: 'Make the table sortable',
      page: '/pricing',
      section: 'Pricing Table',
      elementId: null,
      category: null,
      from: 'jane@example.com',
      status: 'Pending',
      submittedAt: '2026-06-01T10:00:00.000Z',
    });
  });

  it('renders an http(s) pageUrl as a link', () => {
    render(<FeedbackList initialFeedback={[makeItem()]} />);

    const link = document.querySelector('.cf-list-td-page a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://app.example.com/pricing');
  });

  it('renders a javascript: pageUrl as plain text, never as a link', () => {
    render(
      <FeedbackList
        initialFeedback={[makeItem({ pageUrl: "javascript:alert('xss')" })]}
      />
    );

    expect(document.querySelector('.cf-list-td-page a')).toBeNull();
  });

  it('applies statusFilter client-side to initialFeedback', () => {
    const items = [
      makeItem(),
      makeItem({ id: 'fb_2', userEmail: 'bob@example.com', status: 'Done' }),
    ];
    render(<FeedbackList initialFeedback={items} statusFilter="Done" />);

    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('jane')).toBeNull();
    expect(screen.getByText('1 item')).toBeTruthy();
  });

  it('drops an item from a filtered view when its status changes', async () => {
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    render(
      <FeedbackList
        initialFeedback={[makeItem()]}
        statusFilter="Pending"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Pending'), { target: { value: 'Done' } });

    await waitFor(() => expect(screen.queryByText('jane')).toBeNull());
  });

  it('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise(() => {}); // never resolves
    });

    const { unmount } = render(<FeedbackList />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    const resolvers: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => resolvers.push(resolve))
    );

    const { rerender } = render(<FeedbackList statusFilter="Pending" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    rerender(<FeedbackList statusFilter="Done" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Newer request resolves first…
    resolvers[1](
      new Response(
        JSON.stringify([makeItem({ id: 'fb_2', userEmail: 'fresh@example.com', status: 'Done' })]),
        { status: 200 }
      )
    );
    await waitFor(() => expect(screen.getByText('fresh')).toBeTruthy());

    // …then the slow stale one — it must not overwrite the newer data.
    resolvers[0](
      new Response(JSON.stringify([makeItem({ userEmail: 'stale@example.com' })]), { status: 200 })
    );
    await waitFor(() => expect(screen.getByText('fresh')).toBeTruthy());
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('re-shows the loading state when the filter changes', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([makeItem()]), { status: 200 })
    );

    const { rerender } = render(<FeedbackList />);
    await waitFor(() => expect(screen.getByText('jane')).toBeTruthy());

    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    rerender(<FeedbackList statusFilter="Done" />);

    expect(screen.getByText('Loading feedback...')).toBeTruthy();
  });

  it('expands the details row via the keyboard-accessible expand button', () => {
    render(<FeedbackList initialFeedback={[makeItem()]} />);

    const expandButton = screen.getByLabelText('Show feedback from jane@example.com');
    expect(expandButton.tagName).toBe('BUTTON');
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(expandButton);

    expect(expandButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Make the table sortable')).toBeTruthy();
  });

  it('labels the status select and announces copy success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<FeedbackList initialFeedback={[makeItem()]} />);

    expect(screen.getByLabelText('Status for feedback from jane@example.com')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Copy as JSON'));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Copied to clipboard')
    );
  });
});
