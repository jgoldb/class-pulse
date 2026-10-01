import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, BookOpenCheck, CalendarClock, CalendarDays, Check, ClipboardList, HeartHandshake, Lightbulb, RefreshCw, Settings2, Sparkles, Users } from 'lucide-react';
import type { ArtifactContent, ArtifactKind } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { TomorrowSettings } from '../../components/TomorrowSettings';
import { TeacherConfirm } from '../../components/TeacherConfirm';
import { Avatar, Badge, Button, Card, CardBody, Empty, PageSkeleton, Segmented, cn } from '../../components/ui';
import { api, humanize } from '../../lib/api';
import { ARTIFACT_META, draftStage } from '../../lib/pulse';

type DraftRow = { id: string; kind: ArtifactKind; revision: number; generationState: string; reviewState: string; publicationState: string; title?: string | null; students?: Array<{ id: string; displayName: string }>; preview?: ArtifactContent | null };
type Task = { id: string; revision: number; title: string; action: string; dueDate: string; status: string; due: boolean; sourceChanged: boolean };
type Bundle = {
  section: { id: string; name: string; timezone: string };
  today: string; targetDate: string | null; schedule: { enabled: boolean; time: string; lastResult: string | null };
  session: { id: string; date: string; topic: string; objective: string; confirmedCount: number; needsPractice: number } | null;
  instructional: DraftRow[];
  family: { drafts: DraftRow[]; candidates: Array<{ studentId: string; displayName: string; sources: Array<{ eventId: string; revision: number }>; draftId: string | null }> };
  reminders: Task[];
  interventionReviews: { tasks: Task[]; packets: DraftRow[] };
};

const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function Tomorrow() {
  const sections = useQuery({ queryKey: ['pulse-sections'], queryFn: () => api.get<Array<{ id: string; name: string; enabled: boolean }>>('/api/pulse/sections') });
  const [params, setParams] = useSearchParams();
  if (sections.isLoading) return <PageSkeleton />;
  const enabled = (sections.data ?? []).filter((s) => s.enabled);
  if (!enabled.length) return <div><PageHeader eyebrow="Tomorrow Ready™" title="Tomorrow" /><Empty icon={<CalendarClock />} title="No classes yet" description="Tomorrow Ready prepares next-day materials from the classes you teach in Class Pulse." /></div>;
  const section = enabled.find((s) => s.id === params.get('class')) ?? enabled[0]!;
  return <TomorrowFor key={section.id} sectionId={section.id} sections={enabled} onChoose={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('class', id); return n; }, { replace: true })} />;
}

function TomorrowFor({ sectionId, sections, onChoose }: { sectionId: string; sections: Array<{ id: string; name: string }>; onChoose(id: string): void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['tomorrow-bundle', sectionId], queryFn: () => api.get<Bundle>(`/api/pulse/tomorrow/${encodeURIComponent(sectionId)}/bundle`),
    refetchInterval: (query) => { const b = query.state.data; return b && [...b.instructional, ...b.family.drafts].some((d) => ['queued', 'running'].includes(d.generationState)) ? 3000 : false; },
  });
  const [busy, setBusy] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tomorrow-bundle', sectionId] }), qc.invalidateQueries({ queryKey: ['classroom-drafts'] }), qc.invalidateQueries({ queryKey: ['follow-ups'] })]);
  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try { await fn(); if (done) toast.success(done); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(''); }
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <p role="alert">{q.error?.message ?? 'Unavailable'}</p>;
  const b = q.data;
  const byKind = (k: ArtifactKind) => b.instructional.filter((d) => d.kind === k);
  const nothingYet = !b.instructional.length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tomorrow Ready™"
        title={b.targetDate ? `Ready for ${prettyDate(b.targetDate)}` : 'Tomorrow'}
        description="Prepared from today’s confirmed observations. Everything here is a draft until you approve it."
        actions={
          <>
            {sections.length > 1 && <Segmented size="sm" value={sectionId} onChange={onChoose} options={sections.map((s) => ({ value: s.id, label: s.name }))} />}
            <Button loading={busy === 'prepare'} disabled={!b.session?.confirmedCount} onClick={() => void run('prepare', async () => { const r = await api.post<{ message: string }>(`/api/pulse/tomorrow/${encodeURIComponent(sectionId)}/prepare`); toast(r.message); })}>{nothingYet ? <Sparkles /> : <RefreshCw />}{nothingYet ? 'Prepare tomorrow' : 'Refresh from today'}</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-elevated px-4 py-3 text-sm shadow-xs">
        <CalendarDays className="size-4 text-primary" />
        {b.session ? (
          <span><span className="font-semibold">{b.section.name}</span> · from {prettyDate(b.session.date)}{b.session.topic && <> · {b.session.topic}</>} — <span className="tabular-nums">{b.session.confirmedCount}</span> confirmed observation{b.session.confirmedCount === 1 ? '' : 's'}{b.session.needsPractice ? <>, <span className="tabular-nums">{b.session.needsPractice}</span> needing practice</> : null}</span>
        ) : <span className="text-muted">No class session yet. Open one in Class Pulse.</span>}
        <button type="button" onClick={() => setShowSchedule(!showSchedule)} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"><Settings2 className="size-3.5" />{b.schedule.enabled ? `Prepares automatically at ${b.schedule.time}` : 'Automatic preparation off'}</button>
      </div>
      {showSchedule && <TomorrowSettings />}
      {b.schedule.lastResult && <p className="-mt-2 text-xs text-muted">Last scheduled run: {b.schedule.lastResult}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<Sparkles />} tone="bg-primary-soft text-primary-soft-fg" title="Tomorrow’s Do Now" hint="An opening activity built from today’s evidence.">
          {byKind('do_now').map((d) => <Activity key={d.id} draft={d} />)}
          {!byKind('do_now').length && <Hint>{b.session?.confirmedCount ? 'Choose “Prepare tomorrow” to draft one.' : 'Confirm observations during class first.'}</Hint>}
        </Section>
        <Section icon={<Lightbulb />} tone="bg-info-soft text-info-fg" title="Reteach / minilesson" hint="From understanding checks and exit tickets marked “needs practice”.">
          {byKind('reteach').map((d) => <Activity key={d.id} draft={d} />)}
          {!byKind('reteach').length && <Hint>{b.session?.needsPractice ? 'Choose “Prepare tomorrow” to draft a reteach.' : 'Nothing marked “needs practice” today — no reteach needed.'}</Hint>}
        </Section>
        <Section icon={<Users />} tone="bg-proposal-soft text-proposal" title="Small groups" hint="Temporary practice groups: 2–8 students who need practice on the same concept.">
          {byKind('small_group').map((d) => <Activity key={d.id} draft={d} people />)}
          {!byKind('small_group').length && <Hint>No concept had 2–8 students needing practice.</Hint>}
        </Section>
        <Section icon={<HeartHandshake />} tone="bg-warning-soft text-warning-fg" title="Family communication" hint="One note per student, drafted only when you ask. Approving never sends anything.">
          {b.family.drafts.map((d) => <DraftLine key={d.id} draft={d} />)}
          {b.family.candidates.filter((c) => !c.draftId).map((c) => (
            <div key={c.studentId} className="flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm">
              <Avatar name={c.displayName} size="sm" /><span className="flex-1">{c.displayName} <span className="text-xs text-muted">· a success today</span></span>
              <Button size="sm" variant="soft" loading={busy === c.studentId} disabled={!!busy || !b.session} onClick={() => void run(c.studentId, () => api.post('/api/pulse/drafts', { sessionId: b.session!.id, kind: 'parent_message', sources: c.sources }), `Drafting a family note for ${c.displayName.split(' ')[0]}`)}><Sparkles />Draft note</Button>
            </div>
          ))}
          {!b.family.drafts.length && !b.family.candidates.length && <Hint>No confirmed successes today to share yet.</Hint>}
        </Section>
        <Section icon={<ClipboardList />} tone="bg-sunken text-muted" title="Follow-up reminders" hint={`Approved follow-ups due by ${b.targetDate ? prettyDate(b.targetDate) : 'the next class'}.`}>
          {b.reminders.map((t) => <TaskLine key={t.id} task={t} busy={busy === t.id} onDone={() => void run(t.id, () => api.post(`/api/pulse/follow-ups/${t.id}`, { expectedRevision: t.revision, status: 'completed' }), 'Follow-up completed')} />)}
          {!b.reminders.length && <Hint>Nothing due. Add a follow-up when you approve a draft.</Hint>}
        </Section>
        <Section icon={<BookOpenCheck />} tone="bg-hypothesis-soft text-hypothesis" title="Intervention reviews" hint="Review reminders and evidence packets waiting for you.">
          {b.interventionReviews.tasks.map((t) => <TaskLine key={t.id} task={t} busy={busy === t.id} onDone={() => void run(t.id, () => api.post(`/api/pulse/follow-ups/${t.id}`, { expectedRevision: t.revision, status: 'completed' }), 'Review recorded as done')} />)}
          {b.interventionReviews.packets.map((d) => <DraftLine key={d.id} draft={d} />)}
          {!b.interventionReviews.tasks.length && !b.interventionReviews.packets.length && <Hint>No intervention reviews due.</Hint>}
        </Section>
      </div>
    </div>
  );
}

function Section({ icon, tone, title, hint, children }: { icon: React.ReactNode; tone: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="space-y-3 pt-5">
        <div className="flex items-start gap-2.5">
          <span className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', tone)}>{icon}</span>
          <div><h2 className="text-[15px] font-semibold leading-tight">{title}</h2><p className="text-xs text-muted">{hint}</p></div>
        </div>
        <div className="space-y-2">{children}</div>
      </CardBody>
    </Card>
  );
}
const Hint = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-sunken/60 px-3 py-2.5 text-sm text-muted">{children}</p>;

/** An instructional draft with its content previewed, so the teacher can judge it at a glance. */
function Activity({ draft: d, people }: { draft: DraftRow; people?: boolean }) {
  const c = d.preview as (ArtifactContent & { objective?: string; instructions?: string[]; checkForUnderstanding?: string }) | null | undefined;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{d.title ?? ARTIFACT_META[d.kind].label}</span>
        <TeacherConfirm compact stage={draftStage(d)} className="ml-auto" />
      </div>
      {people && !!d.students?.length && <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">{d.students.map((s) => <span key={s.id} className="inline-flex items-center gap-1"><Avatar name={s.displayName} size="sm" className="size-5 text-[9px]" />{s.displayName}</span>)}</p>}
      {c && 'instructions' in c && c.instructions && (
        <div className="mt-2 text-sm">
          {c.objective && <p className="text-muted">{c.objective}</p>}
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">{c.instructions.slice(0, 4).map((i, n) => <li key={n}>{i}</li>)}</ol>
          {c.instructions.length > 4 && <p className="mt-1 text-xs text-muted">+{c.instructions.length - 4} more steps</p>}
          {c.checkForUnderstanding && <p className="mt-1.5 text-xs"><span className="font-semibold">Check for understanding:</span> {c.checkForUnderstanding}</p>}
        </div>
      )}
      {['queued', 'running'].includes(d.generationState) && <p className="mt-2 flex items-center gap-2 text-xs text-muted"><span className="size-1.5 animate-pulse rounded-full bg-info" />Pulsera is preparing this.</p>}
      <Link to={`/teacher/drafts?draft=${d.id}`} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{d.reviewState === 'approved' ? 'Open approved version' : 'Review, edit and approve'}<ArrowRight className="size-3.5" /></Link>
    </div>
  );
}

function DraftLine({ draft: d }: { draft: DraftRow }) {
  return (
    <Link to={`/teacher/drafts?draft=${d.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-border-strong">
      <span className="font-medium">{ARTIFACT_META[d.kind].label}</span>
      {d.students?.[0] && <span className="text-muted">· {d.students.map((s) => s.displayName).join(', ')}</span>}
      <TeacherConfirm compact stage={draftStage(d)} className="ml-auto" />
    </Link>
  );
}

function TaskLine({ task: t, busy, onDone }: { task: Task; busy: boolean; onDone(): void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{t.title}</span>{t.due && <Badge tone="warning">Due</Badge>}{t.sourceChanged && <Badge tone="warning">Source changed</Badge>}</div>
        {t.action && <p className="text-muted">{t.action}</p>}
        <p className="text-xs text-subtle">Due {t.dueDate} · {humanize(t.status)}</p>
      </div>
      {t.status === 'open' && !t.sourceChanged && <Button size="sm" variant="secondary" loading={busy} onClick={onDone}><Check />Done</Button>}
    </div>
  );
}
