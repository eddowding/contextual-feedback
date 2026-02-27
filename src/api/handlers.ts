import { FeedbackAdapter, FeedbackStatus, FeedbackUpdate, validateFeedbackInput } from '../lib/types';

export interface ApiConfig {
  adapter: FeedbackAdapter;
  /** Function to get current user email from request */
  getUserEmail?: (request: Request) => Promise<string | null>;
  /** Optional authorization callback for admin endpoints (PATCH, TRIAGE, RESOLVE).
   *  Return true to allow, false to deny. If not provided, all requests are allowed. */
  authorize?: (request: Request) => Promise<boolean>;
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
  const { adapter, getUserEmail, authorize } = config;

  async function checkAuth(request: Request): Promise<Response | null> {
    if (!authorize) return null;
    const allowed = await authorize(request);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return null;
  }

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
        const { feedbackText, pageUrl, context, elementId, category } = body;

        const validationErrors = validateFeedbackInput({
          feedbackText,
          pageUrl,
          userEmail: userEmail || 'anonymous',
          category,
        });

        if (validationErrors.length > 0) {
          return new Response(
            JSON.stringify({ error: validationErrors[0].message, errors: validationErrors }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

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
          userEmail: (userEmail || 'anonymous').trim(),
          pageUrl: pageUrl.trim(),
          feedbackText: feedbackText.trim(),
          context: context?.trim() || undefined,
          elementId: elementId?.trim() || undefined,
          category: category || undefined,
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
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const body = await request.json();
        const { status, adminNotes, category } = body;

        if (status === undefined && adminNotes === undefined && category === undefined) {
          return new Response(
            JSON.stringify({ error: 'At least one field (status, adminNotes, or category) is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

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

        const updated = await adapter.update(id, {
          status,
          adminNotes: adminNotes?.trim(),
          category,
        });

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
    },

    /**
     * GET /api/feedback/triage
     * Returns pending + in-review feedback in an AI-optimized format
     */
    async TRIAGE(request: Request): Promise<Response> {
      try {
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const pending = await adapter.getAll('Pending');
        const inReview = await adapter.getAll('In Review');
        const allItems = [...pending, ...inReview];

        const items = allItems.map((item) => {
          let page = item.pageUrl;
          try {
            page = new URL(item.pageUrl).pathname;
          } catch {
            // Keep original if not a valid URL
          }

          return {
            id: item.id,
            feedback: item.feedbackText,
            page,
            section: item.context || 'General',
            elementId: item.elementId || null,
            category: item.category || null,
            from: item.userEmail,
            status: item.status,
            submittedAt: item.createdAt,
          };
        });

        return new Response(JSON.stringify({
          items,
          summary: {
            pending: pending.length,
            inReview: inReview.length,
            total: allItems.length,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error fetching triage data:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch triage data' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    },

    /**
     * POST /api/feedback/resolve
     * Bulk-update feedback items with status + admin notes
     */
    async RESOLVE(request: Request): Promise<Response> {
      try {
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const body = await request.json();
        const { resolutions } = body;

        if (!Array.isArray(resolutions) || resolutions.length === 0) {
          return new Response(
            JSON.stringify({ error: 'resolutions array is required and must not be empty' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const validStatuses: FeedbackStatus[] = ['Pending', 'In Review', 'Done', 'Rejected'];

        for (const resolution of resolutions) {
          if (!resolution.id || typeof resolution.id !== 'string') {
            return new Response(
              JSON.stringify({ error: 'Each resolution must have a string id' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (resolution.status && !validStatuses.includes(resolution.status)) {
            return new Response(
              JSON.stringify({ error: `Invalid status "${resolution.status}" for id "${resolution.id}"` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        const updates: Array<{ id: string } & FeedbackUpdate> = resolutions.map(
          (r: { id: string; status?: FeedbackStatus; adminNotes?: string; category?: FeedbackUpdate['category'] }) => ({
            id: r.id,
            status: r.status,
            adminNotes: r.adminNotes?.trim(),
            category: r.category,
          })
        );

        let results;
        if (adapter.bulkUpdate) {
          results = await adapter.bulkUpdate(updates);
        } else {
          results = [];
          for (const { id, ...update } of updates) {
            const updated = await adapter.update(id, update);
            if (updated) results.push(updated);
          }
        }

        return new Response(JSON.stringify({ updated: results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error resolving feedback:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to resolve feedback' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  };
}
