/** All valid feedback statuses, as a runtime list (single source of truth). */
export const VALID_STATUSES = ['Pending', 'In Review', 'Done', 'Rejected'] as const;

export type FeedbackStatus = (typeof VALID_STATUSES)[number];

/** All valid feedback categories, as a runtime list (single source of truth). */
export const VALID_CATEGORIES = ['bug', 'feature', 'praise', 'question', 'other'] as const;

export type FeedbackCategory = (typeof VALID_CATEGORIES)[number];

export interface Feedback {
  id: string;
  userEmail: string;
  pageUrl: string;
  feedbackText: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  adminNotes?: string;
  context?: string;
  elementId?: string;
  category?: FeedbackCategory;
  resolvedAt?: string;
}

export interface FeedbackInput {
  userEmail: string;
  pageUrl: string;
  feedbackText: string;
  context?: string;
  elementId?: string;
  category?: FeedbackCategory;
}

export interface FeedbackUpdate {
  status?: FeedbackStatus;
  adminNotes?: string;
  category?: FeedbackCategory;
}

/** A single bulkUpdate item whose update ERRORED (as opposed to matching no row). */
export interface BulkUpdateFailure {
  id: string;
  error: string;
}

/**
 * Rich bulkUpdate result that distinguishes missing rows from errored updates.
 * `updated` holds the successfully updated items; `failed` lists ids whose
 * individual update errored (db outage, RLS misconfiguration, …) along with the
 * error message. Ids absent from both were missing rows.
 */
export interface BulkUpdateResult {
  updated: Feedback[];
  failed: BulkUpdateFailure[];
}

/**
 * Database adapter interface
 * Implement this to connect to your preferred database
 */
export interface FeedbackAdapter {
  /** Get all feedback, optionally filtered by status */
  getAll(status?: FeedbackStatus): Promise<Feedback[]>;

  /** Get feedback by ID */
  getById(id: string): Promise<Feedback | null>;

  /** Add new feedback */
  add(input: FeedbackInput): Promise<Feedback>;

  /** Update feedback. Resolves the updated item, or null when no row matched.
   *
   *  resolvedAt convention (every adapter must implement this — use the
   *  exported `computeResolvedAt` helper): a status change to Done/Rejected
   *  sets `resolvedAt`, preserving an existing value so retried/idempotent
   *  calls don't corrupt resolution-latency history; a change to
   *  Pending/In Review clears it; no status change leaves it untouched. */
  update(id: string, updates: FeedbackUpdate): Promise<Feedback | null>;

  /** Delete feedback. Resolves true only when a row existed and was deleted —
   *  deleting a missing id resolves false. */
  delete?(id: string): Promise<boolean>;

  /** Get count by status */
  getCount?(status?: FeedbackStatus): Promise<number>;

  /** Bulk update multiple feedback items at once. Applies the same resolvedAt
   *  convention as update().
   *
   *  Contract: always resolves a `BulkUpdateResult`. `updated` holds the items
   *  that were successfully updated; ids missing from BOTH `updated` and
   *  `failed` matched no row (the caller diffs to find them). `failed` reports
   *  per-item ERRORS so the caller can distinguish "row gone" (drop) from
   *  "retry later".
   *
   *  Two valid implementation strategies, both honouring this single type:
   *  - **Per-item** (e.g. the supabase adapter — PostgREST has no
   *    transactions): continue past a per-item error and record it in `failed`.
   *  - **Atomic** (e.g. the postgres adapter's transaction): all-or-nothing —
   *    on any error the whole batch rolls back and the method THROWS (the
   *    handler maps that to a 500). On success it returns `failed: []`.
   *
   *  Never persist partial updates and then throw. */
  bulkUpdate?(updates: Array<{ id: string } & FeedbackUpdate>): Promise<BulkUpdateResult>;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Compute the `resolvedAt` value for a status transition. This is the
 * lifecycle convention every adapter must implement (see
 * FeedbackAdapter.update): a transition to Done/Rejected sets `resolvedAt`,
 * keeping an existing timestamp so retried/idempotent RESOLVE calls (or a
 * PATCH that re-sends status while editing other fields) don't corrupt
 * resolution-latency history; a transition to Pending/In Review clears it.
 *
 * Returns the new ISO timestamp (or the preserved existing one), `null` to
 * clear the field, or `undefined` when the status did not change and
 * `resolvedAt` must be left untouched.
 */
export function computeResolvedAt(
  status: FeedbackStatus | undefined,
  existingResolvedAt?: string
): string | null | undefined {
  if (status === 'Done' || status === 'Rejected') {
    return existingResolvedAt ?? new Date().toISOString();
  }
  if (status === 'Pending' || status === 'In Review') return null;
  return undefined; // no status change
}

/**
 * A page URL is safe when it is an absolute http(s) URL or a relative path.
 * Anything carrying another scheme (javascript:, data:, vbscript:, …) is
 * rejected — those are script vectors when later rendered as an anchor href.
 */
export function isSafePageUrl(url: string): boolean {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL — allow relative paths only.
    return url.startsWith('/');
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Validate feedback input fields.
 *
 * By default this validates a FULL submission: missing `feedbackText` or
 * `pageUrl` are reported as errors. Pass `{ partial: true }` to validate a
 * partial payload (e.g. a field-by-field update), where only the fields that
 * are present get checked and required-ness is skipped.
 *
 * Returns an array of validation errors (empty if valid).
 */
export function validateFeedbackInput(
  input: Partial<FeedbackInput>,
  options: { partial?: boolean } = {}
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { partial = false } = options;

  if (input.feedbackText === undefined) {
    if (!partial) {
      errors.push({ field: 'feedbackText', message: 'Feedback text is required' });
    }
  } else if (typeof input.feedbackText !== 'string') {
    errors.push({ field: 'feedbackText', message: 'Feedback text must be a string' });
  } else {
    const trimmed = input.feedbackText.trim();
    if (!trimmed) {
      errors.push({ field: 'feedbackText', message: 'Feedback text is required' });
    } else if (trimmed.length > 5000) {
      errors.push({ field: 'feedbackText', message: 'Feedback text must be 5000 characters or less' });
    }
  }

  if (input.pageUrl === undefined) {
    if (!partial) {
      errors.push({ field: 'pageUrl', message: 'Page URL is required' });
    }
  } else if (typeof input.pageUrl !== 'string') {
    errors.push({ field: 'pageUrl', message: 'Page URL must be a string' });
  } else {
    const trimmed = input.pageUrl.trim();
    if (!trimmed) {
      errors.push({ field: 'pageUrl', message: 'Page URL is required' });
    } else if (trimmed.length > 2000) {
      errors.push({ field: 'pageUrl', message: 'Page URL must be 2000 characters or less' });
    } else if (!isSafePageUrl(trimmed)) {
      // Reject dangerous schemes (javascript:, data:, …) at the door so a
      // stored value can never execute when rendered as a link in an admin UI.
      errors.push({
        field: 'pageUrl',
        message: 'Page URL must be an http(s) URL or a relative path',
      });
    }
  }

  if (input.userEmail !== undefined) {
    if (typeof input.userEmail !== 'string') {
      errors.push({ field: 'userEmail', message: 'Email must be a string' });
    } else {
      const trimmed = input.userEmail.trim();
      if (trimmed && !trimmed.includes('@')) {
        errors.push({ field: 'userEmail', message: 'Invalid email format' });
      } else if (trimmed.length > 255) {
        // user_email is VARCHAR(255) in the SQL schemas — reject oversized
        // values here as a 400 instead of letting the database length error
        // surface as a 500 (matching the context/elementId caps below).
        errors.push({ field: 'userEmail', message: 'Email must be 255 characters or less' });
      }
    }
  }

  // context and element_id are VARCHAR(255) in the SQL schemas — reject
  // oversized values here as a 400 instead of letting the database error
  // surface as a 500. Note this runs at the HTTP boundary (validateFeedbackInput
  // is called by the API handlers); a caller writing directly through an adapter
  // is responsible for its own input limits.
  if (input.context !== undefined) {
    if (typeof input.context !== 'string') {
      errors.push({ field: 'context', message: 'Context must be a string' });
    } else if (input.context.trim().length > 255) {
      errors.push({ field: 'context', message: 'Context must be 255 characters or less' });
    }
  }

  if (input.elementId !== undefined) {
    if (typeof input.elementId !== 'string') {
      errors.push({ field: 'elementId', message: 'Element ID must be a string' });
    } else if (input.elementId.trim().length > 255) {
      errors.push({ field: 'elementId', message: 'Element ID must be 255 characters or less' });
    }
  }

  if (input.category !== undefined && !VALID_CATEGORIES.includes(input.category)) {
    errors.push({ field: 'category', message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }

  return errors;
}
