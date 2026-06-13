import { Feedback, FeedbackAdapter, FeedbackCategory, FeedbackInput, FeedbackStatus, FeedbackUpdate, VALID_CATEGORIES, VALID_STATUSES, validateFeedbackInput } from '../lib/types';

/**
 * Invoke a fire-and-forget hook so that NOTHING it does can affect the HTTP
 * response: a rejected promise, a synchronous throw, or a plain (non-promise)
 * return — easy in untyped JS — are all absorbed and logged.
 */
function fireAndForget(run: () => unknown): void {
  Promise.resolve()
    .then(() => run())
    .catch(console.error);
}
import { toTriageItem } from '../lib/ai';

const MAX_ADMIN_NOTES_LENGTH = 5000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Parse and validate a JSON request body for state-changing endpoints (POST/PATCH/RESOLVE).
 *
 * - Rejects non-JSON content types with 415. This doubles as CSRF protection when
 *   `authorize` is cookie-based: a cross-site HTML form can only submit
 *   text/plain, multipart or urlencoded bodies without triggering a CORS preflight,
 *   so requiring `application/json` blocks form-based forgery.
 * - Rejects malformed JSON and non-object bodies with 400 — these are client errors,
 *   not server failures, so they must not surface as 500s.
 */
async function parseJsonBody(
  request: Request
): Promise<{ body: Record<string, unknown>; errorResponse?: undefined } | { body?: undefined; errorResponse: Response }> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { errorResponse: jsonResponse({ error: 'Content-Type must be application/json' }, 415) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { errorResponse: jsonResponse({ error: 'Invalid JSON body' }, 400) };
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { errorResponse: jsonResponse({ error: 'Request body must be a JSON object' }, 400) };
  }

  return { body: body as Record<string, unknown> };
}

/**
 * Return a 400 Response when any of the named body fields is present but not a string
 * (numbers, booleans, nulls, objects). Guards the `.trim()` calls downstream so a
 * malformed body surfaces as a 400 validation error rather than a TypeError → 500.
 */
function validateStringFields(body: Record<string, unknown>, fields: string[]): Response | null {
  for (const field of fields) {
    const value = body[field];
    if (value !== undefined && typeof value !== 'string') {
      return jsonResponse({ error: `${field} must be a string` }, 400);
    }
  }
  return null;
}

/**
 * Parse and validate the optional `status` query param (GET/COUNT). Returns a 400
 * Response for unknown values instead of silently returning an empty result set.
 */
function parseStatusParam(
  url: URL
): { status: FeedbackStatus | undefined; errorResponse?: undefined } | { status?: undefined; errorResponse: Response } {
  const raw = url.searchParams.get('status');
  if (raw === null) return { status: undefined };
  if (!VALID_STATUSES.includes(raw as FeedbackStatus)) {
    return {
      errorResponse: jsonResponse(
        { error: `Invalid status value. Must be one of: ${VALID_STATUSES.join(', ')}` },
        400
      ),
    };
  }
  return { status: raw as FeedbackStatus };
}

/** Validate an optional `adminNotes` field. Returns a 400 Response on failure, null when ok.
 *  Pass `forId` in batch contexts (RESOLVE) so the error identifies the offending item,
 *  matching the neighbouring status/category error formats. */
function validateAdminNotes(adminNotes: unknown, context: { forId?: string } = {}): Response | null {
  const suffix = context.forId !== undefined ? ` for id "${context.forId}"` : '';
  if (adminNotes !== undefined && typeof adminNotes !== 'string') {
    return jsonResponse({ error: `adminNotes must be a string${suffix}` }, 400);
  }
  if (typeof adminNotes === 'string' && adminNotes.length > MAX_ADMIN_NOTES_LENGTH) {
    return jsonResponse(
      { error: `Admin notes must be ${MAX_ADMIN_NOTES_LENGTH} characters or less${suffix}` },
      400
    );
  }
  return null;
}

export interface ApiConfig {
  adapter: FeedbackAdapter;
  /** Function to get current user email from request. This is the TRUSTED identity
   *  source: with the default `trustClientEmail: false` its result overrides any
   *  client-supplied body email, so it MUST return a verified identity (e.g. from a
   *  server-side session via Supabase `auth.getUser()` or NextAuth `getServerSession`).
   *  Never derive it from a request header the client can set (like `x-user-email`) —
   *  that would let any caller forge attribution. Return null when there is no
   *  authenticated user. */
  getUserEmail?: (request: Request) => Promise<string | null>;
  /** Optional authorization callback. When provided it gates every read/admin endpoint
   *  (GET, COUNT, PATCH, TRIAGE, RESOLVE) — GET/COUNT can leak feedback (incl. emails) to
   *  any caller, so they are protected too. POST (public submission) is never gated.
   *  Return true to allow, false to deny. If not provided, all requests are allowed. */
  authorize?: (request: Request) => Promise<boolean>;
  /** When false (default), the server `getUserEmail` result OVERRIDES any client-supplied
   *  `userEmail` in the request body, since a client-supplied identity is spoofable.
   *  When true, the client body email is preferred (legacy behaviour). */
  trustClientEmail?: boolean;
  /** Called after a new feedback item is successfully created. Fire-and-forget. */
  onSubmit?: (feedback: Feedback) => Promise<void>;
  /** Called for each item resolved via the RESOLVE endpoint. Fire-and-forget. */
  onResolve?: (feedback: Feedback, updates: FeedbackUpdate) => Promise<void>;
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
  const { adapter, getUserEmail, authorize, trustClientEmail = false } = config;

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
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const url = new URL(request.url);
        const statusParam = parseStatusParam(url);
        if (statusParam.errorResponse) return statusParam.errorResponse;

        const feedback = await adapter.getAll(statusParam.status);

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
        const parsed = await parseJsonBody(request);
        if (parsed.errorResponse) return parsed.errorResponse;

        // Explicit `null` for an OPTIONAL field means "absent" — many non-JS
        // serializers (Python/Go/Java, ORMs) emit null for missing optionals,
        // and 0.1.0 accepted it. Normalise before type-checking so it isn't
        // rejected as a wrong type. feedbackText/pageUrl stay strict: null was
        // already a 400 for those.
        for (const field of ['context', 'elementId', 'userEmail']) {
          if (parsed.body[field] === null) delete parsed.body[field];
        }

        const stringFieldError = validateStringFields(parsed.body, [
          'feedbackText', 'pageUrl', 'context', 'elementId', 'userEmail',
        ]);
        if (stringFieldError) return stringFieldError;

        const { feedbackText, pageUrl, context, elementId, category, userEmail: bodyEmail } =
          parsed.body as Partial<FeedbackInput>;

        // Resolve the submitter's email. A client-supplied body email is spoofable, so by
        // default the server-derived email (getUserEmail) takes precedence. Only when
        // `trustClientEmail` is true does the client body email win (legacy behaviour).
        const serverEmail = getUserEmail ? await getUserEmail(request) : null;
        const userEmail = trustClientEmail
          ? (bodyEmail?.trim() || serverEmail || 'anonymous')
          : (serverEmail || bodyEmail?.trim() || 'anonymous');

        // Full (non-partial) validation: missing/empty feedbackText and pageUrl
        // are rejected here, so no duplicated required-field checks are needed.
        const validationErrors = validateFeedbackInput({
          feedbackText,
          pageUrl,
          context,
          elementId,
          // 'anonymous' is the sentinel for submissions with no email source —
          // skip the email-format check for it so anonymous feedback is accepted.
          ...(userEmail === 'anonymous' ? {} : { userEmail }),
          category,
        });

        if (validationErrors.length > 0) {
          return new Response(
            JSON.stringify({ error: validationErrors[0].message, errors: validationErrors }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const feedback = await adapter.add({
          userEmail: userEmail.trim(),
          // Validation guarantees both are present non-empty strings; the ?? ''
          // only narrows the Partial<> types for the compiler.
          pageUrl: (pageUrl ?? '').trim(),
          feedbackText: (feedbackText ?? '').trim(),
          context: context?.trim() || undefined,
          elementId: elementId?.trim() || undefined,
          category: category || undefined,
        });

        if (config.onSubmit) {
          const { onSubmit } = config;
          fireAndForget(() => onSubmit(feedback));
        }

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

        const parsed = await parseJsonBody(request);
        if (parsed.errorResponse) return parsed.errorResponse;
        const { status, adminNotes, category } = parsed.body as {
          status?: FeedbackStatus;
          adminNotes?: string;
          category?: FeedbackCategory;
        };

        if (status === undefined && adminNotes === undefined && category === undefined) {
          return new Response(
            JSON.stringify({ error: 'At least one field (status, adminNotes, or category) is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (status !== undefined && !VALID_STATUSES.includes(status)) {
          return new Response(
            JSON.stringify({ error: 'Invalid status value' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Delegate category validation to the canonical validator so the rule
        // and its error message live in one place (validateFeedbackInput),
        // rather than re-implementing the enum check here.
        const categoryErrors = validateFeedbackInput({ category }, { partial: true });
        if (categoryErrors.length > 0) {
          return jsonResponse({ error: categoryErrors[0].message }, 400);
        }

        const adminNotesError = validateAdminNotes(adminNotes);
        if (adminNotesError) return adminNotesError;

        // No getById pre-check: the update result is the 404 signal. A pre-check is
        // racy (the row can vanish between the two calls, returning 200 with body
        // `null`) and costs an extra round-trip.
        const updated = await adapter.update(id, {
          status,
          adminNotes: adminNotes?.trim(),
          category,
        });

        if (!updated) {
          return new Response(
            JSON.stringify({ error: 'Feedback not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

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
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const url = new URL(request.url);
        const statusParam = parseStatusParam(url);
        if (statusParam.errorResponse) return statusParam.errorResponse;

        const count = adapter.getCount
          ? await adapter.getCount(statusParam.status)
          : (await adapter.getAll(statusParam.status)).length;

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

        const items = allItems.map(toTriageItem);

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
     * Bulk-update feedback items with status + admin notes.
     *
     * Responds with `{ updated: Feedback[], notFound: string[], failed: string[] }`:
     * - `notFound` — ids whose update matched no row (deleted, never existed, or
     *   filtered by row-level security). Safe to drop.
     * - `failed` — ids whose individual update ERRORED (db outage, bad credentials,
     *   RLS misconfiguration). These should be retried, not treated as gone.
     *
     * Status is 200 for full/partial success, or 500 when nothing was updated and
     * at least one update errored — so an infrastructure failure is never reported
     * as an all-items-missing success.
     */
    async RESOLVE(request: Request): Promise<Response> {
      try {
        const authResponse = await checkAuth(request);
        if (authResponse) return authResponse;

        const parsed = await parseJsonBody(request);
        if (parsed.errorResponse) return parsed.errorResponse;
        const { resolutions } = parsed.body;

        if (!Array.isArray(resolutions) || resolutions.length === 0) {
          return new Response(
            JSON.stringify({ error: 'resolutions array is required and must not be empty' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        for (const resolution of resolutions) {
          if (typeof resolution !== 'object' || resolution === null || Array.isArray(resolution)) {
            return new Response(
              JSON.stringify({ error: 'Each resolution must be an object' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (!resolution.id || typeof resolution.id !== 'string') {
            return new Response(
              JSON.stringify({ error: 'Each resolution must have a string id' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (resolution.status !== undefined && !VALID_STATUSES.includes(resolution.status)) {
            return new Response(
              JSON.stringify({ error: `Invalid status "${resolution.status}" for id "${resolution.id}"` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (resolution.category !== undefined && !VALID_CATEGORIES.includes(resolution.category)) {
            return new Response(
              JSON.stringify({ error: `Invalid category "${resolution.category}" for id "${resolution.id}"` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          const adminNotesError = validateAdminNotes(resolution.adminNotes, { forId: resolution.id });
          if (adminNotesError) return adminNotesError;
        }

        const updates: Array<{ id: string } & FeedbackUpdate> = resolutions.map(
          (r: { id: string; status?: FeedbackStatus; adminNotes?: string; category?: FeedbackUpdate['category'] }) => ({
            id: r.id,
            status: r.status,
            adminNotes: r.adminNotes?.trim(),
            category: r.category,
          })
        );

        let results: Feedback[];
        const failed: string[] = [];
        if (adapter.bulkUpdate) {
          // bulkUpdate always resolves a BulkUpdateResult. Atomic adapters
          // (postgres) throw on any error → caught below as a 500; per-item
          // adapters (supabase) report retryable errors in `failed`.
          const bulkResult = await adapter.bulkUpdate(updates);
          results = bulkResult.updated;
          failed.push(...bulkResult.failed.map(f => f.id));
        } else {
          results = [];
          for (const { id, ...update } of updates) {
            // Per-item failures must not abort the loop: earlier updates are
            // already committed, so a blanket 500 would misreport them as not
            // having happened. Failed ids surface in `failed` (distinct from
            // missing-row `notFound`) so the caller can retry them.
            try {
              const updated = await adapter.update(id, update);
              if (updated) results.push(updated);
            } catch (error) {
              console.error(`Error resolving feedback "${id}":`, error);
              failed.push(id);
            }
          }
        }

        if (config.onResolve) {
          const { onResolve } = config;
          // Index the updates by id once (O(n)) rather than scanning the
          // updates array for every result (O(n·m)) on large batches.
          const updateById = new Map(updates.map(u => [u.id, u]));
          for (const result of results) {
            const matchingUpdate = updateById.get(result.id);
            if (matchingUpdate) {
              const { id: _id, ...updateFields } = matchingUpdate;
              fireAndForget(() => onResolve(result, updateFields));
            }
          }
        }

        // `notFound`: ids whose update matched no row (deleted, never existed,
        // or filtered by RLS) — distinct from `failed` (ids whose update
        // errored and should be retried). When nothing succeeded and at least
        // one update errored, respond 500 so an infrastructure failure (db
        // outage, expired credentials) is never reported as success.
        const updatedIds = new Set(results.map(r => r.id));
        const failedIds = new Set(failed);
        const notFound = updates
          .map(u => u.id)
          .filter(uId => !updatedIds.has(uId) && !failedIds.has(uId));

        const status = results.length === 0 && failed.length > 0 ? 500 : 200;
        return new Response(JSON.stringify({ updated: results, notFound, failed }), {
          status,
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
