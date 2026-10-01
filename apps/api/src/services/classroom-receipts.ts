import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { conflict } from '../context';
import { expiredClassroomRequests } from '../db/schema';

export async function rejectExpiredRequest(db: Db, kind: 'event' | 'contribution', createdBy: string, requestId: string) {
  const [expired] = await db.select({ id: expiredClassroomRequests.id }).from(expiredClassroomRequests).where(and(eq(expiredClassroomRequests.kind, kind), eq(expiredClassroomRequests.createdBy, createdBy), eq(expiredClassroomRequests.requestId, requestId)));
  if (expired) throw conflict('This submission expired. Start a new observation or contribution if it is still needed');
}
