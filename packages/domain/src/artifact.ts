import { z } from 'zod';
import { ClassroomObservation } from './classroom';

export const ARTIFACT_KINDS = ['abc', 'positive_note', 'parent_message', 'do_now', 'reteach', 'small_group', 'sst_report', 'mtss_report', 'fba_observations', 'guide_explain', 'guide_adjust', 'guide_next_step', 'support_recommendation'] as const;
export const ArtifactKind = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKind>;
const short = z.string().trim().min(1).max(500);
const prose = z.string().trim().min(1).max(6000);
const sources = z.array(z.number().int().min(1)).min(1).max(100);
export const AbcArtifact = z.object({ kind: z.literal('abc'), title: short, sourceNumbers: sources, antecedent: z.string().max(2000).nullable(), behavior: short, consequence: z.string().max(2000).nullable(), measuredCount: z.number().int().nonnegative().nullable(), limitations: prose }).strict();
export const PositiveArtifact = z.object({ kind: z.literal('positive_note'), title: short, sourceNumbers: sources, message: prose }).strict();
export const ParentArtifact = z.object({ kind: z.literal('parent_message'), title: short, sourceNumbers: sources, message: prose, invitationToRespond: short }).strict();
const activity = { title: short, sourceNumbers: sources, objective: short, instructions: z.array(short).min(1).max(12), checkForUnderstanding: short, limitations: prose };
export const DoNowArtifact = z.object({ kind: z.literal('do_now'), ...activity }).strict();
export const ReteachArtifact = z.object({ kind: z.literal('reteach'), ...activity }).strict();
export const SmallGroupArtifact = z.object({ kind: z.literal('small_group'), ...activity, rationale: prose }).strict();
const report = { title: short, sourceNumbers: sources, purpose: short, observations: z.array(z.string().max(12000)).min(1).max(100), questionsForTeam: z.array(short).min(1).max(10), limitations: prose };
export const SstArtifact = z.object({ kind: z.literal('sst_report'), ...report }).strict();
export const MtssArtifact = z.object({ kind: z.literal('mtss_report'), ...report }).strict();
export const FbaArtifact = z.object({ kind: z.literal('fba_observations'), ...report }).strict();
const guide = { title: short, sourceNumbers: sources, evidenceSummary: z.array(z.string().max(12000)).min(1).max(100), proposedNextStep: prose, limitations: prose };
export const GuideExplainArtifact = z.object({ kind: z.literal('guide_explain'), ...guide }).strict();
export const GuideAdjustArtifact = z.object({ kind: z.literal('guide_adjust'), ...guide }).strict();
export const GuideNextArtifact = z.object({ kind: z.literal('guide_next_step'), ...guide }).strict();
/** Low-intensity classroom options for the teacher to consider, and how to let the student choose among them. */
export const SupportRecommendationArtifact = z.object({ kind: z.literal('support_recommendation'), title: short, sourceNumbers: sources, evidenceSummary: guide.evidenceSummary, options: z.array(short).min(2).max(4), involveStudent: short, limitations: prose }).strict();
export const ArtifactContent = z.discriminatedUnion('kind', [AbcArtifact, PositiveArtifact, ParentArtifact, DoNowArtifact, ReteachArtifact, SmallGroupArtifact, SstArtifact, MtssArtifact, FbaArtifact, GuideExplainArtifact, GuideAdjustArtifact, GuideNextArtifact, SupportRecommendationArtifact]);
export type ArtifactContent = z.infer<typeof ArtifactContent>;
export const ARTIFACT_SCHEMAS = { abc: AbcArtifact, positive_note: PositiveArtifact, parent_message: ParentArtifact, do_now: DoNowArtifact, reteach: ReteachArtifact, small_group: SmallGroupArtifact, sst_report: SstArtifact, mtss_report: MtssArtifact, fba_observations: FbaArtifact, guide_explain: GuideExplainArtifact, guide_adjust: GuideAdjustArtifact, guide_next_step: GuideNextArtifact, support_recommendation: SupportRecommendationArtifact };
/** Lossless observation text for evidence packets; null is explicitly different from zero. */
export function classroomEvidenceText(observation: z.infer<typeof ClassroomObservation>): string {
  return Object.entries(observation).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}: ${value === null ? 'Not recorded' : value === '' ? 'Not recorded' : String(value)}`).join('; ');
}
export const ArtifactPayload = z.object({
  kind: ArtifactKind, topic: z.string().max(500), objective: z.string().max(1000),
  // Numbers are ephemeral per-request references, never persistent learner/event identifiers.
  evidence: z.array(z.object({ number: z.number().int().positive(), observation: ClassroomObservation })).min(1).max(100),
});
export type ArtifactPayload = z.infer<typeof ArtifactPayload>;
export const ArtifactSource = z.object({ eventId: z.string().uuid(), revision: z.number().int().positive() }).strict();
export type ArtifactSource = z.infer<typeof ArtifactSource>;
export const RequestArtifact = z.object({ sessionId: z.string().uuid(), kind: ArtifactKind, sources: z.array(ArtifactSource).min(1).max(100) }).strict().superRefine((v, ctx) => {
  if (new Set(v.sources.map((s) => s.eventId)).size !== v.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence source' });
});
export type RequestArtifact = z.infer<typeof RequestArtifact>;
