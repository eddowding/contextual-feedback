/**
 * Watcher entrypoint. The ONLY place the real Anthropic SDK, the typed triage
 * client, and the concrete durable stores are constructed. Everything testable
 * lives behind the `Deps` seam.
 *
 * Usage:
 *   triage-watcher once     # run a single pass and exit
 *   triage-watcher serve    # start the cron scheduler (default)
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, ConfigError } from './config';
import { createTriageClient } from './lib-imports';
import { createFileCursorStore } from './cursor';
import { createJsonlAuditSink } from './audit';
import { createEscalator } from './escalation';
import { createRetryQueue } from './retry';
import { createCostGovernor } from './cost';
import { createLogger, systemClock, generateRunId } from './logger';
import { runOnce } from './run';
import { startScheduler } from './scheduler';
import type { AnthropicLike, Deps } from './types';

function buildDeps(config: ReturnType<typeof loadConfig>): Deps {
  const logger = createLogger({ service: 'triage-watcher' });
  // The SDK client structurally satisfies AnthropicLike (messages.create /
  // messages.countTokens). API key resolves from ANTHROPIC_API_KEY by default.
  const anthropic = new Anthropic() as unknown as AnthropicLike;
  const triageClient = createTriageClient({ baseUrl: config.apiBaseUrl, token: config.apiToken });

  return {
    triageClient,
    anthropic,
    cursorStore: createFileCursorStore(config.cursorStorePath),
    auditSink: createJsonlAuditSink(config.auditStorePath),
    escalator: createEscalator(config.escalation, { logger }),
    retryQueue: createRetryQueue(
      { retryStorePath: config.retryStorePath, maxRetryAttempts: config.maxRetryAttempts },
      { clock: systemClock, logger }
    ),
    costGovernor: createCostGovernor(
      {
        maxSpendPerRunUsd: config.maxSpendPerRunUsd,
        maxSpendPerDayUsd: config.maxSpendPerDayUsd,
        requestsPerMin: config.requestsPerMin,
        dailyStorePath: `${config.cursorStorePath}.daily-spend.json`,
      },
      { anthropic, clock: systemClock, logger }
    ),
    clock: systemClock,
    logger,
    runId: generateRunId(),
  };
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // eslint-disable-next-line no-console
      console.error(`Config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const mode = process.argv[2] ?? 'serve';
  const logger = createLogger({ service: 'triage-watcher' });

  if (mode === 'once') {
    const summary = await runOnce(config, buildDeps(config));
    logger.info('single run complete', { ...summary });
    return;
  }

  startScheduler(config, {
    logger,
    makeDeps: () => buildDeps(config),
    run: runOnce,
  });
  // Keep the process alive for the cron scheduler.
  process.stdin.resume();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
