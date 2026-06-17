import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { TriageAuditRecord, FeedbackStatus, FeedbackCategory } from './lib-imports';
import type { AuditSink, Clock } from './types';
import type { PlannedResolution } from './policy';
import type { ApplyResult, ApplyOutcome } from './applier';

/** Map a plan action + an apply outcome to the audit `action`. */
function auditAction(
  planAction: PlannedResolution['action'],
  outcome: ApplyOutcome
): TriageAuditRecord['action'] {
  if (outcome === 'dry-run') return 'would-resolve';
  if (outcome === 'notFound') return 'dropped';
  if (outcome === 'failed') return 'failed';
  // updated
  return planAction === 'escalate' ? 'escalate' : 'auto-resolve';
}

function resolveResult(outcome: ApplyOutcome): TriageAuditRecord['resolveResult'] {
  return outcome; // 'updated' | 'notFound' | 'failed' | 'dry-run'
}

/** Which model/pass made the FINAL call (policy override → 'policy'). */
function deciderModel(entry: PlannedResolution, judged: Set<number>): TriageAuditRecord['model'] {
  if (entry.policyOverride) return 'policy';
  return judged.has(entry.index) ? 'opus' : 'sonnet';
}

export interface BuildAuditArgs {
  runId: string;
  plan: PlannedResolution[];
  applyResult: ApplyResult;
  /** index → real id (formatTriageBatch). */
  idByIndex: Record<number, string>;
  /** index → submittedAt, for cursor reconstruction. */
  submittedAtByIndex: Record<number, string>;
  /** Indices that were re-judged by Opus, so `model` is attributed correctly. */
  judgedIndices: Set<number>;
  clock: Clock;
}

/**
 * Assemble one TriageAuditRecord per processed item from the plan + ApplyResult.
 * Populates every ticket-03 field. Records for failed/dropped items are written
 * too, so the trail shows attempts, not just successes (README §8).
 */
export function buildAuditRecords(args: BuildAuditArgs): TriageAuditRecord[] {
  const { runId, plan, applyResult, idByIndex, submittedAtByIndex, judgedIndices, clock } = args;
  const ts = clock.nowIso();
  const records: TriageAuditRecord[] = [];

  for (const entry of plan) {
    const id = idByIndex[entry.index];
    if (id === undefined) continue; // dropped at apply time (index not in batch)
    const outcome = applyResult.byId[id];
    if (outcome === undefined) continue; // never attempted (e.g. alarmed/dropped)

    const action = auditAction(entry.action, outcome);
    const toStatus: FeedbackStatus | null =
      outcome === 'updated' || outcome === 'dry-run' ? entry.toStatus : null;
    const category: FeedbackCategory | null = entry.category;

    records.push({
      ts,
      runId,
      feedbackId: id,
      submittedAt: submittedAtByIndex[entry.index] ?? '',
      action,
      toStatus,
      category,
      disposition: entry.disposition,
      confidence: entry.confidence,
      injectionSuspected: entry.injectionSuspected,
      model: deciderModel(entry, judgedIndices),
      note: entry.note,
      resolveResult: resolveResult(outcome),
    });
  }

  return records;
}

/**
 * Append-only JSONL audit sink. Opens in append mode, one JSON object per line,
 * fsync before resolving so `append` only returns once the data is durable
 * (the ordering guarantee the orchestrator relies on: audit BEFORE cursor
 * commit). Never rewrites or deletes prior lines.
 */
export function createJsonlAuditSink(path: string): AuditSink {
  return {
    async append(records: TriageAuditRecord[]): Promise<void> {
      if (records.length === 0) return;
      await fs.mkdir(dirname(path), { recursive: true });
      const data = records.map(r => JSON.stringify(r)).join('\n') + '\n';
      const handle = await fs.open(path, 'a');
      try {
        await handle.appendFile(data, 'utf8');
        await handle.sync(); // durable on return
      } finally {
        await handle.close();
      }
    },
  };
}
