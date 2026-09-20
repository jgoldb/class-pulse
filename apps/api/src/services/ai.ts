import { EgressGate, aiConfigFromEnv, modelResolverFromConfig, providerFromEnv, type AiConfig, type EgressLogEntry, type ModelProvider, type RunMeta } from '@class-pulse/ai';
import { newId, type AiSurface, type GenerationStatus } from '@class-pulse/domain';
import type { Db } from '../db/client';
import { egressLog, generationRuns } from '../db/schema';

/**
 * Wire the egress gate to the working plane: every call writes an egress_log row (exact payload,
 * prompt version, model, timestamp, posture) — docs/04 item 4.
 */
export function buildGate(db: Db, env: NodeJS.ProcessEnv = process.env): { gate: EgressGate; aiConfig: AiConfig; provider: ModelProvider } {
  const aiConfig = aiConfigFromEnv(env);
  const provider = providerFromEnv(env);
  const gate = new EgressGate({
    provider,
    resolveModel: modelResolverFromConfig(aiConfig),
    posture: aiConfig.posture,
    newRunId: () => newId(),
    writeLog: async (e: EgressLogEntry) => {
      await db.insert(egressLog).values({
        id: newId(),
        runId: e.runId,
        surface: e.surface,
        caseKey: e.caseKey,
        promptVersionId: e.promptVersionId,
        model: e.model,
        provider: e.provider,
        instructions: e.instructions,
        input: e.input,
        inputHash: e.inputHash,
        status: e.status,
        latencyMs: e.latencyMs,
        usage: e.usage,
        posture: e.posture,
        piiWarnings: e.piiWarnings,
        error: e.error,
        at: e.at,
      });
    },
  });
  return { gate, aiConfig, provider };
}

/** Persist run metadata (docs/03: prompt version, model, input hash, latency, tokens). */
export async function recordRuns(db: Db, surface: AiSurface, caseKey: string | null, runs: RunMeta[], status: GenerationStatus, error: string | null = null): Promise<void> {
  for (const [i, r] of runs.entries()) {
    await db.insert(generationRuns).values({
      id: r.runId,
      surface,
      caseKey,
      promptVersionId: r.promptVersionId,
      model: r.model,
      provider: r.provider,
      inputHash: r.inputHash,
      latencyMs: r.latencyMs,
      tokens: r.usage,
      status: i === runs.length - 1 ? status : 'rejected',
      attempt: i + 1,
      error: i === runs.length - 1 ? error : null,
    }).onConflictDoNothing();
  }
}
