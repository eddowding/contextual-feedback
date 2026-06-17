import { describe, it, expect, vi } from 'vitest';
import { createEscalator } from '../escalation';
import { createNullLogger } from '../logger';
import type { EscalationItem } from '../types';
import type { FetchLike } from '../lib-imports';

function item(over: Partial<EscalationItem> & { feedbackId: string }): EscalationItem {
  return {
    summaryNote: 'needs review', category: 'bug', disposition: 'actionable',
    confidence: 0.8, injectionSuspected: false, page: '/p', section: 's', ...over,
  };
}

function okFetch(): FetchLike & { calls: any[] } {
  const calls: any[] = [];
  const fn = (async (url: string, init?: any) => {
    calls.push({ url, init });
    return { status: 200, text: async () => 'ok' };
  }) as FetchLike & { calls: any[] };
  fn.calls = calls;
  return fn;
}

describe('createEscalator — webhook', () => {
  it('POSTs one batched JSON array with all items; injection flagged', async () => {
    const fetch = okFetch();
    const esc = createEscalator({ type: 'webhook', target: 'https://hook' }, { logger: createNullLogger(), fetch });
    await esc.notify([item({ feedbackId: 'a' }), item({ feedbackId: 'b', injectionSuspected: true })]);
    expect(fetch.calls).toHaveLength(1);
    const payload = JSON.parse(fetch.calls[0].init.body);
    expect(payload).toHaveLength(2);
    expect(payload.find((p: any) => p.feedbackId === 'b').injectionSuspected).toBe(true);
  });

  it('default payload excludes raw text and submitter email', async () => {
    const fetch = okFetch();
    const esc = createEscalator({ type: 'webhook', target: 'https://hook' }, { logger: createNullLogger(), fetch });
    await esc.notify([item({ feedbackId: 'a', text: 'secret raw feedback' })]);
    const payload = JSON.parse(fetch.calls[0].init.body);
    expect('text' in payload[0]).toBe(false);
    expect('from' in payload[0]).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('secret raw feedback');
  });

  it('includeText opt-in adds blockquoted single-line text', async () => {
    const fetch = okFetch();
    const esc = createEscalator(
      { type: 'webhook', target: 'https://hook', includeText: true },
      { logger: createNullLogger(), fetch }
    );
    await esc.notify([item({ feedbackId: 'a', text: 'line1\nline2' })]);
    const payload = JSON.parse(fetch.calls[0].init.body);
    expect(payload[0].text).toBe('> line1 line2');
  });
});

describe('createEscalator — slack', () => {
  it('floats injection items to the top with a warning marker', async () => {
    const fetch = okFetch();
    const esc = createEscalator({ type: 'slack', target: 'https://slack' }, { logger: createNullLogger(), fetch });
    await esc.notify([item({ feedbackId: 'a' }), item({ feedbackId: 'b', injectionSuspected: true })]);
    const text: string = JSON.parse(fetch.calls[0].init.body).text;
    const lines = text.split('\n');
    // First bullet (after the header line) is the injection item.
    expect(lines[1]).toContain(':warning:');
    expect(lines[1]).toContain('id b');
  });
});

describe('createEscalator — resilience', () => {
  it('does not throw when the transport fails (logs + alarms)', async () => {
    const error = vi.fn();
    const logger = { ...createNullLogger(), error };
    const throwingFetch = (async () => { throw new Error('boom'); }) as unknown as FetchLike;
    const esc = createEscalator({ type: 'webhook', target: 'https://hook' }, { logger, fetch: throwingFetch });
    await expect(esc.notify([item({ feedbackId: 'a' })])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('does not throw on a 4xx/5xx status', async () => {
    const error = vi.fn();
    const logger = { ...createNullLogger(), error };
    const badFetch = (async () => ({ status: 500, text: async () => 'err' })) as unknown as FetchLike;
    const esc = createEscalator({ type: 'webhook', target: 'https://hook' }, { logger, fetch: badFetch });
    await expect(esc.notify([item({ feedbackId: 'a' })])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('type none is a clean no-op (no network)', async () => {
    const fetch = okFetch();
    const esc = createEscalator({ type: 'none' }, { logger: createNullLogger(), fetch });
    await esc.notify([item({ feedbackId: 'a' })]);
    expect(fetch.calls).toHaveLength(0);
  });

  it('empty items list makes no call', async () => {
    const fetch = okFetch();
    const esc = createEscalator({ type: 'webhook', target: 'https://hook' }, { logger: createNullLogger(), fetch });
    await esc.notify([]);
    expect(fetch.calls).toHaveLength(0);
  });
});
