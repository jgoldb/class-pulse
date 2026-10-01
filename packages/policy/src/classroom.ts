import type { Scope } from './scope';

/** Classroom records are teacher-private within a current section assignment. Sharing is a
 * separate explicit publication; neither a shared learner nor case grants classroom access. */
export function canUseClassroomSection(scope: Scope, sectionId: string): boolean {
  return scope.teacherSectionIds.has(sectionId);
}
export function canReadClassroomRecord(scope: Scope, userId: string, record: { sectionId: string; createdBy: string }): boolean {
  return canUseClassroomSection(scope, record.sectionId) && record.createdBy === userId;
}
