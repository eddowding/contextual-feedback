import { describe, it, expect } from 'vitest';
import { planActions, needsJudge, type DayCounters } from '../policy';
import type { PolicyConfig } from '../config';
import type { TriageDecision, TriageItem } from '../lib-imports';

const policy: PolicyConfig = {
  autoResolveMinConfidence: 0.9,
  spamMinConfidence: 0.95,
  maxAutoResolvesPerRun: 10,
  maxAutoResolvesPerDay: 50,
  dryRun: false,
};

const noDay: DayCounters = { autoResolvesToday: 0 };

function item(id: string): TriageItem {
  return {
    id, feedback: 'x', page: '/p', section: 's', elementId: null, category: null,
    from: 'a@b.c', status: 'Pending', submittedAt: '2025-01-01T00:00:00Z',
  };
}

function decision(over: Partial<TriageDecision> & { index: number }): TriageDecision {
  return {
    disposition: 'spam', confidence: 0.99, category: 'other', injectionSuspected: false,
    note: '', duplicateOfIndex: null, ...over,
  };
}

function planOne(d: TriageDecision, p: PolicyConfig = policy, day = noDay) {
  return planActions([d], [item('a')], p, day).resolutions[0];
}

describe('planActions — README §4 table', () => {
  it('spam ≥ spam floor → auto-reject (Rejected, other)', () => {
    const r = planOne(decision({ index: 1, disposition: 'spam', confidence: 0.96 }));
    expect(r.action).toBe('auto-resolve');
    expect(r.toStatus).toBe('Rejected');
    expect(r.category).toBe('other');
    expect(r.note).toContain('[auto] spam');
  });

  it('spam at 0.92 (below spam floor but above auto floor) → escalate', () => {
    const r = planOne(decision({ index: 1, disposition: 'spam', confidence: 0.92 }));
    expect(r.action).toBe('escalate');
    expect(r.toStatus).toBe('In Review');
  });

  it('praise ≥ floor → auto-resolve Done, praise', () => {
    const r = planOne(decision({ index: 1, disposition: 'praise', confidence: 0.95, category: 'praise' }));
    expect(r.action).toBe('auto-resolve');
    expect(r.toStatus).toBe('Done');
    expect(r.category).toBe('praise');
    expect(r.note).toContain('positive feedback');
  });

  it('duplicate ≥ floor → auto-resolve Done with ref', () => {
    const r = planOne(decision({ index: 1, disposition: 'duplicate', confidence: 0.95, category: 'bug', duplicateOfIndex: 3 }));
    expect(r.action).toBe('auto-resolve');
    expect(r.toStatus).toBe('Done');
    expect(r.note).toContain('duplicate (of item 3)');
  });

  it('question ≥ floor → auto-resolve Done, question', () => {
    const r = planOne(decision({ index: 1, disposition: 'question', confidence: 0.95, note: 'see /docs/faq' }));
    expect(r.action).toBe('auto-resolve');
    expect(r.toStatus).toBe('Done');
    expect(r.category).toBe('question');
    expect(r.note).toContain('answered: see /docs/faq');
  });

  it('actionable → escalate, category from model, severity note', () => {
    const r = planOne(decision({ index: 1, disposition: 'actionable', confidence: 0.99, category: 'bug', note: 'crash · severity 4' }));
    expect(r.action).toBe('escalate');
    expect(r.toStatus).toBe('In Review');
    expect(r.category).toBe('bug');
    expect(r.note).toContain('severity 4');
  });

  it('unclear → escalate, category other', () => {
    const r = planOne(decision({ index: 1, disposition: 'unclear', confidence: 0.99 }));
    expect(r.action).toBe('escalate');
    expect(r.category).toBe('other');
  });
});

describe('planActions — hard rules', () => {
  it('actionable at 0.99 still escalates (never auto-closes)', () => {
    const r = planOne(decision({ index: 1, disposition: 'actionable', confidence: 0.99, category: 'feature' }));
    expect(r.action).toBe('escalate');
  });

  it('below auto floor → escalate regardless of disposition', () => {
    const r = planOne(decision({ index: 1, disposition: 'praise', confidence: 0.5 }));
    expect(r.action).toBe('escalate');
    expect(r.note).toContain('low confidence');
    expect(r.policyOverride).toBe(true);
  });

  it('injectionSuspected always escalates + flags, even for praise', () => {
    const r = planOne(decision({ index: 1, disposition: 'praise', confidence: 0.99, injectionSuspected: true }));
    expect(r.action).toBe('escalate');
    expect(r.injectionSuspected).toBe(true);
    expect(r.policyOverride).toBe(true);
  });

  it('emits only valid statuses and categories', () => {
    const r = planOne(decision({ index: 1, disposition: 'spam', confidence: 0.99 }));
    expect(['Pending', 'In Review', 'Done', 'Rejected']).toContain(r.toStatus);
    expect([null, 'bug', 'feature', 'praise', 'question', 'other']).toContain(r.category);
  });

  it('truncates a 6000-char note to 5000 and single-lines it', () => {
    const longNote = 'a\n'.repeat(3500); // 7000 chars, multi-line
    const r = planOne(decision({ index: 1, disposition: 'question', confidence: 0.95, note: longNote }));
    expect(r.note.length).toBeLessThanOrEqual(5000);
    expect(r.note).not.toContain('\n');
  });
});

describe('planActions — quota circuit breaker', () => {
  function manyAutoResolvable(n: number): { decisions: TriageDecision[]; items: TriageItem[] } {
    const decisions: TriageDecision[] = [];
    const items: TriageItem[] = [];
    for (let i = 1; i <= n; i++) {
      decisions.push(decision({ index: i, disposition: 'praise', confidence: 0.9 + i * 0.001, category: 'praise' }));
      items.push(item(`id${i}`));
    }
    return { decisions, items };
  }

  it('15 auto-resolvable, cap 10 → 10 resolve, 5 escalate, flag set', () => {
    const { decisions, items } = manyAutoResolvable(15);
    const plan = planActions(decisions, items, { ...policy, maxAutoResolvesPerRun: 10 }, noDay);
    expect(plan.quotaCircuitBroke).toBe(true);
    expect(plan.resolutions.filter(r => r.action === 'auto-resolve')).toHaveLength(10);
    expect(plan.resolutions.filter(r => r.action === 'escalate')).toHaveLength(5);
  });

  it('respects the remaining per-DAY budget', () => {
    const { decisions, items } = manyAutoResolvable(10);
    const plan = planActions(decisions, items, { ...policy, maxAutoResolvesPerRun: 10, maxAutoResolvesPerDay: 50 }, { autoResolvesToday: 47 });
    // Only 3 of the daily budget left.
    expect(plan.resolutions.filter(r => r.action === 'auto-resolve')).toHaveLength(3);
    expect(plan.resolutions.filter(r => r.action === 'escalate')).toHaveLength(7);
    expect(plan.quotaCircuitBroke).toBe(true);
  });

  it('downgrades the LOWEST-confidence auto-resolves first', () => {
    const decisions = [
      decision({ index: 1, disposition: 'praise', confidence: 0.91, category: 'praise' }),
      decision({ index: 2, disposition: 'praise', confidence: 0.99, category: 'praise' }),
    ];
    const items = [item('a'), item('b')];
    const plan = planActions(decisions, items, { ...policy, maxAutoResolvesPerRun: 1 }, noDay);
    const idx1 = plan.resolutions.find(r => r.index === 1)!;
    const idx2 = plan.resolutions.find(r => r.index === 2)!;
    expect(idx1.action).toBe('escalate'); // lower confidence downgraded
    expect(idx2.action).toBe('auto-resolve'); // higher confidence kept
  });
});

describe('planActions — dry-run + judge routing', () => {
  it('dry-run turns every auto-resolve into would-resolve', () => {
    const r = planOne(decision({ index: 1, disposition: 'praise', confidence: 0.95, category: 'praise' }), { ...policy, dryRun: true });
    expect(r.action).toBe('would-resolve');
  });

  it('routes actionable/unclear/low-conf/injection to the judge subset', () => {
    const decisions = [
      decision({ index: 1, disposition: 'actionable', confidence: 0.99 }),
      decision({ index: 2, disposition: 'unclear', confidence: 0.99 }),
      decision({ index: 3, disposition: 'praise', confidence: 0.5 }),
      decision({ index: 4, disposition: 'praise', confidence: 0.99, injectionSuspected: true }),
      decision({ index: 5, disposition: 'praise', confidence: 0.99 }), // settled, not judged
    ];
    const items = [item('a'), item('b'), item('c'), item('d'), item('e')];
    const plan = planActions(decisions, items, policy, noDay);
    expect(plan.subsetForJudge.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('second planActions call (settled decisions) yields empty subsetForJudge', () => {
    const decisions = [decision({ index: 1, disposition: 'praise', confidence: 0.99, category: 'praise' })];
    const plan = planActions(decisions, [item('a')], policy, noDay);
    expect(plan.subsetForJudge).toEqual([]);
  });

  it('needsJudge is true for an actionable decision', () => {
    expect(needsJudge(decision({ index: 1, disposition: 'actionable', confidence: 0.99 }), policy)).toBe(true);
  });
});
