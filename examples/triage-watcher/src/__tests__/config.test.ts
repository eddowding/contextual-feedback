import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../config';

const fullEnv = {
  FEEDBACK_API_BASE_URL: 'https://app/api/feedback',
  FEEDBACK_API_TOKEN: 'tok',
  ANTHROPIC_API_KEY: 'sk-ant-x',
};

describe('loadConfig', () => {
  it('fails fast when apiToken is missing', () => {
    expect(() => loadConfig({ FEEDBACK_API_BASE_URL: 'x', ANTHROPIC_API_KEY: 'k' })).toThrow(ConfigError);
  });

  it('fails fast when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ FEEDBACK_API_BASE_URL: 'x', FEEDBACK_API_TOKEN: 't' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('lists all missing required vars in one error', () => {
    expect(() => loadConfig({})).toThrow(/FEEDBACK_API_BASE_URL.*FEEDBACK_API_TOKEN.*ANTHROPIC_API_KEY/);
  });

  it('applies documented defaults from a full env', () => {
    const cfg = loadConfig(fullEnv);
    expect(cfg.apiBaseUrl).toBe('https://app/api/feedback');
    expect(cfg.pollCron).toBe('*/5 * * * *');
    expect(cfg.seenIdWindow).toBe(1000);
    expect(cfg.classifyModel).toBe('claude-sonnet-4-6');
    expect(cfg.judgeModel).toBe('claude-opus-4-8');
    expect(cfg.maxBatch).toBe(25);
    expect(cfg.maxSpendPerRunUsd).toBe(0.5);
    expect(cfg.maxSpendPerDayUsd).toBe(5);
    expect(cfg.requestsPerMin).toBe(20);
    expect(cfg.maxRetryAttempts).toBe(6);
    expect(cfg.escalation.type).toBe('none');
  });

  it('defaults policy.dryRun to true', () => {
    expect(loadConfig(fullEnv).policy.dryRun).toBe(true);
  });

  it('honours an explicit POLICY_DRY_RUN=false', () => {
    expect(loadConfig({ ...fullEnv, POLICY_DRY_RUN: 'false' }).policy.dryRun).toBe(false);
  });

  it('parses policy thresholds and overrides', () => {
    const cfg = loadConfig({
      ...fullEnv,
      POLICY_AUTO_RESOLVE_MIN_CONFIDENCE: '0.8',
      POLICY_SPAM_MIN_CONFIDENCE: '0.99',
      POLICY_MAX_AUTO_RESOLVES_PER_RUN: '3',
      MAX_BATCH: '5',
    });
    expect(cfg.policy.autoResolveMinConfidence).toBe(0.8);
    expect(cfg.policy.spamMinConfidence).toBe(0.99);
    expect(cfg.policy.maxAutoResolvesPerRun).toBe(3);
    expect(cfg.maxBatch).toBe(5);
  });

  it('rejects a non-numeric numeric var', () => {
    expect(() => loadConfig({ ...fullEnv, MAX_BATCH: 'lots' })).toThrow(ConfigError);
  });

  it('rejects an invalid escalation type', () => {
    expect(() => loadConfig({ ...fullEnv, ESCALATION_TYPE: 'carrier-pigeon' })).toThrow(ConfigError);
  });
});
