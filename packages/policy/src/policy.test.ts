import { describe, expect, it } from 'vitest';
import { ROLES } from '@class-pulse/domain';
import { CASE_FIELDS, FIELD_MATRIX, INVARIANTS, canSee, hiddenFields, visibleFields, type PolicyRole } from './fields';
import { canAdjudicate, canApprovePlan, canLogSignal, canReadCase, caseRoleFor, resolveScope } from './scope';
import { disproportionalityIndex, publishable, suppressCells } from './aggregate';

const ALL_ROLES: PolicyRole[] = [...ROLES, 'administrator_authorized'];

describe('field visibility matrix', () => {
  it('covers every field × role cell', () => {
    for (const f of CASE_FIELDS) {
      for (const r of ALL_ROLES) {
        expect(['visible', 'redacted', 'aggregate_only']).toContain(FIELD_MATRIX[f][r]);
      }
    }
  });

  it('holds the section-13 invariants', () => {
    for (const inv of INVARIANTS) {
      for (const f of inv.neverVisible) {
        expect(canSee(f, inv.role), `${inv.role} must not see ${f}`).toBe(false);
      }
    }
  });

  it('gives an unauthorized administrator no individual narrative fields at all', () => {
    const vis = visibleFields('administrator');
    expect(vis).toEqual(['audit.events']);
  });

  it('lets an authorized administrator see the support view but never teacher free text', () => {
    expect(canSee('plan.measurableGoals', 'administrator_authorized')).toBe(true);
    expect(canSee('signal.behaviorEventNotes', 'administrator_authorized')).toBe(false);
  });

  it('gives students their own goals, strategies, progress and self-checks and nothing raw', () => {
    const vis = new Set(visibleFields('student'));
    for (const f of ['plan.measurableGoals', 'plan.studentSelfMonitoring', 'goal.progressSeries', 'signal.selfChecks', 'plan.studentStrengths']) {
      expect(vis.has(f as never), f).toBe(true);
    }
    for (const f of hiddenFields('student')) expect(vis.has(f)).toBe(false);
    expect(vis.has('signal.behaviorEvents')).toBe(false);
    expect(vis.has('signal.grades')).toBe(false);
  });

  it('gives guardians provenance and confirmed patterns in plain language, not candidates', () => {
    expect(canSee('plan.provenance', 'guardian')).toBe(true);
    expect(canSee('pattern.confirmedPlainLanguage', 'guardian')).toBe(true);
    expect(canSee('pattern.evidence', 'guardian')).toBe(true);
    expect(canSee('pattern.candidates', 'guardian')).toBe(false);
    expect(canSee('review.narrativeFamily', 'guardian')).toBe(true);
    expect(canSee('review.narrativeTeacher', 'guardian')).toBe(false);
  });

  it('teacher and support professional see every case field except the audit log', () => {
    for (const r of ['teacher', 'support_professional'] as const) {
      expect(hiddenFields(r)).toEqual(['audit.events']);
    }
  });
});

describe('row scope', () => {
  const sectionStudents = new Map([
    ['sec-A', ['stu-1', 'stu-2']],
    ['sec-B', ['stu-3']],
  ]);
  const studentCases = new Map([
    ['stu-1', ['ck-1']],
    ['stu-2', ['ck-2']],
    ['stu-3', ['ck-3']],
  ]);

  it('scopes a teacher to their section only', () => {
    const s = resolveScope({ assignments: [{ role: 'teacher', schoolId: null, sectionId: 'sec-A', studentId: null }], sectionStudents, studentCases });
    expect(canReadCase(s, 'ck-1')).toBe(true);
    expect(canReadCase(s, 'ck-2')).toBe(true);
    expect(canReadCase(s, 'ck-3')).toBe(false);
    expect(caseRoleFor(s, 'ck-1')).toBe('teacher');
    expect([...s.identifiedStudentIds].sort()).toEqual(['stu-1', 'stu-2']);
  });

  it('scopes a guardian and a student to one child / self', () => {
    const g = resolveScope({ assignments: [{ role: 'guardian', schoolId: null, sectionId: null, studentId: 'stu-3' }], sectionStudents, studentCases });
    expect(caseRoleFor(g, 'ck-3')).toBe('guardian');
    expect(canReadCase(g, 'ck-1')).toBe(false);
    const st = resolveScope({ assignments: [{ role: 'student', schoolId: null, sectionId: null, studentId: 'stu-2' }], sectionStudents, studentCases });
    expect(caseRoleFor(st, 'ck-2')).toBe('student');
    expect(st.identifiedStudentIds.size).toBe(0);
  });

  it('gives an administrator aggregate-only access unless an authorization record exists', () => {
    const a = resolveScope({ assignments: [{ role: 'administrator', schoolId: 'sch', sectionId: null, studentId: null }], sectionStudents, studentCases });
    expect(a.caseRoles.size).toBe(0);
    expect(a.adminSchoolIds.has('sch')).toBe(true);
    const b = resolveScope({
      assignments: [{ role: 'administrator', schoolId: 'sch', sectionId: null, studentId: null }],
      sectionStudents,
      studentCases,
      authorizedStudentIds: ['stu-3'],
    });
    expect(caseRoleFor(b, 'ck-3')).toBe('administrator_authorized');
    expect(canReadCase(b, 'ck-1')).toBe(false);
  });

  it('resolves the strongest role when several apply', () => {
    const s = resolveScope({
      assignments: [
        { role: 'guardian', schoolId: null, sectionId: null, studentId: 'stu-1' },
        { role: 'teacher', schoolId: null, sectionId: 'sec-A', studentId: null },
      ],
      sectionStudents,
      studentCases,
    });
    expect(caseRoleFor(s, 'ck-1')).toBe('teacher');
  });

  it('reaches section cases through caseSections when the roster mapping is not loaded', () => {
    const s = resolveScope({
      assignments: [{ role: 'teacher', schoolId: null, sectionId: 'sec-B', studentId: null }],
      sectionStudents: new Map(),
      studentCases: new Map(),
      caseSections: new Map([['ck-9', 'sec-B'], ['ck-8', 'sec-A']]),
    });
    expect(canReadCase(s, 'ck-9')).toBe(true);
    expect(canReadCase(s, 'ck-8')).toBe(false);
  });
});

describe('action policies', () => {
  it('routes signal writes by source', () => {
    expect(canLogSignal('teacher', 'teacher_entry')).toBe(true);
    expect(canLogSignal('student', 'teacher_entry')).toBe(false);
    expect(canLogSignal('student', 'student_entry')).toBe(true);
    expect(canLogSignal('guardian', 'student_entry')).toBe(false);
    expect(canLogSignal('teacher', 'system')).toBe(false);
  });
  it('routes adjudication by candidate routing', () => {
    expect(canAdjudicate('teacher', 'teacher_review')).toBe(true);
    expect(canAdjudicate('teacher', 'support_team')).toBe(false);
    expect(canAdjudicate('support_professional', 'support_team')).toBe(true);
    expect(canAdjudicate('support_professional', 'safety_escalation')).toBe(true);
    expect(canAdjudicate('guardian', 'teacher_review')).toBe(false);
  });
  it('makes plan approval configurable and never grants it to an authorized administrator', () => {
    expect(canApprovePlan('teacher', ['teacher', 'support_professional'])).toBe(true);
    expect(canApprovePlan('teacher', ['support_professional'])).toBe(false);
    expect(canApprovePlan('administrator_authorized', ['teacher', 'support_professional', 'administrator'])).toBe(false);
  });
});

describe('aggregation safety', () => {
  it('suppresses small cells and one complementary cell', () => {
    const r = suppressCells(
      [
        { key: 'grade6', count: 30 },
        { key: 'grade7', count: 3 },
        { key: 'grade8', count: 12 },
      ],
      10,
    );
    const byKey = Object.fromEntries(r.cells.map((c) => [c.key, c]));
    expect(byKey.grade7?.suppressed).toBe(true);
    expect(byKey.grade7?.count).toBeNull();
    expect(byKey.grade8?.suppressed).toBe(true);
    expect(byKey.grade8?.reason).toBe('complementary');
    expect(byKey.grade6?.suppressed).toBe(false);
    expect(r.total).toBe(45);
  });
  it('keeps everything when all cells clear the minimum', () => {
    const r = suppressCells([{ key: 'a', count: 10 }, { key: 'b', count: 25 }], 10);
    expect(r.cells.every((c) => !c.suppressed)).toBe(true);
    expect(r.total).toBe(35);
  });
  it('does not suppress empty cells', () => {
    const r = suppressCells([{ key: 'a', count: 0 }, { key: 'b', count: 25 }], 10);
    expect(r.cells.every((c) => !c.suppressed)).toBe(true);
  });
  it('publishable and disproportionality respect the minimum', () => {
    expect(publishable(5, 10)).toBe(false);
    expect(publishable(0, 10)).toBe(true);
    expect(disproportionalityIndex({ fired: 6, population: 20 }, { fired: 10, population: 100 }, 10)).toBeCloseTo(3);
    expect(disproportionalityIndex({ fired: 3, population: 5 }, { fired: 10, population: 100 }, 10)).toBeNull();
  });
});
