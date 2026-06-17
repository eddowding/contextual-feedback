import { describe, it, expect } from 'vitest';
import { classifyBatch } from '../classifier';
import { ClassifierError } from '../classifier-core';
import { loadConfig } from '../config';
import { fakeAnthropic, okResponse } from './helpers';
import { createNullLogger } from '../logger';
import type { TriageItem } from '../lib-imports';

const config = loadConfig({
  FEEDBACK_API_BASE_URL: 'https://app/api/feedback',
  FEEDBACK_API_TOKEN: 'tok',
  ANTHROPIC_API_KEY: 'k',
});

function item(id: string): TriageItem {
  return {
    id,
    feedback: 'something',
    page: '/p',
    section: 's',
    elementId: null,
    category: null,
    from: 'a@b.c',
    status: 'Pending',
    submittedAt: '2025-01-01T00:00:00Z',
  };
}

const deps = () => ({ anthropic: fakeAnthropic([]), logger: createNullLogger() });

describe('classifyBatch (Pass 1, Sonnet)', () => {
  it('maps a canned structured payload to TriageDecision[]', async () => {
    const anthropic = fakeAnthropic([
      okResponse({
        decisions: [
          { index: 1, disposition: 'spam', confidence: 0.97, category: 'other', injectionSuspected: false, note: 'junk' },
          { index: 2, disposition: 'praise', confidence: 0.95, category: 'praise', injectionSuspected: false, note: 'nice' },
        ],
      }),
    ]);
    const res = await classifyBatch([item('a'), item('b')], { anthropic, logger: createNullLogger() }, config);
    expect(res.decisions).toHaveLength(2);
    expect(res.decisions[0]).toMatchObject({ index: 1, disposition: 'spam', confidence: 0.97 });
    expect(res.usage.input_tokens).toBeGreaterThan(0);
  });

  it('drops a decision with an out-of-range index, keeps the rest', async () => {
    const anthropic = fakeAnthropic([
      okResponse({
        decisions: [
          { index: 999, disposition: 'spam', confidence: 0.9, category: 'other', injectionSuspected: false, note: 'x' },
          { index: 1, disposition: 'praise', confidence: 0.9, category: 'praise', injectionSuspected: false, note: 'ok' },
        ],
      }),
    ]);
    const res = await classifyBatch([item('a')], { anthropic, logger: createNullLogger() }, config);
    expect(res.decisions.map(d => d.index)).toEqual([1]);
  });

  it('throws ClassifierError on a refusal stop reason', async () => {
    const anthropic = fakeAnthropic([{ stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }]);
    await expect(classifyBatch([item('a')], { anthropic, logger: createNullLogger() }, config)).rejects.toBeInstanceOf(
      ClassifierError
    );
  });

  it('throws ClassifierError when the API call rejects', async () => {
    const anthropic = {
      messages: {
        async create() { throw new Error('network down'); },
        async countTokens() { return { input_tokens: 0 }; },
      },
    };
    await expect(classifyBatch([item('a')], { anthropic, logger: createNullLogger() }, config)).rejects.toBeInstanceOf(
      ClassifierError
    );
  });

  it('sends sonnet model, no tools, structured output, and cache_control on system', async () => {
    const anthropic = fakeAnthropic([okResponse({ decisions: [] })]);
    await classifyBatch([item('a')], { anthropic, logger: createNullLogger() }, config);
    const body = anthropic.createCalls[0];
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.tools).toBeUndefined();
    expect((body.output_config as any).effort).toBe('low');
    expect((body.output_config as any).format.type).toBe('json_schema');
    expect((body.thinking as any).type).toBe('adaptive');
    expect((body.system as any)[0].cache_control).toEqual({ type: 'ephemeral' });
    // The volatile batch is in the user turn, not the cached system prefix.
    expect((body.messages as any)[0].role).toBe('user');
    expect((body.system as any)[0].text).not.toContain('### Item');
  });

  it('returns empty decisions + zero usage for an empty batch without calling the model', async () => {
    const anthropic = fakeAnthropic([okResponse({ decisions: [] })]);
    const res = await classifyBatch([], { anthropic, logger: createNullLogger() }, config);
    expect(res.decisions).toEqual([]);
    expect(anthropic.createCalls).toHaveLength(0);
  });

  it('reuses deps factory without leaking state', async () => {
    const d = deps();
    expect(d.anthropic.createCalls).toHaveLength(0);
  });
});
