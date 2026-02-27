# contextual-feedback

Section-targeted feedback with an AI resolution loop.

Users click exactly what they're giving feedback about. An AI agent triages, fixes, and resolves — closing the loop automatically.

## The AI Loop

```
User submits feedback → TRIAGE endpoint → AI agent reads →
Agent fixes code/config → RESOLVE endpoint → Done
```

1. **User clicks a section** and submits feedback with context attached
2. **TRIAGE** returns pending items in an AI-optimized format
3. **Your AI agent** reads the triage, takes action (deploys a fix, replies, etc.)
4. **RESOLVE** bulk-updates items with status + notes

This turns feedback from a backlog into a self-healing system.

## Section Targeting

Add `data-feedback-context` to any element:

```tsx
<section data-feedback-context="Pricing Table" data-feedback-id="pricing">
  {/* Users see this highlighted in feedback mode */}
</section>
```

When users enter feedback mode, sections glow blue. Click one, and the context is auto-attached.

## Quick Start (Supabase)

```bash
npm install contextual-feedback
```

### 1. Run the setup SQL

Copy from your code or import it:

```ts
import { SUPABASE_SETUP_SQL } from 'contextual-feedback/setup';
console.log(SUPABASE_SETUP_SQL);
// Run this in your Supabase dashboard SQL editor
```

### 2. Wrap your app

```tsx
import { FeedbackProvider, FeedbackButton } from 'contextual-feedback';
import 'contextual-feedback/styles.css';

export default function Layout({ children }) {
  return (
    <FeedbackProvider>
      {children}
      <FeedbackButton />
    </FeedbackProvider>
  );
}
```

### 3. Create the API route

```ts
// app/api/feedback/route.ts
import { createApiHandlers } from 'contextual-feedback/api';
import { createSupabaseAdapter } from 'contextual-feedback/adapters/supabase';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const adapter = createSupabaseAdapter({ client: supabase });

const { GET, POST, PATCH, COUNT, TRIAGE, RESOLVE } = createApiHandlers({
  adapter,
  getUserEmail: async (request) => request.headers.get('x-user-email'),
});

export { GET, POST };
```

Done. Users can now click the feedback button, highlight sections, and submit.

## Quick Start (Postgres)

```ts
import { createPostgresAdapter, POSTGRES_SCHEMA } from 'contextual-feedback/adapters/postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Run POSTGRES_SCHEMA in your database first, then:
const adapter = createPostgresAdapter({ pool });
```

## Authorization

Admin endpoints (PATCH, TRIAGE, RESOLVE) can be gated with an `authorize` callback:

```ts
const handlers = createApiHandlers({
  adapter,
  authorize: async (request) => {
    const session = await getServerSession(request);
    return session?.user?.role === 'admin';
  },
});
```

GET, POST, and COUNT remain open. If `authorize` is not provided, all endpoints are unrestricted.

## AI Agent Integration

### Triage

```ts
const res = await fetch('/api/feedback/triage');
const { items, summary } = await res.json();
// items: [{ id, feedback, page, section, category, from, status, submittedAt }]
// summary: { pending, inReview, total }
```

### Format for AI

```ts
import { formatForAI } from 'contextual-feedback/ai';

const feedback = await adapter.getAll('Pending');
const markdown = formatForAI(feedback);
// Pass markdown to your AI agent as context
```

### Resolve

```ts
await fetch('/api/feedback/resolve', {
  method: 'POST',
  body: JSON.stringify({
    resolutions: [
      { id: 'abc-123', status: 'Done', adminNotes: 'Fixed in commit abc123' },
      { id: 'def-456', status: 'Rejected', adminNotes: 'Working as intended' },
    ],
  }),
});
```

## Categories

Feedback can be categorized: `bug`, `feature`, `praise`, `question`, `other`.

```ts
// Submit with category
await fetch('/api/feedback', {
  method: 'POST',
  body: JSON.stringify({
    feedbackText: 'Login button is broken',
    pageUrl: '/login',
    category: 'bug',
  }),
});
```

## Components

### `<FeedbackProvider>`

Wraps your app and provides feedback context.

```tsx
<FeedbackProvider apiEndpoint="/api/feedback">
  {children}
</FeedbackProvider>
```

### `<FeedbackButton>`

Floating button to enter/exit feedback mode.

```tsx
<FeedbackButton position="right" /> {/* 'right' | 'left' | 'bottom-right' | 'bottom-left' */}
```

### `<FeedbackList>`

Admin component to view and manage feedback.

```tsx
<FeedbackList
  apiEndpoint="/api/feedback"
  statusFilter="Pending"
  pageSize={20}
  showCopyButtons={true}
  dateLocale="en-US"
/>
```

### `useFeedback()` Hook

```tsx
const { isFeedbackMode, toggleFeedbackMode, openDialog, closeDialog } = useFeedback();
```

## Database Adapters

| Adapter | Import | Use case |
|---------|--------|----------|
| Supabase | `contextual-feedback/adapters/supabase` | Production with Supabase |
| PostgreSQL | `contextual-feedback/adapters/postgres` | Any Postgres database |
| Memory | `contextual-feedback/adapters/memory` | Development and testing |

Or implement the `FeedbackAdapter` interface for custom storage.

## Schema Reference

| Column | Type | Default | Constraint |
|--------|------|---------|------------|
| id | UUID | gen_random_uuid() | PRIMARY KEY |
| user_email | VARCHAR(255) | — | NOT NULL |
| page_url | VARCHAR(2000) | — | NOT NULL |
| feedback_text | TEXT | — | NOT NULL |
| status | VARCHAR(50) | 'Pending' | CHECK: Pending, In Review, Done, Rejected |
| category | VARCHAR(50) | NULL | CHECK: bug, feature, praise, question, other |
| context | VARCHAR(255) | NULL | Section name |
| element_id | VARCHAR(255) | NULL | DOM element ID |
| admin_notes | TEXT | NULL | — |
| resolved_at | TIMESTAMPTZ | NULL | Auto-set on Done/Rejected |
| created_at | TIMESTAMPTZ | NOW() | — |
| updated_at | TIMESTAMPTZ | NOW() | Auto-updated via trigger |

### Row Level Security (Supabase)

```ts
import { SUPABASE_RLS_SQL } from 'contextual-feedback/setup';
// Run in SQL editor to enable RLS with admin/user policies
```

Requires a `user_profiles` table with `id` (matches auth.uid()) and `role` columns.

## Styling

```tsx
import 'contextual-feedback/styles.css';
```

All classes prefixed with `cf-`. Override or copy to customize.

## License

MIT
