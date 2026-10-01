import { eq } from 'drizzle-orm';
import { CaptureVocabulary, DEFAULT_CAPTURE_VOCABULARY } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { forbidden } from '../context';
import { teacherPreferences } from '../db/schema';
import { audit } from './audit';
import { teacherSections } from './classroom';
import { validateClassroomText } from './pulse';

export async function captureVocabulary(ctx: AppContext, actor: Actor) {
  const [row] = await ctx.db.select().from(teacherPreferences).where(eq(teacherPreferences.userId, actor.userId));
  return { vocabulary: row?.captureVocabulary ?? DEFAULT_CAPTURE_VOCABULARY, custom: !!row?.captureVocabulary, defaults: DEFAULT_CAPTURE_VOCABULARY };
}

/** Presets are pasted into observations verbatim, so they get the same roster/PII check as observation text. */
export async function saveCaptureVocabulary(ctx: AppContext, actor: Actor, input: CaptureVocabulary | null) {
  const sections = await teacherSections(ctx.db, actor);
  if (!sections.length) throw forbidden('Only teachers with a class can set capture presets');
  const vocabulary = input === null ? null : CaptureVocabulary.parse(input);
  if (vocabulary) for (const s of sections) await validateClassroomText(ctx.db, s.id, vocabulary);
  await ctx.db.insert(teacherPreferences).values({ userId: actor.userId, captureVocabulary: vocabulary, updatedAt: ctx.now() })
    .onConflictDoUpdate({ target: teacherPreferences.userId, set: { captureVocabulary: vocabulary, updatedAt: ctx.now() } });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'classroom.vocabulary', targetType: 'user', targetId: actor.userId, metadata: { reset: vocabulary === null, praise: vocabulary?.praise.length ?? 0, checkIn: vocabulary?.checkIn.length ?? 0 } });
  return captureVocabulary(ctx, actor);
}
