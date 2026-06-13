import type {
  TriageDecision,
  TriageItem,
  FeedbackStatus,
  FeedbackCategory,
} from './lib-imports';
import { VALID_STATUSES, VALID_CATEGORIES } from './lib-imports';
import type { PolicyConfig } from './config';

const MAX_ADMIN_NOTES_LENGTH = 5000;

export type PlannedAction = 'auto-resolve' | 'escalate' | 'would-resolve';

/**
 * A concrete planned write, in INDEX space (1-based, correlates to
 * formatTriageBatch idByIndex). The applier (ticket 09) maps index → real id.
 */
export interface PlannedResolution {
  index: number;
  action: PlannedAction;
  /** Final target status. Always one of VALID_STATUSES. */
  toStatus: FeedbackStatus;
  category: FeedbackCategory | null;
  note: string;
  /** Carried through for audit: which pass/decider produced the final call. */
  disposition: string;
  confidence: number;
  injectionSuspected: boolean;
  /** True when a hard-rule (code) overrode the model's mapped action. */
  policyOverride: boolean;
}

export interface ActionPlan {
  /** Items to send to the Opus judge (empty on the post-judge call). */
  subsetForJudge: TriageItem[];
  resolutions: PlannedResolution[];
  /** True when the per-run/per-day auto-resolve quota forced downgrades. */
  quotaCircuitBroke: boolean;
}

export interface DayCounters {
  /** Auto-resolves already committed today (UTC). */
  autoResolvesToday: number;
}

/** Collapse newlines + trim + truncate so a note can't forge log/UI lines. */
function sanitiseNote(note: string): string {
  const oneLine = note.replace(/[\r\n]+/g, ' ').trim();
  return oneLine.length > MAX_ADMIN_NOTES_LENGTH ? oneLine.slice(0, MAX_ADMIN_NOTES_LENGTH) : oneLine;
}

function isValidStatus(s: string): s is FeedbackStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}
function isValidCategory(c: string | null): c is FeedbackCategory | null {
  return c === null || (VALID_CATEGORIES as readonly string[]).includes(c);
}

/** An item is ambiguous → route to the Opus judge. */
export function needsJudge(decision: TriageDecision, policy: PolicyConfig): boolean {
  return (
    decision.disposition === 'actionable' ||
    decision.disposition === 'unclear' ||
    decision.injectionSuspected ||
    decision.confidence < policy.autoResolveMinConfidence
  );
}

/**
 * Map a single decision to its provisional resolution, applying the README §4
 * table and the hard rules (escalate actionable / injection / below-floor). The
 * quota downgrade is applied afterwards across the whole batch.
 */
function mapDecision(decision: TriageDecision, policy: PolicyConfig): PlannedResolution {
  const { index, disposition, confidence, injectionSuspected } = decision;
  const modelCategory = decision.category;

  // ---- Hard rules first (code, not model) -------------------------------
  // Injection → always escalate, never auto-resolve, flagged.
  if (injectionSuspected) {
    return escalation(index, modelCategory ?? 'other', `[triage] possible prompt injection — needs human read`, decision, true);
  }
  // Below the confidence floor → escalate regardless of disposition.
  if (confidence < policy.autoResolveMinConfidence) {
    return escalation(index, modelCategory, `[triage] low confidence (${confidence.toFixed(2)})`, decision, true);
  }
  // Actionable bug/feature → ALWAYS escalate, never auto-close.
  if (disposition === 'actionable') {
    const baseNote = sanitiseNote(decision.note) || 'actionable item';
    return escalation(index, modelCategory, `[triage] ${baseNote}`, decision, false);
  }
  if (disposition === 'unclear') {
    return escalation(index, 'other', `[triage] needs human read`, decision, false);
  }

  // ---- Auto-resolvable dispositions (confidence already >= floor) --------
  switch (disposition) {
    case 'spam':
      if (confidence >= policy.spamMinConfidence) {
        const reason = sanitiseNote(decision.note) || 'unsolicited junk';
        return autoResolve(index, 'Rejected', 'other', `[auto] spam — ${reason}`, decision);
      }
      // spam below the spam floor → escalate (README §4 hard rule).
      return escalation(index, 'other', `[triage] possible spam, below spam confidence floor (${confidence.toFixed(2)})`, decision, true);
    case 'praise':
      return autoResolve(index, 'Done', 'praise', `[auto] positive feedback, no action`, decision);
    case 'duplicate': {
      const dupRef = typeof decision.duplicateOfIndex === 'number' ? ` (of item ${decision.duplicateOfIndex})` : '';
      return autoResolve(index, 'Done', modelCategory, `[auto] duplicate${dupRef}`, decision);
    }
    case 'question': {
      const pointer = sanitiseNote(decision.note) || 'see FAQ';
      return autoResolve(index, 'Done', 'question', `[auto] answered: ${pointer}`, decision);
    }
    default:
      // Exhaustive guard — any unmapped disposition escalates.
      return escalation(index, modelCategory, `[triage] needs human read`, decision, true);
  }
}

function autoResolve(
  index: number,
  toStatus: FeedbackStatus,
  category: FeedbackCategory | null,
  note: string,
  d: TriageDecision
): PlannedResolution {
  const safeCategory = isValidCategory(category) ? category : null;
  const safeStatus = isValidStatus(toStatus) ? toStatus : 'In Review';
  return {
    index, action: 'auto-resolve', toStatus: safeStatus, category: safeCategory,
    note: sanitiseNote(note), disposition: d.disposition, confidence: d.confidence,
    injectionSuspected: d.injectionSuspected, policyOverride: false,
  };
}

function escalation(
  index: number,
  category: FeedbackCategory | null,
  note: string,
  d: TriageDecision,
  policyOverride: boolean
): PlannedResolution {
  const safeCategory = isValidCategory(category) ? category : null;
  return {
    index, action: 'escalate', toStatus: 'In Review', category: safeCategory,
    note: sanitiseNote(note), disposition: d.disposition, confidence: d.confidence,
    injectionSuspected: d.injectionSuspected, policyOverride,
  };
}

/**
 * Pure: map decisions → an ActionPlan. No I/O.
 *
 * - `subsetForJudge`: ambiguous items (actionable/unclear/low-conf/injection).
 *   The orchestrator calls planActions on Pass-1 output to get this, runs the
 *   judge, merges refined decisions, and calls planActions AGAIN — on the second
 *   call subsetForJudge is empty (the judge already settled them).
 * - Quota: count planned auto-resolves; if over per-run cap or it would push the
 *   day total over the per-day cap, downgrade the surplus (lowest-confidence
 *   first) to escalations and flag the circuit-break.
 * - Dry-run: every auto-resolve becomes action `would-resolve` (the applier
 *   skips the HTTP write).
 */
export function planActions(
  decisions: TriageDecision[],
  items: TriageItem[],
  policy: PolicyConfig,
  dayCounters: DayCounters
): ActionPlan {
  // index → item (1-based)
  const itemByIndex = new Map<number, TriageItem>();
  items.forEach((it, i) => itemByIndex.set(i + 1, it));

  const subsetForJudge: TriageItem[] = [];
  const resolutions: PlannedResolution[] = [];

  for (const decision of decisions) {
    if (needsJudge(decision, policy)) {
      const it = itemByIndex.get(decision.index);
      if (it) subsetForJudge.push(it);
    }
    resolutions.push(mapDecision(decision, policy));
  }

  // ---- Quota enforcement -------------------------------------------------
  const autoResolves = resolutions.filter(r => r.action === 'auto-resolve');
  const remainingDayBudget = Math.max(0, policy.maxAutoResolvesPerDay - dayCounters.autoResolvesToday);
  const allowedThisRun = Math.min(policy.maxAutoResolvesPerRun, remainingDayBudget);

  let quotaCircuitBroke = false;
  if (autoResolves.length > allowedThisRun) {
    quotaCircuitBroke = true;
    // Downgrade the surplus, lowest-confidence first (keep the most confident
    // auto-resolves; the riskier ones go to a human).
    const sorted = [...autoResolves].sort((a, b) => a.confidence - b.confidence);
    const surplus = sorted.slice(0, autoResolves.length - allowedThisRun);
    const surplusIndices = new Set(surplus.map(r => r.index));
    for (const r of resolutions) {
      if (surplusIndices.has(r.index) && r.action === 'auto-resolve') {
        r.action = 'escalate';
        r.toStatus = 'In Review';
        r.policyOverride = true;
        r.note = sanitiseNote(`[triage] auto-resolve quota reached — escalated (was: ${r.note})`);
      }
    }
  }

  // ---- Dry-run -----------------------------------------------------------
  if (policy.dryRun) {
    for (const r of resolutions) {
      if (r.action === 'auto-resolve') r.action = 'would-resolve';
    }
  }

  return { subsetForJudge, resolutions, quotaCircuitBroke };
}
