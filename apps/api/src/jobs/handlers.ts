import { eq } from 'drizzle-orm';
import { generatePlan } from '@class-pulse/ai';
import { newId, type IntakeFields } from '@class-pulse/domain';
import type { AppContext } from '../context';
import { intakes, planDrafts, safetyFlags } from '../db/schema';
import { recordRuns } from '../services/ai';
import { interpretCandidate, reevaluateNeedsMoreData, sweepAllCases, sweepOneCase } from '../services/patterns';
import { activePrompts } from '../services/prompts';
import { narrateCycle, openDueReviews } from '../services/reviews';
import { denyNamesForCase } from '../services/roster';
import type { JobEnvelope } from './queue';

/**
 * Generation service (docs/05): build the de-identified payload via the gate → call model →
 * validate → guardrails → persist the PlanDraft with full run metadata. Never inside a request.
 */
export async function runGeneratePlan(ctx: AppContext, draftId: string) {
  const [draft] = await ctx.db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (!draft || ['approved', 'discarded'].includes(draft.status)) return;
  const [intake] = await ctx.db.select().from(intakes).where(eq(intakes.id, draft.intakeId)).limit(1);
  if (!intake) return;
  await ctx.db.update(planDrafts).set({ status: 'running', updatedAt: ctx.now() }).where(eq(planDrafts.id, draftId));
  const prompts = await activePrompts(ctx.db);
  const result = await generatePlan({ gate: ctx.gate, prompts, caseKey: draft.caseKey, denyNames: await denyNamesForCase(ctx.db, draft.caseKey) }, { intake: intake.fields as IntakeFields });
  const runs = 'runs' in result ? result.runs : [];
  const now = ctx.now();
  switch (result.status) {
    case 'succeeded':
    case 'rejected': {
      await recordRuns(ctx.db, 'plan_generation', draft.caseKey, runs, result.status === 'succeeded' ? 'succeeded' : 'rejected');
      await ctx.db
        .update(planDrafts)
        .set({ content: result.output, guardrails: result.guardrails, status: result.status === 'succeeded' ? 'ready' : 'needs_attention', runId: runs.at(-1)?.runId ?? null, updatedAt: now })
        .where(eq(planDrafts.id, draftId));
      if (result.output.privacyAndHumanReviewNotes.safetyConcern) {
        await ctx.db.insert(safetyFlags).values({ id: newId(), caseKey: draft.caseKey, source: 'plan_generation', description: result.output.privacyAndHumanReviewNotes.safetyNote ?? 'Safety concern raised during plan generation', status: 'open' });
      }
      break;
    }
    case 'blocked_pii':
      await recordRuns(ctx.db, 'plan_generation', draft.caseKey, runs, 'blocked_pii', 'PII detected at the egress gate');
      await ctx.db.update(planDrafts).set({ status: 'blocked_pii', piiSpans: result.spans, error: 'Identifying information was detected at the egress gate; nothing was sent.', updatedAt: now }).where(eq(planDrafts.id, draftId));
      break;
    case 'failed':
      await recordRuns(ctx.db, 'plan_generation', draft.caseKey, runs, 'failed', result.error);
      await ctx.db.update(planDrafts).set({ status: 'failed', error: result.error, updatedAt: now }).where(eq(planDrafts.id, draftId));
      throw new Error(result.error);
  }
}

export function makeJobHandler(ctx: AppContext) {
  return async (job: JobEnvelope): Promise<void> => {
    ctx.log.info({ job: job.type, id: job.id, attempt: job.attempts }, 'job start');
    switch (job.type) {
      case 'generate_plan':
        await runGeneratePlan(ctx, String(job.payload.draftId));
        break;
      case 'interpret_candidate':
        await interpretCandidate(ctx, String(job.payload.candidateId));
        break;
      case 'narrate_review':
        await narrateCycle(ctx, String(job.payload.cycleId));
        break;
      case 'sweep_case':
        await reevaluateNeedsMoreData(ctx, String(job.payload.caseKey));
        await sweepOneCase(ctx, String(job.payload.caseKey));
        break;
      case 'sweep_all':
        await sweepAllCases(ctx);
        break;
      case 'open_due_reviews':
        await openDueReviews(ctx);
        break;
    }
  };
}
