import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { forbidden } from '../context';
import { accessFor, assertResponsibleFor, classroomFor, createSection, createStudent, enrollStudent } from '../services/classroom';
import { issueInvitation, revokePendingInvitation } from '../services/invitations';

/**
 * The teacher's own class (docs/04). A teacher builds the roster they teach and opens the family
 * and student dashboards onto the children in it, without going through an administrator: in a
 * real school the person who knows the roster is the teacher, and the family's access is a
 * teaching decision, not a procurement one.
 *
 * Every grant here is still scoped, audited, and free — guardian and student accounts are not
 * seats. Teacher, support and administrator roles stay with an administrator.
 */
export function registerClassroomRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/classroom')) return;
    const actor = req.actor!;
    if (!actor.roles.has('teacher') && !actor.roles.has('support_professional')) throw forbidden('Teacher role required');
  });

  app.get('/api/classroom', async (req) => classroomFor(ctx, req.actor!));

  app.post('/api/classroom/sections', async (req) => {
    const body = z
      .object({ name: z.string().min(1).max(120), gradeLevel: z.string().min(1).max(20), periodTag: z.string().max(40).nullable().optional(), schoolId: z.string().nullable().optional() })
      .parse(req.body);
    return createSection(ctx, req.actor!, { name: body.name, gradeLevel: body.gradeLevel, periodTag: body.periodTag ?? null, schoolId: body.schoolId ?? null });
  });

  app.post('/api/classroom/students', async (req) => {
    const body = z
      .object({ sectionId: z.string(), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), gradeLevel: z.string().max(20).nullable().optional() })
      .parse(req.body);
    return createStudent(ctx, req.actor!, { sectionId: body.sectionId, firstName: body.firstName, lastName: body.lastName, gradeLevel: body.gradeLevel ?? null });
  });

  app.post('/api/classroom/enrollments', async (req) => {
    const body = z.object({ studentId: z.string(), sectionId: z.string() }).parse(req.body);
    return enrollStudent(ctx, req.actor!, body);
  });

  // ---- Family and student access ---------------------------------------------------------------
  app.get('/api/classroom/students/:studentId/access', async (req) => {
    const { studentId } = z.object({ studentId: z.string() }).parse(req.params);
    return accessFor(ctx.db, req.actor!, studentId);
  });

  /** Invite this child's parent or the child themselves. Scoped to that one student, always free. */
  app.post('/api/classroom/students/:studentId/access', async (req) => {
    const { studentId } = z.object({ studentId: z.string() }).parse(req.params);
    const body = z.object({ email: z.string().email(), role: z.enum(['guardian', 'student']) }).parse(req.body);
    const student = await assertResponsibleFor(ctx.db, req.actor!, studentId);
    return issueInvitation(ctx, req.actor!, {
      scope: { role: body.role, schoolId: null, sectionId: null, studentId },
      email: body.email,
      schoolId: student.schoolId,
      actorRole: student.responsibleAs,
    });
  });

  app.post('/api/classroom/access/:id/revoke', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const actor = req.actor!;
    await revokePendingInvitation(ctx, actor, id, async (inv) => {
      if (inv.role !== 'guardian' && inv.role !== 'student') throw forbidden('Only an administrator can revoke a staff invitation');
      if (!inv.studentId) throw forbidden('That invitation is not scoped to one of your students');
      return (await assertResponsibleFor(ctx.db, actor, inv.studentId)).responsibleAs;
    });
    return { ok: true };
  });
}
