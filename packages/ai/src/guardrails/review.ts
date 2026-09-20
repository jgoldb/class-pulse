import { vagueTermsIn, type ComputedRecommendation, type GuardrailFinding, type ReviewNarrative } from '@class-pulse/domain';
import { containsCausal, DIAGNOSTIC_TERMS, findTerms, STIGMATIZING_TERMS, strings } from './lexicon';

/**
 * The narrative explains a computed decision; it never changes it (docs/03 §Section 14,
 * docs/05 "Review-cycle engine").
 */
export function checkNarrativeDeterministic(narrative: ReviewNarrative, computed: ComputedRecommendation): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  if (narrative.decision !== computed.decision) {
    findings.push({
      check: 'decision_mismatch',
      severity: 'reject',
      path: 'decision',
      message: `Narrative decision "${narrative.decision}" differs from the computed decision "${computed.decision}".`,
    });
  }
  for (const { path, text } of strings(narrative)) {
    const diag = findTerms(text, DIAGNOSTIC_TERMS);
    if (diag.length) findings.push({ check: 'diagnostic_vocabulary', severity: 'reject', path, message: `Diagnostic/disability vocabulary: ${diag.map((d) => d.trim()).join(', ')}.` });
    const stig = findTerms(text, STIGMATIZING_TERMS);
    if (stig.length) findings.push({ check: 'stigmatizing_language', severity: 'reject', path, message: `Negative label: ${stig.join(', ')}.` });
    const causal = containsCausal(text);
    if (causal.length && path.startsWith('summary')) {
      findings.push({ check: 'causal_language', severity: 'flag', path, message: `Causal language in a summary (${causal.join(', ')}).` });
    }
    const vague = vagueTermsIn(text);
    if (vague.length) findings.push({ check: 'vague_term', severity: 'flag', path, message: `Vague term(s): ${vague.join(', ')}.` });
  }
  return findings;
}
