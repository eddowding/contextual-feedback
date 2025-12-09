import { FeedbackAdapter, FeedbackStatus } from '../lib/types';

export interface ApiConfig {
  adapter: FeedbackAdapter;
  /** Function to get current user email from request */
  getUserEmail?: (request: Request) => Promise<string | null>;
}

/**
 * Create API handlers for feedback endpoints
 *
 * @example Next.js App Router
 * ```ts
 * // app/api/feedback/route.ts
 * import { createApiHandlers } from 'contextual-feedback/api';
 * import { createPostgresAdapter } from 'contextual-feedback/adapters/postgres';
 *
 * const adapter = createPostgresAdapter({ pool });
 * const { GET, POST } = createApiHandlers({ adapter });
 * export { GET, POST };
 * ```
 */
export function createApiHandlers(config: ApiConfig) {
  const { adapter, getUserEmail } = config;

  return {
    /**
     * GET /api/feedback
     * List all feedback, optionally filtered by status
     */
    async GET(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status') as FeedbackStatus | null;

        const feedback = await adapter.getAll(status || undefined);

        return new Response(JSON.stringify(feedback), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error fetching feedback:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch feedback' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    },

    /**
     * POST /api/feedback
     * Submit new feedback
     */
    async POST(request: Request): Promise<Response> {
      try {
        const userEmail = getUserEmail ? await getUserEmail(request) : 'anonymous';
        const body = await request.json();
        const { feedbackText, pageUrl, context, elementId } = body;

        if (!feedbackText || !feedbackText.trim()) {
          return new Response(
            JSON.stringify({ error: 'Feedback text is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (!pageUrl) {
          return new Response(
            JSON.stringify({ error: 'Page URL is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const feedback = await adapter.add({
          userEmail: userEmail || 'anonymous',
          pageUrl,
          feedbackText: feedbackText.trim(),
          context,
          elementId,
        });

        return new Response(JSON.stringify(feedback), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error submitting feedback:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to submit feedback' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    },

    /**
     * PATCH /api/feedback/[id]
     * Update feedback status or admin notes
     */
    async PATCH(request: Request, id: string): Promise<Response> {
      try {
        const body = await request.json();
        const { status, adminNotes } = body;

        const validStatuses: FeedbackStatus[] = ['Pending', 'In Review', 'Done', 'Rejected'];
        if (status && !validStatuses.includes(status)) {
          return new Response(
            JSON.stringify({ error: 'Invalid status value' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const existing = await adapter.getById(id);
        if (!existing) {
          return new Response(
            JSON.stringify({ error: 'Feedback not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const updated = await adapter.update(id, { status, adminNotes });

        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error updating feedback:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to update feedback' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    },

    /**
     * GET /api/feedback/count
     * Get count of feedback by status
     */
    async COUNT(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status') as FeedbackStatus | null;

        const count = adapter.getCount
          ? await adapter.getCount(status || undefined)
          : (await adapter.getAll(status || undefined)).length;

        return new Response(JSON.stringify({ count }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error getting feedback count:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to get count', count: 0 }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  };
}
