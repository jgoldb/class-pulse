/**
 * PII detector (docs/04). Runs live in the intake form and the quick-entry field, and again as a
 * backstop inside the egress gate. Pure and dependency-free so the browser can run it too.
 *
 * Heuristic by design: it will over-flag occasionally ("This looks like a student name. Remove
 * it?") and the UI offers a one-tap fix. The roster denylist is the high-precision path: the API
 * supplies the names of students in the caller's own sections so those never leave the building.
 */
export type PiiKind = 'name' | 'student_id' | 'dob' | 'address' | 'email' | 'phone' | 'ssn';

export interface PiiSpan {
  kind: PiiKind;
  start: number;
  end: number;
  text: string;
  confidence: 'high' | 'medium';
  hint: string;
}

export interface DetectorOptions {
  /** Names of real people (roster). Matched as whole words, case-insensitive. */
  denyNames?: ReadonlyArray<string>;
  /** Extra capitalised words that are not names (school-specific vocabulary). */
  allowWords?: ReadonlyArray<string>;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const COMMON_CAPS = [
  'class', 'pulse', 'the', 'a', 'an', 'student', 'teacher', 'grade', 'period', 'math', 'science', 'english', 'history', 'reading',
  'writing', 'art', 'music', 'pe', 'ela', 'iep', 'llm', 'ai', 'during', 'when', 'after', 'before', 'independent', 'group', 'work',
  'i', 'he', 'she', 'they', 'it', 'we', 'this', 'that', 'these', 'those', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'with',
  'known', 'current', 'desired', 'observable', 'available', 'documented', 'behavior', 'behaviour', 'strategy', 'strategies',
  'baseline', 'frequency', 'information', 'strengths', 'interests', 'yes', 'no', 'none', 'not', 'unknown', 'approximately',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'spanish', 'french', 'chinese', 'american',
  'lego', 'minecraft', 'pokemon', 'google', 'chromebook', 'ipad', 'youtube', 'roblox', 'nintendo', 'xbox', 'playstation',
  'fortnite', 'zoom', 'kahoot', 'quizlet', 'canvas', 'schoology', 'seesaw', 'classroom', 'dojo', 'library', 'lunch', 'recess',
  'homework', 'assignment', 'assignments', 'test', 'quiz', 'exam', 'project', 'unit', 'chapter', 'lesson', 'note', 'notes',
  'october', 'september', 'august', 'november', 'december', 'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'adhd', 'ok', 'okay', 'please', 'thanks', 'also', 'however', 'sometimes', 'often', 'usually', 'always', 'never', 'most',
  'some', 'many', 'few', 'each', 'every', 'other', 'another', 'first', 'second', 'third', 'last', 'next', 'then', 'now',
  'today', 'yesterday', 'tomorrow', 'week', 'weeks', 'day', 'days', 'month', 'months', 'time', 'times', 'minutes', 'minute',
  'the', 'student\'s', 'teacher\'s', 'his', 'her', 'their', 'our', 'my', 'your', 'its', 'has', 'have', 'had', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
  'small', 'smaller', 'positive', 'verbal', 'reminders', 'technology', 'computer', 'science', 'social', 'studies', 'health',
  'physical', 'education', 'band', 'choir', 'orchestra', 'drama', 'theater', 'theatre', 'coding', 'robotics', 'stem', 'steam',
];

const HONORIFICS = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Coach|Principal|Nurse)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
const NAMED = /\b(?:named|name is|called|student|child|son|daughter|kid|boy|girl)\s+(?:is\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
const TWO_CAPS = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const STUDENT_ID_LABELED = /\b(?:student\s*id|id(?:\s*(?:number|no\.?|#))?|sid|osis|ssid|#)\s*[:#]?\s*([A-Z]{0,3}\d{5,12})\b/gi;
const LONG_DIGITS = /\b\d{6,12}\b/g;
const DOB_LABELED = /\b(?:dob|date of birth|born(?: on)?|birthday)\s*[:-]?\s*((?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|(?:[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}))/gi;
const DATE_WITH_YEAR = /\b(\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2})\b/g;
const ADDRESS = /\b\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Terrace|Circle|Cir)\.?\b/g;

function pushSpan(out: PiiSpan[], kind: PiiKind, start: number, end: number, text: string, confidence: 'high' | 'medium', hint: string) {
  if (out.some((s) => s.start < end && start < s.end)) return; // no overlapping spans
  out.push({ kind, start, end, text, confidence, hint });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectPii(text: string, opts: DetectorOptions = {}): PiiSpan[] {
  const out: PiiSpan[] = [];
  if (!text) return out;
  const allow = new Set([...COMMON_CAPS, ...MONTHS, ...DAYS, ...(opts.allowWords ?? []).map((w) => w.toLowerCase())]);

  // 1. Roster denylist — highest precision. Whole names first, then individual name parts ≥ 3 chars.
  // Role words and ordinary vocabulary ("Student A", "Guardian", "Test") never form a denylist
  // entry: a roster name is only usable if at least one part is a real name-like token.
  const denyParts = new Set<string>();
  for (const full of opts.denyNames ?? []) {
    const trimmed = full.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const nameLike = parts.filter((p) => p.length >= 3 && !allow.has(p.toLowerCase()));
    if (nameLike.length === 0) continue;
    // Multi-word entries match as a whole, case-insensitively ("marcus johnson"). A single word
    // ("Example", "Lane") is only ever matched capitalised, through the parts path below.
    if (parts.length > 1) {
      const re = new RegExp(`\\b${escapeRe(trimmed)}\\b`, 'gi');
      for (const m of text.matchAll(re)) pushSpan(out, 'name', m.index, m.index + m[0].length, m[0], 'high', 'Matches a student on your roster.');
    }
    for (const part of nameLike) denyParts.add(part.toLowerCase());
  }
  for (const part of denyParts) {
    const re = new RegExp(`\\b${escapeRe(part)}\\b`, 'gi');
    for (const m of text.matchAll(re)) {
      // Only flag if capitalised in the text, to avoid "will" / "grace" false positives.
      if (/^[A-Z]/.test(m[0])) pushSpan(out, 'name', m.index, m.index + m[0].length, m[0], 'high', 'Matches a student on your roster.');
    }
  }

  // 2. Structured identifiers.
  for (const m of text.matchAll(EMAIL)) pushSpan(out, 'email', m.index, m.index + m[0].length, m[0], 'high', 'Email address.');
  for (const m of text.matchAll(SSN)) pushSpan(out, 'ssn', m.index, m.index + m[0].length, m[0], 'high', 'Looks like a government id number.');
  for (const m of text.matchAll(PHONE)) pushSpan(out, 'phone', m.index, m.index + m[0].length, m[0], 'high', 'Phone number.');
  for (const m of text.matchAll(STUDENT_ID_LABELED)) pushSpan(out, 'student_id', m.index, m.index + m[0].length, m[0], 'high', 'Student identification number.');
  for (const m of text.matchAll(DOB_LABELED)) pushSpan(out, 'dob', m.index, m.index + m[0].length, m[0], 'high', 'Date of birth.');
  for (const m of text.matchAll(ADDRESS)) pushSpan(out, 'address', m.index, m.index + m[0].length, m[0], 'high', 'Street address.');
  for (const m of text.matchAll(DATE_WITH_YEAR)) pushSpan(out, 'dob', m.index, m.index + m[0].length, m[0], 'medium', 'A full date can identify a student; use relative timing ("week 3") instead.');
  for (const m of text.matchAll(LONG_DIGITS)) pushSpan(out, 'student_id', m.index, m.index + m[0].length, m[0], 'medium', 'Long numbers are often ids.');

  // 3. Names by pattern.
  for (const m of text.matchAll(HONORIFICS)) pushSpan(out, 'name', m.index, m.index + m[0].length, m[0], 'high', 'Honorific followed by a name.');
  for (const m of text.matchAll(NAMED)) {
    const cand = m[1]!;
    if (!allow.has(cand.toLowerCase())) {
      const start = m.index + m[0].indexOf(cand);
      pushSpan(out, 'name', start, start + cand.length, cand, 'high', 'This looks like a student name. Class Pulse works without it.');
    }
  }
  for (const m of text.matchAll(TWO_CAPS)) {
    const [whole, a, b] = m;
    if (allow.has(a!.toLowerCase()) || allow.has(b!.toLowerCase())) continue;
    // Skip sentence starts ("During Independent") — the first word after ., !, ? or at index 0.
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before.length === 0 || /[.!?:\n]$/.test(before);
    if (sentenceStart && allow.has(b!.toLowerCase())) continue;
    pushSpan(out, 'name', m.index, m.index + whole.length, whole, sentenceStart ? 'medium' : 'medium', 'This looks like a person\'s name. Remove it? Class Pulse works without it.');
  }

  return out.sort((x, y) => x.start - y.start);
}

/** Replace detected spans with a neutral placeholder. Used by the one-tap fix in the UI. */
export function redactPii(text: string, spans: ReadonlyArray<PiiSpan>): string {
  let out = '';
  let cursor = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, s.start);
    out += s.kind === 'name' ? 'the student' : `[${s.kind}]`;
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

export function hasHighConfidencePii(spans: ReadonlyArray<PiiSpan>): boolean {
  return spans.some((s) => s.confidence === 'high');
}
