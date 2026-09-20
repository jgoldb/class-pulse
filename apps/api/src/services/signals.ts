import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { NewSignal, SEED_CONTEXT_TAGS, SIGNAL_UNITS, newId, numericValue, type Signal } from '@class-pulse/domain';
import { detectPii, hasHighConfidencePii } from '@class-pulse/ai/pii';
import { canLogSignal } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { badRequest, forbidden } from '../context';
import { goals, signals } from '../db/schema';
import { audit } from './audit';
import { getCase, roleForCase } from './cases';
import { denyNamesForCase, orgContextTags } from './roster';

/** Quick entry / self-check / import write path. Validates the controlled tag vocabulary. */
export async function logSignal(ctx: AppContext, actor: Actor, caseKey: string, input: unknown) {
  const role = roleForCase(actor, caseKey);
  const parsed = NewSignal.omit({ caseKey: true, enteredBy: true }).parse(input);
  if (!canLogSignal(role, parsed.source)) throw forbidden(`Role ${role} cannot log ${parsed.source} signals`);
  if (parsed.source === 'student_entry' && parsed.type !== 'self_check') throw forbidden('Students may only log self-checks');
  const c = await getCase(ctx, caseKey);
  const allowed = new Set([...SEED_CONTEXT_TAGS, ...(await orgContextTags(ctx.db, c.schoolId)).map((t) => t.tag)]);
  const unknown = parsed.contextTags.filter((t) => !allowed.has(t));
  if (unknown.length) throw badRequest(`Unknown context tag(s): ${unknown.join(', ')}. Tags are a controlled vocabulary; ask an administrator to extend it.`);
  if (parsed.note) {
    const spans = detectPii(parsed.note, { denyNames: await denyNamesForCase(ctx.db, caseKey) });
    if (hasHighConfidencePii(spans)) throw badRequest('The note contains identifying information. Remove it — Class Pulse works without it.', { spans });
  }
  const num = numericValue(parsed);
  const id = newId();
  await ctx.db.insert(signals).values({
    id,
    caseKey,
    type: parsed.type,
    valueNum: num,
    valueText: typeof parsed.value === 'string' ? parsed.value : null,
    unit: parsed.unit ?? SIGNAL_UNITS[parsed.type],
    contextTags: parsed.contextTags,
    observedAt: parsed.observedAt,
    source: parsed.source,
    sourceConfidence: parsed.sourceConfidence,
    enteredBy: actor.userId,
    goalId: parsed.goalId ?? null,
    strategyId: parsed.strategyId ?? null,
    note: parsed.note ?? null,
  });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'signal.create', targetType: 'signal', targetId: id, caseKey, metadata: { type: parsed.type, tags: parsed.contextTags.length } });
  return id;
}

export function rowToSignal(r: typeof signals.$inferSelect): Signal {
  return {
    id: r.id,
    caseKey: r.caseKey,
    type: r.type as Signal['type'],
    value: r.valueNum ?? r.valueText ?? 0,
    unit: r.unit ?? undefined,
    contextTags: r.contextTags,
    observedAt: r.observedAt,
    source: r.source as Signal['source'],
    sourceConfidence: r.sourceConfidence as Signal['sourceConfidence'],
    enteredBy: r.enteredBy ?? undefined,
    goalId: r.goalId,
    strategyId: r.strategyId,
    note: r.note,
  };
}

export async function signalsForCase(ctx: AppContext, caseKey: string, sinceDays = 120): Promise<Signal[]> {
  const since = new Date(ctx.now().getTime() - sinceDays * 86_400_000);
  const rows = await ctx.db.select().from(signals).where(and(eq(signals.caseKey, caseKey), gte(signals.observedAt, since))).orderBy(asc(signals.observedAt));
  return rows.map(rowToSignal);
}

export async function recentSignals(ctx: AppContext, caseKey: string, limit = 50) {
  return (await ctx.db.select().from(signals).where(eq(signals.caseKey, caseKey)).orderBy(desc(signals.observedAt)).limit(limit)).map(rowToSignal);
}

/**
 * Progress series per goal (docs/05): daily values with observation counts, the baseline band,
 * and the goal line, so a chart can render confidence alongside the data.
 */
export async function progressForGoal(ctx: AppContext, goalId: string, days = 42) {
  const [g] = await ctx.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!g) return null;
  const content = g.content as import('@class-pulse/domain').GoalContent;
  const all = await signalsForCase(ctx, g.caseKey, days);
  const linked = all.filter((s) => s.goalId === goalId);
  const type = content.measurementMethod === 'interval_observation' ? 'interval_observation' : content.measurementMethod === 'permanent_product' ? 'assignment_grade' : 'behavior_event';
  const series = linked.length ? linked : all.filter((s) => s.type === type && !s.goalId);
  const byDay = new Map<string, { date: string; value: number; observations: number }>();
  for (const s of series) {
    const day = s.observedAt.toISOString().slice(0, 10);
    const v = numericValue(s) ?? 0;
    const cur = byDay.get(day) ?? { date: day, value: 0, observations: 0 };
    if (type === 'behavior_event') cur.value += v > 0 ? v : 1;
    else cur.value = (cur.value * cur.observations + v) / (cur.observations + 1);
    cur.observations += 1;
    byDay.set(day, cur);
  }
  const points = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ ...p, value: Math.round(p.value * 100) / 100 }));
  const selfChecks = all.filter((s) => s.type === 'self_check' && (!s.goalId || s.goalId === goalId)).map((s) => ({ date: s.observedAt.toISOString().slice(0, 10), value: numericValue(s) ?? 0 }));
  return {
    goalId,
    targetBehavior: content.targetBehavior,
    direction: content.direction,
    measurementMethod: content.measurementMethod,
    unit: SIGNAL_UNITS[type],
    baseline: content.baseline,
    target: content.target,
    points,
    totalObservations: series.length,
    preBaseline: content.baseline.status !== 'available',
    selfChecks,
  };
}
