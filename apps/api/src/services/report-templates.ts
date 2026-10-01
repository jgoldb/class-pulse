import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { newId, type ArtifactKind } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, forbidden } from '../context';
import type { Db } from '../db/client';
import { classSections, reportTemplateValidations, schools, users } from '../db/schema';
import { audit } from './audit';

/** Report and documentation templates that need educator validation before pilot use. */
export const TEMPLATE_KINDS = ['abc', 'sst_report', 'mtss_report', 'fba_observations', 'support_recommendation'] as const satisfies readonly ArtifactKind[];
const VALIDATOR_ROLES = ['support_professional', 'administrator'] as const;

function validatorSchools(actor: Actor) {
  return new Set(actor.assignments.filter((a) => (VALIDATOR_ROLES as readonly string[]).includes(a.role) && a.schoolId).map((a) => a.schoolId!));
}
async function visibleSchools(ctx: AppContext, actor: Actor) {
  const ids = new Set(validatorSchools(actor));
  const sections = [...actor.scope.teacherSectionIds];
  if (sections.length) for (const s of await ctx.db.select({ schoolId: classSections.schoolId }).from(classSections).where(inArray(classSections.id, sections))) ids.add(s.schoolId);
  return [...ids];
}

/** The current (unrevoked) validation for a school and template, if any. */
export async function templateValidation(db: Db, schoolId: string, kind: ArtifactKind) {
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) return null;
  const [row] = await db.select({ validatedAt: reportTemplateValidations.validatedAt, notes: reportTemplateValidations.notes, role: reportTemplateValidations.validatorRole, name: users.displayName }).from(reportTemplateValidations)
    .innerJoin(users, eq(users.id, reportTemplateValidations.validatedBy))
    .where(and(eq(reportTemplateValidations.schoolId, schoolId), eq(reportTemplateValidations.kind, kind), isNull(reportTemplateValidations.revokedAt))).orderBy(desc(reportTemplateValidations.validatedAt)).limit(1);
  return row ?? null;
}

export async function listReportTemplates(ctx: AppContext, actor: Actor) {
  const ids = await visibleSchools(ctx, actor);
  if (!ids.length) return [];
  const can = validatorSchools(actor);
  const rows = await ctx.db.select({ id: schools.id, name: schools.name }).from(schools).where(inArray(schools.id, ids));
  const result = [];
  for (const school of rows) {
    const templates = [];
    for (const kind of TEMPLATE_KINDS) templates.push({ kind, validation: await templateValidation(ctx.db, school.id, kind) });
    result.push({ schoolId: school.id, schoolName: school.name, canValidate: can.has(school.id), templates });
  }
  return result;
}

export async function setTemplateValidation(ctx: AppContext, actor: Actor, input: { schoolId: string; kind: ArtifactKind; validated: boolean; notes: string }) {
  if (!(TEMPLATE_KINDS as readonly string[]).includes(input.kind)) throw badRequest('This draft type has no template to validate');
  const role = actor.assignments.find((a) => (VALIDATOR_ROLES as readonly string[]).includes(a.role) && a.schoolId === input.schoolId)?.role;
  if (!role) throw forbidden('Only a support professional or administrator at this school can validate report templates');
  await ctx.db.transaction(async (tx) => {
    await tx.update(reportTemplateValidations).set({ revokedAt: ctx.now() }).where(and(eq(reportTemplateValidations.schoolId, input.schoolId), eq(reportTemplateValidations.kind, input.kind), isNull(reportTemplateValidations.revokedAt)));
    if (input.validated) await tx.insert(reportTemplateValidations).values({ id: newId(), schoolId: input.schoolId, kind: input.kind, validatedBy: actor.userId, validatorRole: role, notes: input.notes, validatedAt: ctx.now() });
    await audit(tx, { actorUserId: actor.userId, actorRole: role as 'administrator', action: 'classroom.configure', targetType: 'report_template', targetId: `${input.schoolId}:${input.kind}`, metadata: { validated: input.validated } });
  });
  return { validation: await templateValidation(ctx.db, input.schoolId, input.kind) };
}
