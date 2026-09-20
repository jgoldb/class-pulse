import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EgressGate, type EgressLogEntry } from './gate';
import { MockProvider } from './mock';
import type { ModelProvider } from './provider';
import { DisabledProvider } from './disabled';
import { aiConfigFromEnv, modelResolverFromConfig, providerFromEnv } from './index';

const REPO_ROOT = resolve(__dirname, '../../../..');
const ALLOWED = new Set(['packages/ai/src/egress/openai.ts']);
const SDK_RE = /from\s+['"](openai|@anthropic-ai\/sdk)(\/[^'"]*)?['"]|require\(\s*['"](openai|@anthropic-ai\/sdk)/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'data', 'drizzle', 'eval-reports'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) yield p;
  }
}

describe('egress invariant (docs/04): only the gate imports the provider SDK', () => {
  it('no other module in the repository imports openai or @anthropic-ai/sdk', () => {
    const offenders: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      if (rel.endsWith('egress.test.ts')) continue;
      if (SDK_RE.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

function makeGate(logs: EgressLogEntry[], provider: ModelProvider = new MockProvider()) {
  const cfg = aiConfigFromEnv({ AI_PROVIDER: 'mock', OPENAI_MODEL: 'test-model', NODE_ENV: 'test' } as never);
  let n = 0;
  return new EgressGate({
    provider,
    resolveModel: modelResolverFromConfig(cfg),
    posture: cfg.posture,
    writeLog: (e) => {
      logs.push(e);
    },
    newRunId: () => `run-${++n}`,
  });
}

const prompt = { id: 'guardrail_classifier.v1', body: 'score it', model: 'default', params: { reasoningEffort: null, maxTokens: 500 }, version: 1 };
const Payload = z.object({ surface: z.string(), draft: z.string() });
const Output = z.object({
  unsupportedCausalClaims: z.number(),
  hypothesesStatedAsFact: z.number(),
  stigmatizingLanguage: z.number(),
  outsideEducationalScope: z.number(),
  confidence: z.number(),
  notes: z.string(),
});

describe('EgressGate', () => {
  it('serializes only allowlisted fields', async () => {
    const logs: EgressLogEntry[] = [];
    const gate = makeGate(logs);
    const res = await gate.call({
      surface: 'guardrail_classifier',
      promptVersion: prompt,
      payloadSchema: Payload,
      payload: { surface: 'plan_generation', draft: '{}', studentName: 'LEAK', dob: '01/01/2010' } as never,
      outputSchema: Output,
      schemaName: 'scores',
    });
    expect(res.ok).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.input).not.toContain('LEAK');
    expect(logs[0]!.input).toBe(JSON.stringify({ surface: 'plan_generation', draft: '{}' }));
    expect(logs[0]!.status).toBe('succeeded');
    expect(logs[0]!.posture.store).toBe(false);
    expect(logs[0]!.model).toBe('mock:test-model');
  });

  it('blocks PII in any free-text field and logs the block without the payload', async () => {
    const logs: EgressLogEntry[] = [];
    const gate = makeGate(logs);
    const res = await gate.call({
      surface: 'guardrail_classifier',
      promptVersion: prompt,
      payloadSchema: Payload,
      payload: { surface: 'x', draft: 'Marcus Johnson left his seat' },
      outputSchema: Output,
      schemaName: 'scores',
      denyNames: ['Marcus Johnson'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === 'blocked_pii') expect(res.spans[0]!.text).toBe('Marcus Johnson');
    expect(logs[0]!.status).toBe('blocked_pii');
    expect(logs[0]!.input).not.toContain('Marcus');
  });

  it('reports provider errors and invalid output as retryable failures', async () => {
    const logs: EgressLogEntry[] = [];
    const bad = makeGate(logs, new MockProvider('invalid_json'));
    const r1 = await bad.call({ surface: 'guardrail_classifier', promptVersion: prompt, payloadSchema: Payload, payload: { surface: 'x', draft: 'y' }, outputSchema: Output, schemaName: 's' });
    expect(r1.ok).toBe(false);
    if (!r1.ok && r1.reason !== 'blocked_pii') expect(r1.reason).toBe('invalid_output');
    const err = makeGate(logs, new MockProvider('provider_error'));
    const r2 = await err.call({ surface: 'guardrail_classifier', promptVersion: prompt, payloadSchema: Payload, payload: { surface: 'x', draft: 'y' }, outputSchema: Output, schemaName: 's' });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.reason !== 'blocked_pii') expect(r2.reason).toBe('provider_error');
    expect(logs.map((l) => l.status)).toEqual(['invalid_output', 'provider_error']);
  });

  it('refuses every call when the model is switched off, and logs the refusal', async () => {
    const logs: EgressLogEntry[] = [];
    const gate = makeGate(logs, new DisabledProvider());
    const res = await gate.call({
      surface: 'guardrail_classifier',
      promptVersion: prompt,
      payloadSchema: Payload,
      payload: { surface: 'plan_generation', draft: '{}' },
      outputSchema: Output,
      schemaName: 'scores',
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason !== 'blocked_pii') {
      expect(res.reason).toBe('provider_error');
      // Non-retryable: generateWithGuardrails must not burn a second call on a switched-off model.
      expect(res.retryable).toBe(false);
      expect(res.error).toContain('AI_PROVIDER=off');
    }
    // The refusal is still an audit record: the payload that would have been sent is logged.
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('provider_error');
    expect(logs[0]!.input).toBe(JSON.stringify({ surface: 'plan_generation', draft: '{}' }));
    expect(logs[0]!.promptVersionId).toBe(prompt.id);
  });

  it('honours AI_PROVIDER=off in every environment, without an API key', () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      const env = { AI_PROVIDER: 'off', NODE_ENV } as never;
      expect(aiConfigFromEnv(env).provider).toBe('off');
      expect(providerFromEnv(env).name).toBe('disabled');
    }
  });

  it('still confines the mock provider to NODE_ENV=test', () => {
    expect(aiConfigFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'production' } as never).provider).toBe('openai');
    expect(aiConfigFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'test' } as never).provider).toBe('mock');
  });

  it('resolves models and effort from the environment with per-surface defaults', () => {
    const cfg = aiConfigFromEnv({});
    expect(cfg.model).toBe('gpt-5.6-terra');
    expect(cfg.reasoningEffort).toBe('medium');
    expect(cfg.classifierModel).toBe('gpt-5.6-terra');
    expect(cfg.classifierReasoningEffort).toBe('low');
    const resolve = modelResolverFromConfig(aiConfigFromEnv({ OPENAI_MODEL: 'm1', OPENAI_CLASSIFIER_MODEL: 'm2', OPENAI_REASONING_EFFORT: 'high', OPENAI_MAX_OUTPUT_TOKENS: '3000' }));
    expect(resolve('plan_generation', { model: 'default', params: { reasoningEffort: null, maxTokens: 8000 } })).toEqual({ model: 'm1', reasoningEffort: 'high', maxTokens: 3000 });
    expect(resolve('guardrail_classifier', { model: 'default', params: { reasoningEffort: null, maxTokens: 800 } })).toEqual({ model: 'm2', reasoningEffort: 'low', maxTokens: 800 });
    expect(resolve('plan_generation', { model: 'pinned', params: { reasoningEffort: 'minimal', maxTokens: 100 } })).toEqual({ model: 'pinned', reasoningEffort: 'minimal', maxTokens: 100 });
  });
});
