import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Lightbulb, Sparkles, Users, Wand2 } from 'lucide-react';
import type { ArtifactKind, ClassroomObservation } from '@class-pulse/domain';
import { Avatar, Dialog, SheetContent, cn } from '../../../components/ui';
import { ARTIFACT_META, OBSERVATION_META, observationText } from '../../../lib/pulse';

type Evidence = { id: string; status: string; studentId: string; observation: ClassroomObservation };

/**
 * Pulsera Guide™ as a context rail (visual spec §3, §12): it opens only when the teacher asks,
 * offers actions tied to what is on screen — this class, or the selected student — and works only
 * from confirmed observations. Every result is its own draft behind Teacher Confirm; Guide never
 * logs anything and is not a chat.
 */
export function GuidePanel<T extends Evidence>({ open, onOpenChange, student, events, nameOf, busy, onDraft, onPrepare, canPrepare }: {
  open: boolean; onOpenChange(open: boolean): void; student: { id: string; displayName: string } | null;
  events: T[]; nameOf(id: string): string; busy: boolean; canPrepare: boolean;
  onDraft(kind: ArtifactKind, sources: T[]): Promise<boolean>; onPrepare(): void;
}) {
  const [made, setMade] = useState<ArtifactKind[]>([]);
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const mine = student ? confirmed.filter((e) => e.studentId === student.id) : [];
  const practice = confirmed.filter((e) => (e.observation.kind === 'understanding' && e.observation.evidence === 'needs_practice') || (e.observation.kind === 'exit_ticket' && e.observation.assessment === 'needs_practice'));
  const groups = [...practice.reduce((m, e) => { const c = 'concept' in e.observation ? e.observation.concept.trim() : ''; if (c) { const k = c.toLowerCase(); m.set(k, { concept: c, items: [...(m.get(k)?.items ?? []), e] }); } return m; }, new Map<string, { concept: string; items: T[] }>()).values()]
    .map((g) => ({ ...g, students: [...new Set(g.items.map((e) => e.studentId))] }));
  const ask = async (kind: ArtifactKind, sources: T[]) => { if (await onDraft(kind, sources)) setMade((m) => [...m, kind]); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md" title={<span className="inline-flex items-center gap-2"><span className="inline-flex size-7 items-center justify-center rounded-lg bg-ai-soft text-ai-fg"><Sparkles className="size-4" /></span>Pulsera Guide</span>} description="Suggestions from today’s confirmed observations. Each one arrives in Drafts for you to review.">
        <div className="space-y-6">
          {student && (
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Avatar name={student.displayName} size="sm" />{student.displayName}</h3>
              <GuideAction icon={<Lightbulb />} title="Explain this student’s recent evidence" hint={mine.length ? `From ${mine.length} confirmed observation${mine.length === 1 ? '' : 's'} today. A plain summary, including what it does not show.` : 'Confirm an observation for this student first.'} disabled={busy || !mine.length} onClick={() => void ask('guide_explain', mine)} />
              <GuideAction icon={<Wand2 />} title="Suggest a next step" hint="One concrete action for the next lesson." disabled={busy || !mine.length} onClick={() => void ask('guide_next_step', mine)} />
              <Link to={`/teacher/students?student=${student.id}#guide`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Use evidence from earlier sessions <ArrowRight className="size-3.5" /></Link>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">This class</h3>
            <GuideAction icon={<Lightbulb />} title="Suggest an instructional adjustment" hint={confirmed.length ? `One teaching change to try, from ${confirmed.length} confirmed observation${confirmed.length === 1 ? '' : 's'} this session.` : 'Confirm observations during class first.'} disabled={busy || !confirmed.length} onClick={() => void ask('guide_adjust', confirmed.slice(0, 100))} />
            {groups.map((g) => {
              const ok = g.students.length >= 2 && g.students.length <= 8;
              return (
                <GuideAction key={g.concept} icon={<Users />} title={`Suggest a small group · ${g.concept}`} hint={ok ? `${g.students.map(nameOf).join(', ')} need practice.` : 'A practice group needs 2–8 students on one concept.'} disabled={busy || !ok} onClick={() => void ask('small_group', g.items)} />
              );
            })}
            {!groups.length && <p className="rounded-lg bg-sunken/70 px-4 py-3 text-sm text-muted">Mark understanding checks “needs practice” and Guide can propose practice groups.</p>}
            <GuideAction icon={<Sparkles />} title="Help me prepare tomorrow" hint="Do Now, reteach and groups from this session, ready to review in Tomorrow." disabled={busy || !canPrepare} onClick={onPrepare} />
          </section>

          {!!made.length && (
            <div className="rounded-lg border border-ai/25 bg-ai-soft/60 p-4 text-sm">
              <p className="font-medium text-ai-fg">Requested: {[...new Set(made)].map((k) => ARTIFACT_META[k].label).join(', ')}</p>
              <Link to="/teacher/drafts" className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">Review in Drafts <ArrowRight className="size-3.5" /></Link>
            </div>
          )}

          {!!confirmed.length && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">What Guide can see ({confirmed.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {confirmed.slice(0, 12).map((e) => <li key={e.id} className="flex gap-2"><span className={cn('mt-0.5 rounded px-1.5 text-[10px] font-semibold', OBSERVATION_META[e.observation.kind].chip)}>{OBSERVATION_META[e.observation.kind].label}</span><span className="min-w-0 flex-1 text-muted">{observationText(e.observation)}</span></li>)}
              </ul>
              <p className="mt-2 text-xs text-subtle">Names are never sent; Guide sees de-identified observations only.</p>
            </details>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}

function GuideAction({ icon, title, hint, disabled, onClick }: { icon: React.ReactNode; title: string; hint: string; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 rounded-xl border border-border bg-elevated p-4 text-left transition-all hover:-translate-y-0.5 hover:border-ai/40 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ai-soft text-ai-fg [&_svg]:size-4">{icon}</span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
    </button>
  );
}
