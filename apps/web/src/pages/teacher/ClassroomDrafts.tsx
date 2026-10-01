import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Bot, CalendarClock, Check, ClipboardList, Download, FileText, History, Inbox, ListChecks, Pencil, Share2, Sparkles, Trash2, UserRound } from 'lucide-react';
import type { ArtifactContent, ArtifactKind, ArtifactSource, ClassroomObservation } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { FollowUpForm } from '../../components/FollowUps';
import { TeacherConfirm } from '../../components/TeacherConfirm';
import { Avatar, Badge, Button, Callout, Card, CardBody, Dialog, DialogContent, Empty, Input, PageSkeleton, Segmented, Textarea, cn } from '../../components/ui';
import { api, fmtDate, fmtDateTime, humanize } from '../../lib/api';
import { relativeTime } from '../../lib/utils';
import { ARTIFACT_META, INBOX_GROUPS, OBSERVATION_META, draftStage, observationText, type InboxGroup } from '../../lib/pulse';
import type { CaseListItem } from '../../lib/types';

type Draft = {
  id: string; sessionId: string; kind: ArtifactKind; revision: number; sources: ArtifactSource[];
  generationState: string; reviewState: string; publicationState: string; error: string | null;
  promptVersionId: string | null; runId: string | null; deferredUntil: string | null; createdAt: string; expiresAt: string;
  title?: string | null; students?: Array<{ id: string; displayName: string }>; evidenceKinds?: string[];
  session?: { date: string; topic: string } | null; approvedAudience?: string | null; approvedAt?: string | null;
};
type Revision = { revision: number; content: ArtifactContent; createdBy: string; createdAt: string };
type Publication = { approvedBy: string; approverName?: string; approvedAt: string; audience: string; revision: number; deliveryState: string; portalShared?: boolean };
type SourceContext = { number: number; studentId: string; firstName: string; lastName: string; observedAt: string; source: string; confirmedBy: string };
type Detail = { draft: Draft; revisions: Revision[]; evidence: Array<{ number: number; observation: ClassroomObservation }>; publications: Publication[]; sourceContext?: SourceContext[]; template?: { validation: { name: string; role: string; validatedAt: string } | null } | null };

type Status = 'review' | 'approved' | 'deferred' | 'all';
const deferred = (d: Draft) => !!d.deferredUntil && new Date(d.deferredUntil) > new Date();
const needsReview = (d: Draft) => d.reviewState === 'suggested' && !deferred(d);

/** The Draft Inbox: every AI suggestion, grouped by what it is for, behind Teacher Confirm™. */
export function ClassroomDrafts() {
  const drafts = useQuery({ queryKey: ['classroom-drafts'], queryFn: () => api.get<Draft[]>('/api/pulse/drafts'), refetchInterval: (q) => (q.state.data ?? []).some((d) => ['queued', 'running'].includes(d.generationState)) ? 3000 : 15000 });
  const legacy = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const planRevisions = useQuery({ queryKey: ['classroom-plan-revisions'], queryFn: () => api.get<Array<{ draftId: string; status: string; invalidatedAt: string | null }>>('/api/pulse/plan-revisions') });
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState<InboxGroup | 'all'>('all');
  const [status, setStatus] = useState<Status>('review');
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<'approve' | 'defer' | 'discard' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const qc = useQueryClient();
  const id = params.get('draft') ?? '';
  const select = (next: string) => setParams((p) => { const n = new URLSearchParams(p); if (next) n.set('draft', next); else n.delete('draft'); return n; }, { replace: true });
  if (drafts.isLoading) return <PageSkeleton />;
  const live = (drafts.data ?? []).filter((d) => d.reviewState !== 'discarded');
  const byStatus = (d: Draft, s: Status) => s === 'all' || (s === 'review' ? needsReview(d) || ['stale'].includes(d.reviewState) : s === 'approved' ? d.reviewState === 'approved' : deferred(d) && d.reviewState === 'suggested');
  const rows = live.filter((d) => byStatus(d, status) && (group === 'all' || ARTIFACT_META[d.kind].group === group));
  const count = (g: InboxGroup) => live.filter((d) => ARTIFACT_META[d.kind].group === g && byStatus(d, status)).length;
  const supportItems = [
    ...(planRevisions.data ?? []).filter((d) => !['approved', 'discarded'].includes(d.status)).map((d) => ({ key: d.draftId, to: `/teacher/drafts/${d.draftId}`, label: 'Classroom-informed support plan revision', state: d.invalidatedAt ? 'Source review required' : humanize(d.status) })),
    ...(legacy.data ?? []).filter((c) => c.latestDraft && !c.plan).map((c) => ({ key: c.caseKey, to: `/teacher/drafts/${c.latestDraft!.id}`, label: 'Support plan draft', state: humanize(c.latestDraft!.status) })),
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Teacher Confirm™"
        title="Drafts"
        description="What happened, what Pulsera drafted, and the evidence behind it. Nothing becomes a record until you approve an exact version. Approving never sends a message."
        actions={<Link to="/teacher"><Button variant="secondary"><ArrowLeft /> Class Pulse</Button></Link>}
      />
      {drafts.error && <p role="alert">{drafts.error.message}</p>}
      {!!supportItems.length && (
        <Callout tone="primary" title="Support plans awaiting you" className="mb-4">
          <ul className="mt-1 space-y-1">{supportItems.map((s) => <li key={s.key}><Link className="font-medium underline-offset-2 hover:underline" to={s.to}>{s.label}</Link> <span className="text-xs opacity-80">· {s.state}</span></li>)}</ul>
        </Callout>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented size="sm" value={status} onChange={setStatus} options={[
          { value: 'review', label: `To review (${live.filter((d) => byStatus(d, 'review')).length})` },
          { value: 'approved', label: 'Approved' },
          { value: 'deferred', label: `Deferred (${live.filter((d) => byStatus(d, 'deferred')).length})` },
          { value: 'all', label: 'All' },
        ]} />
      </div>
      {(
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Draft categories">
          <GroupChip active={group === 'all'} onClick={() => setGroup('all')} label="Everything" count={rows.length && group === 'all' ? rows.length : live.filter((d) => byStatus(d, status)).length} />
          {INBOX_GROUPS.map((g) => <GroupChip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)} label={g.label} count={count(g.id)} />)}
        </div>
      )}

      <Dialog open={!!confirmBulk} onOpenChange={(o) => !o && !bulkBusy && setConfirmBulk(null)}>
        {confirmBulk && bulk && (
          <DialogContent title={confirmBulk === 'approve' ? `Approve ${bulk.length} draft${bulk.length === 1 ? '' : 's'}` : confirmBulk === 'defer' ? 'Review these tomorrow' : 'Discard these drafts'} description={confirmBulk === 'approve' ? 'Each exact version below is approved and logged with your name, for your own use (teacher only). Family or student audiences are chosen one draft at a time.' : undefined}>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
              {live.filter((d) => bulk.includes(d.id)).map((d) => <li key={d.id} className="rounded-md bg-sunken/60 px-3 py-2"><span className="font-medium">{ARTIFACT_META[d.kind].label}</span>{d.title && <> · {d.title}</>}<span className="text-xs text-muted"> · version {d.revision}{d.students?.length ? ` · ${d.students.map((s) => s.displayName).join(', ')}` : ''}</span></li>)}
            </ul>
            <div className="mt-4 flex gap-2">
              <Button loading={bulkBusy} variant={confirmBulk === 'discard' ? 'danger' : 'primary'} onClick={async () => {
                setBulkBusy(true);
                try {
                  const r = await api.post<{ results: Array<{ id: string; ok: boolean; error?: string }> }>('/api/pulse/drafts/bulk', { decision: confirmBulk, items: live.filter((d) => bulk.includes(d.id)).map((d) => ({ id: d.id, expectedRevision: d.revision })) });
                  const failed = r.results.filter((x) => !x.ok);
                  if (failed.length) toast.error(`${failed.length} could not be ${confirmBulk === 'approve' ? 'approved' : 'updated'}: ${failed[0]!.error}`); else toast.success(confirmBulk === 'approve' ? `${r.results.length} approved and logged` : confirmBulk === 'defer' ? 'Deferred until tomorrow' : 'Discarded');
                  setBulk(failed.length ? failed.map((x) => x.id) : null); setConfirmBulk(null);
                  await qc.invalidateQueries({ queryKey: ['classroom-drafts'] });
                } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
                finally { setBulkBusy(false); }
              }}>{confirmBulk === 'approve' ? 'Approve these versions' : confirmBulk === 'defer' ? 'Defer' : 'Discard'}</Button>
              <Button variant="ghost" disabled={bulkBusy} onClick={() => setConfirmBulk(null)}>Cancel</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <div className="grid gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <div className={cn('space-y-2', id && 'max-lg:hidden')}>
          {!rows.length && (
            <Empty compact icon={<Inbox />} title={status === 'review' ? 'Nothing waiting for you' : 'No drafts here'} description="Confirm observations in Class Pulse and choose what to draft. Suggestions land here for review." />
          )}
          {rows.some(reviewable) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {bulk === null
                ? <Button size="sm" variant="ghost" onClick={() => setBulk([])}><ListChecks />Select several</Button>
                : <>
                    <span className="font-medium">{bulk.length} selected</span>
                    <button type="button" className="text-primary hover:underline" onClick={() => setBulk(rows.filter(reviewable).map((d) => d.id))}>All ready</button>
                    <button type="button" className="text-muted hover:underline" onClick={() => setBulk(null)}>Done</button>
                  </>}
            </div>
          )}
          {bulk !== null && !!bulk.length && (
            <div className="sticky top-2 z-10 flex flex-wrap gap-1.5 rounded-lg border border-border bg-elevated p-2 shadow-md">
              <Button size="sm" onClick={() => setConfirmBulk('approve')}><Check />Approve {bulk.length}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmBulk('defer')}><CalendarClock />Tomorrow</Button>
              <Button size="sm" variant="ghost" className="text-danger-fg" onClick={() => setConfirmBulk('discard')}><Trash2 />Discard</Button>
            </div>
          )}
          {rows.map((d) => (
            <div key={d.id} className="flex items-start gap-2">
              {bulk !== null && <input type="checkbox" aria-label={`Select ${ARTIFACT_META[d.kind].label}${d.title ? ` · ${d.title}` : ''}`} className="mt-4 size-4 accent-[var(--primary)]" disabled={!reviewable(d)} checked={bulk.includes(d.id)} onChange={(e) => setBulk((ids) => (e.target.checked ? [...(ids ?? []), d.id] : (ids ?? []).filter((x) => x !== d.id)))} />}
              <div className="min-w-0 flex-1"><DraftCard draft={d} active={id === d.id} onClick={() => select(d.id)} /></div>
            </div>
          ))}
        </div>
        <div className={cn(!id && 'max-lg:hidden')}>
          {id ? (
            <>
              <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => select('')}><ArrowLeft /> All drafts</Button>
              <ArtifactReview key={id} id={id} />
            </>
          ) : (
            <Card><CardBody className="flex min-h-64 flex-col items-center justify-center gap-2 pt-5 text-center text-sm text-muted"><Sparkles className="size-6 text-proposal" />Select a draft to see what happened, what Pulsera drafted and the evidence behind it.</CardBody></Card>
          )}
        </div>
      </div>
    </div>
  );
}

const reviewable = (d: Draft) => d.generationState === 'ready' && d.reviewState === 'suggested';

function GroupChip({ active, onClick, label, count, title }: { active: boolean; onClick(): void; label: string; count: number; title?: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} title={title} onClick={onClick} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', active ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-elevated text-muted hover:text-fg')}>
      {label}<span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-primary/15' : 'bg-sunken')}>{count}</span>
    </button>
  );
}

function DraftCard({ draft: d, active, onClick }: { draft: Draft; active: boolean; onClick(): void }) {
  const meta = ARTIFACT_META[d.kind];
  const students = d.students ?? [];
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('w-full rounded-xl border bg-elevated p-3 text-left shadow-xs transition-all', active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:-translate-y-0.5 hover:border-border-strong')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{meta.label}</span>
        <span className="ml-auto text-[11px] text-subtle">{relativeTime(d.createdAt)}</span>
      </div>
      {d.title && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{d.title}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {students.slice(0, 3).map((s) => <span key={s.id} className="inline-flex items-center gap-1"><Avatar name={s.displayName} size="sm" className="size-5 text-[9px]" />{s.displayName}</span>)}
        {students.length > 3 && <span>+{students.length - 3}</span>}
        {!!d.evidenceKinds?.length && <span>· from {d.evidenceKinds.map((k) => OBSERVATION_META[k as keyof typeof OBSERVATION_META]?.label.toLowerCase() ?? humanize(k)).join(', ')}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TeacherConfirm compact stage={draftStage(d)} />
        {deferred(d) && <Badge tone="outline"><CalendarClock /> until {fmtDate(d.deferredUntil)}</Badge>}
        {d.approvedAudience && d.approvedAudience !== 'teacher' && <Badge tone="info">For {d.approvedAudience}</Badge>}
      </div>
    </button>
  );
}

function SectionTitle({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone: string; children?: React.ReactNode }) {
  return <div className="mb-2 flex flex-wrap items-center gap-2"><span className={cn('inline-flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5', tone)}>{icon}</span><h3 className="text-sm font-semibold">{title}</h3>{children}</div>;
}

function ArtifactReview({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['classroom-draft', id], queryFn: () => api.get<Detail>(`/api/pulse/drafts/${id}`), refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.draft.generationState ?? '') ? 3000 : false });
  const [edited, setEdited] = useState<ArtifactContent | null>(null);
  const [audience, setAudience] = useState<'teacher' | 'student' | 'family'>('teacher');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['classroom-draft', id] }); await qc.invalidateQueries({ queryKey: ['classroom-drafts'] }); };
  async function action(path: string, body: unknown, done?: string) {
    setBusy(true); setError('');
    try { await api.post(`/api/pulse/drafts/${id}/${path}`, body); setEdited(null); setEditRevision(null); setStatus(done ?? 'Saved'); if (done) toast.success(done); setTimeout(() => setStatus(''), 4000); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); return false; }
    finally { setBusy(false); }
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <Callout tone="warning" title="This draft is not available">{q.error.message} Return to Class Pulse to prepare from current evidence.</Callout>;
  if (!q.data) return null;
  const { draft, revisions, publications, evidence, sourceContext = [] } = q.data;
  const meta = ARTIFACT_META[draft.kind];
  const current = revisions.find((r) => r.revision === draft.revision);
  const content = edited ?? current?.content;
  const canReview = draft.generationState === 'ready' && !['stale', 'discarded'].includes(draft.reviewState);
  const publication = publications.find((p) => p.revision === draft.revision);
  const people = [...new Map(sourceContext.map((s) => [s.studentId, `${s.firstName} ${s.lastName}`])).values()];
  const communication = ['positive_note', 'parent_message'].includes(draft.kind);

  async function exportApproved() {
    setBusy(true); setError('');
    try {
      const exported = await api.post<{ content: ArtifactContent; publication: Publication; sourceContext?: SourceContext[]; templateStatus: string | null; template?: { validation: { name: string } | null } | null }>(`/api/pulse/drafts/${id}/export`);
      const provenance = exported.sourceContext?.map((s) => `Source ${s.number}: ${s.firstName} ${s.lastName} · ${fmtDateTime(s.observedAt)} · ${humanize(s.source)}`).join('\n') ?? '';
      const text = Object.entries(exported.content).filter(([k]) => !['kind', 'sourceNumbers'].includes(k)).map(([k, v]) => `${humanize(k)}\n${Array.isArray(v) ? v.join('\n') : v ?? 'Not recorded'}`).join('\n\n') + `\n\n${provenance}\nApproved version ${exported.publication.revision} · ${exported.publication.audience} · ${exported.publication.approverName ?? 'Educator'} · ${fmtDateTime(exported.publication.approvedAt)}\n${exported.template ? exported.template.validation ? `Template validated by ${exported.template.validation.name}.\n` : 'Template not yet validated by a qualified educator — for discussion only.\n' : ''}Not sent. Export does not confirm receipt.\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `pulsera-${draft.kind}-v${draft.revision}.txt`; a.click(); URL.revokeObjectURL(url);
      setStatus('Approved version exported. No message was sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardBody className="space-y-5 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{INBOX_GROUPS.find((g) => g.id === meta.group)?.label}</div>
            <h2 className="text-lg font-semibold">{meta.label} · version {draft.revision || '—'}</h2>
            {!!people.length && <p className="text-sm text-muted">{draft.kind === 'small_group' ? 'Proposed temporary group: ' : 'About '}{people.join(', ')}</p>}
          </div>
          <TeacherConfirm stage={draftStage(draft)} />
        </div>
        {q.data.template && (q.data.template.validation
          ? <p className="flex items-center gap-1.5 text-xs text-success-fg"><Check className="size-3.5" />Template validated by {q.data.template.validation.name} ({humanize(q.data.template.validation.role)}) on {fmtDate(q.data.template.validation.validatedAt)}. Supports team discussion; formal decisions follow the school’s own process.</p>
          : <Callout tone="info">This template has not yet been validated by a qualified educator at your school, so use it for discussion only. Formal school decisions follow the school’s own process.</Callout>)}
        {draft.error && <Callout tone="danger">{draft.error}</Callout>}
        {['failed', 'disabled'].includes(draft.generationState) && <Button disabled={busy} onClick={() => void action('retry', {}, 'Retrying the draft')}>Retry generation</Button>}
        {['queued', 'running'].includes(draft.generationState) && <p role="status" className="flex items-center gap-2 text-sm text-muted"><span className="size-2 animate-pulse rounded-full bg-info" />Pulsera is preparing this draft. Classroom capture remains available.</p>}

        <section>
          <SectionTitle icon={<UserRound />} title="What happened" tone="bg-evidence-soft text-evidence"><span className="text-xs text-muted">Teacher observations · confirmed</span></SectionTitle>
          <ol className="space-y-2">
            {evidence.map((e) => {
              const ctx = sourceContext.find((s) => s.number === e.number);
              const m = OBSERVATION_META[e.observation.kind];
              const Icon = m.icon;
              return (
                <li key={e.number} className="flex gap-3 rounded-lg border border-border bg-sunken/40 p-3 text-sm">
                  <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md', m.chip)}><Icon className="size-3.5" /></span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted">Source {e.number} · {m.label}{ctx && <> · {ctx.firstName} {ctx.lastName} · {fmtDateTime(ctx.observedAt)} · {humanize(ctx.source)}</>}</p>
                    <p className="mt-0.5">{observationText(e.observation)}</p>
                    {e.observation.kind === 'behavior' && <p className="mt-0.5 text-xs text-muted">Antecedent: {e.observation.antecedent ?? 'Not recorded'} · Consequence: {e.observation.consequence ?? 'Not recorded'} · Count: {e.observation.measuredCount ?? 'Not measured'}</p>}
                    {e.observation.kind !== 'note' && e.observation.note && <p className="mt-0.5 text-xs text-muted">Note: {e.observation.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {content && (
          <section>
            <SectionTitle icon={draft.reviewState === 'approved' && !edited ? <Check /> : <Bot />} title={draft.reviewState === 'approved' && !edited ? 'Approved record' : 'What Pulsera drafted'} tone={draft.reviewState === 'approved' && !edited ? 'bg-success-soft text-success-fg' : 'bg-proposal-soft text-proposal'}>
              <span className="text-xs text-muted">{edited ? 'Editing — saves as a new version' : `${current?.createdBy === 'ai' ? 'Drafted by AI' : 'Edited by an educator'}${draft.reviewState === 'approved' ? ', approved by you' : ' · not yet approved'} · version ${draft.revision}`}</span>
            </SectionTitle>
            <div className={cn('space-y-3 rounded-lg border p-3', draft.reviewState === 'approved' && !edited ? 'border-success/30 bg-success-soft/30' : 'border-dashed border-proposal/40 bg-proposal-soft/20')}>
              {Object.entries(content).filter(([key]) => !['kind', 'sourceNumbers'].includes(key)).map(([key, value]) => (
                <label key={key} className="block text-sm font-medium">{humanize(key)}
                  {edited
                    ? key === 'measuredCount'
                      ? <Input type="number" min={0} step={1} value={value ?? ''} onChange={(e) => setEdited({ ...edited, [key]: e.target.value === '' ? null : Number(e.target.value) } as ArtifactContent)} />
                      : <Textarea rows={key === 'message' ? 6 : 3} value={Array.isArray(value) ? value.join('\n') : value ?? ''} onChange={(e) => setEdited({ ...edited, [key]: Array.isArray(value) ? e.target.value.split('\n').filter(Boolean) : ['antecedent', 'consequence'].includes(key) ? e.target.value || null : e.target.value } as ArtifactContent)} />
                    : <p className="mt-1 whitespace-pre-wrap font-normal text-fg/85">{Array.isArray(value) ? value.map((v, n) => `${n + 1}. ${v}`).join('\n') : value ?? 'Not recorded'}</p>}
                </label>
              ))}
            </div>
          </section>
        )}

        {canReview && content && draft.reviewState !== 'approved' && (
          <section className="space-y-3 rounded-lg border border-border p-3">
            <SectionTitle icon={<ClipboardList />} title="Teacher Confirm" tone="bg-info-soft text-info-fg"><span className="text-xs text-muted">You approve this exact version</span></SectionTitle>
            {edited ? (
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} onClick={() => void action('edit', { expectedRevision: editRevision, content: edited }, 'New version saved')}>Save new version</Button>
                <Button variant="ghost" disabled={busy} onClick={() => { setEdited(null); setEditRevision(null); }}>Cancel edit</Button>
              </div>
            ) : (
              <>
                {communication && (
                  <div className="space-y-1.5 text-sm font-medium"><span>Intended audience</span>
                    <Segmented size="sm" value={audience} onChange={setAudience} options={[{ value: 'teacher', label: 'Teacher only' }, { value: 'student', label: 'Student' }, { value: 'family', label: 'Family' }]} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy} onClick={() => void action('approve', { expectedRevision: draft.revision, audience }, `Version ${draft.revision} approved and logged`)}><Check /> Approve version {draft.revision}</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => { setEdited(structuredClone(content)); setEditRevision(draft.revision); }}><Pencil /> Edit wording</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void action('decide', { expectedRevision: draft.revision, decision: 'defer', until: new Date(Date.now() + 86400000).toISOString() }, 'Deferred until tomorrow')}><CalendarClock /> Review tomorrow</Button>
                  <Button variant="ghost" disabled={busy} className="text-danger-fg" onClick={() => void action('decide', { expectedRevision: draft.revision, decision: 'discard' }, 'Draft discarded')}><Trash2 /> Discard draft</Button>
                </div>
                <p className="text-xs text-muted">Approval logs this version with your name and the time. {communication ? 'It does not send anything; sharing to a portal is a separate step.' : 'It stays private to your section.'}</p>
              </>
            )}
          </section>
        )}
        {!canReview && draft.reviewState === 'suggested' && draft.generationState === 'ready' && <Button variant="ghost" disabled={busy} onClick={() => void action('decide', { expectedRevision: draft.revision, decision: 'discard' }, 'Draft discarded')}>Discard draft</Button>}

        {draft.reviewState === 'approved' && publication && (
          <section className="space-y-3 rounded-lg border border-success/30 p-3">
            <p className="flex items-start gap-2 text-sm text-success-fg"><Check className="mt-0.5 size-4 shrink-0" />Approved by {publication.approverName ?? 'Educator'}. External delivery: not sent.</p>
            <p className="text-xs text-muted">{fmtDateTime(publication.approvedAt)} · audience: {humanize(publication.audience)} · version {publication.revision}{publication.portalShared ? ' · visible in portal' : ''}</p>
            <div className="flex flex-wrap gap-2">
              {publication.audience !== 'teacher' && <Button disabled={busy} variant="secondary" onClick={() => void action('share', { expectedRevision: draft.revision, shared: !publication.portalShared }, publication.portalShared ? 'Removed from portal' : 'Shared in portal')}><Share2 />{publication.portalShared ? 'Remove from portal' : `Share approved version in ${publication.audience} portal`}</Button>}
              <Button disabled={busy} onClick={() => void exportApproved()}><Download /> Export approved version</Button>
              <Link to={`/teacher/reports/${id}`}><Button variant="secondary" disabled={busy}><FileText /> Print or PDF</Button></Link>
            </div>
            <FollowUpForm key={`${id}:${draft.revision}`} draftId={id} revision={draft.revision} />
          </section>
        )}

        {canReview && (
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold"><Sparkles className="mr-1 inline size-4 text-proposal" />Pulsera Guide™ · work with this evidence</summary>
            <p className="my-2 text-xs text-muted">Guide prepares a suggestion from the same confirmed sources. Each result is its own draft and needs its own approval.</p>
            <div className="flex flex-wrap gap-2">{(['guide_explain', 'guide_adjust', 'guide_next_step'] as const).map((kind) => (
              <Button key={kind} size="sm" variant="secondary" disabled={busy} onClick={async () => {
                setBusy(true); setError('');
                try { await api.post('/api/pulse/drafts', { sessionId: draft.sessionId, kind, sources: draft.sources }); await refresh(); toast('Guide suggestion requested', { description: 'It appears under Instruction when ready.' }); }
                catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare suggestion'); }
                finally { setBusy(false); }
              }}>{kind === 'guide_explain' ? 'Explain this evidence' : kind === 'guide_adjust' ? 'Suggest an instructional adjustment' : 'Draft a next step'}</Button>
            ))}</div>
          </details>
        )}

        {revisions.length > 1 && (
          <details>
            <summary className="cursor-pointer text-sm"><History className="mr-1 inline size-4" />Version history and changes</summary>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">{revisions.map((r, i) => <li key={r.revision}>Version {r.revision} · {r.createdBy === 'ai' ? 'AI suggestion' : 'Educator edit'} · {fmtDateTime(r.createdAt)}{i > 0 && <span> · Changed: {Object.keys(r.content).filter((k) => JSON.stringify((r.content as Record<string, unknown>)[k]) !== JSON.stringify((revisions[i - 1]!.content as Record<string, unknown>)[k])).map(humanize).join(', ')}</span>}</li>)}</ul>
          </details>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-subtle"><FileText className="size-3" />Prompt {draft.promptVersionId ?? 'not generated'}{draft.reviewState !== 'approved' && ` · unapproved content expires ${fmtDateTime(draft.expiresAt)}`}</p>
        {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        <p role="status" className="text-sm">{status}</p>
      </CardBody>
    </Card>
  );
}
