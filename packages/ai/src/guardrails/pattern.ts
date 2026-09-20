import type { GuardrailFinding, InterventionProposal, PatternRouting } from '@class-pulse/domain';
import { containsCausal, DETERMINATION_TERMS, DIAGNOSTIC_TERMS, findTerms, STIGMATIZING_TERMS, strings } from './lexicon';

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Loose match: the confounder text appears verbatim, or most of its content words appear. */
function addressed(confounder: string, entries: ReadonlyArray<{ confounder: string }>): boolean {
  const target = norm(confounder);
  const words = target.split(' ').filter((w) => w.length > 3);
  return entries.some((e) => {
    const got = norm(e.confounder);
    if (got === target || got.includes(target) || target.includes(got)) return true;
    const hits = words.filter((w) => got.includes(w)).length;
    return words.length > 0 && hits / words.length >= 0.6;
  });
}

/**
 * Deterministic checks for a pattern interpretation (docs/02 guardrails):
 *  - every listed confounder appears in alternativeExplanations (structural)
 *  - no causal verbs in `hypothesis`
 *  - no diagnostic / disability / medical / placement language anywhere
 *  - no intervention implying a determination reserved for a team or formal process
 *  - effortLevel 'high' requires workloadJustification
 *  - safety_escalation candidates get no intervention proposals at all
 */
export function checkProposalDeterministic(
  proposal: InterventionProposal,
  confounders: ReadonlyArray<string>,
  routing: PatternRouting,
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];

  confounders.forEach((c, i) => {
    if (!addressed(c, proposal.alternativeExplanations)) {
      findings.push({
        check: 'confounder_not_addressed',
        severity: 'reject',
        path: 'alternativeExplanations',
        message: `Confounder ${i + 1} not addressed: "${c}".`,
      });
    }
  });

  const causal = containsCausal(proposal.hypothesis);
  if (causal.length) {
    findings.push({ check: 'causal_language_in_hypothesis', severity: 'reject', path: 'hypothesis', message: `Hypothesis uses causal language (${causal.join(', ')}).` });
  }

  proposal.proposedInterventions.forEach((p, i) => {
    if (p.effortLevel === 'high' && !(p.workloadJustification && p.workloadJustification.trim().length > 10)) {
      findings.push({
        check: 'high_effort_unjustified',
        severity: 'reject',
        path: `proposedInterventions.${i}.workloadJustification`,
        message: `Intervention ${i + 1} is high effort without a workload justification.`,
      });
    }
    const det = findTerms(`${p.description} ${p.rationale}`, DETERMINATION_TERMS);
    if (det.length) {
      findings.push({
        check: 'determination_language',
        severity: 'reject',
        path: `proposedInterventions.${i}`,
        message: `Intervention ${i + 1} implies a determination reserved for a team or formal process: ${det.join(', ')}.`,
      });
    }
  });

  if (routing === 'safety_escalation' && proposal.proposedInterventions.length > 0) {
    findings.push({ check: 'safety_escalation_has_interventions', severity: 'reject', path: 'proposedInterventions', message: 'Safety-escalation candidates receive no intervention proposals.' });
  }

  for (const { path, text } of strings(proposal)) {
    const diag = findTerms(text, DIAGNOSTIC_TERMS);
    if (diag.length) findings.push({ check: 'diagnostic_vocabulary', severity: 'reject', path, message: `Diagnostic/disability vocabulary: ${diag.map((d) => d.trim()).join(', ')}.` });
    const stig = findTerms(text, STIGMATIZING_TERMS);
    if (stig.length) findings.push({ check: 'stigmatizing_language', severity: 'reject', path, message: `Negative label: ${stig.join(', ')}.` });
  }

  return findings;
}
