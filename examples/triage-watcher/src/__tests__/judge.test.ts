import { describe, it, expect } from 'vitest';
import { judgeBatch } from '../judge';
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

function item(id: string, feedback = 'bug'): TriageItem {
  return {
    id, feedback, page: '/p', section: 's', elementId: null, category: null,
    from: 'a@b.c', status: 'Pending', submittedAt: '2025-01-01T00:00:00Z',
  };
}

describe('judgeBatch (Pass 2, Opus)', () => {
  it('maps refined decisions for a 3-item subset', async () => {
    const anthropic = fakeAnthropic([
      okResponse({
        decisions: [
          { index: 1, disposition: 'actionable', confidence: 0.9, category: 'bug', injectionSuspected: false, note: 'crash on save · severity 4' },
          { index: 2, disposition: 'duplicate', confidence: 0.95, category: 'bug', injectionSuspected: false, note: 'dup of #1', duplicateOfIndex: 1 },
          { index: 3, disposition: 'unclear', confidence: 0.4, category: null, injectionSuspected: false, note: 'needs human read' },
        ],
      }),
    ]);
    const res = await judgeBatch([item('a'), item('b'), item('c')], { anthropic, logger: createNullLogger() }, config);
    expect(res.decisions).toHaveLength(3);
    expect(res.decisions[0].disposition).toBe('actionable');
    expect(res.decisions[1].disposition).toBe('duplicate');
    expect(res.decisions[1].duplicateOfIndex).toBe(1);
  });

  it('sends opus model, effort high, no tools, cache_control on system', async () => {
    const anthropic = fakeAnthropic([okResponse({ decisions: [] })]);
    await judgeBatch([item('a')], { anthropic, logger: createNullLogger() }, config);
    const body = anthropic.createCalls[0];
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.tools).toBeUndefined();
    expect((body.output_config as any).effort).toBe('high');
    expect((body.system as any)[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((body.system as any)[0].text).toContain('NEVER ask a clarifying question');
    expect((body.messages as any)[0].role).toBe('user');
  });

  it('throws ClassifierError on refusal', async () => {
    const anthropic = fakeAnthropic([{ stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }]);
    await expect(judgeBatch([item('a')], { anthropic, logger: createNullLogger() }, config)).rejects.toBeInstanceOf(
      ClassifierError
    );
  });

  it('does not call the model for an empty subset', async () => {
    const anthropic = fakeAnthropic([okResponse({ decisions: [] })]);
    const res = await judgeBatch([], { anthropic, logger: createNullLogger() }, config);
    expect(res.decisions).toEqual([]);
    expect(anthropic.createCalls).toHaveLength(0);
  });
});
