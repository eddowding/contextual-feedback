// Components
export { FeedbackProvider, useFeedback } from './components/FeedbackProvider';
export type { FeedbackProviderProps, FeedbackContextType } from './components/FeedbackProvider';

export { FeedbackDialog } from './components/FeedbackDialog';
export type { FeedbackDialogProps } from './components/FeedbackDialog';

export { FeedbackHoverHandler } from './components/FeedbackHoverHandler';

export { FeedbackButton } from './components/FeedbackButton';
export type { FeedbackButtonProps } from './components/FeedbackButton';

export { FeedbackList } from './components/FeedbackList';
export type { FeedbackListProps, ExportFormat } from './components/FeedbackList';

// Types
export type {
  Feedback,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackInput,
  FeedbackUpdate,
  FeedbackAdapter,
  ValidationError,
} from './lib/types';

// Validation
export { validateFeedbackInput } from './lib/types';

// Utilities
export { detectFeedbackContext, getPageContexts } from './lib/utils';

// API Handlers
export { createApiHandlers } from './api/handlers';
export type { ApiConfig } from './api/handlers';

// AI Utilities
export { formatForAI } from './lib/ai';

// Adapters
export { createPostgresAdapter, POSTGRES_SCHEMA } from './lib/adapters/postgres';
export { createSupabaseAdapter, SUPABASE_SCHEMA } from './lib/adapters/supabase';
export { createMemoryAdapter } from './lib/adapters/memory';

// Setup SQL
export { SUPABASE_SETUP_SQL, SUPABASE_RLS_SQL } from './setup/supabase';
