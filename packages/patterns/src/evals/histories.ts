import type { ComputedRecommendation, Signal } from '@class-pulse/domain';
import type { DetectionContext, PlanContext, ReviewCycleContext } from '../engine/window';

/**
 * Labeled synthetic case histories (docs/02 "Evaluation"). Each history states which
 * definitions should fire. Noise-only histories assert non-firing. Deterministic (seeded) so the
 * suite is reproducible in CI.
 */
export interface LabeledHistory {
  id: string;
  title: string;
  build(now: Date): DetectionContext;
  shouldFire: string[];
  /** Definitions expected to report insufficient data instead of a decision. */
  expectInsufficient?: string[];
}

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 0xffffffff;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
}

const DAY = 86_400_000;

export class HistoryBuilder {
  private signals: Signal[] = [];
  private n = 0;
  readonly rng: Rng;
  constructor(
    readonly caseKey: string,
    readonly now: Date,
    seed = 7,
  ) {
    this.rng = new Rng(seed);
  }
  /** Day offset backwards from `now`; hour sets time of day. */
  at(daysAgo: number, hour = 10): Date {
    const d = new Date(this.now.getTime() - daysAgo * DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  }
  add(s: Omit<Signal, 'id' | 'caseKey' | 'source' | 'sourceConfidence'> & Partial<Pick<Signal, 'source' | 'sourceConfidence'>>): this {
    this.signals.push({ id: `${this.caseKey}-${++this.n}`, caseKey: this.caseKey, source: 'teacher_entry', sourceConfidence: 'high', ...s });
    return this;
  }
  event(daysAgo: number, tags: string[], hour = 10, goalId?: string): this {
    return this.add({ type: 'behavior_event', value: 1, unit: 'events', contextTags: tags, observedAt: this.at(daysAgo, hour), goalId: goalId ?? null });
  }
  grade(daysAgo: number, value: number, tags: string[]): this {
    return this.add({ type: 'assignment_grade', value, unit: 'percent', contextTags: tags, observedAt: this.at(daysAgo, 12) });
  }
  assessment(daysAgo: number, value: number, tags: string[]): this {
    return this.add({ type: 'assessment_score', value, unit: 'percent', contextTags: tags, observedAt: this.at(daysAgo, 12) });
  }
  attendance(daysAgo: number, present: 0 | 0.5 | 1): this {
    return this.add({ type: 'attendance', value: present, unit: 'presence', contextTags: [], observedAt: this.at(daysAgo, 8), source: 'sis_import' });
  }
  strategyUse(daysAgo: number, tags: string[] = [], strategyId = 'strat-1'): this {
    return this.add({ type: 'strategy_use', value: 1, unit: 'uses', contextTags: tags, observedAt: this.at(daysAgo, 9), strategyId });
  }
  build(plan: PlanContext | null = null, reviewCycles: ReviewCycleContext[] = []): DetectionContext {
    const signals = [...this.signals].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    const from = signals[0]?.observedAt ?? this.now;
    return { window: { caseKey: this.caseKey, from, to: this.now, signals }, plan, reviewCycles, now: this.now };
  }
}

export const PLAN_ALL_USED: PlanContext = {
  strengths: ['technology', 'positive feedback', 'smaller parts'],
  strategies: [
    { id: 's1', kind: 'preventive', description: 'Divide assignments into smaller parts with checkpoints', usesStrengths: ['smaller parts'], status: 'active' },
    { id: 's2', kind: 'response', description: 'Specific positive feedback within one minute', usesStrengths: ['positive feedback'], status: 'active' },
    { id: 's3', kind: 'preventive', description: 'Offer a technology-based extension', usesStrengths: ['technology'], status: 'active' },
  ],
  goals: [],
};

export const PLAN_TECH_UNUSED: PlanContext = {
  ...PLAN_ALL_USED,
  strategies: PLAN_ALL_USED.strategies.filter((s) => s.id !== 's3'),
};

function cycle(trend: 'improving' | 'flat' | 'worsening', consistent: boolean, daysAgo: number, now: Date): ReviewCycleContext {
  const computed: ComputedRecommendation = {
    decision: trend === 'improving' ? 'continue' : 'modify',
    firedCriteria: [],
    goalSummaries: [{ goalIndex: 0, targetBehavior: 'Leaving seat', observations: 12, windowDays: 14, currentValue: 4, baselineValue: 4, changePct: 0, trend }],
    implementationConsistency: { strategyUsesInWindow: consistent ? 8 : 1, weeksWithStrategyUse: consistent ? 2 : 0, weeksInWindow: 2 },
    rationale: [],
  };
  return { decision: computed.decision, decidedAt: new Date(now.getTime() - daysAgo * DAY), computed };
}

export const HISTORIES: LabeledHistory[] = [
  {
    id: 'motivating',
    title: 'The motivating example: strong independent, weak group, absences, events in group work',
    shouldFire: ['context-performance-divergence', 'strength-underutilization'],
    build(now) {
      const b = new HistoryBuilder('ck-motivating', now, 11);
      // 5 weeks, independent assessments high, group grades low
      for (let w = 0; w < 5; w++) {
        b.assessment(35 - w * 7 - 1, 88 + b.rng.int(0, 8), ['independent', 'summative', 'period_3']);
        b.grade(35 - w * 7 - 3, 85 + b.rng.int(0, 10), ['independent', 'formative', 'period_3']);
        b.grade(35 - w * 7 - 5, 58 + b.rng.int(0, 10), ['group_work', 'formative', 'period_3']);
        for (let d = 0; d < 5; d++) b.attendance(35 - w * 7 - d, d === 2 && w % 2 === 0 ? 0 : 1);
        b.event(35 - w * 7 - 5, ['group_work', 'period_3', 'long_assignment']);
        b.event(35 - w * 7 - 5, ['group_work', 'period_3', 'long_assignment'], 11);
        // The strategy is applied where the behavior occurs (group days), as a teacher would.
        b.strategyUse(35 - w * 7 - 5, ['group_work']);
      }
      return b.build(PLAN_TECH_UNUSED);
    },
  },
  {
    id: 'noise',
    title: 'Noise only: even grades, events spread evenly, strengths all used',
    shouldFire: [],
    build(now) {
      const b = new HistoryBuilder('ck-noise', now, 23);
      const ctxs = ['independent', 'group_work', 'paired'];
      const lens = ['short_task', 'long_assignment'];
      const periods = ['period_1', 'period_2', 'period_3', 'period_4'];
      const structures = ['structured', 'structured', 'transition'];
      for (let d = 42; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        b.attendance(d, 1);
        if (d % 3 === 0) b.grade(d, 78 + b.rng.int(0, 8), [ctxs[d % 3]!, lens[d % 2]!, periods[d % 4]!]);
        if (d % 4 === 0) b.event(d, [ctxs[(d + 1) % 3]!, lens[(d + 1) % 2]!, periods[(d + 1) % 4]!, structures[d % 3]!], 9 + (d % 4));
        if (d % 5 === 0) b.strategyUse(d, [lens[d % 2]!]);
        if (d % 6 === 0) b.add({ type: 'interval_observation', value: 60 + b.rng.int(0, 10), unit: 'percent_intervals', contextTags: [ctxs[d % 3]!, lens[d % 2]!, periods[d % 4]!, 'structured'], observedAt: b.at(d, 13) });
      }
      return b.build(PLAN_ALL_USED, [cycle('improving', true, 20, now), cycle('flat', false, 5, now)]);
    },
  },
  {
    id: 'task-length',
    title: 'Events over-represented in long assignments',
    shouldFire: ['task-length-sensitivity'],
    build(now) {
      const b = new HistoryBuilder('ck-task', now, 5);
      for (let d = 20; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        const len = d % 2 === 0 ? 'long_assignment' : 'short_task';
        b.strategyUse(d, [len]);
        if (d % 3 === 0) b.grade(d, 80, [len, 'independent']);
        if (len === 'long_assignment') {
          b.event(d, [len, 'independent'], 10);
          b.event(d, [len, 'independent'], 11);
          b.event(d, [len, 'independent'], 12);
        } else if (d % 3 === 0) b.event(d, [len, 'independent'], 10);
      }
      return b.build(PLAN_ALL_USED);
    },
  },
  {
    id: 'time-of-day',
    title: 'Events concentrated in period 3',
    shouldFire: ['time-of-day-clustering'],
    build(now) {
      const b = new HistoryBuilder('ck-tod', now, 9);
      for (let d = 20; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        for (const p of ['period_1', 'period_3', 'period_5']) b.strategyUse(d, [p]);
        b.event(d, ['period_3', 'structured'], 11);
        if (d % 2 === 0) b.event(d, ['period_3', 'structured'], 11);
        if (d % 5 === 0) b.event(d, ['period_1', 'structured'], 9);
      }
      return b.build(PLAN_ALL_USED);
    },
  },
  {
    id: 'unstructured',
    title: 'Events during transitions',
    shouldFire: ['unstructured-time-clustering'],
    build(now) {
      const b = new HistoryBuilder('ck-unstr', now, 3);
      for (let d = 20; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        b.strategyUse(d, ['structured']);
        b.strategyUse(d, ['structured', 'period_2']);
        b.strategyUse(d, ['transition']);
        b.event(d, ['transition', 'period_2'], 10);
        if (d % 2 === 0) b.event(d, ['unstructured_time'], 12);
        if (d % 6 === 0) b.event(d, ['structured', 'period_2'], 11);
      }
      return b.build(PLAN_ALL_USED);
    },
  },
  {
    id: 'attendance-coupling',
    title: 'Weeks with absences have lower grades',
    shouldFire: ['attendance-performance-coupling'],
    build(now) {
      const b = new HistoryBuilder('ck-att', now, 17);
      const absentWeeks = [1, 3, 4];
      for (let w = 0; w < 6; w++) {
        const bad = absentWeeks.includes(w);
        for (let d = 0; d < 5; d++) b.attendance(41 - w * 7 - d, bad && d < 2 ? 0 : 1);
        b.grade(41 - w * 7 - 2, bad ? 60 + b.rng.int(0, 5) : 85 + b.rng.int(0, 5), ['independent']);
        b.grade(41 - w * 7 - 4, bad ? 58 + b.rng.int(0, 5) : 83 + b.rng.int(0, 5), ['independent']);
      }
      return b.build(PLAN_ALL_USED);
    },
  },
  {
    id: 'strategy-effective',
    title: 'Fewer events on days a strategy was logged',
    shouldFire: ['strategy-effectiveness-signal'],
    build(now) {
      const b = new HistoryBuilder('ck-strat', now, 29);
      for (let d = 20; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        if (d % 2 === 0) {
          b.strategyUse(d);
          if (d % 4 === 0) b.event(d, ['independent'], 10);
        } else {
          b.event(d, ['independent'], 10);
          b.event(d, ['independent'], 11);
          b.event(d, ['independent'], 13);
        }
      }
      return b.build(PLAN_ALL_USED);
    },
  },
  {
    id: 'non-response',
    title: 'Two review cycles with consistent implementation and no movement',
    shouldFire: ['non-response-trajectory'],
    build(now) {
      const b = new HistoryBuilder('ck-nonresp', now, 31);
      for (let d = 28; d > 0; d--) {
        if (d % 7 === 0 || d % 7 === 6) continue;
        b.strategyUse(d);
        b.event(d, ['independent'], 10);
      }
      return b.build(PLAN_ALL_USED, [cycle('flat', true, 30, now), cycle('worsening', true, 14, now)]);
    },
  },
  {
    id: 'sparse',
    title: 'Sparse history: everything data-driven should report insufficient data',
    shouldFire: [],
    expectInsufficient: ['context-performance-divergence', 'task-length-sensitivity', 'time-of-day-clustering', 'unstructured-time-clustering', 'attendance-performance-coupling', 'strategy-effectiveness-signal', 'non-response-trajectory'],
    build(now) {
      const b = new HistoryBuilder('ck-sparse', now, 2);
      b.event(3, ['independent', 'period_2']).event(2, ['group_work', 'period_2']).grade(1, 80, ['independent']);
      return b.build(PLAN_ALL_USED);
    },
  },
];
