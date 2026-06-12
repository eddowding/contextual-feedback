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

// Hooks
export { useUrlParamActivation } from './lib/useUrlParamActivation';

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

// Validation + runtime constants (single source of truth for the
// FeedbackStatus/FeedbackCategory unions) + adapter helpers
export { validateFeedbackInput, computeResolvedAt, VALID_STATUSES, VALID_CATEGORIES } from './lib/types';

// Utilities
export { detectFeedbackContext, getPageContexts } from './lib/utils';

// Server-only types (types are erased at build time, so they are safe to
// re-export from this client-marked entry). The runtime values live ONLY on
// the dedicated server subpaths so they never get bundled with a 'use client'
// banner:
//   createApiHandlers            → 'contextual-feedback/api'
//   formatForAI, toTriageItem    → 'contextual-feedback/ai'
//   createPostgresAdapter, POSTGRES_SCHEMA → 'contextual-feedback/adapters/postgres'
//   createSupabaseAdapter, SUPABASE_SCHEMA → 'contextual-feedback/adapters/supabase'
//   createMemoryAdapter          → 'contextual-feedback/adapters/memory'
//   SUPABASE_SETUP_SQL, SUPABASE_RLS_SQL   → 'contextual-feedback/setup'
export type { ApiConfig } from './api/handlers';
export type { TriageItem } from './lib/ai';
