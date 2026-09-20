import type { ComputedRecommendation, GoalContent, ReviewCriterion, ReviewDecision, Signal } from '@class-pulse/domain';
import { signalTypeForMethod } from '@class-pulse/domain';
import { dayKey, distinctDays, eventsPerDay, mean, slopePerDay, values, weekIndex } from './window';

/**
 * The review-cycle engine (docs/03 §Section 14, docs/05). Section 14 of the plan is rules; this
 * evaluates them against logged data and computes the recommendation. The model narrates the
 * result afterwards and a guardrail rejects a narrative that changes the decision.
 */
export interface ReviewInput {
  goals: Array<GoalContent & { id: string }>;
  criteria: ReviewCriterion[];
  signals: Signal[];
  now: Date;
}

const DAY = 86_400_000;
const PRECEDENCE: ReviewDecision[] = ['seek_support', 'modify', 'collect_more', 'fade', 'continue'];

interface GoalMetrics {
  observations: number;
  currentValue: number | null;
  baselineValue: number | null;
  changePct: number | null;
  trend: 'improving' | 'flat' | 'worsening' | 'insufficient_data';
}

function signalsForGoal(goal: GoalContent & { id: string }, signals: Signal[], from: Date): Signal[] {
  const type = signalTypeForMethod(goal.measurementMethod);
  const inWindow = signals.filter((s) => s.observedAt >= from);
  const linked = inWindow.filter((s) => s.goalId === goal.id);
  if (linked.length) return linked;
  return inWindow.filter((s) => s.type === type && !s.goalId);
}

function metricValue(goal: GoalContent, metric: ReviewCriterion['metric'], sig: Signal[]): { value: number | null; observations: number } {
  switch (metric) {
    case 'events_per_day': {
      const days = distinctDays(sig);
      return { value: eventsPerDay(sig, days), observations: sig.length };
    }
    case 'percent_intervals':
    case 'mean_grade_percent':
    case 'self_check_mean':
      return { value: mean(values(sig)), observations: sig.length };
    case 'strategy_uses_per_week': {
      const weeks = new Set(sig.map((s) => weekIndex(s.observedAt))).size || 1;
      return { value: sig.length / weeks, observations: sig.length };
    }
  }
}

function goalMetrics(goal: GoalContent & { id: string }, signals: Signal[], windowDays: number, minObs: number, now: Date): GoalMetrics {
  const from = new Date(now.getTime() - windowDays * DAY);
  const sig = signalsForGoal(goal, signals, from);
  const metric: ReviewCriterion['metric'] = goal.measurementMethod === 'interval_observation' ? 'percent_intervals' : goal.measurementMethod === 'permanent_product' ? 'mean_grade_percent' : 'events_per_day';
  const { value, observations } = metricValue(goal, metric, sig);
  const baselineValue = goal.baseline.status === 'available' ? goal.baseline.value : null;
  if (observations < minObs || value === null) return { observations, currentValue: value, baselineValue, changePct: null, trend: 'insufficient_data' };
  let changePct: number | null = null;
  let trend: GoalMetrics['trend'] = 'flat';
  if (baselineValue !== null && baselineValue !== 0) {
    changePct = ((value - baselineValue) / baselineValue) * 100;
    const better = goal.direction === 'decrease' ? -changePct : changePct;
    trend = better >= 15 ? 'improving' : better <= -15 ? 'worsening' : 'flat';
  } else {
    // No baseline: use the within-window slope (per day) relative to the mean value.
    const slope = slopePerDay(sig.map((s) => (metric === 'events_per_day' ? { ...s, value: 1 } : s)));
    const perDayCounts = metric === 'events_per_day' ? dailyCounts(sig) : null;
    const s = perDayCounts ? slopeOfSeries(perDayCounts) : slope;
    if (s === null) trend = 'flat';
    else {
      const rel = (s * windowDays) / Math.max(value, 0.01);
      const better = goal.direction === 'decrease' ? -rel : rel;
      trend = better >= 0.25 ? 'improving' : better <= -0.25 ? 'worsening' : 'flat';
    }
  }
  return { observations, currentValue: Math.round(value * 100) / 100, baselineValue, changePct: changePct === null ? null : Math.round(changePct), trend };
}

function dailyCounts(sig: Signal[]): Array<{ x: number; y: number }> {
  const m = new Map<string, number>();
  for (const s of sig) m.set(dayKey(s.observedAt), (m.get(dayKey(s.observedAt)) ?? 0) + 1);
  return [...m.entries()].sort().map(([d, n]) => ({ x: new Date(d).getTime() / DAY, y: n }));
}

function slopeOfSeries(pts: Array<{ x: number; y: number }>): number | null {
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

export function computeRecommendation(input: ReviewInput): ComputedRecommendation {
  const { goals, criteria, signals, now } = input;
  const maxWindow = Math.max(14, ...criteria.map((c) => c.windowDays));
  const minObsFor = (i: number) => Math.min(...criteria.filter((c) => c.goalIndex === i).map((c) => c.minObservations), 6);

  const goalSummaries = goals.map((g, i) => {
    const m = goalMetrics(g, signals, Math.max(14, ...criteria.filter((c) => c.goalIndex === i).map((c) => c.windowDays)), minObsFor(i), now);
    return { goalIndex: i, targetBehavior: g.targetBehavior, observations: m.observations, windowDays: Math.max(14, ...criteria.filter((c) => c.goalIndex === i).map((c) => c.windowDays)), currentValue: m.currentValue, baselineValue: m.baselineValue, changePct: m.changePct, trend: m.trend };
  });

  const firedCriteria: ComputedRecommendation['firedCriteria'] = [];
  criteria.forEach((c, idx) => {
    const from = new Date(now.getTime() - c.windowDays * DAY);
    let sig: Signal[];
    let goal: (GoalContent & { id: string }) | null = null;
    if (c.goalIndex !== null && goals[c.goalIndex]) {
      goal = goals[c.goalIndex]!;
      sig = c.metric === 'strategy_uses_per_week' ? signals.filter((s) => s.type === 'strategy_use' && s.observedAt >= from) : signalsForGoal(goal, signals, from);
    } else {
      const type = c.metric === 'strategy_uses_per_week' ? 'strategy_use' : c.metric === 'self_check_mean' ? 'self_check' : c.metric === 'mean_grade_percent' ? 'assignment_grade' : c.metric === 'percent_intervals' ? 'interval_observation' : 'behavior_event';
      sig = signals.filter((s) => s.type === type && s.observedAt >= from);
    }
    const { value, observations } = metricValue(goal ?? goals[0]!, c.metric, sig);
    let fires = false;
    if (c.comparator === 'insufficient_data') fires = observations < c.minObservations;
    else if (observations >= c.minObservations && value !== null && c.value !== null) {
      const baseline = goal && goal.baseline.status === 'available' ? goal.baseline.value : null;
      switch (c.comparator) {
        case 'lte':
          fires = value <= c.value;
          break;
        case 'gte':
          fires = value >= c.value;
          break;
        case 'change_pct_lte':
          fires = baseline !== null && baseline !== 0 && ((value - baseline) / baseline) * 100 <= c.value;
          break;
        case 'change_pct_gte':
          fires = baseline !== null && baseline !== 0 && ((value - baseline) / baseline) * 100 >= c.value;
          break;
      }
    }
    if (fires) firedCriteria.push({ criterionIndex: idx, description: c.description, observedValue: value === null ? null : Math.round(value * 100) / 100, observations, decision: c.decision });
  });

  const from = new Date(now.getTime() - maxWindow * DAY);
  const uses = signals.filter((s) => s.type === 'strategy_use' && s.observedAt >= from);
  // Count calendar weeks the window touches (partial weeks at both ends included) so
  // weeksWithStrategyUse can never exceed weeksInWindow.
  const weeksInWindow = Math.max(1, weekIndex(now) - weekIndex(from) + 1);
  const implementationConsistency = { strategyUsesInWindow: uses.length, weeksWithStrategyUse: Math.min(weeksInWindow, new Set(uses.map((s) => weekIndex(s.observedAt))).size), weeksInWindow };

  const rationale: string[] = [];
  let decision: ReviewDecision | null = null;
  for (const d of PRECEDENCE) {
    if (firedCriteria.some((f) => f.decision === d)) {
      decision = d;
      break;
    }
  }
  if (!decision) {
    if (goalSummaries.some((g) => g.trend === 'insufficient_data')) {
      decision = 'collect_more';
      rationale.push('No review criterion fired and at least one goal has too few observations in the window.');
    } else if (goalSummaries.length && goalSummaries.every((g) => g.trend === 'improving')) {
      decision = 'continue';
      rationale.push('No review criterion fired; every goal is improving against its baseline.');
    } else if (goalSummaries.some((g) => g.trend === 'worsening')) {
      decision = 'modify';
      rationale.push('No review criterion fired but at least one goal is worsening.');
    } else {
      decision = 'continue';
      rationale.push('No review criterion fired; measures are stable.');
    }
  } else {
    rationale.push(`Decision "${decision}" from ${firedCriteria.filter((f) => f.decision === decision).length} fired criterion/criteria; precedence is seek_support > modify > collect_more > fade > continue.`);
  }
  if (decision !== 'collect_more' && implementationConsistency.weeksWithStrategyUse < Math.ceil(weeksInWindow / 2)) {
    rationale.push(`Strategy use was logged in only ${implementationConsistency.weeksWithStrategyUse} of ${weeksInWindow} weeks; interpret the trend with caution.`);
  }

  return { decision, firedCriteria, goalSummaries, implementationConsistency, rationale };
}
