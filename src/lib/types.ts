export type FeedbackStatus = 'Pending' | 'In Review' | 'Done' | 'Rejected';

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
}

export interface FeedbackInput {
  userEmail: string;
  pageUrl: string;
  feedbackText: string;
  context?: string;
  elementId?: string;
}

export interface FeedbackUpdate {
  status?: FeedbackStatus;
  adminNotes?: string;
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
}
