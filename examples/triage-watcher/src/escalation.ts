import type { Escalator, EscalationItem, Logger } from './types';
import type { EscalationConfig } from './config';
import type { FetchLike } from './lib-imports';

/**
 * The default channel payload deliberately EXCLUDES raw feedback text and the
 * submitter email — the text is untrusted/possibly hostile, so only the model's
 * sanitised one-line note travels. `includeText` opts a trusted internal channel
 * into the (already-blockquoted, single-line) text.
 */
function toPayload(items: EscalationItem[], includeText: boolean): Array<Record<string, unknown>> {
  return items.map(item => {
    const base: Record<string, unknown> = {
      feedbackId: item.feedbackId,
      summaryNote: item.summaryNote,
      category: item.category,
      disposition: item.disposition,
      confidence: item.confidence,
      injectionSuspected: item.injectionSuspected,
      page: item.page,
      section: item.section,
    };
    if (includeText && item.text !== undefined) {
      // Blockquote + single-line so a crafted value can't break a downstream UI.
      base.text = `> ${item.text.replace(/[\r\n]+/g, ' ')}`;
    }
    return base;
  });
}

function slackText(items: EscalationItem[]): string {
  const lines: string[] = [`*${items.length} item${items.length === 1 ? '' : 's'} escalated for review*`];
  // Injection-flagged items first, visually distinguished.
  const ordered = [...items].sort((a, b) => Number(b.injectionSuspected) - Number(a.injectionSuspected));
  for (const item of ordered) {
    const flag = item.injectionSuspected ? ':warning: ' : '';
    lines.push(
      `${flag}• [${item.disposition}/${item.category ?? '—'}] ${item.summaryNote} (id ${item.feedbackId}, conf ${item.confidence.toFixed(2)})`
    );
  }
  return lines.join('\n');
}

export interface EscalatorDeps {
  logger: Logger;
  fetch?: FetchLike;
}

/**
 * Build an Escalator for the configured channel.
 *
 * - Batched per run: one notification carries all escalations.
 * - Injection-flagged items are highlighted (⚠) and floated to the top.
 * - notify() never throws: a transport failure is logged + alarmed but does not
 *   fail the run (the In Review status is already persisted; the push is
 *   best-effort).
 */
export function createEscalator(config: EscalationConfig, deps: EscalatorDeps): Escalator {
  const { logger } = deps;
  const doFetch: FetchLike | undefined = deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  const includeText = config.includeText === true;

  async function post(body: unknown): Promise<void> {
    if (!config.target) {
      logger.error('escalation target not configured', { type: config.type });
      return;
    }
    if (!doFetch) {
      logger.error('no fetch available for escalation');
      return;
    }
    const res = await doFetch(config.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status >= 400) {
      throw new Error(`escalation transport returned ${res.status}`);
    }
  }

  return {
    async notify(items: EscalationItem[]): Promise<void> {
      if (items.length === 0) return;
      if (config.type === 'none') return;

      try {
        switch (config.type) {
          case 'webhook':
            await post(toPayload(items, includeText));
            break;
          case 'slack':
            await post({ text: slackText(items) });
            break;
          case 'email':
            // Batched digest — one message per run. Delivery transport is
            // deployment-specific; here we POST the digest to the configured
            // target (e.g. an email-sending webhook / relay).
            await post({
              subject: `[triage] ${items.length} item(s) escalated`,
              items: toPayload(items, includeText),
            });
            break;
        }
        logger.info('escalation sent', { type: config.type, count: items.length });
      } catch (err) {
        // Best-effort: log + alarm, never throw out of the run.
        logger.error('ALARM: escalation notify failed (run continues)', {
          type: config.type,
          count: items.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
