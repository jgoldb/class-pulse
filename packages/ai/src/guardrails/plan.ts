import { REQUIRED_NONEMPTY_SECTIONS, targetWithoutBaseline, vagueTermsIn, type GuardrailFinding, type PlanContent } from '@class-pulse/domain';
import { containsCausal, DETERMINATION_TERMS, DIAGNOSTIC_TERMS, findTerms, STIGMATIZING_TERMS, strings } from './lexicon';

/** Sections where diagnostic vocabulary may legitimately appear as a *caution* ("do not infer a disability"). */
const META_SECTIONS = new Set(['privacyAndHumanReviewNotes', 'missingInformation', 'informationNotToDisplay']);

/** A baseline needs at least this many behavior-specific counts on separate occasions to support a target. */
export const MIN_BASELINE_OBSERVATIONS = 3;

/**
 * Deterministic plan checks (docs/03 table). Fast, free, no false humility.
 *
 * | Check                                                          | Severity |
 * | numeric target while baseline.status !== 'available'           | reject   |
 * | vague terms in a goal's observable definition                  | flag     |
 * | diagnostic / disability vocabulary anywhere                    | reject   |
 * | required sections missing or empty                             | reject   |
 * | causal verbs inside a hypothesis                               | reject   |
 * | determination language in strategies                          | reject   |
 * | stigmatizing labels                                            | reject   |
 * | monitoring workload over ~15 min/day                           | flag     |
 */
export function checkPlanDeterministic(plan: PlanContent): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];

  for (const key of REQUIRED_NONEMPTY_SECTIONS) {
    const v = plan[key];
    const empty = v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
    if (empty) findings.push({ check: 'required_section', severity: 'reject', path: key, message: `Section "${key}" is missing or empty.` });
  }

  for (const key of ['studentStrengths', 'documentedPatterns'] as const) {
    if (plan[key].length === 0) {
      const asks = plan.missingInformation.some((m) => new RegExp(key === 'studentStrengths' ? 'strength|interest' : 'pattern|situation|when|setting', 'i').test(m));
      findings.push({
        check: 'empty_optional_section',
        severity: asks ? 'flag' : 'reject',
        path: key,
        message: asks ? `No ${key === 'studentStrengths' ? 'strengths' : 'documented patterns'} in the input; the draft asks for them under missing information.` : `"${key}" is empty and missingInformation does not ask for it.`,
      });
    }
  }

  plan.measurableGoals.forEach((g, i) => {
    if (g.baseline.status === 'available' && g.baseline.observations < MIN_BASELINE_OBSERVATIONS && g.target.status !== 'blocked_on_baseline') {
      findings.push({
        check: 'baseline_too_thin',
        severity: 'reject',
        path: `measurableGoals.${i}.baseline`,
        message: `Goal ${i + 1} treats ${g.baseline.observations} observation(s) as an available baseline and sets a target. A baseline needs at least ${MIN_BASELINE_OBSERVATIONS} behavior-specific counts on separate occasions.`,
      });
    }
    if (targetWithoutBaseline(g.baseline, g.target)) {
      findings.push({
        check: 'target_without_baseline',
        severity: 'reject',
        path: `measurableGoals.${i}.target`,
        message: `Goal ${i + 1} has a numeric target (${g.target.status}) while its baseline is "${g.baseline.status}". A target requires a behavior-specific baseline.`,
      });
    }
    if (g.target.status === 'established') {
      findings.push({
        check: 'target_established_by_model',
        severity: 'reject',
        path: `measurableGoals.${i}.target.status`,
        message: `Goal ${i + 1} presents a target as established; the model may only propose.`,
      });
    }
    for (const field of ['observableDefinition', 'targetBehavior'] as const) {
      const vague = vagueTermsIn(g[field]);
      if (vague.length) {
        findings.push({
          check: 'vague_term',
          severity: 'flag',
          path: `measurableGoals.${i}.${field}`,
          message: `Goal ${i + 1} uses vague term(s): ${vague.join(', ')}. Replace with an observable definition.`,
        });
      }
    }
  });

  plan.hypothesesToMonitor.forEach((h, i) => {
    const causal = containsCausal(h.hypothesis);
    if (causal.length) {
      findings.push({
        check: 'causal_language_in_hypothesis',
        severity: 'reject',
        path: `hypothesesToMonitor.${i}.hypothesis`,
        message: `Hypothesis ${i + 1} uses causal language (${causal.join(', ')}).`,
      });
    }
  });

  for (const { path, text } of strings(plan)) {
    const section = path.split('.')[0] ?? '';
    const meta = META_SECTIONS.has(section);
    const diag = findTerms(text, DIAGNOSTIC_TERMS);
    if (diag.length) {
      findings.push({
        check: 'diagnostic_vocabulary',
        severity: meta ? 'flag' : 'reject',
        path,
        message: `Diagnostic/disability vocabulary: ${diag.map((d) => d.trim()).join(', ')}.`,
      });
    }
    const stig = findTerms(text, STIGMATIZING_TERMS);
    if (stig.length) {
      findings.push({ check: 'stigmatizing_language', severity: 'reject', path, message: `Negative label: ${stig.join(', ')}.` });
    }
    if (/Strateg|replacementBehaviors|teacherResponse|preventive/.test(section)) {
      const det = findTerms(text, DETERMINATION_TERMS);
      if (det.length) {
        findings.push({ check: 'determination_language', severity: 'reject', path, message: `Implies a determination reserved for a team or formal process: ${det.join(', ')}.` });
      }
    }
  }

  const minutes = plan.progressMonitoring.reduce((s, m) => s + (m.estimatedMinutesPerDay || 0), 0);
  if (minutes > 15) {
    findings.push({ check: 'monitoring_workload', severity: 'flag', path: 'progressMonitoring', message: `Monitoring plan totals ~${minutes} min/day; target is under 15.` });
  }

  return findings;
}
