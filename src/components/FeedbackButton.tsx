'use client';

import { useFeedback } from './FeedbackProvider';

export interface FeedbackButtonProps {
  /** Position on screen */
  position?: 'right' | 'left' | 'bottom-right' | 'bottom-left';
  /** Custom class name */
  className?: string;
}

/**
 * Floating button to toggle feedback mode
 */
export function FeedbackButton({ position = 'right', className }: FeedbackButtonProps) {
  const { isFeedbackMode, toggleFeedbackMode } = useFeedback();

  const positionClasses: Record<string, string> = {
    'right': 'cf-button-right',
    'left': 'cf-button-left',
    'bottom-right': 'cf-button-bottom-right',
    'bottom-left': 'cf-button-bottom-left',
  };

  return (
    <button
      onClick={toggleFeedbackMode}
      className={`cf-floating-button ${positionClasses[position]} ${isFeedbackMode ? 'cf-button-active' : ''} ${className || ''}`}
      title={isFeedbackMode ? 'Exit feedback mode (ESC)' : 'Enter feedback mode'}
      aria-label={isFeedbackMode ? 'Exit feedback mode' : 'Give feedback'}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span className="cf-button-text">
        {isFeedbackMode ? 'Exit' : 'Feedback'}
      </span>
    </button>
  );
}
