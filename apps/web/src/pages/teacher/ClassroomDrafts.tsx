import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ArtifactContent, ArtifactKind, ArtifactSource, ClassroomObservation } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { TomorrowSettings } from '../../components/TomorrowSettings';
import { FollowUpForm, FollowUps } from '../../components/FollowUps';
import { Badge, Button, Card, CardBody, Input, PageSkeleton, Textarea } from '../../components/ui';
import { api, fmtDateTime, humanize } from '../../lib/api';
import type { CaseListItem } from '../../lib/types';

type Draft = { id: string; sessionId: string; kind: ArtifactKind; revision: number; sources: ArtifactSource[]; generationState: string; reviewState: string; publicationState: string; error: string | null; promptVersionId: string | null; runId: string | null; deferredUntil: string | null; createdAt: string; expiresAt: string };
type Revision = { revision: number; content: ArtifactContent; createdBy: string; createdAt: string };
type Publication = { approvedBy: string; approverName?: string; approvedAt: string; audience: string; revision: number; deliveryState: string; portalShared?: boolean };
type SourceContext = { number: number; studentId: string; firstName: string; lastName: string; observedAt: string; source: string; confirmedBy: string };
type Detail = { draft: Draft; revisions: Revision[]; evidence: Array<{ number: number; observation: ClassroomObservation }>; publications: Publication[]; sourceContext?: SourceContext[] };

export function ClassroomDrafts({ tomorrow = false }: { tomorrow?: boolean }) {
  const drafts = useQuery({ queryKey: ['classroom-drafts'], queryFn: () => api.get<Draft[]>('/api/pulse/drafts'), refetchInterval: 5000 });
  const legacy = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const planRevisions = useQuery({ queryKey: ['classroom-plan-revisions'], queryFn: () => api.get<Array<{ draftId: string; status: string; invalidatedAt: string | null }>>('/api/pulse/plan-revisions') });
  const [id, setId] = useState('');
  const [showDeferred, setShowDeferred] = useState(false);
  if (drafts.isLoading) return <PageSkeleton />;
  const rows = (drafts.data ?? []).filter((d) => (!tomorrow || ['do_now', 'reteach', 'small_group'].includes(d.kind)) && d.reviewState !== 'discarded' && (showDeferred || !d.deferredUntil || new Date(d.deferredUntil) <= new Date()));
  return <div>
    <PageHeader title={tomorrow ? 'Tomorrow Ready' : 'Drafts'} description={tomorrow ? 'Review next-class activities prepared from confirmed classroom observations.' : 'Inspect the evidence, edit the wording, and approve an exact version. Messages are not sent.'} actions={<Link to="/teacher"><Button>Prepare from Class Pulse</Button></Link>} />
    {drafts.error && <p role="alert">{drafts.error.message}</p>}
    {tomorrow && <><TomorrowSettings /><FollowUps /></>}
    {!tomorrow && planRevisions.data?.filter((d) => !['approved', 'discarded'].includes(d.status)).map((d) => <Link className="mb-2 block text-sm text-primary underline" key={d.draftId} to={`/teacher/drafts/${d.draftId}`}>Classroom-informed plan revision · {d.invalidatedAt ? 'Source review required' : humanize(d.status)}</Link>)}
    <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={showDeferred} onChange={(e) => setShowDeferred(e.target.checked)} />Include deferred drafts</label>
    {!tomorrow && (legacy.data ?? []).filter((c) => c.latestDraft && !c.plan).map((c) => <Link className="mb-2 block text-sm text-primary underline" key={c.caseKey} to={`/teacher/drafts/${c.latestDraft!.id}`}>Support plan draft · {humanize(c.latestDraft!.status)}</Link>)}
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]"><div className="space-y-2">
      {!rows.length && <p className="text-sm text-muted">No drafts here yet. Confirm observations in Class Pulse, select evidence, then choose a draft type.</p>}
      {rows.map((d) => <button type="button" key={d.id} onClick={() => setId(d.id)} aria-pressed={id === d.id} className={`w-full rounded-lg border p-3 text-left ${id === d.id ? 'border-primary bg-info-soft' : 'border-border bg-elevated'}`}><span className="block text-sm font-semibold">{humanize(d.kind)}</span><span className="text-xs text-muted">{fmtDateTime(d.createdAt)}</span><div className="mt-2 flex flex-wrap gap-1"><Badge>{d.generationState}</Badge><Badge>{d.reviewState}</Badge>{d.publicationState !== 'unpublished' && <Badge>{humanize(d.publicationState)}</Badge>}</div></button>)}
    </div>{id ? <ArtifactReview key={id} id={id} /> : <Card><CardBody className="pt-5 text-sm text-muted">Select a draft to review its evidence and wording.</CardBody></Card>}</div>
  </div>;
}

function ArtifactReview({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['classroom-draft', id], queryFn: () => api.get<Detail>(`/api/pulse/drafts/${id}`), refetchInterval: 5000 });
  const [edited, setEdited] = useState<ArtifactContent | null>(null);
  const [audience, setAudience] = useState('teacher');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['classroom-draft', id] }); await qc.invalidateQueries({ queryKey: ['classroom-drafts'] }); };
  async function action(path: string, body: unknown) {
    setBusy(true); setError('');
    try { await api.post(`/api/pulse/drafts/${id}/${path}`, body); setEdited(null); setEditRevision(null); setStatus('Saved'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <p role="alert">{q.error.message} Return to Class Pulse to prepare from current evidence.</p>;
  if (!q.data) return null;
  const { draft, revisions, publications, evidence, sourceContext = [] } = q.data;
  const current = revisions.find((r) => r.revision === draft.revision);
  const content = edited ?? current?.content;
  const canReview = draft.generationState === 'ready' && !['stale', 'discarded'].includes(draft.reviewState);
  return <Card><CardBody className="space-y-4 pt-5">
    <h2 className="text-lg font-semibold">{humanize(draft.kind)} · version {draft.revision}</h2>
    {['sst_report', 'mtss_report', 'fba_observations'].includes(draft.kind) && <p className="rounded bg-info-soft p-3 text-sm">Synthetic report template awaiting educator validation before pilot use. This packet supports team discussion; formal school decisions require the school's own process.</p>}
    {draft.kind === 'small_group' && <p className="text-sm">Proposed temporary group: {[...new Map(sourceContext.map((s) => [s.studentId, `${s.firstName} ${s.lastName}`])).values()].join(', ')}. Approval confirms this group for the proposed practice activity.</p>}
    {!!sourceContext.length && <ul className="text-xs text-muted">{sourceContext.map((s) => <li key={s.number}>Source {s.number}: {s.firstName} {s.lastName} · {fmtDateTime(s.observedAt)} · {humanize(s.source)}</li>)}</ul>}
    <p className="text-sm">Generation: {draft.generationState} · Review: {draft.reviewState} · Publication: {humanize(draft.publicationState)}</p>
    {draft.error && <p role="alert" className="text-sm text-danger-fg">{draft.error}</p>}
    {['failed', 'disabled'].includes(draft.generationState) && <Button disabled={busy} onClick={() => void action('retry', {})}>Retry generation</Button>}
    {['queued', 'running'].includes(draft.generationState) && <p role="status" className="text-sm text-muted">Preparing your draft. Classroom capture remains available.</p>}
    <details open><summary className="cursor-pointer text-sm font-semibold">Source evidence ({evidence.length})</summary><ol className="mt-2 space-y-2 text-sm">{evidence.map((e) => <li key={e.number}><strong>Source {e.number} · {humanize(e.observation.kind)}</strong><dl>{Object.entries(e.observation).filter(([k]) => k !== 'kind').map(([k, v]) => <div key={k}><dt className="inline text-muted">{humanize(k)}: </dt><dd className="inline">{v === null || v === '' ? 'Not recorded' : String(v)}</dd></div>)}</dl></li>)}</ol></details>
    {content && <div className="space-y-3">{Object.entries(content).filter(([key]) => !['kind', 'sourceNumbers'].includes(key)).map(([key, value]) => <label key={key} className="block text-sm font-medium">{humanize(key)}
      {edited ? key === 'measuredCount' ? <Input type="number" min={0} step={1} value={value ?? ''} onChange={(e) => setEdited({ ...edited, [key]: e.target.value === '' ? null : Number(e.target.value) } as ArtifactContent)} /> : <Textarea rows={key === 'message' ? 6 : 3} value={Array.isArray(value) ? value.join('\n') : value ?? ''} onChange={(e) => setEdited({ ...edited, [key]: Array.isArray(value) ? e.target.value.split('\n').filter(Boolean) : ['antecedent', 'consequence'].includes(key) ? e.target.value || null : e.target.value } as ArtifactContent)} /> : <p className="mt-1 whitespace-pre-wrap font-normal text-muted">{Array.isArray(value) ? value.map((v, n) => `${n + 1}. ${v}`).join('\n') : value ?? 'Not recorded'}</p>}
    </label>)}</div>}
    {revisions.length > 1 && <details><summary className="cursor-pointer text-sm">Version history and changes</summary><ul className="mt-2 space-y-2 text-xs text-muted">{revisions.map((r, i) => <li key={r.revision}>Version {r.revision} · {r.createdBy === 'ai' ? 'AI suggestion' : 'Educator edit'} · {fmtDateTime(r.createdAt)}{i > 0 && <span> · Changed: {Object.keys(r.content).filter((k) => JSON.stringify((r.content as any)[k]) !== JSON.stringify((revisions[i - 1]!.content as any)[k])).map(humanize).join(', ')}</span>}</li>)}</ul></details>}
    {canReview && content && <div className="flex flex-wrap gap-2">
      {edited ? <><Button loading={busy} onClick={() => void action('edit', { expectedRevision: editRevision, content: edited })}>Save new version</Button><Button variant="ghost" disabled={busy} onClick={() => { setEdited(null); setEditRevision(null); }}>Cancel edit</Button></> : <Button variant="secondary" disabled={busy} onClick={() => { setEdited(structuredClone(content)); setEditRevision(draft.revision); }}>Edit wording</Button>}
      {!edited && draft.reviewState !== 'approved' && <>
        <label className="text-sm">Intended audience<select className="ml-2 min-h-10 rounded border border-border bg-elevated px-2" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="teacher">Teacher</option>{['positive_note', 'parent_message'].includes(draft.kind) && <><option value="student">Student</option><option value="family">Family</option></>}</select></label>
        <Button loading={busy} onClick={() => void action('approve', { expectedRevision: draft.revision, audience })}>Approve version {draft.revision}</Button>
      </>}
    </div>}
    {draft.reviewState !== 'approved' && <div className="flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => void action('decide', { expectedRevision: draft.revision, decision: 'defer', until: new Date(Date.now() + 86400000).toISOString() })}>Review tomorrow</Button><Button variant="ghost" disabled={busy} onClick={() => void action('decide', { expectedRevision: draft.revision, decision: 'discard' })}>Discard draft</Button></div>}
    {draft.reviewState === 'approved' && <>
      <p className="text-sm text-success-fg">Approved by {publications.find((p) => p.revision === draft.revision)?.approverName ?? 'Educator'}. External delivery: not sent.</p>
      {publications.find((p) => p.revision === draft.revision)?.audience !== 'teacher' && <Button disabled={busy} variant="secondary" onClick={() => void action('share', { expectedRevision: draft.revision, shared: !publications.find((p) => p.revision === draft.revision)?.portalShared })}>{publications.find((p) => p.revision === draft.revision)?.portalShared ? 'Remove from portal' : `Share approved version in ${publications.find((p) => p.revision === draft.revision)?.audience} portal`}</Button>}
      <FollowUpForm key={`${id}:${draft.revision}`} draftId={id} revision={draft.revision} />
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try {
          const exported = await api.post<{ content: ArtifactContent; publication: Publication; sourceContext?: SourceContext[]; templateStatus: string | null }>(`/api/pulse/drafts/${id}/export`);
          const provenance = exported.sourceContext?.map((s) => `Source ${s.number}: ${s.firstName} ${s.lastName} · ${fmtDateTime(s.observedAt)} · ${humanize(s.source)}`).join('\n') ?? '';
          const text = Object.entries(exported.content).filter(([k]) => !['kind', 'sourceNumbers'].includes(k)).map(([k, v]) => `${humanize(k)}\n${Array.isArray(v) ? v.join('\n') : v ?? 'Not recorded'}`).join('\n\n') + `\n\n${provenance}\nApproved version ${exported.publication.revision} · ${exported.publication.audience} · ${exported.publication.approverName ?? 'Educator'} · ${fmtDateTime(exported.publication.approvedAt)}\n${exported.templateStatus ? 'Synthetic template — pending educator validation before pilot use.\n' : ''}Not sent. Export does not confirm receipt.\n`;
          const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          const a = document.createElement('a'); a.href = url; a.download = `pulsera-${draft.kind}-v${draft.revision}.txt`; a.click(); URL.revokeObjectURL(url); setStatus('Approved version exported. No message was sent.');
        } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
      }}>Export approved version</Button>
    </>}
    {canReview && <details><summary className="cursor-pointer text-sm font-semibold">Pulsera Guide · work with this evidence</summary><p className="my-2 text-xs text-muted">Guide prepares a suggestion from the same confirmed sources. Each result needs its own review and approval.</p><div className="flex flex-wrap gap-2">{(['guide_explain', 'guide_adjust', 'guide_next_step'] as const).map((kind) => <Button key={kind} variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await api.post('/api/pulse/drafts', { sessionId: draft.sessionId, kind, sources: draft.sources }); await refresh(); setStatus('Guide suggestion requested. Select it in the draft list when ready.'); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare suggestion'); }
      finally { setBusy(false); }
    }}>{kind === 'guide_explain' ? 'Explain evidence' : kind === 'guide_adjust' ? 'Suggest an adjustment' : 'Draft a next step'}</Button>)}</div></details>}
    <p className="text-xs text-muted">Prompt: {draft.promptVersionId ?? 'Not generated'} · Expires {fmtDateTime(draft.expiresAt)}</p>
    {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}<p role="status" className="text-sm">{status}</p>
  </CardBody></Card>;
}
