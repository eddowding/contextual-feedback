// Components
export { FeedbackProvider, useFeedback } from './components/FeedbackProvider';
export type { FeedbackProviderProps, FeedbackContextType } from './components/FeedbackProvider';

export { FeedbackDialog } from './components/FeedbackDialog';
export type { FeedbackDialogProps } from './components/FeedbackDialog';

export { FeedbackHoverHandler } from './components/FeedbackHoverHandler';

export { FeedbackButton } from './components/FeedbackButton';
export type { FeedbackButtonProps } from './components/FeedbackButton';

export { FeedbackList } from './components/FeedbackList';
export type { FeedbackListProps } from './components/FeedbackList';

// Types
export type {
  Feedback,
  FeedbackStatus,
  FeedbackInput,
  FeedbackUpdate,
  FeedbackAdapter,
} from './lib/types';

// Utilities
export { detectFeedbackContext, getPageContexts } from './lib/utils';

// API Handlers
export { createApiHandlers } from './api/handlers';
export type { ApiConfig } from './api/handlers';

// Adapters
export { createPostgresAdapter, POSTGRES_SCHEMA } from './lib/adapters/postgres';
export { createSupabaseAdapter, SUPABASE_SCHEMA } from './lib/adapters/supabase';
export { createMemoryAdapter } from './lib/adapters/memory';
