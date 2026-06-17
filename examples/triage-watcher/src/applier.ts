import type { Resolution, ResolveResponse, TriageClient } from './lib-imports';
import type { Logger } from './types';
import type { PlannedResolution } from './policy';

export type ApplyOutcome = 'updated' | 'notFound' | 'failed' | 'dry-run';

export interface ApplyResult {
  updated: string[];
  notFound: string[];
  failed: string[];
  dryRun: string[];
  /** id → outcome, for audit (10), cursor commit (05), and retry (13). */
  byId: Record<string, ApplyOutcome>;
}

export interface ApplyDeps {
  triageClient: TriageClient;
  logger: Logger;
}

/**
 * Apply an action plan via RESOLVE and split the result into
 * updated/notFound/failed (+ dry-run).
 *
 * - Maps each PlannedResolution.index → real id via `idByIndex`. SECURITY
 *   BACKSTOP: an index not in idByIndex is dropped + alarmed (it can't have been
 *   in the batch we sent).
 * - Dry-run: if ANY plan entry is `would-resolve`, issue NO RESOLVE call; every
 *   mapped id returns `dry-run`.
 * - Builds the resolutions payload omitting fields the plan doesn't set (RESOLVE
 *   treats absent fields as no-change), but always sends the target status.
 * - The client returns the body on 200 AND 500 (ticket 01); a whole-batch 500
 *   surfaces its `failed` ids for retry — never throws here.
 */
export async function applyPlan(
  plan: PlannedResolution[],
  idByIndex: Record<number, string>,
  deps: ApplyDeps
): Promise<ApplyResult> {
  const { triageClient, logger } = deps;
  const result: ApplyResult = { updated: [], notFound: [], failed: [], dryRun: [], byId: {} };

  // Map indices → ids, dropping any index not in the batch we sent.
  const mapped: { id: string; entry: PlannedResolution }[] = [];
  for (const entry of plan) {
    const id = idByIndex[entry.index];
    if (id === undefined) {
      logger.error('ALARM: plan entry index not in idByIndex — dropped', { index: entry.index });
      continue;
    }
    mapped.push({ id, entry });
  }

  if (mapped.length === 0) {
    return result;
  }

  const isDryRun = mapped.some(m => m.entry.action === 'would-resolve');
  if (isDryRun) {
    for (const { id } of mapped) {
      result.dryRun.push(id);
      result.byId[id] = 'dry-run';
    }
    return result;
  }

  // Build the RESOLVE payload. Always set status (the plan always has one);
  // include category/adminNotes only when present so we never blank a field.
  const resolutions: Resolution[] = mapped.map(({ id, entry }) => {
    const r: Resolution = { id, status: entry.toStatus };
    if (entry.note) r.adminNotes = entry.note;
    if (entry.category !== null) r.category = entry.category;
    return r;
  });

  const idsSent = new Set(mapped.map(m => m.id));

  // The "never throws here" contract is load-bearing: a throw out of applyPlan
  // aborts runOnce AFTER model spend but BEFORE the audit append + cursor commit
  // (orchestrator step 10/11), so the batch is re-fetched and re-billed next run
  // with no audit trail. The client throws only on an unexpected HTTP status
  // (401/415/…) or an unparseable body — neither actionable per-item — so treat
  // the whole batch as `failed` (retryable) and let the run still audit+commit.
  let response: ResolveResponse;
  try {
    response = await triageClient.resolve(resolutions);
  } catch (err) {
    logger.error('ALARM: RESOLVE call threw — treating batch as failed (retryable)', {
      error: err instanceof Error ? err.message : String(err),
    });
    for (const id of idsSent) {
      result.failed.push(id);
      result.byId[id] = 'failed';
    }
    return result;
  }

  // Guard against a malformed body (e.g. a 500 whose shape is {error} rather
  // than {updated, notFound, failed}): default each list to [] so we fall
  // through to the "sent but unaccounted-for → failed" backstop below instead
  // of throwing on `for...of undefined`.
  const updated = Array.isArray(response.updated) ? response.updated : [];
  const notFoundIds = Array.isArray(response.notFound) ? response.notFound : [];
  const failedIds = Array.isArray(response.failed) ? response.failed : [];

  for (const fb of updated) {
    result.updated.push(fb.id);
    result.byId[fb.id] = 'updated';
  }
  for (const id of notFoundIds) {
    result.notFound.push(id);
    result.byId[id] = 'notFound';
  }
  for (const id of failedIds) {
    result.failed.push(id);
    result.byId[id] = 'failed';
  }

  // Defensive: any id we sent that the response never accounted for is treated
  // as failed (retry) rather than silently dropped — covers a malformed body.
  for (const id of idsSent) {
    if (result.byId[id] === undefined) {
      logger.warn('id sent but absent from RESOLVE response — treating as failed', { id });
      result.failed.push(id);
      result.byId[id] = 'failed';
    }
  }

  return result;
}
