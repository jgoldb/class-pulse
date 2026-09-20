import type { Role, RoleAssignment } from '@class-pulse/domain';

/**
 * docs/04 layer 1 — row scope. "Which students can this user touch at all?"
 *
 * Pure: the caller resolves the user's role assignments and (for administrators) live
 * authorization records, and the section → student and student → caseKey mappings. This module
 * only decides. Nothing here touches a database, so the decisions are testable exhaustively.
 */
export interface ScopeInputs {
  assignments: ReadonlyArray<Pick<RoleAssignment, 'role' | 'schoolId' | 'sectionId' | 'studentId'>>;
  /** sectionId → studentIds currently enrolled */
  sectionStudents: ReadonlyMap<string, ReadonlyArray<string>>;
  /** studentId → caseKeys */
  studentCases: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Live (unexpired, unrevoked) authorization records for this user, as studentIds */
  authorizedStudentIds?: ReadonlyArray<string>;
  /** caseKey → sectionId, for section-scoped roles to reach cases without the identified plane */
  caseSections?: ReadonlyMap<string, string>;
}

export interface Scope {
  /** Case keys this user may read at the individual level, and the role under which. */
  caseRoles: Map<string, Role | 'administrator_authorized'>;
  /** Student ids this user may resolve through the link table (identified plane). Empty for students/guardians of self only. */
  identifiedStudentIds: Set<string>;
  /** School ids where the user holds an administrator role — aggregate access only. */
  adminSchoolIds: Set<string>;
  /** Section ids where the user teaches. */
  teacherSectionIds: Set<string>;
}

const ROLE_PRECEDENCE: Array<Role | 'administrator_authorized'> = [
  'support_professional',
  'teacher',
  'administrator_authorized',
  'guardian',
  'student',
];

function stronger(a: Role | 'administrator_authorized' | undefined, b: Role | 'administrator_authorized'): Role | 'administrator_authorized' {
  if (!a) return b;
  return ROLE_PRECEDENCE.indexOf(a) <= ROLE_PRECEDENCE.indexOf(b) ? a : b;
}

export function resolveScope(input: ScopeInputs): Scope {
  const scope: Scope = {
    caseRoles: new Map(),
    identifiedStudentIds: new Set(),
    adminSchoolIds: new Set(),
    teacherSectionIds: new Set(),
  };

  const grant = (studentId: string, role: Role | 'administrator_authorized') => {
    for (const ck of input.studentCases.get(studentId) ?? []) {
      scope.caseRoles.set(ck, stronger(scope.caseRoles.get(ck), role));
    }
  };

  for (const a of input.assignments) {
    switch (a.role) {
      case 'teacher': {
        if (!a.sectionId) break;
        scope.teacherSectionIds.add(a.sectionId);
        for (const sid of input.sectionStudents.get(a.sectionId) ?? []) {
          scope.identifiedStudentIds.add(sid);
          grant(sid, 'teacher');
        }
        // Cases attached to the section whose student mapping is unknown to the caller
        for (const [ck, sec] of input.caseSections ?? []) {
          if (sec === a.sectionId) scope.caseRoles.set(ck, stronger(scope.caseRoles.get(ck), 'teacher'));
        }
        break;
      }
      case 'support_professional': {
        if (!a.studentId) break;
        scope.identifiedStudentIds.add(a.studentId);
        grant(a.studentId, 'support_professional');
        break;
      }
      case 'guardian': {
        if (!a.studentId) break;
        scope.identifiedStudentIds.add(a.studentId);
        grant(a.studentId, 'guardian');
        break;
      }
      case 'student': {
        if (!a.studentId) break;
        grant(a.studentId, 'student');
        break;
      }
      case 'administrator': {
        if (a.schoolId) scope.adminSchoolIds.add(a.schoolId);
        break;
      }
    }
  }

  for (const sid of input.authorizedStudentIds ?? []) {
    scope.identifiedStudentIds.add(sid);
    grant(sid, 'administrator_authorized');
  }

  return scope;
}

/** Row-scope decision for a single case. */
export function caseRoleFor(scope: Scope, caseKey: string): Role | 'administrator_authorized' | null {
  return scope.caseRoles.get(caseKey) ?? null;
}

export function canReadCase(scope: Scope, caseKey: string): boolean {
  return scope.caseRoles.has(caseKey);
}

/** Who may write signals (quick entry / self-check) on a case. */
export function canLogSignal(role: Role | 'administrator_authorized', signalSource: 'teacher_entry' | 'student_entry' | 'sis_import' | 'system'): boolean {
  if (signalSource === 'teacher_entry' || signalSource === 'sis_import') return role === 'teacher' || role === 'support_professional';
  if (signalSource === 'student_entry') return role === 'student';
  return false;
}

/** Who may adjudicate a candidate, by routing (docs/02: routing determines who can adjudicate). */
export function canAdjudicate(role: Role | 'administrator_authorized', routing: 'teacher_review' | 'support_team' | 'safety_escalation'): boolean {
  switch (routing) {
    case 'teacher_review':
      return role === 'teacher' || role === 'support_professional';
    case 'support_team':
    case 'safety_escalation':
      return role === 'support_professional';
  }
}

/** Configurable approver set (open question #7). Default: teacher and support professional. */
export function canApprovePlan(role: Role | 'administrator_authorized', approverRoles: ReadonlyArray<Role>): boolean {
  return role !== 'administrator_authorized' && approverRoles.includes(role);
}

export function isTeacherLike(role: Role | 'administrator_authorized'): boolean {
  return role === 'teacher' || role === 'support_professional' || role === 'administrator_authorized';
}
