export type FeedbackStatus = 'Pending' | 'In Review' | 'Done' | 'Rejected';

export type FeedbackCategory = 'bug' | 'feature' | 'praise' | 'question' | 'other';

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

  /** Update feedback */
  update(id: string, updates: FeedbackUpdate): Promise<Feedback | null>;

  /** Delete feedback */
  delete?(id: string): Promise<boolean>;

  /** Get count by status */
  getCount?(status?: FeedbackStatus): Promise<number>;

  /** Bulk update multiple feedback items at once */
  bulkUpdate?(updates: Array<{ id: string } & FeedbackUpdate>): Promise<Feedback[]>;
}

export interface ValidationError {
  field: string;
  message: string;
}

const VALID_CATEGORIES: FeedbackCategory[] = ['bug', 'feature', 'praise', 'question', 'other'];

/**
 * Validate feedback input fields.
 * Returns an array of validation errors (empty if valid).
 */
export function validateFeedbackInput(input: Partial<FeedbackInput>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.feedbackText !== undefined) {
    const trimmed = input.feedbackText.trim();
    if (!trimmed) {
      errors.push({ field: 'feedbackText', message: 'Feedback text is required' });
    } else if (trimmed.length > 5000) {
      errors.push({ field: 'feedbackText', message: 'Feedback text must be 5000 characters or less' });
    }
  }

  if (input.pageUrl !== undefined) {
    const trimmed = input.pageUrl.trim();
    if (!trimmed) {
      errors.push({ field: 'pageUrl', message: 'Page URL is required' });
    } else if (trimmed.length > 2000) {
      errors.push({ field: 'pageUrl', message: 'Page URL must be 2000 characters or less' });
    }
  }

  if (input.userEmail !== undefined) {
    const trimmed = input.userEmail.trim();
    if (trimmed && !trimmed.includes('@')) {
      errors.push({ field: 'userEmail', message: 'Invalid email format' });
    }
  }

  if (input.category !== undefined && !VALID_CATEGORIES.includes(input.category)) {
    errors.push({ field: 'category', message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }

  return errors;
}
