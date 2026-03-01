'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { FeedbackDialog } from './FeedbackDialog';
import { FeedbackHoverHandler } from './FeedbackHoverHandler';
import { useUrlParamActivation } from '../lib/useUrlParamActivation';

export interface FeedbackContextType {
  isOpen: boolean;
  isFeedbackMode: boolean;
  isActivated: boolean;
  mode: 'targeted' | 'simple';
  collectEmail: 'never' | 'optional' | 'required';
  defaultEmail?: string;
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
    userEmail?: string;
  }) => Promise<void>;
  /** Custom dialog component */
  DialogComponent?: React.ComponentType;
  /** URL parameter name that activates feedback. When set, feedback UI only
   *  appears if ?{urlParam}=true is in the URL (persisted to sessionStorage). */
  urlParam?: string;
  /** 'targeted' shows hover-to-select sections; 'simple' opens dialog directly. Default: 'targeted' */
  mode?: 'targeted' | 'simple';
  /** Whether to collect email from users. Default: 'never' */
  collectEmail?: 'never' | 'optional' | 'required';
  /** Pre-fill email field (e.g. from auth context) */
  defaultEmail?: string;
}

export function FeedbackProvider({
  children,
  apiEndpoint = '/api/feedback',
  onSubmit,
  DialogComponent,
  urlParam,
  mode = 'targeted',
  collectEmail = 'never',
  defaultEmail,
}: FeedbackProviderProps) {
  const isActivated = useUrlParamActivation(urlParam);
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
        isActivated,
        mode,
        collectEmail,
        defaultEmail,
        openDialog,
        openFeedbackDialog,
        closeDialog,
        toggleFeedbackMode,
        context,
        elementId
      }}
    >
      {children}
      {isActivated && <Dialog />}
      {isActivated && mode === 'targeted' && <FeedbackHoverHandler />}
    </FeedbackContext.Provider>
  );
}

// Re-export context for advanced use cases
export { FeedbackContext };
