import { ARTIFACT_SCHEMAS, ArtifactContent, ArtifactPayload, classroomEvidenceText, type PromptVersion } from '@class-pulse/domain';
import { z } from 'zod';
import type { EgressGate } from './egress/gate';
import { CAUSAL_PHRASES, DETERMINATION_TERMS, DIAGNOSTIC_TERMS, STIGMATIZING_TERMS, findTerms } from './guardrails/lexicon';
import { detectPii, hasHighConfidencePii } from './pii';
import { ClassifierOutput, ClassifierPayload } from './schema';

export function checkClassroomArtifact(payload: ArtifactPayload, content: ArtifactContent): string[] {
  const failures: string[] = [];
  if (content.kind !== payload.kind) failures.push('Wrong artifact kind');
  if (new Set(content.sourceNumbers).size !== content.sourceNumbers.length || content.sourceNumbers.some((n) => !payload.evidence.some((s) => s.number === n))) failures.push('Invalid source citation');
  const text = JSON.stringify(content);
  if (findTerms(text, [...DIAGNOSTIC_TERMS, ...STIGMATIZING_TERMS, ...DETERMINATION_TERMS, ...CAUSAL_PHRASES]).length) failures.push('Unsupported diagnostic, causal, stigmatizing or determination language');
  if (hasHighConfidencePii(detectPii(text))) failures.push('Identifying information in output');
  if (content.kind === 'abc') {
    const observation = payload.evidence.find((e) => e.number === content.sourceNumbers[0])?.observation;
    if (content.sourceNumbers.length !== 1 || observation?.kind !== 'behavior' || content.behavior !== observation.action || content.antecedent !== observation.antecedent || content.consequence !== observation.consequence || content.measuredCount !== observation.measuredCount) failures.push('ABC must preserve exactly one observed source, including missing values');
  }
  if ('observations' in content || 'evidenceSummary' in content) {
    const observed = 'observations' in content ? content.observations : content.evidenceSummary;
    const expected = payload.evidence.map((e) => classroomEvidenceText(e.observation));
    if (content.sourceNumbers.length !== payload.evidence.length || content.sourceNumbers.some((n, i) => n !== payload.evidence[i]?.number) || JSON.stringify(observed) !== JSON.stringify(expected)) failures.push('Evidence summaries must preserve all supplied observations exactly and in order');
  }
  if (content.kind === 'small_group' && (content.sourceNumbers.length !== payload.evidence.length || payload.evidence.some((e) => !['understanding', 'exit_ticket'].includes(e.observation.kind)))) failures.push('A proposed group must include exactly the selected instructional evidence');
  return failures;
}

export async function generateClassroomArtifact(gate: EgressGate, prompt: PromptVersion, classifier: PromptVersion, payload: ArtifactPayload, denyNames: string[]) {
  const parsed = ArtifactPayload.parse(payload);
  const generationPayload = { ...parsed, evidenceText: parsed.evidence.map((e) => classroomEvidenceText(e.observation)) };
  const generationSchema = ArtifactPayload.extend({ evidenceText: z.array(z.string().max(12000)).min(1).max(100) });
  const result = await gate.call<typeof generationPayload, ArtifactContent>({ retentionClass: 'classroom_pending', surface: 'classroom_draft', promptVersion: prompt, payloadSchema: generationSchema, payload: generationPayload, outputSchema: ARTIFACT_SCHEMAS[payload.kind], schemaName: `classroom_${payload.kind}`, denyNames });
  if (!result.ok) return { ok: false as const, error: result.reason === 'blocked_pii' ? 'Identifying information blocked generation' : result.error, runs: [result.run] };
  const failures = checkClassroomArtifact(payload, result.output);
  if (hasHighConfidencePii(detectPii(JSON.stringify(result.output), { denyNames }))) failures.push('Roster identity in output');
  if (failures.length) return { ok: false as const, error: failures.join('; '), runs: [result.run] };
  const checked = await gate.call({ retentionClass: 'classroom_pending', surface: 'guardrail_classifier', promptVersion: classifier, payloadSchema: ClassifierPayload, payload: { surface: 'classroom_draft', draft: JSON.stringify(result.output) }, outputSchema: ClassifierOutput, schemaName: 'classroom_guardrails', denyNames });
  if (!checked.ok) return { ok: false as const, error: 'Draft safety review failed; retry generation', runs: [result.run, checked.run] };
  const c = checked.output;
  if (c.unsupportedCausalClaims > 0.25 || c.hypothesesStatedAsFact > 0.25 || c.stigmatizingLanguage > 0.25 || c.outsideEducationalScope > 0.25 || c.confidence < 0.5) return { ok: false as const, error: 'Draft needs regeneration after safety review', runs: [result.run, checked.run] };
  return { ok: true as const, content: result.output, runs: [result.run, checked.run] };
}
