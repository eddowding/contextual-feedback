/**
 * Single place the watcher imports library symbols from.
 *
 * In this in-repo example we import directly from the library source so the
 * watcher's tests resolve without a separate `npm install` of the published
 * package. In a downstream/standalone deployment, change these two specifiers
 * to `'contextual-feedback/ai'` (the public subpath) — every other watcher
 * module imports from here, so this is the only edit needed.
 */
export {
  createTriageClient,
  TriageHttpError,
  formatTriageBatch,
  TRIAGE_DISPOSITIONS,
} from '../../../src/lib/ai';

export type {
  TriageClient,
  TriageItem,
  TriageResponse,
  Resolution,
  ResolveResponse,
  FetchLike,
  TriageDecision,
  TriageDisposition,
  TriageAuditRecord,
} from '../../../src/lib/ai';

export {
  VALID_STATUSES,
  VALID_CATEGORIES,
} from '../../../src/lib/types';

export type {
  Feedback,
  FeedbackStatus,
  FeedbackCategory,
} from '../../../src/lib/types';
