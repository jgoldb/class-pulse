import type { PatternDefinition } from '../engine/window';
import { checkSufficiency, fired, insufficient, mean, notFired, ofType, pearson, values, weekIndex } from '../engine/window';

/**
 * Absence rate and grade trend move together, week by week. Routes to the support team, never
 * the teacher queue: chronic absence is a wellbeing signal before it is an instructional one
 * (docs/02 "Routing is not cosmetic").
 */
export const attendancePerformanceCoupling: PatternDefinition = {
  id: 'attendance-performance-coupling',
  version: 1,
  title: 'Attendance and performance moving together',
  plainLanguage: 'In weeks with more absences, graded work has scored lower; in weeks with better attendance it has scored higher.',
  requiredSignals: { types: ['attendance', 'assignment_grade', 'assessment_score'], minObservations: 16, minDistinctDays: 10, minSpanDays: 28 },
  confounders: [
    'Missed instruction alone can lower grades regardless of anything else',
    'Weeks with few graded entries produce unstable weekly averages',
    'Grading policies for missed work may drive the scores directly',
    'Both absence and grades may follow a school-calendar pattern (testing weeks, holidays)',
  ],
  routing: 'support_team',
  suppression: { cooldownDays: 60, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minWeeks: 4, maxCorrelation: -0.5, minAbsenceWeeks: 2 },
  reviewer: null,
  proxyReview:
    'Attendance correlates with socioeconomic status and other protected characteristics (docs/02 proxy awareness). This rule is within-student over time, routes to the support team only, and is monitored for disproportionality before leaving piloting.',
  detect(ctx) {
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing);
    const att = ofType(ctx.window.signals, ['attendance']);
    const grades = ofType(ctx.window.signals, ['assignment_grade', 'assessment_score']);
    if (att.length < 8) return insufficient([`${8 - att.length} more attendance entries`]);
    if (grades.length < 6) return insufficient([`${6 - grades.length} more graded entries`]);
    const weeks = new Map<number, { present: number[]; grades: number[] }>();
    for (const s of att) {
      const w = weekIndex(s.observedAt);
      if (!weeks.has(w)) weeks.set(w, { present: [], grades: [] });
      const v = values([s])[0];
      if (v !== undefined) weeks.get(w)!.present.push(v);
    }
    for (const s of grades) {
      const w = weekIndex(s.observedAt);
      if (!weeks.has(w)) weeks.set(w, { present: [], grades: [] });
      const v = values([s])[0];
      if (v !== undefined) weeks.get(w)!.grades.push(v);
    }
    const rows = [...weeks.values()].filter((r) => r.present.length > 0 && r.grades.length > 0);
    if (rows.length < this.thresholds.minWeeks!) return insufficient([`${this.thresholds.minWeeks! - rows.length} more weeks with both attendance and graded work`]);
    const absence = rows.map((r) => 1 - mean(r.present)!);
    const grade = rows.map((r) => mean(r.grades)!);
    const absenceWeeks = absence.filter((a) => a > 0).length;
    const r = pearson(absence, grade);
    const measures = {
      weeks: rows.length,
      weeksWithAbsence: absenceWeeks,
      correlation: r === null ? 0 : Math.round(r * 100) / 100,
      meanAbsenceRate: Math.round(mean(absence)! * 100) / 100,
      meanGrade: Math.round(mean(grade)! * 10) / 10,
    };
    if (r === null || absenceWeeks < this.thresholds.minAbsenceWeeks! || r > this.thresholds.maxCorrelation!) return notFired(measures);
    return fired(0.4 + 0.6 * Math.min(1, (-r - 0.5) / 0.5), [...att, ...grades], measures);
  },
};
