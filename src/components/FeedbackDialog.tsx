'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useFeedback } from './FeedbackProvider';
import { detectFeedbackContext, getPageContexts } from '../lib/utils';

export interface FeedbackDialogProps {
  /** API endpoint for submitting feedback. Defaults to '/api/feedback' */
  apiEndpoint?: string;
  /** Custom submit handler (overrides API call) */
  onSubmit?: (feedback: {
    feedbackText: string;
    pageUrl: string;
    context?: string;
    elementId?: string;
  }) => Promise<void>;
}

export function FeedbackDialog({
  apiEndpoint = '/api/feedback',
  onSubmit
}: FeedbackDialogProps = {}) {
  const { isOpen, closeDialog, context: providedContext, elementId: providedElementId } = useFeedback();
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [detectedContext, setDetectedContext] = useState<string>('General Page');
  const [detectedElementId, setDetectedElementId] = useState<string | undefined>(undefined);
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [selectedContext, setSelectedContext] = useState<string>('General Page');
  const [availableContexts, setAvailableContexts] = useState<string[]>(['General Page']);

  // Detect context when dialog opens
  useEffect(() => {
    if (isOpen) {
      const contexts = getPageContexts();
      setAvailableContexts(contexts);

      if (providedContext) {
        setDetectedContext(providedContext);
        setDetectedElementId(providedElementId);
        setSelectedContext(providedContext);
      } else {
        const detected = detectFeedbackContext();
        setDetectedContext(detected.context);
        setDetectedElementId(detected.elementId);
        setSelectedContext(detected.context);
      }
      setIsEditingContext(false);
    }
  }, [isOpen, providedContext, providedElementId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const feedbackData = {
      feedbackText: feedback,
      pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      context: selectedContext !== 'General Page' ? selectedContext : undefined,
      elementId: detectedElementId,
    };

    try {
      if (onSubmit) {
        await onSubmit(feedbackData);
      } else {
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedbackData),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to submit feedback');
        }
      }

      setSuccess(true);
      setFeedback('');

      setTimeout(() => {
        closeDialog();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="cf-dialog-overlay" onClick={closeDialog}>
      <div className="cf-dialog" onClick={e => e.stopPropagation()}>
        <button className="cf-dialog-close" onClick={closeDialog} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 className="cf-dialog-title">Send Feedback</h2>
        <p className="cf-dialog-description">
          Share your thoughts, report issues, or suggest improvements.
        </p>

        {success ? (
          <div className="cf-success">
            <div className="cf-success-title">Thank you for your feedback!</div>
            <p className="cf-success-message">We appreciate your input.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="cf-form">
            {/* Context Section */}
            <div className="cf-context-box">
              <div className="cf-context-content">
                <div className="cf-context-label">About:</div>
                <div className="cf-context-value">
                  {isEditingContext ? (
                    <select
                      value={selectedContext}
                      onChange={(e) => setSelectedContext(e.target.value)}
                      className="cf-context-select"
                    >
                      {availableContexts.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    selectedContext
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingContext(!isEditingContext)}
                className="cf-context-edit"
                title={isEditingContext ? 'Done' : 'Edit'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>

            <div className="cf-field">
              <label htmlFor="cf-feedback" className="cf-label">What's on your mind?</label>
              <textarea
                id="cf-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                required
                rows={5}
                className="cf-textarea"
                placeholder="Tell us what you think, report a bug, or suggest an improvement..."
                disabled={isSubmitting}
              />
            </div>

            {error && <div className="cf-error">{error}</div>}

            <div className="cf-page-info">
              Page: <span className="cf-page-url">{typeof window !== 'undefined' ? window.location.pathname : ''}</span>
            </div>

            <div className="cf-actions">
              <button type="button" onClick={closeDialog} disabled={isSubmitting} className="cf-btn cf-btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting || !feedback.trim()} className="cf-btn cf-btn-primary">
                {isSubmitting ? (
                  <>
                    <svg className="cf-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  'Submit Feedback'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
