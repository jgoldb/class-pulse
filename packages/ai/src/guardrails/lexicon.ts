/**
 * Shared vocabulary for deterministic guardrails (docs/03, docs/02). Kept as data so a reviewer
 * without engineering background can read and extend it.
 */

/** Causal verbs forbidden inside a hypothesis field. */
export const CAUSAL_PHRASES = [
  'because',
  'due to',
  'caused by',
  'causes',
  'as a result of',
  'leads to',
  'results in',
  'stems from',
  'the reason is',
  'the reason for',
  'owing to',
  'is why',
] as const;

/**
 * Diagnostic, disability, medical or placement vocabulary. Rejected anywhere in a draft.
 * Terms match as whole words; a trailing `*` marks a prefix ("diagnos*" matches diagnosis,
 * diagnosed, diagnostic).
 */
export const DIAGNOSTIC_TERMS = [
  'adhd',
  'autism',
  'autistic',
  'asd',
  'on the spectrum',
  'oppositional defiant',
  'conduct disorder',
  'anxiety disorder',
  'depression',
  'depressed',
  'bipolar',
  'dyslexia',
  'dyslexic',
  'dyscalculia',
  'dysgraphia',
  'processing disorder',
  'learning disability',
  'learning disabled',
  'intellectual disability',
  'emotionally disturbed',
  'emotional disturbance',
  'ptsd',
  'ocd',
  'trauma*',
  'diagnos*',
  'disorder*',
  'medicat*',
  'prescri*',
  'disability',
  'disabilities',
  'disabled',
  'sensory processing',
  'special education eligibility',
  'eligible for special education',
  'needs an iep',
  'qualify for an iep',
  'needs a 504',
] as const;

/** Language implying a determination reserved for a team or formal process. */
export const DETERMINATION_TERMS = [
  'placement',
  'eligibility',
  'refer for evaluation',
  'referral for evaluation',
  'psychological evaluation',
  'psychoeducational',
  'suspend',
  'suspension',
  'expel',
  'expulsion',
  'detention',
  'retain the student',
  'retention in grade',
  'remove from the class',
  'removal from class',
  'alternative school',
  'self-contained',
  'restrictive setting',
] as const;

/** Negative labels the source prompt forbids. */
export const STIGMATIZING_TERMS = [
  'lazy',
  'defiant',
  'manipulative',
  'bad kid',
  'troublemaker',
  'problem child',
  'attention-seeking',
  'attention seeking',
  'naughty',
  'unmotivated',
  'won\'t behave',
  'refuses to behave',
] as const;

const TERM_CACHE = new Map<string, RegExp>();

function termRegex(term: string): RegExp {
  let re = TERM_CACHE.get(term);
  if (!re) {
    const prefix = term.endsWith('*');
    const body = (prefix ? term.slice(0, -1) : term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    re = new RegExp(`(^|[^a-z0-9])${body}${prefix ? '' : '(?=$|[^a-z0-9])'}`, 'i');
    TERM_CACHE.set(term, re);
  }
  return re;
}

/** Whole-word (or `*`-prefix) matching, case-insensitive. */
export function findTerms(text: string, terms: ReadonlyArray<string>): string[] {
  return terms.filter((t) => termRegex(t).test(text)).map((t) => t.replace(/\*$/, ''));
}

export function containsCausal(text: string): string[] {
  return findTerms(text, CAUSAL_PHRASES);
}

/** Walk any JSON value and yield every string with its path. */
export function* strings(value: unknown, path = ''): Generator<{ path: string; text: string }> {
  if (typeof value === 'string') {
    yield { path, text: value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], path ? `${path}.${i}` : String(i));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
  }
}
