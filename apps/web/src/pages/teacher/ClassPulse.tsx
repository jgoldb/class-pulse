import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ARTIFACT_KINDS, type ArtifactKind, type CaptureEvent, type ClassroomObservation, type SessionInput } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Card, CardBody, Dialog, DialogContent, Input, PageSkeleton, Textarea } from '../../components/ui';
import { ApiError, api, fmtDateTime, humanize } from '../../lib/api';
import type { CaseListItem, Classroom, RosterStudent } from '../../lib/types';
import { TeacherToday } from './Today';
import { ClassroomHelp } from '../PulseProfiles';

type Section = Classroom['sections'][number] & { timezone: string; enabled: boolean };
type Session = { id: string; date: string; topic: string; objective: string; timezone: string; contextTags: string[] };
type Event = { id: string; revision: number; status: string; studentId: string; observation: ClassroomObservation; observedAt: string; confirmedAt: string | null; confirmedBy: string | null; source: string };
type Seat = { studentId: string; row: number; column: number };
const kinds = ['participation', 'praise', 'understanding', 'check_in', 'behavior', 'attendance', 'exit_ticket'] as const;
const initial = (kind: ClassroomObservation['kind']): ClassroomObservation => {
  switch (kind) {
    case 'participation': return { kind, action: 'contributed', note: '' };
    case 'praise': return { kind, strength: 'Contributed to class discussion', note: '' };
    case 'understanding': return { kind, concept: '', evidence: 'not_checked', note: '' };
    case 'check_in': return { kind, observation: '', note: '' };
    case 'behavior': return { kind, action: '', antecedent: null, consequence: null, measuredCount: null, note: '' };
    case 'attendance': return { kind, status: 'present', note: '' };
    case 'exit_ticket': return { kind, concept: '', response: '', assessment: 'not_assessed', note: '' };
  }
};
function observationText(o: ClassroomObservation) {
  switch (o.kind) {
    case 'participation': return humanize(o.action);
    case 'praise': return o.strength;
    case 'understanding': return `${o.concept}: ${humanize(o.evidence)}`;
    case 'check_in': return o.observation;
    case 'behavior': return `${o.action}${o.measuredCount === null ? ' · count not measured' : ` · measured count ${o.measuredCount}`}`;
    case 'attendance': return humanize(o.status);
    case 'exit_ticket': return `${o.concept}: ${o.response} · ${humanize(o.assessment)}`;
  }
}
const selectStyle = 'min-h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm';

export function ClassPulse() {
  const q = useQuery({ queryKey: ['pulse-sections'], queryFn: () => api.get<Section[]>('/api/pulse/sections') });
  const [chosen, setChosen] = useState('');
  const [pending, setPending] = useState(false);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const enabled = (q.data ?? []).filter((s) => s.enabled);
  if (!enabled.length) return <><p className="mb-4 text-sm text-muted">Class Pulse can be enabled for a synthetic workspace in Administration → School structure.</p><TeacherToday /></>;
  const section = enabled.find((s) => s.id === chosen) ?? enabled[0]!;
  return <div>
    <PageHeader title="Class Pulse" description="Record what you observe. Each confirmed observation stays separate from AI suggestions." actions={<Link to="/teacher/support"><Button variant="secondary">Support & pending decisions</Button></Link>} />
    <label className="block text-sm font-medium" htmlFor="pulse-section">Current class</label>
    <select id="pulse-section" className={`${selectStyle} mb-4 max-w-md`} value={section.id} disabled={pending} onChange={(e) => setChosen(e.target.value)}>{enabled.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <PulseClass key={section.id} section={section} onPendingChange={setPending} />
  </div>;
}

function PulseClass({ section, onPendingChange }: { section: Section; onPendingChange(value: boolean): void }) {
  const qc = useQueryClient();
  const roster = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const caseRoster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const sessions = useQuery({ queryKey: ['pulse-sessions', section.id], queryFn: () => api.get<Session[]>(`/api/pulse/sessions?sectionId=${encodeURIComponent(section.id)}`) });
  const layout = useQuery({ queryKey: ['pulse-seating', section.id], queryFn: () => api.get<{ version: number; positions: Seat[] }>(`/api/pulse/seating?sectionId=${encodeURIComponent(section.id)}`) });
  const [sessionId, setSessionId] = useState('');
  const detail = useQuery({ queryKey: ['pulse-events', sessionId], enabled: !!sessionId, queryFn: () => api.get<{ session: Session; seating: Seat[]; events: Event[] }>(`/api/pulse/sessions/${sessionId}`) });
  const [topic, setTopic] = useState('');
  const [objective, setObjective] = useState('');
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: section.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [studentId, setStudentId] = useState('');
  const [list, setList] = useState(false);
  const [observation, setObservation] = useState<ClassroomObservation>(initial('participation'));
  const [editing, setEditing] = useState<Event | null>(null);
  const [reason, setReason] = useState('');
  const [editor, setEditor] = useState(false);
  const [projection, setProjection] = useState<Event | null>(null);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pendingSession = useRef<SessionInput | null>(null);
  const [sessionPending, setSessionPending] = useState(false);
  const pendingAction = useRef<{ url: string; body: unknown } | null>(null);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [draftKind, setDraftKind] = useState<ArtifactKind>('positive_note');
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    const pending = busy || retry || sessionPending;
    onPendingChange(pending);
    const warn = (e: BeforeUnloadEvent) => { if (pending) { e.preventDefault(); e.returnValue = ''; } };
    // Keep page-memory retry work from being silently lost to navigation or refresh.
    const guardLinks = (e: MouseEvent) => { if (pending && e.target instanceof Element && e.target.closest('a[href]')) { e.preventDefault(); e.stopPropagation(); setStatus('Finish or dismiss the pending save before leaving this class.'); } };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLinks, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardLinks, true); };
  }, [busy, retry, sessionPending, onPendingChange]);
  const students = (roster.data?.students ?? []).filter((s) => s.sectionIds.includes(section.id));
  const name = (id: string) => students.find((s) => s.id === id)?.displayName ?? 'Student';
  const refresh = () => qc.invalidateQueries({ queryKey: ['pulse-events', sessionId] });
  async function perform(url: string, body: unknown) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setStatus('Saving observation…');
    pendingAction.current = { url, body };
    try {
      await api.post(url, body); pendingAction.current = null; setRetry(false); setEditor(false); setEditing(null);
      setStatus('Saved. Sharing and AI generation are separate actions.'); await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      const retryable = !(e instanceof ApiError && e.status >= 400 && e.status < 500);
      setRetry(retryable); if (!retryable) pendingAction.current = null;
      setStatus(retryable ? 'Not confirmed saved. Retry sends the same request.' : 'Not saved. Check the details and try again.');
      if (e instanceof ApiError && e.status === 409) await refresh();
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  function capture(o: ClassroomObservation, confirmed: boolean, source: CaptureEvent['source'] = 'teacher_text') {
    const body: CaptureEvent = { requestId: crypto.randomUUID(), sessionId, studentId, observation: o, observedAt: new Date().toISOString(), source, confirmed };
    return perform('/api/pulse/events', body);
  }
  if (roster.isLoading || sessions.isLoading) return <PageSkeleton />;
  if (roster.error || sessions.error) return <p role="alert">{(roster.error ?? sessions.error)?.message}</p>;
  const positions = sessionId ? detail.data?.seating ?? [] : layout.data?.positions ?? [];
  const seatColumns = Math.max(4, ...positions.map((p) => p.column + 1));
  const unseatedRow = positions.length ? Math.max(...positions.map((p) => p.row)) + 1 : 0;
  const unseated = students.filter((s) => !positions.some((p) => p.studentId === s.id));
  const seatFor = (id: string) => positions.find((p) => p.studentId === id) ?? { row: unseatedRow + Math.floor(unseated.findIndex((s) => s.id === id) / seatColumns), column: unseated.findIndex((s) => s.id === id) % seatColumns };
  return <div className="space-y-4">
    <ClassroomHelp sectionId={section.id} people={students.map((s) => ({ id: s.id, displayName: s.displayName, sections: [] }))} />
    <Card><CardBody className="space-y-3 pt-5">
      <label htmlFor="pulse-session" className="block text-sm font-medium">Class session · {section.timezone}</label>
      <select id="pulse-session" className={selectStyle} value={sessionId} disabled={busy || retry || sessionPending} onChange={(e) => { setSessionId(e.target.value); setStudentId(''); setSourceIds([]); setStatus(''); }}><option value="">Start a new session</option>{sessions.data?.map((s) => <option key={s.id} value={s.id}>{s.date} · {s.topic || 'Untitled lesson'}</option>)}</select>
      {!sessionId ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
        const body = pendingSession.current ?? { requestId: crypto.randomUUID(), sectionId: section.id, date, topic, objective, contextTags: section.periodTag ? [section.periodTag] : [] };
        pendingSession.current = body; setSessionPending(true);
        try { const s = await api.post<{ id: string }>('/api/pulse/sessions', body); pendingSession.current = null; setSessionPending(false); setSessionId(s.id); setSourceIds([]); await qc.invalidateQueries({ queryKey: ['pulse-sessions', section.id] }); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not start session'); }
        finally { inFlight.current = false; setBusy(false); }
      }}>
        <label className="text-sm">Class date<Input type="date" required value={date} disabled={busy || !!pendingSession.current} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="text-sm">Lesson topic<Input maxLength={500} value={topic} disabled={busy || !!pendingSession.current} onChange={(e) => setTopic(e.target.value)} placeholder="Fractions on a number line" /></label>
        <label className="text-sm sm:col-span-2">Lesson objective<Input maxLength={1000} value={objective} disabled={busy || !!pendingSession.current} onChange={(e) => setObjective(e.target.value)} placeholder="What will students practise?" /></label>
        <Button type="submit" loading={busy}>{pendingSession.current ? 'Retry starting session' : 'Open class'}</Button>
        {pendingSession.current && !busy && <Button variant="ghost" onClick={() => { pendingSession.current = null; setSessionPending(false); setError(''); }}>Edit session details</Button>}
      </form> : <p className="text-sm text-muted">{detail.data?.session.topic} {detail.data?.session.objective && `· ${detail.data.session.objective}`}</p>}
    </CardBody></Card>

    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{list ? 'Class roster' : 'Seating chart'}</h2><div className="flex gap-2"><Button variant="secondary" onClick={() => setList(!list)}>{list ? 'Show seating chart' : 'Show roster list'}</Button><Button variant="ghost" onClick={() => { setOrder(students.map((s) => s.id)); setArranging(true); }}>Arrange seats</Button></div></div>
    <p className="text-xs text-muted">Select a student to record an observation. No recent observation means no data. Seat changes apply to new sessions.</p>
    <div className="max-w-full overflow-x-auto"><div className="grid gap-2" style={list ? { gridTemplateColumns: '1fr' } : { gridTemplateColumns: `repeat(${seatColumns}, minmax(9rem, 1fr))` }}>
      {[...students].sort((a, b) => {
        const positions = sessionId ? detail.data?.seating : layout.data?.positions;
        const pos = (id: string) => { const p = positions?.find((s) => s.studentId === id); return p ? p.row * 20 + p.column : 1000; };
        return pos(a.id) - pos(b.id);
      }).map((s) => {
        const recent = detail.data?.events.find((e) => e.studentId === s.id && e.status === 'confirmed');
        const seat = seatFor(s.id);
        return <button key={s.id} type="button" style={list ? undefined : { gridRow: seat.row + 1, gridColumn: seat.column + 1 }} aria-pressed={studentId === s.id} onClick={() => setStudentId(s.id)} className={`min-h-24 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-primary ${studentId === s.id ? 'border-primary bg-info-soft' : 'border-border bg-elevated'}`}><span className="block font-medium">{s.displayName}</span>{!list && <span className="text-xs text-muted">Row {seat.row + 1}, seat {seat.column + 1}</span>}<span className="mt-1 block text-xs text-muted">{recent ? `${humanize(recent.observation.kind)} · ${fmtDateTime(recent.observedAt)}` : 'No recent observation'}</span></button>;
      })}
    </div></div>
    <Card className="sticky bottom-20 z-10 shadow-md sm:static"><CardBody className="pt-4"><h2 className="mb-2 text-sm font-semibold">{studentId ? name(studentId) : 'Select a student'}{!sessionId && ' · open a class to capture'}</h2><div className="flex flex-wrap gap-2">
      <Button disabled={!sessionId || !studentId || busy || retry} onClick={() => void capture(initial('participation'), true, 'teacher_tap')}>Confirm participation</Button>
      <Button variant="secondary" disabled={!sessionId || !studentId || busy || retry} onClick={() => { setEditing(null); setObservation(initial('praise')); setEditor(true); }}>Praise</Button>
      <Button variant="secondary" disabled={!sessionId || !studentId || busy || retry} onClick={() => { setEditing(null); setObservation(initial('understanding')); setEditor(true); }}>Understanding</Button>
      <Button variant="secondary" disabled={!sessionId || !studentId || busy || retry} onClick={() => { setEditing(null); setObservation(initial('check_in')); setEditor(true); }}>Check-in / observation</Button>
    </div></CardBody></Card>
    <p role="status" className="text-sm">{status}</p>
    {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    {retry && <div className="flex gap-2"><Button loading={busy} onClick={() => { const p = pendingAction.current; if (p) void perform(p.url, p.body); }}>Retry save</Button><Button variant="ghost" disabled={busy} onClick={() => { pendingAction.current = null; setRetry(false); setStatus('Retry dismissed. Refresh recent activity before capturing again.'); void refresh(); }}>Dismiss retry</Button></div>}
    <p className="text-xs text-muted">Voice capture awaits school approval of an audio provider. Enter observations in the form for now.</p>
    <h2 className="font-semibold">Recent activity</h2>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">Draft type<select className="ml-2 min-h-10 rounded border border-border bg-elevated px-2" value={draftKind} onChange={(e) => setDraftKind(e.target.value as ArtifactKind)}>{ARTIFACT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
      <Button variant="secondary" disabled={busy || !sourceIds.length} onClick={async () => {
        setBusy(true); setError('');
        try { await api.post('/api/pulse/drafts', { sessionId, kind: draftKind, sources: (detail.data?.events ?? []).filter((e) => sourceIds.includes(e.id) && e.status === 'confirmed').map((e) => ({ eventId: e.id, revision: e.revision })) }); setStatus('Draft requested. Review its status and wording in Drafts.'); await qc.invalidateQueries({ queryKey: ['classroom-drafts'] }); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare draft'); }
        finally { setBusy(false); }
      }}>Prepare from selected evidence</Button><Link className="text-sm text-primary underline" to="/teacher/drafts">Open drafts</Link>
    </div>
    {detail.error && <p role="alert">{detail.error.message}</p>}
    {!detail.data?.events.length && <p className="text-sm text-muted">No observations in this session yet.</p>}
    <ul className="divide-y divide-border">{detail.data?.events.map((event) => <li key={event.id} className="space-y-2 py-3">
      {event.status === 'confirmed' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sourceIds.includes(event.id)} onChange={(e) => setSourceIds((ids) => e.target.checked ? [...ids, event.id] : ids.filter((id) => id !== event.id))} />Use this observation as draft evidence</label>}
      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{name(event.studentId)}</strong><Badge>{event.status}</Badge><span className="text-xs text-muted">{fmtDateTime(event.observedAt)} · version {event.revision}</span></div>
      <p className="text-sm">{observationText(event.observation)}</p>{event.observation.note && <p className="text-sm text-muted">{event.observation.note}</p>}
      {event.observation.kind === 'behavior' && <p className="text-xs text-muted">Before: {event.observation.antecedent ?? 'Not recorded'} · After: {event.observation.consequence ?? 'Not recorded'}</p>}
      {event.status !== 'withdrawn' && <div className="flex flex-wrap gap-2">
        {event.status === 'pending' && <Button size="sm" disabled={busy || retry} onClick={() => void perform(`/api/pulse/events/${event.id}/confirm`, { expectedRevision: event.revision })}>Confirm this version</Button>}
        <Button size="sm" variant="secondary" disabled={busy || retry} onClick={() => { setEditing(event); setStudentId(event.studentId); setObservation(event.observation); setReason(''); setEditor(true); }}>Correct</Button>
        <Button size="sm" variant="ghost" disabled={busy || retry} onClick={() => void perform(`/api/pulse/events/${event.id}/withdraw`, { expectedRevision: event.revision })}>Undo observation</Button>
        {event.status === 'confirmed' && ['behavior', 'attendance'].includes(event.observation.kind) && <Button size="sm" variant="ghost" disabled={busy || retry} onClick={() => { setProjection(event); setDestination(''); }}>Connect to support case</Button>}
      </div>}
    </li>)}</ul>
    <Dialog open={editor} onOpenChange={(open) => !busy && setEditor(open)}><DialogContent className="max-h-[90dvh] overflow-y-auto" title={editing ? 'Correct observation' : 'Record observation'} description="Check the wording and student before confirming.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (editing) void perform(`/api/pulse/events/${editing.id}/revise`, { requestId: crypto.randomUUID(), expectedRevision: editing.revision, studentId, observation, reason, confirmed: true }); else void capture(observation, true); }}>
        {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        <label className="block text-sm">Student<select className={selectStyle} value={studentId} onChange={(e) => setStudentId(e.target.value)}>{students.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
        <ObservationFields value={observation} onChange={setObservation} />
        {editing && <label className="block text-sm">Reason for correction<Input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <Button type="submit" disabled={busy || retry} loading={busy}>Confirm {editing ? 'correction' : 'observation'}</Button>
        {!editing && <Button type="button" variant="ghost" disabled={busy || retry} onClick={() => void capture(observation, false)}>Save for review</Button>}
      </form>
    </DialogContent></Dialog>
    <Dialog open={arranging} onOpenChange={setArranging}><DialogContent className="max-h-[90dvh] overflow-y-auto" title="Arrange seats" description="Seats run left to right in rows of four. Use Move up to change the order. Existing session snapshots stay unchanged.">
      <ol className="space-y-2">{order.map((id, index) => <li key={id} className="flex items-center justify-between gap-2 text-sm"><span>{index + 1}. {name(id)}</span><Button size="sm" variant="secondary" disabled={index === 0 || busy} aria-label={`Move ${name(id)} up`} onClick={() => setOrder((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>Move up</Button></li>)}</ol>
      <Button className="mt-4" loading={busy} onClick={async () => { setBusy(true); setError(''); try { await api.post(`/api/pulse/seating/${section.id}`, { expectedVersion: layout.data?.version ?? 0, positions: order.map((id, i) => ({ studentId: id, row: Math.floor(i / 4), column: i % 4 })) }); await qc.invalidateQueries({ queryKey: ['pulse-seating', section.id] }); setArranging(false); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save seats'); } finally { setBusy(false); } }}>Save seating</Button>
    </DialogContent></Dialog>
    <Dialog open={!!projection} onOpenChange={(open) => !open && setProjection(null)}><DialogContent title="Connect observation to a support case" description="Only explicit attendance or a measured behavior count can be included. A correction or undo retires the projected signal.">
      <label className="block text-sm">Existing case<select className={selectStyle} value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">Choose this student's case</option>{(cases.data ?? []).filter((c) => c.sectionId === section.id && caseRoster.data?.find((s) => s.id === projection?.studentId)?.caseKeys.includes(c.caseKey)).map((c) => <option key={c.caseKey} value={c.caseKey}>{projection ? name(projection.studentId) : ''} · {humanize(c.status)} · {c.plan ? 'Support plan' : 'Case without plan'}</option>)}</select></label>
      <Button className="mt-3" disabled={!destination || busy} onClick={async () => { if (!projection) return; await perform(`/api/pulse/events/${projection.id}/project`, { expectedRevision: projection.revision, caseKey: destination, goalId: null, strategyId: null }); setProjection(null); }}>Confirm connection</Button>
    </DialogContent></Dialog>
  </div>;
}

function ObservationFields({ value: o, onChange: set }: { value: ClassroomObservation; onChange(v: ClassroomObservation): void }) {
  return <>
    <label className="block text-sm">Observation type<select className={selectStyle} value={o.kind} onChange={(e) => set(initial(e.target.value as ClassroomObservation['kind']))}>{kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
    {o.kind === 'participation' && <label className="block text-sm">Action<select className={selectStyle} value={o.action} onChange={(e) => set({ ...o, action: e.target.value as typeof o.action })}>{['contributed', 'asked_question', 'collaborated'].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select></label>}
    {o.kind === 'praise' && <label className="block text-sm">Strength or success<Input required maxLength={500} value={o.strength} onChange={(e) => set({ ...o, strength: e.target.value })} /></label>}
    {(o.kind === 'understanding' || o.kind === 'exit_ticket') && <label className="block text-sm">Concept<Input required maxLength={500} value={o.concept} onChange={(e) => set({ ...o, concept: e.target.value })} /></label>}
    {o.kind === 'understanding' && <label className="block text-sm">Observed evidence<select className={selectStyle} value={o.evidence} onChange={(e) => set({ ...o, evidence: e.target.value as typeof o.evidence })}>{['demonstrated', 'needs_practice', 'not_checked'].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select></label>}
    {o.kind === 'check_in' && <label className="block text-sm">What did you observe?<Input required maxLength={500} value={o.observation} onChange={(e) => set({ ...o, observation: e.target.value })} /></label>}
    {o.kind === 'behavior' && <>
      <label className="block text-sm">Observable action<Input required maxLength={500} value={o.action} onChange={(e) => set({ ...o, action: e.target.value })} /></label>
      <label className="block text-sm">Before (optional)<Input maxLength={2000} value={o.antecedent ?? ''} onChange={(e) => set({ ...o, antecedent: e.target.value || null })} /></label>
      <label className="block text-sm">After (optional)<Input maxLength={2000} value={o.consequence ?? ''} onChange={(e) => set({ ...o, consequence: e.target.value || null })} /></label>
      <label className="block text-sm">Measured count (leave blank if unmeasured)<Input type="number" min={0} max={10000} step={1} value={o.measuredCount ?? ''} onChange={(e) => set({ ...o, measuredCount: e.target.value === '' ? null : Number(e.target.value) })} /></label>
    </>}
    {o.kind === 'attendance' && <label className="block text-sm">Attendance<select className={selectStyle} value={o.status} onChange={(e) => set({ ...o, status: e.target.value as typeof o.status })}>{['present', 'absent', 'late'].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select></label>}
    {o.kind === 'exit_ticket' && <>
      <label className="block text-sm">Reviewed response<Input required maxLength={500} value={o.response} onChange={(e) => set({ ...o, response: e.target.value })} /></label>
      <label className="block text-sm">Assessment<select className={selectStyle} value={o.assessment} onChange={(e) => set({ ...o, assessment: e.target.value as typeof o.assessment })}>{['demonstrated', 'needs_practice', 'not_assessed'].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select></label>
    </>}
    <label className="block text-sm">Context note (optional)<Textarea maxLength={2000} value={o.note} onChange={(e) => set({ ...o, note: e.target.value })} placeholder="Observable actions, without names or diagnoses" /></label>
  </>;
}
