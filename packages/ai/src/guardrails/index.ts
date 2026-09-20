import type { GuardrailFinding, GuardrailResult } from '@class-pulse/domain';
import type { ClassifierOutput } from '../schema';

export { checkPlanDeterministic } from './plan';
export { checkProposalDeterministic } from './pattern';
export { checkNarrativeDeterministic } from './review';
export * from './lexicon';

/** Classifier thresholds (docs/03): high-confidence high scores reject; low confidence flags. */
export const CLASSIFIER_REJECT_SCORE = 0.7;
export const CLASSIFIER_FLAG_SCORE = 0.4;
export const CLASSIFIER_MIN_CONFIDENCE = 0.6;

export function classifierFindings(c: ClassifierOutput): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  const dims: Array<[keyof ClassifierOutput, string]> = [
    ['unsupportedCausalClaims', 'Unsupported causal claims'],
    ['hypothesesStatedAsFact', 'Hypotheses stated as fact'],
    ['stigmatizingLanguage', 'Stigmatizing language'],
    ['outsideEducationalScope', 'Content outside educational scope'],
  ];
  for (const [key, label] of dims) {
    const score = c[key] as number;
    if (score >= CLASSIFIER_REJECT_SCORE && c.confidence >= CLASSIFIER_MIN_CONFIDENCE) {
      out.push({ check: `classifier.${key}`, severity: 'reject', path: '', message: `${label} (score ${score.toFixed(2)}, confidence ${c.confidence.toFixed(2)}). ${c.notes}` });
    } else if (score >= CLASSIFIER_FLAG_SCORE) {
      out.push({ check: `classifier.${key}`, severity: 'flag', path: '', message: `${label} (score ${score.toFixed(2)}, confidence ${c.confidence.toFixed(2)}). ${c.notes}` });
    }
  }
  return out;
}

export function combine(deterministic: GuardrailFinding[], classifier: { model: string; output: ClassifierOutput } | null): GuardrailResult {
  const findings = [...deterministic, ...(classifier ? classifierFindings(classifier.output) : [])];
  return {
    passed: !findings.some((f) => f.severity === 'reject'),
    findings,
    classifier: classifier ? { model: classifier.model, ...classifier.output } : null,
  };
}
