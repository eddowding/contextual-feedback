'use client';

import { useState, useEffect, useRef, FormEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
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
    userEmail?: string;
  }) => Promise<void>;
}

export function FeedbackDialog({
  apiEndpoint = '/api/feedback',
  onSubmit
}: FeedbackDialogProps = {}) {
  const {
    isOpen,
    closeDialog,
    context: providedContext,
    elementId: providedElementId,
    mode,
    collectEmail,
    defaultEmail,
  } = useFeedback();
  const [feedback, setFeedback] = useState('');
  const [email, setEmail] = useState(defaultEmail || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [, setDetectedContext] = useState<string>('General Page');
  const [detectedElementId, setDetectedElementId] = useState<string | undefined>(undefined);
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [selectedContext, setSelectedContext] = useState<string>('General Page');
  const [availableContexts, setAvailableContexts] = useState<string[]>(['General Page']);
  const mouseDownOnOverlayRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const contextSelectRef = useRef<HTMLSelectElement>(null);

  // Detect context and reset transient state (email, error, success) when dialog opens
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
      setEmail(defaultEmail || '');
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, providedContext, providedElementId, defaultEmail]);

  // Escape-to-close, initial focus, Tab trapping, and focus restore while the
  // dialog is open (ARIA APG modal dialog pattern)
  useEffect(() => {
    if (!isOpen) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    textareaRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap Tab/Shift+Tab inside the dialog
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen, closeDialog]);

  // Move focus to the success confirmation so screen readers announce it
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  // Focus the context select when the edit toggle reveals it
  useEffect(() => {
    if (isEditingContext) contextSelectRef.current?.focus();
  }, [isEditingContext]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const feedbackData = {
      feedbackText: feedback,
      pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      context: selectedContext !== 'General Page' ? selectedContext : undefined,
      elementId: detectedElementId,
      ...(collectEmail !== 'never' && email.trim() ? { userEmail: email.trim() } : {}),
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

      // Show the confirmation until the user dismisses it — auto-closing
      // would yank the dialog away before screen-reader users perceive it.
      setSuccess(true);
      setFeedback('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const showEmail = collectEmail !== 'never';
  const emailRequired = collectEmail === 'required';
  const isSubmitDisabled = isSubmitting || !feedback.trim() || (emailRequired && !email.trim());

  // Only dismiss when the interaction both started and ended on the backdrop —
  // a text-selection drag from the textarea released over the overlay must not
  // close the dialog and discard the user's typed feedback.
  const handleOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    mouseDownOnOverlayRef.current = e.target === e.currentTarget;
  };
  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (mouseDownOnOverlayRef.current && e.target === e.currentTarget) {
      closeDialog();
    }
    mouseDownOnOverlayRef.current = false;
  };

  // Portal to document.body so `position: fixed` isn't trapped by transformed/
  // filtered ancestors (which become the containing block and clip the overlay).
  // isOpen can only be true client-side, so document is always available here.
  return createPortal(
    <div className="cf-dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className="cf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cf-dialog-title"
        aria-describedby="cf-dialog-desc"
      >
        <button className="cf-dialog-close" onClick={closeDialog} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 id="cf-dialog-title" className="cf-dialog-title">Send Feedback</h2>
        <p id="cf-dialog-desc" className="cf-dialog-description">
          Share your thoughts, report issues, or suggest improvements.
        </p>

        {success ? (
          <div className="cf-success" role="status" tabIndex={-1} ref={successRef}>
            <div className="cf-success-title">Thank you for your feedback!</div>
            <p className="cf-success-message">We appreciate your input.</p>
            <button type="button" onClick={closeDialog} className="cf-btn cf-btn-primary cf-success-close">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="cf-form">
            {/* Context Section — hidden in simple mode */}
            {mode === 'targeted' && (
              <div className="cf-context-box">
                <div className="cf-context-content">
                  <label htmlFor="cf-context" className="cf-context-label">About:</label>
                  <div className="cf-context-value">
                    {isEditingContext ? (
                      <select
                        id="cf-context"
                        ref={contextSelectRef}
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
                  aria-label={isEditingContext ? 'Done editing section' : 'Change section'}
                  aria-expanded={isEditingContext}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Email field — shown when collectEmail is 'optional' or 'required' */}
            {showEmail && (
              <div className="cf-field">
                <label htmlFor="cf-email" className="cf-label">
                  Email{emailRequired ? '' : ' (optional)'}
                </label>
                <input
                  id="cf-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="cf-input"
                  placeholder="your@email.com"
                  required={emailRequired}
                  disabled={isSubmitting}
                />
              </div>
            )}

            <div className="cf-field">
              <label htmlFor="cf-feedback" className="cf-label">What's on your mind?</label>
              <textarea
                id="cf-feedback"
                ref={textareaRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                required
                rows={5}
                className="cf-textarea"
                placeholder="Tell us what you think, report a bug, or suggest an improvement..."
                disabled={isSubmitting}
              />
            </div>

            {error && <div className="cf-error" role="alert">{error}</div>}

            <div className="cf-page-info">
              Page: <span className="cf-page-url">{typeof window !== 'undefined' ? window.location.pathname : ''}</span>
            </div>

            <div className="cf-actions">
              <button type="button" onClick={closeDialog} disabled={isSubmitting} className="cf-btn cf-btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitDisabled} className="cf-btn cf-btn-primary">
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
    </div>,
    document.body
  );
}
