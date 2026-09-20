import { describe, expect, it } from 'vitest';
import { Baseline, GoalTarget, targetWithoutBaseline } from './baseline';
import { vagueTermsIn } from './goal';
import { canTransitionPlan, isApprovalTransition } from './plan';
import { canTransitionCandidate } from './pattern';
import { diffPlans, summarizeDiffBySection } from './diff';
import { roleScopeIsValid } from './roles';
import { dimensionOfTag, Signal } from './signals';
import { newCaseKey } from './ids';

describe('Baseline union', () => {
  it('accepts all three states and rejects a bare number', () => {
    expect(Baseline.parse({ status: 'available', value: 4, unit: 'events/period', observations: 5, spanDays: 7 }).status).toBe('available');
    expect(Baseline.parse({ status: 'unavailable', reason: 'none' }).status).toBe('unavailable');
    expect(
      Baseline.parse({ status: 'ambiguous', rawInput: '3-5 times', whyAmbiguous: 'spans two behaviors', candidateBehaviors: ['a', 'b'] }).status,
    ).toBe('ambiguous');
    expect(() => Baseline.parse(4)).toThrow();
    expect(() => Baseline.parse({ status: 'available', value: null })).toThrow();
  });

  it('flags a numeric target without an available baseline (the V1 failure)', () => {
    const ambiguous: Baseline = { status: 'ambiguous', rawInput: '3-5', whyAmbiguous: 'x', candidateBehaviors: [] };
    const proposed: GoalTarget = { status: 'proposed', value: 2, unit: 'events', rationale: 'x' };
    const blocked: GoalTarget = { status: 'blocked_on_baseline', note: 'collect first' };
    expect(targetWithoutBaseline(ambiguous, proposed)).toBe(true);
    expect(targetWithoutBaseline(ambiguous, blocked)).toBe(false);
    expect(targetWithoutBaseline({ status: 'available', value: 4, unit: 'e', observations: 3, spanDays: 5 }, proposed)).toBe(false);
  });
});

describe('vague terms', () => {
  it('finds forbidden terms as whole words only', () => {
    expect(vagueTermsIn('The student will stay focused and on task')).toEqual(['focused', 'on task']);
    expect(vagueTermsIn('The student remains in the assigned area')).toEqual([]);
    expect(vagueTermsIn('unfocused')).toEqual([]);
  });
});

describe('plan lifecycle', () => {
  it('follows draft → in_review → active → under_review → outcome', () => {
    expect(canTransitionPlan('draft', 'in_review')).toBe(true);
    expect(canTransitionPlan('draft', 'active')).toBe(false);
    expect(canTransitionPlan('in_review', 'active')).toBe(true);
    expect(canTransitionPlan('active', 'under_review')).toBe(true);
    expect(canTransitionPlan('under_review', 'modified')).toBe(true);
    expect(canTransitionPlan('faded', 'active')).toBe(false);
  });
  it('marks the approval transitions', () => {
    expect(isApprovalTransition('in_review', 'active')).toBe(true);
    expect(isApprovalTransition('draft', 'in_review')).toBe(false);
  });
});

describe('candidate lifecycle', () => {
  it('requires in_review before any decision', () => {
    expect(canTransitionCandidate('detected', 'confirmed')).toBe(false);
    expect(canTransitionCandidate('detected', 'in_review')).toBe(true);
    expect(canTransitionCandidate('in_review', 'dismissed')).toBe(true);
    expect(canTransitionCandidate('needs_more_data', 'in_review')).toBe(true);
  });
});

describe('diffPlans', () => {
  it('records field-level changes, additions and removals', () => {
    const draft = { a: 1, goals: [{ t: 'x' }, { t: 'y' }], s: ['p', 'q'] };
    const approved = { a: 2, goals: [{ t: 'x' }], s: ['p', 'q', 'r'] };
    const d = diffPlans(draft, approved);
    expect(d).toContainEqual({ op: 'changed', path: 'a', from: 1, to: 2 });
    expect(d).toContainEqual({ op: 'removed', path: 'goals.1', from: { t: 'y' } });
    expect(d).toContainEqual({ op: 'added', path: 's.2', to: 'r' });
    expect(summarizeDiffBySection(d)).toEqual({ a: { changed: 1, added: 0, removed: 0 }, goals: { changed: 0, added: 0, removed: 1 }, s: { changed: 0, added: 1, removed: 0 } });
  });
});

describe('role scoping', () => {
  it('rejects global roles', () => {
    expect(roleScopeIsValid({ role: 'teacher', schoolId: null, sectionId: 'sec', studentId: null })).toBe(true);
    expect(roleScopeIsValid({ role: 'teacher', schoolId: 'sch', sectionId: null, studentId: null })).toBe(false);
    expect(roleScopeIsValid({ role: 'guardian', schoolId: null, sectionId: null, studentId: 'stu' })).toBe(true);
    expect(roleScopeIsValid({ role: 'administrator', schoolId: 'sch', sectionId: null, studentId: null })).toBe(true);
    expect(roleScopeIsValid({ role: 'administrator', schoolId: null, sectionId: null, studentId: null })).toBe(false);
  });
});

describe('signals', () => {
  it('maps tags to dimensions and validates the shape', () => {
    expect(dimensionOfTag('group_work')).toBe('work_arrangement');
    expect(dimensionOfTag('period_3')).toBe('schedule');
    expect(dimensionOfTag('nope')).toBeNull();
    const s = Signal.parse({
      id: '1', caseKey: 'ck', type: 'behavior_event', value: 1, contextTags: ['independent', 'long_assignment'],
      observedAt: '2026-09-01T10:00:00Z', source: 'teacher_entry', sourceConfidence: 'high',
    });
    expect(s.observedAt).toBeInstanceOf(Date);
    expect(() => Signal.parse({ ...s, contextTags: ['Not Snake'] })).toThrow();
  });
  it('generates distinct case keys', () => {
    const a = newCaseKey();
    const b = newCaseKey();
    expect(a).toMatch(/^ck_[A-Za-z0-9]{16}$/);
    expect(a).not.toBe(b);
  });
});
