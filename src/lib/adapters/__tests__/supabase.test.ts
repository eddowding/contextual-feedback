import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseAdapter } from '../supabase';

function createMockClient() {
  const builder: Record<string, unknown> = {};

  const chainable = () => {
    const proxy = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') {
            return (resolve: (val: unknown) => void) => {
              resolve(builder._result ?? { data: [], error: null });
            };
          }
          if (typeof prop === 'string') {
            if (!builder[prop]) {
              builder[prop] = vi.fn().mockReturnValue(chainable());
            }
            return builder[prop];
          }
        },
      }
    );
    return proxy;
  };

  const client = {
    from: vi.fn().mockReturnValue(chainable()),
    _builder: builder,
    _setResult: (result: unknown) => {
      builder._result = result;
    },
  };

  return client;
}

describe('createSupabaseAdapter', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it('calls from() with correct table name', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter({ client: client as any });
    await adapter.getAll();
    expect(client.from).toHaveBeenCalledWith('feedback');
  });

  it('uses custom table name', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter({ client: client as any, tableName: 'my_feedback' });
    await adapter.getAll();
    expect(client.from).toHaveBeenCalledWith('my_feedback');
  });

  it('getAll returns mapped feedback array', async () => {
    const mockRow = {
      id: 'fb_1',
      user_email: 'user@test.com',
      page_url: 'https://example.com',
      feedback_text: 'Test',
      status: 'Pending',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      admin_notes: null,
      context: null,
      element_id: null,
    };

    client._setResult({ data: [mockRow], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter({ client: client as any });
    const results = await adapter.getAll();

    expect(results).toHaveLength(1);
    expect(results[0].userEmail).toBe('user@test.com');
    expect(results[0].feedbackText).toBe('Test');
  });

  it('throws on supabase error', async () => {
    client._setResult({ data: null, error: { message: 'Auth error' } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter({ client: client as any });
    await expect(adapter.getAll()).rejects.toThrow('Auth error');
  });
});
