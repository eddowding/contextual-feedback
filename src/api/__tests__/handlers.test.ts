import { describe, it, expect, beforeEach, vi } from 'vitest';
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

    it('GET and POST remain open without auth', async () => {
      const getRes = await authedHandlers.GET(makeRequest('http://localhost/api/feedback'));
      expect(getRes.status).toBe(200);

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
    it('prefers body userEmail over getUserEmail', async () => {
      const res = await handlers.POST(
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

    it('falls back to getUserEmail when body userEmail is absent', async () => {
      const res = await handlers.POST(
        jsonRequest('http://localhost/api/feedback', {
          feedbackText: 'Bug',
          pageUrl: '/page',
        })
      );

      const data = await res.json();
      expect(data.userEmail).toBe('anonymous@test.local');
    });

    it('trims whitespace from body email', async () => {
      const res = await handlers.POST(
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
  });
});
