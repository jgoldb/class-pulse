import { and, desc, eq } from 'drizzle-orm';
import { PROMPT_SEEDS } from '@class-pulse/ai';
import { newId, type AiSurface, type PromptVersion } from '@class-pulse/domain';
import type { Db } from '../db/client';
import { evalRuns, promptVersions } from '../db/schema';
import { badRequest, conflict, notFound } from '../context';

/**
 * Copy code-defined prompt seeds into the registry table (idempotent). On a fresh database the
 * seeds' statuses apply as written. On an existing database, new versions are inserted as
 * `draft` regardless of their seed status: promotion goes through the eval-gated path
 * (docs/03), never through a redeploy.
 */
export async function seedPrompts(db: Db): Promise<void> {
  const existing = await db.select({ id: promptVersions.id, surface: promptVersions.surface, status: promptVersions.status }).from(promptVersions);
  const surfacesWithRows = new Set(existing.map((e) => e.surface));
  for (const seed of PROMPT_SEEDS) {
    if (existing.some((e) => e.id === seed.id)) continue;
    const status = surfacesWithRows.has(seed.surface) ? 'draft' : seed.status;
    await db.insert(promptVersions).values({ ...seed, params: seed.params, status }).onConflictDoNothing();
  }
}

export async function activePrompt(db: Db, surface: AiSurface): Promise<PromptVersion> {
  const [row] = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.surface, surface), eq(promptVersions.status, 'active')))
    .limit(1);
  if (!row) throw new Error(`No active prompt for surface ${surface}`);
  return row as PromptVersion;
}

export async function activePrompts(db: Db) {
  const [plan_generation, pattern_interpretation, review_narration, guardrail_classifier] = await Promise.all([
    activePrompt(db, 'plan_generation'),
    activePrompt(db, 'pattern_interpretation'),
    activePrompt(db, 'review_narration'),
    activePrompt(db, 'guardrail_classifier'),
  ]);
  return { plan_generation, pattern_interpretation, review_narration, guardrail_classifier };
}

export async function listPrompts(db: Db) {
  const rows = await db.select().from(promptVersions).orderBy(promptVersions.surface, desc(promptVersions.version));
  const runs = await db.select().from(evalRuns).orderBy(desc(evalRuns.createdAt));
  return rows.map((p) => ({
    ...p,
    body: undefined,
    bodyLength: p.body.length,
    latestEval: runs.find((r) => r.promptVersionId === p.id) ?? null,
  }));
}

export async function promptBody(db: Db, id: string) {
  const [row] = await db.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  if (!row) throw notFound('Prompt version not found');
  return row;
}

/** Create a new draft version (immutable once created). */
export async function createPromptVersion(db: Db, input: { surface: AiSurface; body: string; model: string; params: PromptVersion['params']; changelog: string; createdBy: string }) {
  const [latest] = await db.select().from(promptVersions).where(eq(promptVersions.surface, input.surface)).orderBy(desc(promptVersions.version)).limit(1);
  const version = (latest?.version ?? 0) + 1;
  const id = `${input.surface}.v${version}`;
  await db.insert(promptVersions).values({ id, surface: input.surface, version, body: input.body, model: input.model, params: input.params, changelog: input.changelog, createdBy: input.createdBy, status: 'draft' });
  return id;
}

/**
 * docs/03 "Gate — no prompt version reaches active without passing the suite." Promotion requires
 * a passing eval run recorded against this exact version (plan_generation only has a suite in v1;
 * other surfaces are promoted with a recorded reason and no suite yet).
 */
export async function promotePrompt(db: Db, id: string, by: string): Promise<void> {
  const target = await promptBody(db, id);
  if (target.status === 'active') throw conflict('Already active');
  if (target.status === 'retired') throw badRequest('Retired versions cannot be promoted; create a new version');
  if (target.surface === 'plan_generation') {
    const [run] = await db.select().from(evalRuns).where(eq(evalRuns.promptVersionId, id)).orderBy(desc(evalRuns.createdAt)).limit(1);
    if (!run || !run.passed) throw badRequest('Promotion blocked: no passing eval run recorded for this prompt version', { latestEval: run ?? null });
  }
  await db.transaction(async (tx) => {
    await tx.update(promptVersions).set({ status: 'retired' }).where(and(eq(promptVersions.surface, target.surface), eq(promptVersions.status, 'active')));
    await tx.update(promptVersions).set({ status: 'active' }).where(eq(promptVersions.id, id));
  });
  void by;
}

export async function recordEvalRun(db: Db, r: { promptVersionId: string; provider: string; model: string; passed: boolean; passedCases: number; totalCases: number; report: unknown }) {
  const id = newId();
  await db.insert(evalRuns).values({ id, ...r, report: r.report as object });
  return id;
}
