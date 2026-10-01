import { afterAll, describe, expect, it } from 'vitest';
import { newId } from '@class-pulse/domain';
import { createApp, type AppHandle } from './bootstrap';
import { openDb } from './db/client';
import { backupDatabase, orderedTables, restoreDatabase, rowCounts } from './db/backup';
import { auditEvents, classSections, organizations, roleAssignments, schools, sectionEnrollments, students, users } from './db/schema';
import { audit } from './services/audit';

let source: AppHandle;
afterAll(async () => { await source?.close(); });

describe('logical backup and restore', () => {
  it('orders parents before children and round-trips every row into an empty database', async () => {
    expect(orderedTables().length).toBeGreaterThan(30);
    source = await createApp({ env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', AI_PROVIDER: 'off', OPENAI_API_KEY: '' }, memory: true, pollMs: 60000 });
    const db = source.ctx.db;
    await db.insert(organizations).values({ id: 'org', name: 'Synthetic workspace' });
    await db.insert(schools).values({ id: 'school', orgId: 'org', name: 'School', pendingRetentionDays: 14 });
    await db.insert(classSections).values({ id: 'section', schoolId: 'school', name: 'Class', gradeLevel: '6' });
    await db.insert(users).values({ id: 'teacher', displayName: 'Teacher', email: 'teacher@test.school' });
    await db.insert(students).values({ id: 'a', schoolId: 'school', firstName: 'Robin', lastName: 'Sample', gradeLevel: '6' });
    await db.insert(sectionEnrollments).values({ sectionId: 'section', studentId: 'a' });
    await db.insert(roleAssignments).values({ id: newId(), userId: 'teacher', role: 'teacher', sectionId: 'section' });
    await audit(db, { actorUserId: 'teacher', actorRole: 'teacher', action: 'classroom.read', targetType: 'section', targetId: 'section' });
    const backup = await backupDatabase(db);
    expect(backup.tables['identified.students']).toHaveLength(1);
    const before = await rowCounts(db);

    const target = await openDb({ url: null, memory: true });
    try {
      const after = await restoreDatabase(target.db, JSON.parse(JSON.stringify(backup)));
      expect(after).toEqual(before);
      const [school] = await target.db.select().from(schools);
      expect(school!.pendingRetentionDays).toBe(14);
      const [entry] = await target.db.select().from(auditEvents);
      expect(entry!.at).toBeInstanceOf(Date);
      await expect(restoreDatabase(target.db, backup)).rejects.toThrow(/Refusing to restore/);
    } finally { await target.close(); }
  });
});
