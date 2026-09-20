import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AiSurface, PromptVersion } from '@class-pulse/domain';
import { detectPii, type PiiSpan } from '../pii/detector';
import { strings } from '../guardrails/lexicon';
import { toStructuredJsonSchema } from '../schema';
import { ProviderError, type ModelProvider, type ReasoningEffort, type StructuredRequest } from './provider';

/**
 * THE EGRESS GATE (docs/04). One function every outbound model call goes through. It:
 *  1. serializes only allowlisted fields (a Zod payload schema; unknown keys are stripped),
 *  2. scans every free-text field for PII and blocks on a hit,
 *  3. records provider posture (zero retention, region) on every call,
 *  4. writes an egress log entry with the exact payload that left, prompt version, model, time.
 */

export interface ModelResolution {
  model: string;
  reasoningEffort: ReasoningEffort | null;
  maxTokens: number;
}

export interface EgressLogEntry {
  runId: string;
  surface: AiSurface;
  caseKey: string | null;
  promptVersionId: string;
  model: string;
  provider: string;
  /** Exactly what left. */
  instructions: string;
  input: string;
  inputHash: string;
  status: 'sent' | 'blocked_pii' | 'provider_error' | 'invalid_output' | 'succeeded';
  latencyMs: number | null;
  usage: { input: number; output: number; reasoning: number } | null;
  posture: { zeroRetention: boolean; region: string; store: false };
  piiWarnings: PiiSpan[];
  error: string | null;
  at: Date;
}

export interface EgressGateOptions {
  provider: ModelProvider;
  resolveModel: (surface: AiSurface, prompt: Pick<PromptVersion, 'model' | 'params'>) => ModelResolution;
  posture: { zeroRetention: boolean; region: string };
  writeLog: (entry: EgressLogEntry) => Promise<void> | void;
  newRunId: () => string;
}

export interface EgressCall<TPayload, TOut> {
  surface: AiSurface;
  promptVersion: Pick<PromptVersion, 'id' | 'body' | 'model' | 'params' | 'version'>;
  payloadSchema: z.ZodType<TPayload>;
  payload: TPayload;
  outputSchema: z.ZodType<TOut>;
  schemaName: string;
  caseKey?: string | null;
  /** Roster names for this call's scope, supplied by the API from the identified plane. */
  denyNames?: ReadonlyArray<string>;
}

export interface RunMeta {
  runId: string;
  model: string;
  provider: string;
  promptVersionId: string;
  inputHash: string;
  latencyMs: number | null;
  usage: { input: number; output: number; reasoning: number } | null;
}

export type EgressOutcome<TOut> =
  | { ok: true; output: TOut; rawText: string; run: RunMeta; piiWarnings: PiiSpan[] }
  | { ok: false; reason: 'blocked_pii'; spans: PiiSpan[]; run: RunMeta }
  | { ok: false; reason: 'provider_error' | 'invalid_output'; error: string; retryable: boolean; run: RunMeta };

export class EgressGate {
  constructor(private readonly opts: EgressGateOptions) {}

  get providerName(): string {
    return this.opts.provider.name;
  }

  async call<TPayload, TOut>(c: EgressCall<TPayload, TOut>): Promise<EgressOutcome<TOut>> {
    // 1. Allowlist serialization. Zod objects strip unknown keys; nothing else can be serialized.
    const parsed = c.payloadSchema.parse(c.payload);
    const input = JSON.stringify(parsed);
    const resolved = this.opts.resolveModel(c.surface, c.promptVersion);
    const runId = this.opts.newRunId();
    const inputHash = createHash('sha256').update(c.promptVersion.body).update('\n').update(input).digest('hex');
    const posture = { ...this.opts.posture, store: false as const };
    const run: RunMeta = {
      runId,
      model: resolved.model,
      provider: this.opts.provider.name,
      promptVersionId: c.promptVersion.id,
      inputHash,
      latencyMs: null,
      usage: null,
    };
    const base = {
      runId,
      surface: c.surface,
      caseKey: c.caseKey ?? null,
      promptVersionId: c.promptVersion.id,
      model: resolved.model,
      provider: this.opts.provider.name,
      instructions: c.promptVersion.body,
      input,
      inputHash,
      posture,
      at: new Date(),
    };

    // 2. PII scan of every free-text field in the allowlisted payload.
    const spans: PiiSpan[] = [];
    for (const { path, text } of strings(parsed)) {
      for (const s of detectPii(text, { denyNames: c.denyNames })) spans.push({ ...s, hint: `${path}: ${s.hint}` });
    }
    const blocking = spans.filter((s) => s.confidence === 'high');
    const warnings = spans.filter((s) => s.confidence !== 'high');
    if (blocking.length) {
      await this.opts.writeLog({ ...base, input: '[blocked: payload not sent]', status: 'blocked_pii', latencyMs: null, usage: null, piiWarnings: spans, error: 'PII detected' });
      return { ok: false, reason: 'blocked_pii', spans: blocking, run };
    }

    // 3. The call.
    const req: StructuredRequest = {
      surface: c.surface,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort,
      maxOutputTokens: resolved.maxTokens,
      instructions: c.promptVersion.body,
      input,
      schemaName: c.schemaName,
      jsonSchema: toStructuredJsonSchema(c.outputSchema),
    };
    const started = Date.now();
    try {
      const res = await this.opts.provider.complete(req);
      run.latencyMs = Date.now() - started;
      run.usage = res.usage;
      run.model = res.model;
      const validated = c.outputSchema.safeParse(res.outputJson);
      if (!validated.success) {
        const error = `Output failed schema validation: ${validated.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
        await this.opts.writeLog({ ...base, model: res.model, status: 'invalid_output', latencyMs: run.latencyMs, usage: res.usage, piiWarnings: warnings, error });
        return { ok: false, reason: 'invalid_output', error, retryable: true, run };
      }
      await this.opts.writeLog({ ...base, model: res.model, status: 'succeeded', latencyMs: run.latencyMs, usage: res.usage, piiWarnings: warnings, error: null });
      return { ok: true, output: validated.data, rawText: res.rawText, run, piiWarnings: warnings };
    } catch (err) {
      run.latencyMs = Date.now() - started;
      const retryable = err instanceof ProviderError ? err.retryable : false;
      const error = err instanceof Error ? err.message : String(err);
      await this.opts.writeLog({ ...base, status: 'provider_error', latencyMs: run.latencyMs, usage: null, piiWarnings: warnings, error });
      return { ok: false, reason: 'provider_error', error, retryable, run };
    }
  }
}
