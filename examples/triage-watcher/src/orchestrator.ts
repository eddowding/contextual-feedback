import type { WatcherConfig } from './config';
import type { Deps, RunSummary, EscalationItem } from './types';
import type { TriageItem, TriageDecision } from './lib-imports';
import { formatTriageBatch } from './lib-imports';
import { selectNewItems, commit, type ProcessedItem } from './cursor';
import { classifyBatch } from './classifier';
import { judgeBatch } from './judge';
import { planActions, type DayCounters, type PlannedResolution } from './policy';
import { applyPlan } from './applier';
import { buildAuditRecords } from './audit';
import { exhaustedEscalationNote } from './retry';
import { ClassifierError } from './classifier-core';

/**
 * Full single-run orchestration (README §2 sequence). Order is load-bearing for
 * crash safety: audit append (step 10) happens BEFORE the cursor commit (step
 * 11), so a crash between them just re-processes (idempotent) rather than losing
 * the action trail.
 */
export async function runOnce(config: WatcherConfig, deps: Deps): Promise<RunSummary> {
  const {
    triageClient, cursorStore, retryQueue, costGovernor, dailyQuotaStore,
    auditSink, escalator, clock, logger, runId,
  } = deps;

  const summary: RunSummary = { runId, polled: 0, classified: 0, autoResolved: 0, escalated: 0, failed: 0 };
  logger.info('run start', { runId, dryRun: config.policy.dryRun });

  // 1. Poll.
  const { items } = await triageClient.getTriage();
  summary.polled = items.length;

  // 2. Idempotency filter + retry gating.
  const state = await cursorStore.load();
  const { fresh } = selectNewItems(items, state);
  const now = clock.now();
  const notYetDue = new Set(await retryQueue.notYetDueIds(now));
  let candidates = fresh.filter(it => !notYetDue.has(it.id));

  // Force-escalate ids that have exhausted their retry budget (give-up path).
  const exhausted = new Set(await retryQueue.exhaustedIds());
  const forcedEscalations = candidates.filter(it => exhausted.has(it.id));
  candidates = candidates.filter(it => !exhausted.has(it.id));

  // 3. Batch cap.
  const batch = candidates.slice(0, config.maxBatch);

  if (batch.length === 0 && forcedEscalations.length === 0) {
    logger.info('run end', { ...summary });
    return summary;
  }

  // 4. Cost governor: daily budget blown → escalate-everything (no classification).
  const dailyOk = await costGovernor.withinDailyBudget();
  if (!dailyOk) {
    logger.warn('ALARM: daily budget exhausted — escalate-everything path', { runId, count: batch.length });
    return await escalateEverything(config, deps, [...batch, ...forcedEscalations], summary);
  }

  // Run-budget preflight for Pass 1. If denied, shrink the batch and retry; if
  // it can't fit even one item, defer the batch to the next run.
  let working = batch;
  await costGovernor.acquireSlot();
  let { prompt } = formatTriageBatch(working);
  let pf = await costGovernor.preflight({
    system: 'classify', userPrompt: prompt, model: config.classifyModel,
  });
  while (!pf.allowed && working.length > 1) {
    working = working.slice(0, Math.floor(working.length / 2));
    ({ prompt } = formatTriageBatch(working));
    pf = await costGovernor.preflight({ system: 'classify', userPrompt: prompt, model: config.classifyModel });
  }
  if (!pf.allowed) {
    logger.warn('run budget too tight for even one item — deferring batch', { runId, reason: pf.reason });
    // Still process any forced escalations (they need no classification).
    if (forcedEscalations.length > 0) {
      return await escalateEverything(config, deps, forcedEscalations, summary, /*forcedOnly*/ true);
    }
    logger.info('run end', { ...summary });
    return summary;
  }

  // 5. Format the (possibly shrunk) batch.
  const { idByIndex } = formatTriageBatch(working);
  const submittedAtByIndex: Record<number, string> = {};
  working.forEach((it, i) => { submittedAtByIndex[i + 1] = it.submittedAt; });

  // 6. Pass 1.
  let pass1;
  try {
    pass1 = await classifyBatch(working, deps, config);
  } catch (err) {
    if (err instanceof ClassifierError) {
      logger.error('ALARM: Pass 1 classifier error — skipping batch this run', { runId, error: err.message });
      // No writes; forced escalations still handled below if present.
      if (forcedEscalations.length > 0) {
        return await escalateEverything(config, deps, forcedEscalations, summary, true);
      }
      logger.info('run end', { ...summary });
      return summary;
    }
    throw err;
  }
  await costGovernor.record(pass1.usage, config.classifyModel);
  summary.classified = pass1.decisions.length;

  // 7. Provisional plan → subsetForJudge. Seed the day counter from the PERSISTED
  // per-UTC-day total so the per-day auto-resolve cap actually binds across runs
  // (an in-memory 0 here would reset the cap every run, leaving only the per-run
  // cap live).
  const dayCounters: DayCounters = { autoResolvesToday: await dailyQuotaStore.todayCount(now) };
  const provisional = planActions(pass1.decisions, working, config.policy, dayCounters);

  // 8. Pass 2 (judge) on the ambiguous subset; merge; re-plan.
  const judgedIndices = new Set<number>();
  let mergedDecisions = pass1.decisions;
  if (provisional.subsetForJudge.length > 0) {
    // subset item id → original batch index (for remapping judge output).
    const idToOriginalIndex = new Map<string, number>();
    working.forEach((it, i) => idToOriginalIndex.set(it.id, i + 1));

    await costGovernor.acquireSlot();
    try {
      const pass2 = await judgeBatch(provisional.subsetForJudge, deps, config);
      await costGovernor.record(pass2.usage, config.judgeModel);

      // Remap subset-relative indices → original batch indices and merge.
      const byOriginalIndex = new Map<number, TriageDecision>();
      for (const d of pass1.decisions) byOriginalIndex.set(d.index, d);
      for (const jd of pass2.decisions) {
        const subsetItem = provisional.subsetForJudge[jd.index - 1];
        if (!subsetItem) continue; // out-of-range already dropped by validator
        const orig = idToOriginalIndex.get(subsetItem.id);
        if (orig === undefined) continue;
        judgedIndices.add(orig);
        // injectionSuspected is a STICKY canary (README §5.6): if Pass 1 raised
        // it, the judge cannot clear it — force-escalation must survive a judge
        // that re-labels the item. OR the two passes.
        const pass1Flag = byOriginalIndex.get(orig)?.injectionSuspected ?? false;
        byOriginalIndex.set(orig, {
          ...jd,
          index: orig,
          injectionSuspected: jd.injectionSuspected || pass1Flag,
        });
      }
      mergedDecisions = [...byOriginalIndex.values()].sort((a, b) => a.index - b.index);
    } catch (err) {
      if (err instanceof ClassifierError) {
        logger.error('ALARM: Pass 2 judge error — escalating the judge subset, keeping pass-1 settles', {
          runId, error: err.message,
        });
        // On judge failure, force-escalate the ambiguous subset (don't auto-close
        // un-judged items). Mark them so the re-plan escalates them.
        const subsetIds = new Set(provisional.subsetForJudge.map(i => i.id));
        mergedDecisions = pass1.decisions.map(d => {
          const it = working[d.index - 1];
          if (it && subsetIds.has(it.id)) {
            return { ...d, disposition: 'unclear' as const, confidence: 0 };
          }
          return d;
        });
      } else {
        throw err;
      }
    }
  }

  // Final plan (subsetForJudge should now be empty).
  const finalPlan = planActions(mergedDecisions, working, config.policy, dayCounters);

  // 9. Apply.
  const applyResult = await applyPlan(finalPlan.resolutions, idByIndex, deps);

  // 10. Audit — BEFORE cursor commit (crash-safety ordering).
  const auditRecords = buildAuditRecords({
    runId, plan: finalPlan.resolutions, applyResult, idByIndex, submittedAtByIndex, judgedIndices, clock,
  });
  await auditSink.append(auditRecords);

  // 11. Cursor commit + retry bookkeeping.
  const processed: ProcessedItem[] = [];
  let committedAutoResolves = 0;
  for (const entry of finalPlan.resolutions) {
    const id = idByIndex[entry.index];
    if (!id) continue;
    const outcome = applyResult.byId[id];
    if (outcome === undefined) continue;
    if (outcome === 'updated' || outcome === 'dry-run') {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'updated' });
      await retryQueue.recordOutcome(id);
      // Count only real (non-dry-run) auto-resolves toward the persisted daily
      // quota — escalations and dry-runs don't consume the auto-resolve budget.
      if (outcome === 'updated' && entry.action === 'auto-resolve') committedAutoResolves += 1;
    } else if (outcome === 'notFound') {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'dropped' });
      await retryQueue.recordOutcome(id);
    } else {
      // failed — do NOT advance cursor; enqueue for backoff.
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'failed' });
      await retryQueue.enqueue(id, now);
    }
  }
  const newState = commit(state, processed, config.seenIdWindow);
  await cursorStore.save(newState);

  // Persist the day's committed auto-resolve count so the per-day cap carries
  // into the next run (and the next scheduler tick).
  if (committedAutoResolves > 0) await dailyQuotaStore.add(now, committedAutoResolves);

  // Tally.
  for (const entry of finalPlan.resolutions) {
    const id = idByIndex[entry.index];
    const outcome = id ? applyResult.byId[id] : undefined;
    if (outcome === 'failed') summary.failed += 1;
    else if (entry.action === 'escalate') summary.escalated += 1;
    else if (entry.action === 'auto-resolve' || entry.action === 'would-resolve') summary.autoResolved += 1;
  }

  // 12. Escalate (best-effort push) — In Review items from this run + forced.
  const escalationItems: EscalationItem[] = [];
  for (const entry of finalPlan.resolutions) {
    if (entry.action !== 'escalate') continue;
    const id = idByIndex[entry.index];
    if (!id || applyResult.byId[id] === 'failed') continue;
    const it = working[entry.index - 1];
    escalationItems.push(buildEscalationItem(config, it, entry));
  }

  // Handle forced (retry-exhausted) escalations as their own RESOLVE write.
  if (forcedEscalations.length > 0) {
    await escalateExhausted(config, deps, forcedEscalations, summary, escalationItems);
  }

  if (escalationItems.length > 0) {
    await escalator.notify(escalationItems);
  }

  logger.info('run end', { ...summary, quotaCircuitBroke: finalPlan.quotaCircuitBroke });
  return summary;
}

function buildEscalationItem(
  config: WatcherConfig,
  it: TriageItem | undefined,
  entry: PlannedResolution
): EscalationItem {
  return {
    feedbackId: it?.id ?? '',
    summaryNote: entry.note,
    category: entry.category,
    disposition: entry.disposition,
    confidence: entry.confidence,
    injectionSuspected: entry.injectionSuspected,
    page: it?.page,
    section: it?.section,
    ...(config.escalation.includeText && it ? { text: it.feedback } : {}),
  };
}

/**
 * Daily-budget-blown / classifier-down fallback: claim items for a human by
 * setting them to In Review WITHOUT classification, so feedback is never silently
 * dropped (README §6). Still audits + advances the cursor.
 */
async function escalateEverything(
  config: WatcherConfig,
  deps: Deps,
  items: TriageItem[],
  summary: RunSummary,
  forcedOnly = false
): Promise<RunSummary> {
  const { cursorStore, auditSink, escalator, retryQueue, clock, runId, logger } = deps;
  if (items.length === 0) {
    logger.info('run end', { ...summary });
    return summary;
  }

  const idByIndex: Record<number, string> = {};
  const submittedAtByIndex: Record<number, string> = {};
  const plan: PlannedResolution[] = items.map((it, i) => {
    const index = i + 1;
    idByIndex[index] = it.id;
    submittedAtByIndex[index] = it.submittedAt;
    return {
      index,
      action: config.policy.dryRun ? 'would-resolve' : 'escalate',
      toStatus: 'In Review',
      category: null,
      note: forcedOnly
        ? exhaustedEscalationNote(config.maxRetryAttempts)
        : '[triage] escalated without classification (budget/availability limit)',
      disposition: 'unclear',
      confidence: 0,
      injectionSuspected: false,
      policyOverride: true,
    };
  });

  const applyResult = await applyPlan(plan, idByIndex, deps);
  const auditRecords = buildAuditRecords({
    runId, plan, applyResult, idByIndex, submittedAtByIndex, judgedIndices: new Set(), clock,
  });
  await auditSink.append(auditRecords);

  const state = await cursorStore.load();
  const processed: ProcessedItem[] = [];
  const escalationItems: EscalationItem[] = [];
  for (const entry of plan) {
    const id = idByIndex[entry.index];
    const outcome = applyResult.byId[id];
    if (outcome === 'updated' || outcome === 'dry-run') {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'updated' });
      await retryQueue.recordOutcome(id);
      summary.escalated += 1;
      const it = items[entry.index - 1];
      escalationItems.push(buildEscalationItem(config, it, entry));
    } else if (outcome === 'notFound') {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'dropped' });
      await retryQueue.recordOutcome(id);
    } else {
      // failed — enqueue for backoff like the main path does (orchestrator step
      // 11). These are ordinary (non-exhausted) items, so a transient RESOLVE
      // write failure here must NOT silently drop them from the retry queue.
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'failed' });
      await retryQueue.enqueue(id, clock.now());
      summary.failed += 1;
    }
  }
  await cursorStore.save(commit(state, processed, config.seenIdWindow));
  if (escalationItems.length > 0) await escalator.notify(escalationItems);

  logger.info('run end', { ...summary, mode: 'escalate-everything' });
  return summary;
}

/** Force-escalate retry-exhausted ids alongside a normal run, then drop them. */
async function escalateExhausted(
  config: WatcherConfig,
  deps: Deps,
  items: TriageItem[],
  summary: RunSummary,
  escalationItems: EscalationItem[]
): Promise<void> {
  const { auditSink, retryQueue, cursorStore, clock, runId } = deps;
  const idByIndex: Record<number, string> = {};
  const submittedAtByIndex: Record<number, string> = {};
  const plan: PlannedResolution[] = items.map((it, i) => {
    const index = i + 1;
    idByIndex[index] = it.id;
    submittedAtByIndex[index] = it.submittedAt;
    return {
      index,
      action: config.policy.dryRun ? 'would-resolve' : 'escalate',
      toStatus: 'In Review',
      category: null,
      note: exhaustedEscalationNote(config.maxRetryAttempts),
      disposition: 'unclear',
      confidence: 0,
      injectionSuspected: false,
      policyOverride: true,
    };
  });
  const applyResult = await applyPlan(plan, idByIndex, deps);
  await auditSink.append(
    buildAuditRecords({ runId, plan, applyResult, idByIndex, submittedAtByIndex, judgedIndices: new Set(), clock })
  );
  const state = await cursorStore.load();
  const processed: ProcessedItem[] = [];
  for (const entry of plan) {
    const id = idByIndex[entry.index];
    const outcome = applyResult.byId[id];
    if (outcome === 'updated' || outcome === 'dry-run' || outcome === 'notFound') {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: outcome === 'notFound' ? 'dropped' : 'updated' });
      await retryQueue.drop(id); // give up, escalated for a human
      summary.escalated += 1;
      const it = items[entry.index - 1];
      escalationItems.push(buildEscalationItem(config, it, entry));
    } else {
      processed.push({ id, submittedAt: submittedAtByIndex[entry.index], outcome: 'failed' });
      summary.failed += 1;
    }
  }
  await cursorStore.save(commit(state, processed, config.seenIdWindow));
}
