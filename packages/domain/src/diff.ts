/**
 * Field-level diff between an AI draft and the approved plan (docs/01: "store the draft/approved
 * diff" — the highest-value feedback signal in the system).
 *
 * Paths are JSON-pointer-ish ("measurableGoals.0.target.status"). Arrays are compared by index;
 * added and removed elements are recorded as such so prompt review can ask "which sections do
 * educators consistently delete?".
 */
export type DiffEntry =
  | { op: 'changed'; path: string; from: unknown; to: unknown }
  | { op: 'added'; path: string; to: unknown }
  | { op: 'removed'; path: string; from: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function walk(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = path ? `${path}.${i}` : String(i);
      if (i >= a.length) out.push({ op: 'added', path: p, to: b[i] });
      else if (i >= b.length) out.push({ op: 'removed', path: p, from: a[i] });
      else walk(a[i], b[i], p, out);
    }
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) out.push({ op: 'added', path: p, to: b[k] });
      else if (!(k in b)) out.push({ op: 'removed', path: p, from: a[k] });
      else walk(a[k], b[k], p, out);
    }
    return;
  }
  const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
  if (!same) out.push({ op: 'changed', path, from: a, to: b });
}

export function diffPlans(draft: unknown, approved: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(draft, approved, '', out);
  return out;
}

/** Top-level section of a diff path, for aggregation ("which sections get rewritten most"). */
export function sectionOfPath(path: string): string {
  return path.split('.')[0] ?? path;
}

export function summarizeDiffBySection(entries: DiffEntry[]): Record<string, { changed: number; added: number; removed: number }> {
  const out: Record<string, { changed: number; added: number; removed: number }> = {};
  for (const e of entries) {
    const s = sectionOfPath(e.path);
    out[s] ??= { changed: 0, added: 0, removed: 0 };
    out[s][e.op]++;
  }
  return out;
}
