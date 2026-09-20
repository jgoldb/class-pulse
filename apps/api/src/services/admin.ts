import { and, eq, inArray } from 'drizzle-orm';
import { PATTERN_CATALOG } from '@class-pulse/patterns';
import { disproportionalityIndex, publishable, suppressCells } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { forbidden } from '../context';
import { caseLinks, cases, definitionStatus, generationRuns, patternCandidates, planDrafts, plans, reviewCycles, signals, students } from '../db/schema';
import { listAudit } from './audit';

function requireAdmin(actor: Actor): string[] {
  if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
  return [...actor.scope.adminSchoolIds];
}

/**
 * Administrative views (docs/04 "Aggregation safety", docs/06 Phase 7): aggregate by default,
 * minimum cell size with complementary suppression, no individual rows.
 */
export async function trends(ctx: AppContext, actor: Actor) {
  const schoolIds = requireAdmin(actor);
  const min = ctx.config.adminMinCellSize;
  const allCases = schoolIds.length ? await ctx.db.select().from(cases).where(inArray(cases.schoolId, schoolIds)) : [];
  const keys = allCases.map((c) => c.caseKey);
  const allPlans = keys.length ? await ctx.db.select().from(plans).where(inArray(plans.caseKey, keys)) : [];
  const cycles = keys.length ? await ctx.db.select().from(reviewCycles).where(inArray(reviewCycles.caseKey, keys)) : [];
  const drafts = keys.length ? await ctx.db.select().from(planDrafts).where(inArray(planDrafts.caseKey, keys)) : [];
  const runs = await ctx.db.select().from(generationRuns);

  const byGrade = new Map<string, number>();
  for (const c of allCases) byGrade.set(c.gradeLevel, (byGrade.get(c.gradeLevel) ?? 0) + 1);
  const planStatus = new Map<string, number>();
  for (const p of allPlans) planStatus.set(p.status, (planStatus.get(p.status) ?? 0) + 1);
  const decisions = new Map<string, number>();
  for (const c of cycles) if (c.decision) decisions.set(c.decision, (decisions.get(c.decision) ?? 0) + 1);

  // Intervention effectiveness: share of decided review cycles whose computed trend was improving on at least one goal.
  const decided = cycles.filter((c) => c.status === 'decided' && c.computed);
  const improving = decided.filter((c) => (c.computed as { goalSummaries: Array<{ trend: string }> }).goalSummaries.some((g) => g.trend === 'improving')).length;

  return {
    minCellSize: min,
    activeCases: publishable(allCases.length, min) ? allCases.length : null,
    casesByGrade: suppressCells([...byGrade.entries()].map(([key, count]) => ({ key: `grade ${key}`, count })), min),
    plansByStatus: suppressCells([...planStatus.entries()].map(([key, count]) => ({ key, count })), min),
    reviewDecisions: suppressCells([...decisions.entries()].map(([key, count]) => ({ key, count })), min),
    interventionEffectiveness: publishable(decided.length, min) ? { decidedCycles: decided.length, improvingShare: decided.length ? Math.round((improving / decided.length) * 100) / 100 : null } : { decidedCycles: null, improvingShare: null },
    generation: {
      total: runs.length,
      failureRate: runs.length ? Math.round((runs.filter((r) => r.status === 'failed' || r.status === 'blocked_pii').length / runs.length) * 1000) / 1000 : null,
      rejectionRate: runs.length ? Math.round((runs.filter((r) => r.status === 'rejected').length / runs.length) * 1000) / 1000 : null,
      medianLatencyMs: median(runs.map((r) => r.latencyMs).filter((x): x is number => x !== null)),
      draftsNeedingAttention: drafts.filter((d) => d.status === 'needs_attention').length,
    },
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

/** Pattern catalog health (docs/02 tuning loop): fire rate, confirmation rate, dismissal reasons, time to adjudication. */
export async function catalogHealth(ctx: AppContext, actor: Actor) {
  const schoolIds = requireAdmin(actor);
  const min = ctx.config.adminMinCellSize;
  const allCases = schoolIds.length ? await ctx.db.select().from(cases).where(inArray(cases.schoolId, schoolIds)) : [];
  const keys = allCases.map((c) => c.caseKey);
  const cands = keys.length ? await ctx.db.select().from(patternCandidates).where(inArray(patternCandidates.caseKey, keys)) : [];
  const overrides = new Map((await ctx.db.select().from(definitionStatus)).map((r) => [r.definitionId, r]));
  return PATTERN_CATALOG.map((d) => {
    const mine = cands.filter((c) => c.definitionId === d.id);
    const adjudicated = mine.filter((c) => ['confirmed', 'dismissed'].includes(c.status));
    const confirmed = adjudicated.filter((c) => c.status === 'confirmed').length;
    const reasons = new Map<string, number>();
    for (const c of mine) if (c.dismissalReason) reasons.set(c.dismissalReason, (reasons.get(c.dismissalReason) ?? 0) + 1);
    const ttaDays = mine.filter((c) => c.adjudicatedAt).map((c) => (c.adjudicatedAt!.getTime() - c.detectedAt.getTime()) / 86_400_000);
    const override = overrides.get(d.id);
    return {
      id: d.id,
      version: d.version,
      title: d.title,
      plainLanguage: d.plainLanguage,
      routing: d.routing,
      status: override?.status ?? d.status,
      reviewer: override?.reviewer ?? d.reviewer,
      thresholds: d.thresholds,
      confounders: d.confounders,
      proxyReview: d.proxyReview,
      fired: mine.length,
      fireRatePerCase: allCases.length ? Math.round((mine.length / allCases.length) * 100) / 100 : null,
      adjudicated: adjudicated.length,
      confirmationRate: adjudicated.length ? Math.round((confirmed / adjudicated.length) * 100) / 100 : null,
      dismissalReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })),
      medianDaysToAdjudication: median(ttaDays) === null ? null : Math.round(median(ttaDays)! * 10) / 10,
      belowFloor: adjudicated.length >= min && confirmed / adjudicated.length < CONFIRMATION_FLOOR,
    };
  });
}

export const CONFIRMATION_FLOOR = 0.4;

/**
 * Equity monitoring (docs/02): firing and confirmation rates by demographic subgroup, aggregate
 * only, admin only, minimum cell sizes. This is the ONLY code path that touches demographics,
 * and it never returns a row below the cell size. Detection and interpretation cannot reach it.
 */
export async function equityMonitor(ctx: AppContext, actor: Actor) {
  const schoolIds = requireAdmin(actor);
  const min = ctx.config.adminMinCellSize;
  if (!schoolIds.length) return { minCellSize: min, attributes: [] };
  const pop = await ctx.db.select({ id: students.id, demographics: students.demographics }).from(students).where(inArray(students.schoolId, schoolIds));
  const links = pop.length ? await ctx.db.select().from(caseLinks).where(inArray(caseLinks.studentId, pop.map((p) => p.id))) : [];
  const keys = links.map((l) => l.caseKey);
  const cands = keys.length ? await ctx.db.select({ caseKey: patternCandidates.caseKey, definitionId: patternCandidates.definitionId, status: patternCandidates.status }).from(patternCandidates).where(and(inArray(patternCandidates.caseKey, keys), eq(patternCandidates.visible, true))) : [];
  const caseToStudent = new Map(links.map((l) => [l.caseKey, l.studentId]));
  const firedStudents = new Set(cands.map((c) => caseToStudent.get(c.caseKey)!));
  const confirmedStudents = new Set(cands.filter((c) => c.status === 'confirmed').map((c) => caseToStudent.get(c.caseKey)!));
  const overall = { fired: firedStudents.size, population: pop.length };

  const attributes = new Map<string, Map<string, { population: number; fired: number; confirmed: number }>>();
  for (const s of pop) {
    for (const [attr, value] of Object.entries(s.demographics ?? {})) {
      if (!attributes.has(attr)) attributes.set(attr, new Map());
      const groups = attributes.get(attr)!;
      const g = groups.get(value) ?? { population: 0, fired: 0, confirmed: 0 };
      g.population++;
      if (firedStudents.has(s.id)) g.fired++;
      if (confirmedStudents.has(s.id)) g.confirmed++;
      groups.set(value, g);
    }
  }
  return {
    minCellSize: min,
    overallFireRate: publishable(pop.length, min) && pop.length ? Math.round((overall.fired / overall.population) * 100) / 100 : null,
    attributes: [...attributes.entries()].map(([attribute, groups]) => ({
      attribute,
      groups: [...groups.entries()].map(([value, g]) => {
        const ok = g.population >= min;
        const di = disproportionalityIndex({ fired: g.fired, population: g.population }, overall, min);
        return {
          value,
          population: ok ? g.population : null,
          fireRate: ok ? Math.round((g.fired / g.population) * 100) / 100 : null,
          confirmationRate: ok && g.fired >= min ? Math.round((g.confirmed / g.fired) * 100) / 100 : null,
          disproportionalityIndex: di === null ? null : Math.round(di * 100) / 100,
          alert: di !== null && (di >= DISPROPORTIONALITY_ALERT || di <= 1 / DISPROPORTIONALITY_ALERT),
          suppressed: !ok,
        };
      }),
    })),
  };
}

export const DISPROPORTIONALITY_ALERT = 1.5;

/** Prompt-tuning input (docs/03 feedback loop): where educators rewrite the draft, by section. */
export async function draftDiffAggregate(ctx: AppContext, actor: Actor) {
  const schoolIds = requireAdmin(actor);
  const allCases = schoolIds.length ? await ctx.db.select({ caseKey: cases.caseKey }).from(cases).where(inArray(cases.schoolId, schoolIds)) : [];
  const keys = allCases.map((c) => c.caseKey);
  const rows = keys.length ? await ctx.db.select({ diff: plans.draftDiff, promptVersionId: plans.promptVersionId }).from(plans).where(inArray(plans.caseKey, keys)) : [];
  const totals: Record<string, { changed: number; added: number; removed: number; plans: number }> = {};
  for (const r of rows) {
    const by = (r.diff as { bySection?: Record<string, { changed: number; added: number; removed: number }> } | null)?.bySection ?? {};
    for (const [section, v] of Object.entries(by)) {
      totals[section] ??= { changed: 0, added: 0, removed: 0, plans: 0 };
      totals[section].changed += v.changed;
      totals[section].added += v.added;
      totals[section].removed += v.removed;
      totals[section].plans += 1;
    }
  }
  return { approvedPlans: rows.length, bySection: Object.entries(totals).map(([section, v]) => ({ section, ...v })).sort((a, b) => b.changed + b.added + b.removed - (a.changed + a.added + a.removed)) };
}

export async function auditViewer(ctx: AppContext, actor: Actor, filter: { studentId?: string; caseKey?: string; action?: string; limit?: number }) {
  requireAdmin(actor);
  return listAudit(ctx.db, { ...filter, action: filter.action as never });
}

export async function quickEntryHealth(ctx: AppContext, actor: Actor) {
  const schoolIds = requireAdmin(actor);
  const allCases = schoolIds.length ? await ctx.db.select({ caseKey: cases.caseKey }).from(cases).where(inArray(cases.schoolId, schoolIds)) : [];
  const keys = allCases.map((c) => c.caseKey);
  const rows = keys.length ? await ctx.db.select({ type: signals.type, source: signals.source, tags: signals.contextTags }).from(signals).where(inArray(signals.caseKey, keys)) : [];
  const teacher = rows.filter((r) => r.source === 'teacher_entry');
  return {
    teacherEntries: teacher.length,
    taggedShare: teacher.length ? Math.round((teacher.filter((r) => r.tags.length > 0).length / teacher.length) * 100) / 100 : null,
    byType: Object.entries(rows.reduce<Record<string, number>>((acc, r) => ((acc[r.type] = (acc[r.type] ?? 0) + 1), acc), {})).map(([type, count]) => ({ type, count })),
  };
}
