import { describe, it, expect, vi } from 'vitest';
import { createTriageClient, TriageHttpError, FetchLike } from '../triage-client';

function fakeResponse(status: number, body: unknown) {
  return {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('createTriageClient.getTriage', () => {
  it('issues a GET with bearer header and parses {items, summary}', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(200, {
        items: [{ id: 'a' }],
        summary: { pending: 1, inReview: 0, total: 1 },
      })
    ) as unknown as FetchLike;

    const client = createTriageClient({
      baseUrl: 'https://app/api/feedback',
      token: 'secret',
      fetch: fetchMock,
    });

    const res = await client.getTriage();
    expect(res.summary.total).toBe(1);
    expect(res.items[0].id).toBe('a');

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://app/api/feedback/triage');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('trims a single trailing slash on baseUrl', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(200, { items: [], summary: { pending: 0, inReview: 0, total: 0 } })
    ) as unknown as FetchLike;
    const client = createTriageClient({ baseUrl: 'https://app/api/feedback/', token: 't', fetch: fetchMock });
    await client.getTriage();
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://app/api/feedback/triage');
  });

  it('throws TriageHttpError(status=401) on a 401', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(401, { error: 'Unauthorized' })) as unknown as FetchLike;
    const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token: 't', fetch: fetchMock });
    await expect(client.getTriage()).rejects.toMatchObject({ name: 'TriageHttpError', status: 401 });
  });
});

describe('createTriageClient.resolve', () => {
  it('issues a JSON POST and returns the parsed body on 200', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(200, { updated: [{ id: 'a' }], notFound: ['b'], failed: ['c'] })
    ) as unknown as FetchLike;

    const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token: 'tok', fetch: fetchMock });
    const res = await client.resolve([{ id: 'a', status: 'Done' }]);

    expect(res.updated[0].id).toBe('a');
    expect(res.notFound).toEqual(['b']);
    expect(res.failed).toEqual(['c']);

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://app/api/feedback/resolve');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ resolutions: [{ id: 'a', status: 'Done' }] });
  });

  it('returns the parsed body on a 500 without throwing', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(500, { updated: [], notFound: [], failed: ['x'] })
    ) as unknown as FetchLike;
    const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token: 't', fetch: fetchMock });
    const res = await client.resolve([{ id: 'x', status: 'Done' }]);
    expect(res.failed).toEqual(['x']);
  });

  it('throws TriageHttpError on a 415 (Content-Type rejected)', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(415, { error: 'Content-Type must be application/json' })
    ) as unknown as FetchLike;
    const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token: 't', fetch: fetchMock });
    await expect(client.resolve([{ id: 'x' }])).rejects.toMatchObject({ name: 'TriageHttpError', status: 415 });
  });

  it('throws TriageHttpError on an unparseable body', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, 'not json')) as unknown as FetchLike;
    const client = createTriageClient({ baseUrl: 'https://app/api/feedback', token: 't', fetch: fetchMock });
    await expect(client.resolve([{ id: 'x' }])).rejects.toBeInstanceOf(TriageHttpError);
  });
});
