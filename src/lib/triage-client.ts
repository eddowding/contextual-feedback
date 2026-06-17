import { Feedback, FeedbackCategory, FeedbackStatus } from './types';
import { TriageItem } from './ai';

/**
 * Response body of `GET /api/feedback/triage` (handlers.ts → TRIAGE).
 * Mirrors the handler's JSON shape exactly.
 */
export interface TriageResponse {
  items: TriageItem[];
  summary: {
    pending: number;
    inReview: number;
    total: number;
  };
}

/**
 * A single resolution sent to `POST /api/feedback/resolve` (handlers.ts → RESOLVE).
 * Absent fields are treated as no-change by the endpoint, so only set what you
 * want to write.
 */
export interface Resolution {
  id: string;
  status?: FeedbackStatus;
  adminNotes?: string;
  category?: FeedbackCategory;
}

/**
 * Response body of `POST /api/feedback/resolve` (handlers.ts → RESOLVE).
 *
 * - `updated`  — items whose update succeeded.
 * - `notFound` — ids that matched no row (deleted, or silently RLS-filtered).
 *   Usually safe to drop — but if the token lacks UPDATE rights on an
 *   RLS-protected table, every id lands here, so confirm access before treating
 *   `notFound` as permanently gone.
 * - `failed`   — ids whose update errored (db outage, RLS misconfig). Retry.
 *
 * The endpoint returns this body on **200** (full/partial success) and on
 * **500** (nothing updated + at least one error) — so the client surfaces the
 * body on both rather than throwing, letting the caller read `failed`.
 */
export interface ResolveResponse {
  updated: Feedback[];
  notFound: string[];
  failed: string[];
}

/**
 * Thrown on an unexpected HTTP status (anything that is neither a parseable
 * 200 nor a parseable 500-with-body) or an unparseable body. Carries the
 * `status` and raw `body` for diagnostics.
 */
export class TriageHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TriageHttpError';
    this.status = status;
    this.body = body;
  }
}

/** Minimal fetch signature so the client is runtime-agnostic (Node 18+, edge, workers). */
export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export interface TriageClientOptions {
  /** Base URL of the feedback API, e.g. https://app.example.com/api/feedback */
  baseUrl: string;
  /** Bearer token the host app's `config.authorize` accepts. */
  token: string;
  /** Injectable fetch (default `globalThis.fetch`). */
  fetch?: FetchLike;
}

export interface TriageClient {
  getTriage(): Promise<TriageResponse>;
  resolve(resolutions: Resolution[]): Promise<ResolveResponse>;
}

/** Drop a single trailing slash so `${baseUrl}/triage` never doubles up. */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function parseJson(body: string, status: number): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new TriageHttpError(`Unparseable JSON body (status ${status})`, status, body);
  }
}

/**
 * A dependency-free typed client for the library's TRIAGE / RESOLVE endpoints.
 *
 * @example
 * ```ts
 * import { createTriageClient } from 'contextual-feedback/ai';
 *
 * const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token });
 * const { items } = await client.getTriage();
 * const result = await client.resolve([{ id: items[0].id, status: 'Done' }]);
 * ```
 */
export function createTriageClient(options: TriageClientOptions): TriageClient {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const doFetch: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (!doFetch) {
    throw new Error('No fetch implementation available; pass one via options.fetch');
  }

  return {
    async getTriage(): Promise<TriageResponse> {
      const res = await doFetch(`${baseUrl}/triage`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/json',
        },
      });
      const body = await res.text();
      if (res.status !== 200) {
        throw new TriageHttpError(`TRIAGE failed with status ${res.status}`, res.status, body);
      }
      return parseJson(body, res.status) as TriageResponse;
    },

    async resolve(resolutions: Resolution[]): Promise<ResolveResponse> {
      const res = await doFetch(`${baseUrl}/resolve`, {
        method: 'POST',
        headers: {
          // Content-Type is required — handlers reject non-JSON with 415.
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ resolutions }),
      });
      const body = await res.text();
      // The endpoint returns the {updated, notFound, failed} body on 200 AND
      // 500 — surface both so the caller can read `failed`. Any other status
      // (401, 415, 400, …) is an error the caller cannot act on item-by-item.
      if (res.status === 200 || res.status === 500) {
        return parseJson(body, res.status) as ResolveResponse;
      }
      throw new TriageHttpError(`RESOLVE failed with status ${res.status}`, res.status, body);
    },
  };
}
