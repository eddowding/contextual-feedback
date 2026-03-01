'use client';

import { useFeedback } from './FeedbackProvider';

export interface FeedbackButtonProps {
  /** Position on screen */
  position?: 'right' | 'left' | 'bottom-right' | 'bottom-left';
  /** Custom class name */
  className?: string;
}

/**
 * Floating button to toggle feedback mode (targeted) or open dialog directly (simple)
 */
export function FeedbackButton({ position = 'right', className }: FeedbackButtonProps) {
  const { isFeedbackMode, toggleFeedbackMode, isActivated, mode, openDialog } = useFeedback();

  if (!isActivated) return null;

  const handleClick = () => {
    if (mode === 'simple') {
      openDialog('General Page');
    } else {
      toggleFeedbackMode();
    }
  };

  const isActive = mode === 'targeted' && isFeedbackMode;

  const positionClasses: Record<string, string> = {
    'right': 'cf-button-right',
    'left': 'cf-button-left',
    'bottom-right': 'cf-button-bottom-right',
    'bottom-left': 'cf-button-bottom-left',
  };

  return (
    <button
      onClick={handleClick}
      className={`cf-floating-button ${positionClasses[position]} ${isActive ? 'cf-button-active' : ''} ${className || ''}`}
      title={isActive ? 'Exit feedback mode (ESC)' : 'Give feedback'}
      aria-label={isActive ? 'Exit feedback mode' : 'Give feedback'}
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
        {isActive ? 'Exit' : 'Feedback'}
      </span>
    </button>
  );
}
