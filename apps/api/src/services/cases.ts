import { and, desc, eq, inArray } from 'drizzle-orm';
import { IntakeFields, newId, type Role } from '@class-pulse/domain';
import { detectPii, hasHighConfidencePii } from '@class-pulse/ai/pii';
import type { Actor, AppContext } from '../context';
import { badRequest, forbidden, notFound } from '../context';
import { cases, insufficientDataNotes, intakes, planDrafts, plans, safetyFlags } from '../db/schema';
import { audit } from './audit';
import { denyNamesForCase, openCaseForStudent } from './roster';

export function roleForCase(actor: Actor, caseKey: string): Role | 'administrator_authorized' {
  const role = actor.scope.caseRoles.get(caseKey);
  if (!role) throw forbidden('Case is outside your scope');
  return role;
}

export function requireTeacherLike(actor: Actor, caseKey: string): Role | 'administrator_authorized' {
  const role = roleForCase(actor, caseKey);
  if (role !== 'teacher' && role !== 'support_professional') throw forbidden('This action requires a teacher or support professional role on the case');
  return role;
}

/**
 * Intake: create (or reuse) a case for the student, store the 7 fields, and enqueue async
 * generation (docs/05: never synchronous). PII is checked here against the roster before the
 * gate ever sees it, so the teacher gets an inline fix rather than a dead end.
 */
export async function submitIntake(ctx: AppContext, actor: Actor, input: { studentId?: string; caseKey?: string; fields: unknown }) {
  const fields = IntakeFields.parse(input.fields);
  let caseKey = input.caseKey ?? null;
  if (!caseKey) {
    if (!input.studentId) throw badRequest('studentId or caseKey is required');
    caseKey = (await openCaseForStudent(ctx.db, actor, input.studentId)).caseKey;
  }
  requireTeacherLike(actor, caseKey);

  const denyNames = await denyNamesForCase(ctx.db, caseKey);
  const spans = Object.entries(fields).flatMap(([field, text]) => detectPii(String(text), { denyNames }).map((s) => ({ ...s, field })));
  if (hasHighConfidencePii(spans)) {
    throw badRequest('Intake contains identifying information. Remove it — Class Pulse works without it.', { spans: spans.filter((s) => s.confidence === 'high') });
  }

  const [latest] = await ctx.db.select().from(intakes).where(eq(intakes.caseKey, caseKey)).orderBy(desc(intakes.version)).limit(1);
  const intakeId = newId();
  const draftId = newId();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(intakes).values({ id: intakeId, caseKey: caseKey!, version: (latest?.version ?? 0) + 1, fields, createdBy: actor.userId });
    await tx.insert(planDrafts).values({ id: draftId, caseKey: caseKey!, intakeId, status: 'queued', createdBy: actor.userId });
  });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: roleForCase(actor, caseKey), action: 'intake.create', targetType: 'intake', targetId: intakeId, caseKey });
  await ctx.queue.enqueue('generate_plan', { draftId, caseKey });
  return { caseKey, intakeId, draftId, piiWarnings: spans.filter((s) => s.confidence !== 'high') };
}

export async function listCasesForActor(ctx: AppContext, actor: Actor) {
  const keys = [...actor.scope.caseRoles.keys()];
  if (!keys.length) return [];
  const rows = await ctx.db.select().from(cases).where(inArray(cases.caseKey, keys));
  const activePlans = await ctx.db.select({ caseKey: plans.caseKey, status: plans.status, id: plans.id, updatedAt: plans.updatedAt }).from(plans).where(inArray(plans.caseKey, keys));
  const drafts = await ctx.db.select({ caseKey: planDrafts.caseKey, status: planDrafts.status, id: planDrafts.id }).from(planDrafts).where(inArray(planDrafts.caseKey, keys));
  return rows.map((c) => {
    const plan = activePlans.filter((p) => p.caseKey === c.caseKey).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    const draft = drafts.filter((d) => d.caseKey === c.caseKey).at(-1) ?? null;
    return { caseKey: c.caseKey, gradeLevel: c.gradeLevel, status: c.status, sectionId: c.sectionId, role: actor.scope.caseRoles.get(c.caseKey)!, plan, latestDraft: draft, createdAt: c.createdAt };
  });
}

export async function getCase(ctx: AppContext, caseKey: string) {
  const [c] = await ctx.db.select().from(cases).where(eq(cases.caseKey, caseKey)).limit(1);
  if (!c) throw notFound('Case not found');
  return c;
}

export async function latestIntake(ctx: AppContext, caseKey: string) {
  const [row] = await ctx.db.select().from(intakes).where(eq(intakes.caseKey, caseKey)).orderBy(desc(intakes.version)).limit(1);
  return row ?? null;
}

/** Teacher-only data-quality panel: what each rule still needs (docs/02 sufficiency gate). */
export async function dataQuality(ctx: AppContext, actor: Actor, caseKey: string) {
  requireTeacherLike(actor, caseKey);
  const notes = await ctx.db.select().from(insufficientDataNotes).where(eq(insufficientDataNotes.caseKey, caseKey)).orderBy(desc(insufficientDataNotes.at));
  const latestByDef = new Map<string, (typeof notes)[number]>();
  for (const n of notes) if (!latestByDef.has(n.definitionId)) latestByDef.set(n.definitionId, n);
  return [...latestByDef.values()];
}

export async function listSafetyFlags(ctx: AppContext, caseKey: string) {
  return ctx.db.select().from(safetyFlags).where(eq(safetyFlags.caseKey, caseKey)).orderBy(desc(safetyFlags.createdAt));
}

export async function acknowledgeSafetyFlag(ctx: AppContext, actor: Actor, caseKey: string, id: string) {
  requireTeacherLike(actor, caseKey);
  await ctx.db.update(safetyFlags).set({ status: 'acknowledged', acknowledgedBy: actor.userId }).where(and(eq(safetyFlags.id, id), eq(safetyFlags.caseKey, caseKey)));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: roleForCase(actor, caseKey), action: 'safety.flag', targetType: 'safety_flag', targetId: id, caseKey, metadata: { acknowledged: true } });
}

export async function raiseSafetyFlag(ctx: AppContext, actor: Actor, caseKey: string, description: string) {
  roleForCase(actor, caseKey);
  const id = newId();
  await ctx.db.insert(safetyFlags).values({ id, caseKey, source: actor.roles.has('student') ? 'student_self_check' : 'teacher', description, status: 'open' });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: roleForCase(actor, caseKey), action: 'safety.flag', targetType: 'safety_flag', targetId: id, caseKey });
  return id;
}
