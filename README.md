# contextual-feedback

Section-targeted feedback system for React applications. Let users click exactly what they're giving feedback about.

![Demo](https://raw.githubusercontent.com/eddowding/contextual-feedback/main/demo.gif)

## Why?

Most feedback tools are just a form. Users say "something's broken" and you have no idea what they're looking at.

This library lets users:
1. Enter **feedback mode** (click a button)
2. See all feedbackable sections **highlighted with blue outlines**
3. **Click the exact section** they want to give feedback about
4. Submit feedback **with context automatically attached**

Admins see feedback with the exact section name and page URL - no guessing.

## Installation

```bash
npm install contextual-feedback
# or
yarn add contextual-feedback
# or
pnpm add contextual-feedback
```

## Quick Start

### 1. Wrap your app

```tsx
// app/layout.tsx (Next.js) or App.tsx
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

### 2. Mark sections

Add `data-feedback-context` to any element you want users to be able to give feedback on:

```tsx
<section data-feedback-context="Pricing Table" data-feedback-id="pricing">
  {/* Your pricing content */}
</section>

<div data-feedback-context="User Profile Card" data-feedback-id="profile-card">
  {/* Your profile content */}
</div>
```

### 3. Set up the API (Next.js App Router)

```tsx
// app/api/feedback/route.ts
import { createApiHandlers } from 'contextual-feedback/api';
import { createPostgresAdapter } from 'contextual-feedback/adapters/postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPostgresAdapter({ pool });

const { GET, POST } = createApiHandlers({
  adapter,
  getUserEmail: async (request) => {
    // Return current user's email, or null for anonymous
    return request.headers.get('x-user-email');
  }
});

export { GET, POST };
```

### 4. Create the database table

```sql
CREATE TABLE feedback (
  id VARCHAR(100) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  page_url VARCHAR(1000) NOT NULL,
  feedback_text TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending',
  context VARCHAR(255),
  element_id VARCHAR(255),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_created_at ON feedback(created_at DESC);
```

Done! Users can now click the feedback button, see highlighted sections, and submit targeted feedback.

### 5. Add an admin page (optional)

```tsx
// app/admin/feedback/page.tsx
import { FeedbackList } from 'contextual-feedback';

export default async function AdminFeedbackPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Feedback</h1>
      <FeedbackList />
    </div>
  );
}
```

## Database Adapters

### PostgreSQL

```ts
import { createPostgresAdapter } from 'contextual-feedback/adapters/postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPostgresAdapter({ pool });
```

### Supabase

```ts
import { createSupabaseAdapter } from 'contextual-feedback/adapters/supabase';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
const adapter = createSupabaseAdapter({ client: supabase });
```

### In-Memory (Development)

```ts
import { createMemoryAdapter } from 'contextual-feedback/adapters/memory';

const adapter = createMemoryAdapter();
```

### Custom Adapter

Implement the `FeedbackAdapter` interface:

```ts
interface FeedbackAdapter {
  getAll(status?: FeedbackStatus): Promise<Feedback[]>;
  getById(id: string): Promise<Feedback | null>;
  add(input: FeedbackInput): Promise<Feedback>;
  update(id: string, updates: FeedbackUpdate): Promise<Feedback | null>;
  delete?(id: string): Promise<boolean>;
  getCount?(status?: FeedbackStatus): Promise<number>;
}
```

## Components

### `<FeedbackList>`

Admin component to view and manage feedback.

```tsx
<FeedbackList
  apiEndpoint="/api/feedback"     // Default
  statusFilter="Pending"          // Optional: filter by status
  showCopyButtons={true}          // Show copy-to-clipboard buttons
  dateLocale="en-US"              // Date formatting locale
/>
```

**Features:**
- Expandable rows showing full feedback text
- Inline status dropdown (updates via API)
- Copy feedback as JSON
- Context shown as blue badge
- Loading and error states

### `<FeedbackProvider>`

Wraps your app and provides feedback context.

```tsx
<FeedbackProvider
  apiEndpoint="/api/feedback"  // Default
  onSubmit={async (feedback) => { /* custom handler */ }}
>
  {children}
</FeedbackProvider>
```

### `<FeedbackButton>`

Floating button to enter/exit feedback mode.

```tsx
<FeedbackButton
  position="right"  // 'right' | 'left' | 'bottom-right' | 'bottom-left'
  className="my-custom-class"
/>
```

### `useFeedback()` Hook

Access feedback state programmatically:

```tsx
const {
  isFeedbackMode,      // boolean - is feedback mode active?
  toggleFeedbackMode,  // () => void - toggle feedback mode
  openDialog,          // (context?, elementId?) => void - open dialog
  closeDialog,         // () => void - close dialog
} = useFeedback();
```

## API Endpoints

The `createApiHandlers` function returns handlers for:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/feedback` | List all feedback (optional `?status=Pending`) |
| POST | `/api/feedback` | Submit new feedback |
| PATCH | `/api/feedback/[id]` | Update status/notes |
| GET | `/api/feedback/count` | Get count (optional `?status=Pending`) |

## Feedback Object

```ts
interface Feedback {
  id: string;
  userEmail: string;
  pageUrl: string;
  feedbackText: string;
  status: 'Pending' | 'In Review' | 'Done' | 'Rejected';
  context?: string;      // e.g., "Pricing Table"
  elementId?: string;    // e.g., "pricing"
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}
```

## Styling

Import the default styles:

```tsx
import 'contextual-feedback/styles.css';
```

Or copy and customize. All classes are prefixed with `cf-`:

- `.cf-section-active` - Highlighted section in feedback mode
- `.cf-central-button` - "General Feedback" button
- `.cf-floating-button` - The feedback toggle button
- `.cf-dialog` - The feedback dialog
- `.cf-dialog-overlay` - Dialog backdrop

## Section Naming Tips

Use clear, consistent names:

```tsx
// Good
data-feedback-context="User Profile Card"
data-feedback-context="Pricing Table"
data-feedback-context="Navigation Menu"

// Bad
data-feedback-context="div1"
data-feedback-context="section"
```

Nest contexts for granularity:

```tsx
<section data-feedback-context="Dashboard" data-feedback-id="dashboard">
  <div data-feedback-context="Revenue Chart" data-feedback-id="revenue-chart">
    {/* Inner context takes precedence when clicked */}
  </div>
</section>
```

## License

MIT
