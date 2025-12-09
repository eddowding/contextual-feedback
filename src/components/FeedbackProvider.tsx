'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { FeedbackDialog } from './FeedbackDialog';
import { FeedbackHoverHandler } from './FeedbackHoverHandler';

export interface FeedbackContextType {
  isOpen: boolean;
  isFeedbackMode: boolean;
  openDialog: (context?: string, elementId?: string) => void;
  openFeedbackDialog: () => void;
  closeDialog: () => void;
  toggleFeedbackMode: () => void;
  context?: string;
  elementId?: string;
}

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within FeedbackProvider');
  }
  return context;
}

export interface FeedbackProviderProps {
  children: ReactNode;
  /** API endpoint for submitting feedback. Defaults to '/api/feedback' */
  apiEndpoint?: string;
  /** Custom callback when feedback is submitted */
  onSubmit?: (feedback: {
    feedbackText: string;
    pageUrl: string;
    context?: string;
    elementId?: string;
  }) => Promise<void>;
  /** Custom dialog component */
  DialogComponent?: React.ComponentType;
}

export function FeedbackProvider({
  children,
  apiEndpoint = '/api/feedback',
  onSubmit,
  DialogComponent
}: FeedbackProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFeedbackMode, setIsFeedbackMode] = useState(false);
  const [context, setContext] = useState<string | undefined>(undefined);
  const [elementId, setElementId] = useState<string | undefined>(undefined);

  const openDialog = useCallback((initialContext?: string, initialElementId?: string) => {
    setContext(initialContext);
    setElementId(initialElementId);
    setIsOpen(true);
    setIsFeedbackMode(false);
  }, []);

  const openFeedbackDialog = useCallback(() => {
    openDialog();
  }, [openDialog]);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setContext(undefined);
    setElementId(undefined);
  }, []);

  const toggleFeedbackMode = useCallback(() => {
    setIsFeedbackMode(prev => !prev);
  }, []);

  const Dialog = DialogComponent || FeedbackDialog;

  return (
    <FeedbackContext.Provider
      value={{
        isOpen,
        isFeedbackMode,
        openDialog,
        openFeedbackDialog,
        closeDialog,
        toggleFeedbackMode,
        context,
        elementId
      }}
    >
      {children}
      <Dialog />
      <FeedbackHoverHandler />
    </FeedbackContext.Provider>
  );
}

// Re-export context for advanced use cases
export { FeedbackContext };
