import type { CandidateStatus, DetectionResult, PatternDefinitionStatus, Signal } from '@class-pulse/domain';
import { distinctDays, mean, spanDays, values, type DetectionContext, type PatternDefinition } from './window';

export interface ExistingCandidate {
  definitionId: string;
  status: CandidateStatus;
  detectedAt: Date;
  adjudicatedAt: Date | null;
}

export interface SweepOptions {
  definitions: ReadonlyArray<PatternDefinition>;
  /** Admin overrides of definition status (docs/06 Phase 7: retirable from the admin surface). */
  statusOverrides?: ReadonlyMap<string, PatternDefinitionStatus>;
  existing: ReadonlyArray<ExistingCandidate>;
}

export interface SweepCandidate {
  definition: PatternDefinition;
  status: PatternDefinitionStatus;
  result: DetectionResult;
  /** Piloting definitions detect and record but surface to no one. */
  visible: boolean;
}

export interface SweepOutcome {
  candidates: SweepCandidate[];
  suppressed: Array<{ definitionId: string; reason: string }>;
  insufficient: Array<{ definitionId: string; version: number; title: string; missing: string[] }>;
  evaluated: number;
}

const ACTIVE_STATUSES: CandidateStatus[] = ['detected', 'in_review', 'needs_more_data', 'escalated'];
const DAY = 86_400_000;

/**
 * Run every non-retired definition over one case (docs/05 "Pattern sweep"). Applies the
 * sufficiency gate and per-definition suppression (cooldown after adjudication, max active per
 * student). Per-teacher caps are applied across cases by `applyTeacherCap`.
 */
export function sweepCase(ctx: DetectionContext, opts: SweepOptions): SweepOutcome {
  const out: SweepOutcome = { candidates: [], suppressed: [], insufficient: [], evaluated: 0 };
  for (const def of opts.definitions) {
    const status = opts.statusOverrides?.get(def.id) ?? def.status;
    if (status === 'retired') continue;
    const mine = opts.existing.filter((e) => e.definitionId === def.id);
    const active = mine.filter((e) => ACTIVE_STATUSES.includes(e.status)).length;
    if (active >= def.suppression.maxActivePerStudent) {
      out.suppressed.push({ definitionId: def.id, reason: `already ${active} active candidate(s) for this student` });
      continue;
    }
    const lastAdjudicated = mine
      .filter((e) => e.adjudicatedAt)
      .map((e) => e.adjudicatedAt!.getTime())
      .sort((a, b) => b - a)[0];
    if (lastAdjudicated !== undefined && ctx.now.getTime() - lastAdjudicated < def.suppression.cooldownDays * DAY) {
      const daysLeft = Math.ceil((def.suppression.cooldownDays * DAY - (ctx.now.getTime() - lastAdjudicated)) / DAY);
      out.suppressed.push({ definitionId: def.id, reason: `cooldown: ${daysLeft} day(s) remaining after last adjudication` });
      continue;
    }
    out.evaluated++;
    const result = def.detect(ctx);
    if (result.insufficientData) {
      out.insufficient.push({ definitionId: def.id, version: def.version, title: def.title, missing: result.insufficientData.missing });
      continue;
    }
    if (result.fired) out.candidates.push({ definition: def, status, result, visible: status === 'active' });
  }
  out.candidates.sort((a, b) => b.result.strength - a.result.strength);
  return out;
}

/**
 * Alert-fatigue cap (docs/02): at most `cap` visible active candidates per teacher, ranked by
 * evidence strength. Returns the subset of new candidates that may surface now; the rest stay
 * recorded but invisible until a slot frees.
 */
export function applyTeacherCap<T extends { strength: number }>(newCandidates: ReadonlyArray<T>, currentlyVisibleActive: number, cap: number): { surface: T[]; hold: T[] } {
  const slots = Math.max(0, cap - currentlyVisibleActive);
  const ranked = [...newCandidates].sort((a, b) => b.strength - a.strength);
  return { surface: ranked.slice(0, slots), hold: ranked.slice(slots) };
}

export interface EvidenceSummary {
  signalType: string;
  count: number;
  distinctDays: number;
  spanDays: number;
  contextTags: string[];
  mean: number | null;
  byContext: Array<{ tag: string; count: number; mean: number | null }>;
}

/**
 * De-identified evidence summary for the interpretation prompt (docs/02 §2): counts, means,
 * spans, tags. No ids, no notes, no dates beyond span length.
 */
export function summarizeEvidence(signals: ReadonlyArray<Signal>, evidenceRefs: ReadonlyArray<string>): EvidenceSummary[] {
  const refs = new Set(evidenceRefs);
  const chosen = signals.filter((s) => refs.has(s.id));
  const byType = new Map<string, Signal[]>();
  for (const s of chosen) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s);
  }
  const out: EvidenceSummary[] = [];
  for (const [type, group] of byType) {
    const tags = [...new Set(group.flatMap((s) => s.contextTags))].sort();
    const byContext = tags.map((tag) => {
      const g = group.filter((s) => s.contextTags.includes(tag));
      return { tag, count: g.length, mean: type === 'behavior_event' ? null : round(mean(values(g))) };
    });
    out.push({ signalType: type, count: group.length, distinctDays: distinctDays(group), spanDays: spanDays(group), contextTags: tags, mean: type === 'behavior_event' ? null : round(mean(values(group))), byContext });
  }
  return out;
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}
