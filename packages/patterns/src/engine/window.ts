import type { ComputedRecommendation, DetectionResult, GoalContent, PatternDefinitionMeta, ReviewDecision, Signal, SignalType, StrategyKind } from '@class-pulse/domain';
import { CONTEXT_DIMENSIONS, numericValue, type ContextDimension } from '@class-pulse/domain';

/** Everything a detection rule may see. Note what is absent: names, ids, demographics (docs/02). */
export interface SignalWindow {
  caseKey: string;
  from: Date;
  to: Date;
  /** Sorted ascending by observedAt. */
  signals: Signal[];
}

export interface PlanContext {
  strengths: string[];
  strategies: Array<{ id: string; kind: StrategyKind; description: string; usesStrengths: string[]; status: 'draft' | 'active' | 'retired' }>;
  goals: Array<GoalContent & { id: string; status: string }>;
}

export interface ReviewCycleContext {
  decision: ReviewDecision | null;
  decidedAt: Date | null;
  computed: ComputedRecommendation | null;
}

export interface DetectionContext {
  window: SignalWindow;
  plan: PlanContext | null;
  reviewCycles: ReviewCycleContext[];
  now: Date;
}

export interface PatternDefinition extends PatternDefinitionMeta {
  detect(ctx: DetectionContext): DetectionResult;
}

// ---- helpers --------------------------------------------------------------------------------

const DAY = 86_400_000;

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekIndex(d: Date): number {
  return Math.floor(d.getTime() / (7 * DAY));
}

export function ofType(signals: ReadonlyArray<Signal>, types: ReadonlyArray<SignalType>): Signal[] {
  return signals.filter((s) => types.includes(s.type));
}

export function numeric(s: Signal): number | null {
  return numericValue(s);
}

export function distinctDays(signals: ReadonlyArray<Signal>): number {
  return new Set(signals.map((s) => dayKey(s.observedAt))).size;
}

export function spanDays(signals: ReadonlyArray<Signal>): number {
  if (signals.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of signals) {
    const t = s.observedAt.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return Math.round((max - min) / DAY);
}

export function withTag(signals: ReadonlyArray<Signal>, tag: string): Signal[] {
  return signals.filter((s) => s.contextTags.includes(tag));
}

export function withAnyTag(signals: ReadonlyArray<Signal>, tags: ReadonlyArray<string>): Signal[] {
  return signals.filter((s) => s.contextTags.some((t) => tags.includes(t)));
}

/** Group signals by the tag they carry in a dimension. Signals with no tag in the dimension are omitted. */
export function byDimension(signals: ReadonlyArray<Signal>, dim: ContextDimension): Map<string, Signal[]> {
  const tags = CONTEXT_DIMENSIONS[dim] as readonly string[];
  const out = new Map<string, Signal[]>();
  for (const s of signals) {
    for (const t of s.contextTags) {
      if (tags.includes(t)) {
        if (!out.has(t)) out.set(t, []);
        out.get(t)!.push(s);
      }
    }
  }
  return out;
}

export function sum(xs: ReadonlyArray<number>): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function mean(xs: ReadonlyArray<number>): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function stddev(xs: ReadonlyArray<number>): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

export function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function values(signals: ReadonlyArray<Signal>): number[] {
  return signals.map(numeric).filter((v): v is number => v !== null);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Ordinary least squares slope of value against day index. */
export function slopePerDay(signals: ReadonlyArray<Signal>): number | null {
  const pts = signals.map((s) => ({ x: s.observedAt.getTime() / DAY, y: numeric(s) })).filter((p): p is { x: number; y: number } => p.y !== null);
  if (pts.length < 3) return null;
  const mx = mean(pts.map((p) => p.x))!;
  const my = mean(pts.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Events per distinct observed day, the standard rate for behavior_event signals. */
export function eventsPerDay(events: ReadonlyArray<Signal>, observedDays: number): number | null {
  if (observedDays === 0) return null;
  return sum(values(events).map((v) => (v > 0 ? v : 1))) / observedDays;
}

// ---- results --------------------------------------------------------------------------------

export function notFired(measures: Record<string, number> = {}): DetectionResult {
  return { fired: false, strength: 0, evidenceRefs: [], measures, insufficientData: null };
}

export function insufficient(missing: string[], measures: Record<string, number> = {}): DetectionResult {
  return { fired: false, strength: 0, evidenceRefs: [], measures, insufficientData: { missing } };
}

export function fired(strength: number, evidence: ReadonlyArray<Signal>, measures: Record<string, number>): DetectionResult {
  return { fired: true, strength: clamp01(strength), evidenceRefs: evidence.map((s) => s.id), measures, insufficientData: null };
}

/**
 * The sufficiency gate (docs/02): below `requiredSignals` thresholds a definition emits an
 * `insufficient_data` note naming what is missing rather than a weak candidate.
 */
export function checkSufficiency(def: PatternDefinitionMeta, signals: ReadonlyArray<Signal>): string[] {
  const req = def.requiredSignals;
  const relevant = ofType(signals, req.types);
  const missing: string[] = [];
  if (relevant.length < req.minObservations) missing.push(`${req.minObservations - relevant.length} more ${req.types.join('/')} entries (have ${relevant.length}, need ${req.minObservations})`);
  const days = distinctDays(relevant);
  if (days < req.minDistinctDays) missing.push(`entries on ${req.minDistinctDays - days} more distinct days (have ${days}, need ${req.minDistinctDays})`);
  const span = spanDays(relevant);
  if (span < req.minSpanDays) missing.push(`${req.minSpanDays - span} more days of history (span ${span}, need ${req.minSpanDays})`);
  return missing;
}
