import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApiHandlers } from '../handlers';
import { createMemoryAdapter } from '../../lib/adapters/memory';
import { FeedbackAdapter } from '../../lib/types';

function makeRequest(url: string, options: RequestInit = {}): Request {
  return new Request(url, options);
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('createApiHandlers', () => {
  let adapter: FeedbackAdapter;
  let handlers: ReturnType<typeof createApiHandlers>;

  beforeEach(() => {
    adapter = createMemoryAdapter();
    handlers = createApiHandlers({
      adapter,
      getUserEmail: async () => 'anonymous@test.local',
    });
  });

  describe('GET', () => {
    it('returns empty array initially', async () => {
      const res = await handlers.GET(makeRequest('http://localhost/api/feedback'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('returns feedback items', async () => {
      await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.GET(makeRequest('http://localhost/api/feedback'));
      const data = await res.json();
      expect(data).toHaveLength(1);
    });

    it('filters by status query param', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });
      await adapter.update(fb.id, { status: 'Done' });

      const res = await handlers.GET(makeRequest('http://localhost/api/feedback?status=Done'));
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].status).toBe('Done');
    });
  });

  describe('POST', () => {
    it('creates feedback and returns 201', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug found',
          pageUrl: 'https://example.com/page',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.feedbackText).toBe('Bug found');
      expect(data.status).toBe('Pending');
      expect(data.userEmail).toBe('anonymous@test.local');
    });

    it('uses getUserEmail callback', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'ed@test.com',
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Nice',
          pageUrl: '/page',
        })
      );

      const data = await res.json();
      expect(data.userEmail).toBe('ed@test.com');
    });

    it('returns 400 for missing feedbackText', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          pageUrl: '/page',
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing pageUrl', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty feedbackText', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: '   ',
          pageUrl: '/page',
        })
      );
      expect(res.status).toBe(400);
    });

    it('includes context and elementId', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          context: 'Pricing Table',
          elementId: 'pricing',
        })
      );

      const data = await res.json();
      expect(data.context).toBe('Pricing Table');
      expect(data.elementId).toBe('pricing');
    });

    it('returns 400 for context exceeding 255 chars (schema VARCHAR(255))', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          context: 'c'.repeat(256),
        })
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('255');
    });

    it('returns 400 for elementId exceeding 255 chars', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          elementId: 'e'.repeat(256),
        })
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('255');
    });

    it('accepts context and elementId at exactly 255 chars', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          context: 'c'.repeat(255),
          elementId: 'e'.repeat(255),
        })
      );

      expect(res.status).toBe(201);
    });

    it('accepts category', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Found a bug',
          pageUrl: '/page',
          category: 'bug',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.category).toBe('bug');
    });

    it('rejects invalid category', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          category: 'invalid',
        })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH', () => {
    it('updates status', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 'Done' }),
        fb.id
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('Done');
    });

    it('updates adminNotes', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { adminNotes: 'Noted' }),
        fb.id
      );

      const data = await res.json();
      expect(data.adminNotes).toBe('Noted');
    });

    it('updates category', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { category: 'feature' }),
        fb.id
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.category).toBe('feature');
    });

    it('sets resolvedAt when status becomes Done', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 'Done' }),
        fb.id
      );

      const data = await res.json();
      expect(data.resolvedAt).toBeTruthy();
    });

    it('returns 400 when no fields provided', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, {}),
        fb.id
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status', async () => {
      const fb = await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: '/p',
        feedbackText: 'Test',
      });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 'Invalid' }),
        fb.id
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent feedback', async () => {
      const res = await handlers.PATCH(
        jsonRequest('http://localhost/api/feedback/nonexistent', { status: 'Done' }),
        'nonexistent'
      );
      expect(res.status).toBe(404);
    });
  });

  describe('COUNT', () => {
    it('returns total count', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      const res = await handlers.COUNT(makeRequest('http://localhost/api/feedback/count'));
      const data = await res.json();
      expect(data.count).toBe(2);
    });

    it('filters by status', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });
      await adapter.update(fb.id, { status: 'Done' });

      const res = await handlers.COUNT(
        makeRequest('http://localhost/api/feedback/count?status=Pending')
      );
      const data = await res.json();
      expect(data.count).toBe(1);
    });
  });

  describe('TRIAGE', () => {
    it('returns pending and in-review items', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: 'https://example.com/page', feedbackText: 'Bug' });
      const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: 'https://example.com/other', feedbackText: 'Feature' });
      await adapter.update(fb2.id, { status: 'In Review' });

      const fb3 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Done item' });
      await adapter.update(fb3.id, { status: 'Done' });

      const res = await handlers.TRIAGE(makeRequest('http://localhost/api/feedback/triage'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.items).toHaveLength(2);
      expect(data.summary.pending).toBe(1);
      expect(data.summary.inReview).toBe(1);
      expect(data.summary.total).toBe(2);
    });

    it('extracts URL pathname', async () => {
      await adapter.add({
        userEmail: 'u@t.com',
        pageUrl: 'https://example.com/dashboard?tab=1',
        feedbackText: 'Bug',
      });

      const res = await handlers.TRIAGE(makeRequest('http://localhost/api/feedback/triage'));
      const data = await res.json();
      expect(data.items[0].page).toBe('/dashboard');
    });
  });

  describe('RESOLVE', () => {
    it('bulk updates feedback items', async () => {
      const fb1 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb1.id, status: 'Done', adminNotes: 'Fixed in v1.2' },
            { id: fb2.id, status: 'Rejected', adminNotes: 'Won\'t fix' },
          ],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(2);
      expect(data.updated[0].status).toBe('Done');
      expect(data.updated[1].status).toBe('Rejected');
    });

    it('returns 400 for empty resolutions', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', { resolutions: [] })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing resolutions', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {})
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for resolution with missing id', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ status: 'Done' }],
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status in resolution', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'fb_1', status: 'BadStatus' }],
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 500) for a null entry in resolutions', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [null],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Each resolution must be an object');
    });

    it('returns 400 for a string entry in resolutions', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: ['fb_1'],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Each resolution must be an object');
    });

    it('returns 400 for an array entry in resolutions', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [[{ id: 'fb_1', status: 'Done' }]],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Each resolution must be an object');
    });
  });

  describe('authorize callback', () => {
    let authedHandlers: ReturnType<typeof createApiHandlers>;

    beforeEach(() => {
      authedHandlers = createApiHandlers({
        adapter,
        getUserEmail: async () => 'user@test.com',
        authorize: async (req) => req.headers.get('x-admin-token') === 'secret',
      });
    });

    it('PATCH returns 401 when authorize rejects', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });
      const res = await authedHandlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 'Done' }),
        fb.id
      );
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('PATCH succeeds when authorize allows', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });
      const req = new Request(`http://localhost/api/feedback/${fb.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': 'secret',
        },
        body: JSON.stringify({ status: 'Done' }),
      });
      const res = await authedHandlers.PATCH(req, fb.id);
      expect(res.status).toBe(200);
    });

    it('TRIAGE returns 401 when unauthorized', async () => {
      const res = await authedHandlers.TRIAGE(
        makeRequest('http://localhost/api/feedback/triage')
      );
      expect(res.status).toBe(401);
    });

    it('RESOLVE returns 401 when unauthorized', async () => {
      const res = await authedHandlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'fb_1', status: 'Done' }],
        })
      );
      expect(res.status).toBe(401);
    });

    it('GET returns 401 when unauthorized', async () => {
      const res = await authedHandlers.GET(makeRequest('http://localhost/api/feedback'));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('COUNT returns 401 when unauthorized', async () => {
      const res = await authedHandlers.COUNT(
        makeRequest('http://localhost/api/feedback/count')
      );
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('GET succeeds when authorize allows', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });
      const req = new Request('http://localhost/api/feedback', {
        headers: { 'x-admin-token': 'secret' },
      });
      const res = await authedHandlers.GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
    });

    it('COUNT succeeds when authorize allows', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });
      const req = new Request('http://localhost/api/feedback/count', {
        headers: { 'x-admin-token': 'secret' },
      });
      const res = await authedHandlers.COUNT(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(1);
    });

    it('POST (public submission) remains open without auth', async () => {
      const postRes = await authedHandlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );
      expect(postRes.status).toBe(201);
    });
  });

  describe('POST with client-provided userEmail', () => {
    it('server getUserEmail OVERRIDES body userEmail by default (trustClientEmail=false)', async () => {
      // Default handlers use getUserEmail: () => 'anonymous@test.local'.
      // A spoofed client email in the body must NOT win.
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: 'client@example.com',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('anonymous@test.local');
    });

    it('falls back to body email when server getUserEmail returns null', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => null,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: 'client@example.com',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('client@example.com');
    });

    it('uses getUserEmail when body userEmail is absent', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
        })
      );

      const data = await res.json();
      expect(data.userEmail).toBe('anonymous@test.local');
    });
  });

  describe('anonymous submissions', () => {
    it('accepts feedback with no email source when getUserEmail is not configured', async () => {
      const h = createApiHandlers({ adapter });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Anonymous bug report',
          pageUrl: '/page',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('anonymous');
    });

    it('accepts feedback when getUserEmail returns null and no body email', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => null,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Anonymous bug report',
          pageUrl: '/page',
          category: 'bug',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('anonymous');
      expect(data.category).toBe('bug');
    });

    it('still rejects an invalid (non-anonymous) email', async () => {
      const h = createApiHandlers({ adapter });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: 'not-an-email',
        })
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid email format');
    });

    it('rejects a client that supplies the literal "anonymous" sentinel as its email', async () => {
      // A client must not be able to masquerade as genuine-anonymous by sending
      // userEmail: "anonymous" — that is a sourced value, so it is validated as
      // an email and fails the format check rather than being stored silently.
      const h = createApiHandlers({ adapter });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: 'anonymous',
        })
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid email format');
    });
  });

  describe('trustClientEmail option', () => {
    it('prefers body userEmail when trustClientEmail=true (legacy behaviour)', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'server@test.local',
        trustClientEmail: true,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: 'client@example.com',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('client@example.com');
    });

    it('trims whitespace from body email when trustClientEmail=true', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => null,
        trustClientEmail: true,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
          userEmail: '  user@example.com  ',
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('user@example.com');
    });

    it('falls back to server email when trustClientEmail=true but no body email', async () => {
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'server@test.local',
        trustClientEmail: true,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
        })
      );

      const data = await res.json();
      expect(data.userEmail).toBe('server@test.local');
    });
  });

  describe('onSubmit hook', () => {
    it('calls onSubmit after successful POST', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onSubmit,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );

      expect(res.status).toBe(201);
      // Allow microtask to flush fire-and-forget
      await new Promise(r => setTimeout(r, 0));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][0].feedbackText).toBe('Test');
    });

    it('does not affect response when onSubmit throws', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('hook failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onSubmit,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );

      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 0));
      expect(onSubmit).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });

    it('does not affect response when onSubmit throws SYNCHRONOUSLY', async () => {
      // Easy in untyped JS: a plain function that throws before returning a
      // promise. The insert has already been persisted, so a 500 here would
      // make the widget show an error and the user resubmit a duplicate.
      const onSubmit = vi.fn(() => {
        throw new Error('sync hook failure');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onSubmit,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );

      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 0));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not affect response when onSubmit returns a non-promise', async () => {
      // A plain (non-async) JS hook returning undefined must not produce a
      // TypeError from calling .catch on undefined.
      const onSubmit = vi.fn(() => undefined);

      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        // Untyped-JS consumers can pass a plain function — simulate that.
        onSubmit: onSubmit as unknown as () => Promise<void>,
      });

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );

      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 0));
      expect(onSubmit).toHaveBeenCalledOnce();
    });
  });

  describe('onResolve hook', () => {
    it('calls onResolve for each resolved item', async () => {
      const onResolve = vi.fn().mockResolvedValue(undefined);
      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onResolve,
      });

      const fb1 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb1.id, status: 'Done', adminNotes: 'Fixed' },
            { id: fb2.id, status: 'Rejected' },
          ],
        })
      );

      expect(res.status).toBe(200);
      await new Promise(r => setTimeout(r, 0));
      expect(onResolve).toHaveBeenCalledTimes(2);
      expect(onResolve.mock.calls[0][0].id).toBe(fb1.id);
      expect(onResolve.mock.calls[0][1].status).toBe('Done');
      expect(onResolve.mock.calls[1][0].id).toBe(fb2.id);
      expect(onResolve.mock.calls[1][1].status).toBe('Rejected');
    });

    it('does not affect response when onResolve throws', async () => {
      const onResolve = vi.fn().mockRejectedValue(new Error('hook failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onResolve,
      });

      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done' }],
        })
      );

      expect(res.status).toBe(200);
      await new Promise(r => setTimeout(r, 0));
      expect(onResolve).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });

    it('does not affect response when onResolve throws SYNCHRONOUSLY', async () => {
      const onResolve = vi.fn(() => {
        throw new Error('sync hook failure');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const h = createApiHandlers({
        adapter,
        getUserEmail: async () => 'u@t.com',
        onResolve,
      });

      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done' }],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      await new Promise(r => setTimeout(r, 0));
      expect(onResolve).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('minimal adapter fallbacks (no getCount, no bulkUpdate)', () => {
    function createMinimalAdapter(full: FeedbackAdapter): FeedbackAdapter {
      return {
        getAll: full.getAll,
        getById: full.getById,
        add: full.add,
        update: full.update,
      };
    }

    it('COUNT falls back to getAll().length when adapter.getCount is undefined', async () => {
      const minimal = createMinimalAdapter(adapter);
      const h = createApiHandlers({ adapter: minimal });

      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      const res = await h.COUNT(makeRequest('http://localhost/api/feedback/count'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(2);
    });

    it('COUNT fallback respects the status filter', async () => {
      const minimal = createMinimalAdapter(adapter);
      const h = createApiHandlers({ adapter: minimal });

      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });
      await adapter.update(fb.id, { status: 'Done' });

      const res = await h.COUNT(
        makeRequest('http://localhost/api/feedback/count?status=Done')
      );
      const data = await res.json();
      expect(data.count).toBe(1);
    });

    it('RESOLVE uses adapter.update per item when bulkUpdate is undefined', async () => {
      const minimal = createMinimalAdapter(adapter);
      const updateSpy = vi.fn(minimal.update);
      minimal.update = updateSpy;
      const h = createApiHandlers({ adapter: minimal });

      const fb1 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb1.id, status: 'Done', adminNotes: 'Fixed' },
            { id: fb2.id, status: 'Rejected' },
          ],
        })
      );

      expect(res.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenCalledWith(fb1.id, { status: 'Done', adminNotes: 'Fixed' });
      expect(updateSpy).toHaveBeenCalledWith(fb2.id, { status: 'Rejected', adminNotes: undefined, category: undefined });

      const data = await res.json();
      expect(data.updated).toHaveLength(2);
      expect(data.updated[0].status).toBe('Done');
      expect(data.updated[1].status).toBe('Rejected');
      expect(data.notFound).toEqual([]);
    });

    it('RESOLVE omits non-existent ids from updated on the fallback path', async () => {
      const minimal = createMinimalAdapter(adapter);
      const h = createApiHandlers({ adapter: minimal });

      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb.id, status: 'Done' },
            { id: 'does_not_exist', status: 'Done' },
          ],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.updated[0].id).toBe(fb.id);
      expect(data.notFound).toEqual(['does_not_exist']);
    });

    it('RESOLVE continues past a per-item update error and reports it in failed', async () => {
      const minimal = createMinimalAdapter(adapter);
      const realUpdate = minimal.update;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const fb1 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

      minimal.update = vi.fn(async (id, update) => {
        if (id === fb1.id) throw new Error('db hiccup');
        return realUpdate(id, update);
      });
      const h = createApiHandlers({ adapter: minimal });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb1.id, status: 'Done' },
            { id: fb2.id, status: 'Done' },
          ],
        })
      );

      // Partial success: fb_2 committed, so the response must report it as
      // updated (200), with the errored id in `failed` — NOT in `notFound`,
      // which is reserved for rows that no longer exist.
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.updated[0].id).toBe(fb2.id);
      expect(data.failed).toEqual([fb1.id]);
      expect(data.notFound).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('onResolve fires for items resolved via the update fallback path', async () => {
      const minimal = createMinimalAdapter(adapter);
      const onResolve = vi.fn().mockResolvedValue(undefined);
      const h = createApiHandlers({ adapter: minimal, onResolve });

      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb.id, status: 'Done', adminNotes: 'Shipped' },
            { id: 'missing', status: 'Done' },
          ],
        })
      );

      expect(res.status).toBe(200);
      await new Promise(r => setTimeout(r, 0));
      expect(onResolve).toHaveBeenCalledOnce();
      expect(onResolve.mock.calls[0][0].id).toBe(fb.id);
      expect(onResolve.mock.calls[0][1].status).toBe('Done');
      expect(onResolve.mock.calls[0][1].adminNotes).toBe('Shipped');
    });
  });

  describe('handler error paths (failing adapter)', () => {
    let failingHandlers: ReturnType<typeof createApiHandlers>;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const fail = () => Promise.reject(new Error('db down'));
      const failingAdapter: FeedbackAdapter = {
        getAll: fail,
        getById: fail,
        add: fail,
        update: fail,
      };
      failingHandlers = createApiHandlers({
        adapter: failingAdapter,
        getUserEmail: async () => 'u@t.com',
      });
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('GET returns 500 with JSON error body', async () => {
      const res = await failingHandlers.GET(makeRequest('http://localhost/api/feedback'));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Failed to fetch feedback' });
    });

    it('POST returns 500 with JSON error body', async () => {
      const res = await failingHandlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
        })
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Failed to submit feedback' });
    });

    it('PATCH returns 500 with JSON error body', async () => {
      const res = await failingHandlers.PATCH(
        jsonRequest('http://localhost/api/feedback/fb_1', { status: 'Done' }),
        'fb_1'
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Failed to update feedback' });
    });

    it('COUNT returns 500 with error and count 0', async () => {
      const res = await failingHandlers.COUNT(
        makeRequest('http://localhost/api/feedback/count')
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Failed to get count', count: 0 });
    });

    it('TRIAGE returns 500 with JSON error body', async () => {
      const res = await failingHandlers.TRIAGE(
        makeRequest('http://localhost/api/feedback/triage')
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Failed to fetch triage data' });
    });

    it('RESOLVE returns 500 with failed ids when every update errors (fallback path)', async () => {
      // A total failure (db down) must NOT look like an all-items-missing
      // success: an agent told the ids are notFound would drop them. The
      // errored ids are reported in `failed`, and since nothing succeeded the
      // status is 500 so the caller knows to retry the whole batch.
      const res = await failingHandlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'fb_1', status: 'Done' }],
        })
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ updated: [], notFound: [], failed: ['fb_1'] });
    });

    it('RESOLVE outer-catch (atomic adapter throws) still returns a ResolveResponse shape, not {error}', async () => {
      // An atomic bulkUpdate that throws (e.g. postgres ROLLBACK rethrow) hits
      // the handler's catch-all. It must keep the {updated, notFound, failed}
      // contract — every parsed id in `failed` — so a typed client can retry
      // instead of choking on a {error}-shaped body.
      const throwingAdapter: FeedbackAdapter = {
        getAll: () => Promise.reject(new Error('db down')),
        getById: () => Promise.reject(new Error('db down')),
        add: () => Promise.reject(new Error('db down')),
        update: () => Promise.reject(new Error('db down')),
        bulkUpdate: () => Promise.reject(new Error('transaction rolled back')),
      };
      const h = createApiHandlers({ adapter: throwingAdapter, getUserEmail: async () => 'u@t.com' });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'fb_1', status: 'Done' }, { id: 'fb_2', status: 'Rejected' }],
        })
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ updated: [], notFound: [], failed: ['fb_1', 'fb_2'] });
    });
  });

  describe('malformed request bodies', () => {
    function rawJsonRequest(url: string, raw: string): Request {
      return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });
    }

    it('POST returns 400 for invalid JSON', async () => {
      const res = await handlers.POST(rawJsonRequest('http://localhost/api/feedback', 'not json'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });

    it('PATCH returns 400 for invalid JSON', async () => {
      const res = await handlers.PATCH(
        rawJsonRequest('http://localhost/api/feedback/fb_1', 'not json'),
        'fb_1'
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });

    it('RESOLVE returns 400 for invalid JSON', async () => {
      const res = await handlers.RESOLVE(
        rawJsonRequest('http://localhost/api/feedback/resolve', 'not json')
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });

    it('POST returns 400 for empty body', async () => {
      const res = await handlers.POST(rawJsonRequest('http://localhost/api/feedback', ''));
      expect(res.status).toBe(400);
    });

    it('POST returns 400 for a JSON scalar body', async () => {
      const res = await handlers.POST(rawJsonRequest('http://localhost/api/feedback', 'null'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Request body must be a JSON object');
    });

    it('POST returns 400 for a JSON array body', async () => {
      const res = await handlers.POST(rawJsonRequest('http://localhost/api/feedback', '[]'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Request body must be a JSON object');
    });
  });

  describe('content type enforcement (CSRF defence)', () => {
    it('POST returns 415 for text/plain (cross-site form trick)', async () => {
      const res = await handlers.POST(
        new Request('http://localhost/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ feedbackText: 'Test', pageUrl: '/page' }),
        })
      );
      expect(res.status).toBe(415);
      const data = await res.json();
      expect(data.error).toBe('Content-Type must be application/json');
    });

    it('PATCH returns 415 for urlencoded content type', async () => {
      const res = await handlers.PATCH(
        new Request('http://localhost/api/feedback/fb_1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: JSON.stringify({ status: 'Done' }),
        }),
        'fb_1'
      );
      expect(res.status).toBe(415);
    });

    it('RESOLVE returns 415 for text/plain content type', async () => {
      const res = await handlers.RESOLVE(
        new Request('http://localhost/api/feedback/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ resolutions: [{ id: 'fb_1', status: 'Done' }] }),
        })
      );
      expect(res.status).toBe(415);
    });

    it('POST accepts application/json with a charset parameter', async () => {
      const res = await handlers.POST(
        new Request('http://localhost/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ feedbackText: 'Test', pageUrl: '/page' }),
        })
      );
      expect(res.status).toBe(201);
    });
  });

  describe('status query param validation', () => {
    it('GET with bogus status returns 400', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.GET(makeRequest('http://localhost/api/feedback?status=Bogus'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid status value');
    });

    it('GET with wrong-case status returns 400', async () => {
      const res = await handlers.GET(makeRequest('http://localhost/api/feedback?status=pending'));
      expect(res.status).toBe(400);
    });

    it('GET without status param returns everything', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.GET(makeRequest('http://localhost/api/feedback'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
    });

    it('GET with an EMPTY status param (?status=) returns everything, not 400', async () => {
      // A UI/bookmark that always appends ?status=${sel} with an empty default
      // ("All" → '') must keep getting all rows, matching pre-validation behaviour.
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.GET(makeRequest('http://localhost/api/feedback?status='));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
    });

    it('COUNT with an EMPTY status param (?status=) counts everything, not 400', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.COUNT(makeRequest('http://localhost/api/feedback/count?status='));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(1);
    });

    it('COUNT with bogus status returns 400', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.COUNT(
        makeRequest('http://localhost/api/feedback/count?status=Bogus')
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid status value');
    });

    it('COUNT with a valid status still filters', async () => {
      await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.COUNT(
        makeRequest('http://localhost/api/feedback/count?status=Pending')
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(1);
    });
  });

  describe('falsy and non-string status values in PATCH/RESOLVE', () => {
    it('PATCH returns 400 for empty-string status', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: '' }),
        fb.id
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid status value');

      // Status must not have been corrupted
      const stored = await adapter.getById(fb.id);
      expect(stored?.status).toBe('Pending');
    });

    it('PATCH returns 400 for null status', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: null }),
        fb.id
      );
      expect(res.status).toBe(400);

      const stored = await adapter.getById(fb.id);
      expect(stored?.status).toBe('Pending');
    });

    it('PATCH returns 400 for a numeric status', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 42 }),
        fb.id
      );
      expect(res.status).toBe(400);
    });

    it('RESOLVE returns 400 for empty-string status in a resolution', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: '' }],
        })
      );
      expect(res.status).toBe(400);

      const stored = await adapter.getById(fb.id);
      expect(stored?.status).toBe('Pending');
    });

    it('RESOLVE returns 400 for null status in a resolution', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: null }],
        })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('non-string POST body fields', () => {
    it('returns 400 when feedbackText is a number', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 123,
          pageUrl: '/page',
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('feedbackText must be a string');
    });

    it('returns 400 when pageUrl is a boolean', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: true,
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('pageUrl must be a string');
    });

    it('returns 400 when userEmail is an object', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          userEmail: { evil: true },
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('userEmail must be a string');
    });

    it('returns 400 when context is a number', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          context: 99,
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('context must be a string');
    });

    it('returns 400 when category is a number', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          category: 7,
        })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('explicit null for optional POST body fields', () => {
    // Non-JS clients (Python/Go/Java serializers, ORMs) emit explicit `null`
    // for absent optional fields, and 0.1.0 accepted that. null means
    // "absent", not "invalid".
    it('accepts null context and elementId, storing the row without them', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          context: null,
          elementId: null,
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.context).toBeUndefined();
      expect(data.elementId).toBeUndefined();
    });

    it('treats null userEmail as absent (anonymous flow), not a type error', async () => {
      const h = createApiHandlers({ adapter }); // no getUserEmail configured

      const res = await h.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: '/page',
          userEmail: null,
        })
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.userEmail).toBe('anonymous');
    });

    it('still rejects null feedbackText and pageUrl', async () => {
      const res1 = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: null,
          pageUrl: '/page',
        })
      );
      expect(res1.status).toBe(400);

      const res2 = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Test',
          pageUrl: null,
        })
      );
      expect(res2.status).toBe(400);
    });
  });

  describe('PATCH race with deletion (TOCTOU)', () => {
    it('returns 404 (not 200 with null body) when update finds no row', async () => {
      // Simulate the row vanishing between request receipt and the update —
      // the handler must rely on the update result, not a getById pre-check.
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });
      const racyAdapter: FeedbackAdapter = {
        ...adapter,
        update: async () => null,
      };
      const h = createApiHandlers({ adapter: racyAdapter });

      const res = await h.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { status: 'Done' }),
        fb.id
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Feedback not found');
    });
  });

  describe('RESOLVE notFound reporting', () => {
    it('lists requested ids that were not updated', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb.id, status: 'Done' },
            { id: 'missing_1', status: 'Done' },
            { id: 'missing_2', status: 'Rejected' },
          ],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.updated[0].id).toBe(fb.id);
      expect(data.notFound).toEqual(['missing_1', 'missing_2']);
    });

    it('returns an empty notFound array when all ids exist', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done' }],
        })
      );

      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.notFound).toEqual([]);
    });

    it('reports a fully-stale batch as all notFound', async () => {
      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'gone', status: 'Done' }],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toEqual([]);
      expect(data.notFound).toEqual(['gone']);
    });

    it('reports notFound when the adapter has no bulkUpdate (per-item fallback)', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const noBulkAdapter: FeedbackAdapter = {
        getAll: adapter.getAll,
        getById: adapter.getById,
        add: adapter.add,
        update: adapter.update,
      };
      const h = createApiHandlers({ adapter: noBulkAdapter });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb.id, status: 'Done' },
            { id: 'missing', status: 'Done' },
          ],
        })
      );

      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.notFound).toEqual(['missing']);
      expect(data.failed).toEqual([]);
    });
  });

  describe('RESOLVE failed reporting (adapter bulkUpdate returning BulkUpdateResult)', () => {
    // Adapters without transactions (supabase/PostgREST) report per-item
    // errors via the rich BulkUpdateResult shape. The handler must surface
    // those as `failed` (retry later), not `notFound` (row gone).
    function adapterWithRichBulkUpdate(
      base: FeedbackAdapter,
      result: Awaited<ReturnType<NonNullable<FeedbackAdapter['bulkUpdate']>>>
    ): FeedbackAdapter {
      return { ...base, bulkUpdate: async () => result };
    }

    it('reports errored ids in failed, not notFound (partial success → 200)', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
      const updatedFb = { ...fb, status: 'Done' as const };
      const h = createApiHandlers({
        adapter: adapterWithRichBulkUpdate(adapter, {
          updated: [updatedFb],
          failed: [{ id: 'fb_broken', error: 'permission denied' }],
        }),
      });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: fb.id, status: 'Done' },
            { id: 'fb_broken', status: 'Done' },
            { id: 'fb_gone', status: 'Done' },
          ],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toHaveLength(1);
      expect(data.failed).toEqual(['fb_broken']);
      expect(data.notFound).toEqual(['fb_gone']);
    });

    it('returns 500 when nothing was updated and at least one update errored', async () => {
      // A db outage / expired credentials / RLS misconfiguration must not be
      // reported as a 200 with every id in notFound — agents following the
      // README would treat the items as deleted and drop them.
      const h = createApiHandlers({
        adapter: adapterWithRichBulkUpdate(adapter, {
          updated: [],
          failed: [
            { id: 'fb_1', error: 'db down' },
            { id: 'fb_2', error: 'db down' },
          ],
        }),
      });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [
            { id: 'fb_1', status: 'Done' },
            { id: 'fb_2', status: 'Done' },
          ],
        })
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ updated: [], notFound: [], failed: ['fb_1', 'fb_2'] });
    });

    it('still returns 200 when an all-notFound batch has no errors', async () => {
      // Genuinely-missing rows with zero errors remain a success: the agent
      // can safely drop those ids.
      const h = createApiHandlers({
        adapter: adapterWithRichBulkUpdate(adapter, { updated: [], failed: [] }),
      });

      const res = await h.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: 'gone', status: 'Done' }],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ updated: [], notFound: ['gone'], failed: [] });
    });
  });

  describe('category and adminNotes validation in PATCH/RESOLVE', () => {
    it('PATCH returns 400 for invalid category', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { category: 'junk' }),
        fb.id
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid category');
    });

    it('RESOLVE returns 400 for invalid category in a resolution', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done', category: 'junk' }],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid category');
    });

    it('RESOLVE accepts a valid category', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done', category: 'bug' }],
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated[0].category).toBe('bug');
    });

    it('PATCH returns 400 for adminNotes over 5000 characters', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { adminNotes: 'x'.repeat(5001) }),
        fb.id
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('5000 characters or less');
    });

    it('PATCH returns 400 for non-string adminNotes', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.PATCH(
        jsonRequest(`http://localhost/api/feedback/${fb.id}`, { adminNotes: 42 }),
        fb.id
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('adminNotes must be a string');
    });

    it('RESOLVE returns 400 for adminNotes over 5000 characters, identifying the item', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done', adminNotes: 'x'.repeat(5001) }],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('5000 characters or less');
      // Batch errors must say WHICH resolution failed, like the status/category errors.
      expect(data.error).toContain(`for id "${fb.id}"`);
    });

    it('RESOLVE returns 400 for non-string adminNotes, identifying the item', async () => {
      const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'Test' });

      const res = await handlers.RESOLVE(
        jsonRequest('http://localhost/api/feedback/resolve', {
          resolutions: [{ id: fb.id, status: 'Done', adminNotes: 42 }],
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe(`adminNotes must be a string for id "${fb.id}"`);
    });
  });
});
