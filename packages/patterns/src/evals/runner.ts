import { PATTERN_CATALOG } from '../definitions';
import type { PatternDefinition } from '../engine/window';
import { HISTORIES, type LabeledHistory } from './histories';

export interface DefinitionScore {
  definitionId: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number | null;
  recall: number | null;
  failures: string[];
}

export interface DetectionEvalReport {
  now: string;
  definitions: DefinitionScore[];
  insufficientMismatches: string[];
  passed: boolean;
}

/**
 * Detection eval (docs/02): precision and recall per definition over labeled histories, plus
 * non-firing on noise and correct `insufficient_data` reporting on sparse histories.
 * Deterministic, fast, runs in CI.
 */
export function runDetectionEvals(opts: { definitions?: PatternDefinition[]; histories?: LabeledHistory[]; now?: Date } = {}): DetectionEvalReport {
  const definitions = opts.definitions ?? PATTERN_CATALOG;
  const histories = opts.histories ?? HISTORIES;
  const now = opts.now ?? new Date('2026-09-18T12:00:00Z');
  const scores = new Map<string, DefinitionScore>(definitions.map((d) => [d.id, { definitionId: d.id, truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0, precision: null, recall: null, failures: [] }]));
  const insufficientMismatches: string[] = [];
  for (const h of histories) {
    const ctx = h.build(now);
    for (const d of definitions) {
      const r = d.detect(ctx);
      const should = h.shouldFire.includes(d.id);
      const s = scores.get(d.id)!;
      if (r.fired && should) s.truePositives++;
      else if (r.fired && !should) {
        s.falsePositives++;
        s.failures.push(`${h.id}: fired unexpectedly (strength ${r.strength.toFixed(2)}, ${JSON.stringify(r.measures)})`);
      } else if (!r.fired && should) {
        s.falseNegatives++;
        s.failures.push(`${h.id}: did not fire (${r.insufficientData ? `insufficient: ${r.insufficientData.missing.join('; ')}` : JSON.stringify(r.measures)})`);
      } else s.trueNegatives++;
      if (h.expectInsufficient?.includes(d.id) && !r.insufficientData) insufficientMismatches.push(`${h.id}/${d.id}: expected insufficient_data, got ${r.fired ? 'fired' : 'not fired'}`);
    }
  }
  for (const s of scores.values()) {
    s.precision = s.truePositives + s.falsePositives ? s.truePositives / (s.truePositives + s.falsePositives) : null;
    s.recall = s.truePositives + s.falseNegatives ? s.truePositives / (s.truePositives + s.falseNegatives) : null;
  }
  const defs = [...scores.values()];
  return { now: now.toISOString(), definitions: defs, insufficientMismatches, passed: defs.every((d) => d.falsePositives === 0 && d.falseNegatives === 0) && insufficientMismatches.length === 0 };
}

export function formatDetectionReport(r: DetectionEvalReport): string {
  const lines = [`Detection evals @ ${r.now} — ${r.passed ? 'PASS' : 'FAIL'}`];
  for (const d of r.definitions) {
    lines.push(`  ${d.definitionId.padEnd(34)} TP=${d.truePositives} FP=${d.falsePositives} FN=${d.falseNegatives} TN=${d.trueNegatives} P=${d.precision?.toFixed(2) ?? '-'} R=${d.recall?.toFixed(2) ?? '-'}`);
    for (const f of d.failures) lines.push(`      ✘ ${f}`);
  }
  for (const m of r.insufficientMismatches) lines.push(`  ✘ ${m}`);
  return lines.join('\n');
}
