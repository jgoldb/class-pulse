import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BookOpen, CalendarDays, ChevronDown, Eye, EyeOff, Inbox, LayoutGrid, List, Move, Plus, RotateCcw, Target } from 'lucide-react';
import { DEFAULT_CAPTURE_VOCABULARY, type ArtifactKind, type CaptureEvent, type CaptureVocabulary, type ClassroomObservation, type SessionInput } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Card, CardBody, Dialog, DialogContent, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Empty, Input, PageSkeleton, Segmented, cn } from '../../components/ui';
import { ApiError, api, humanize } from '../../lib/api';
import type { CaseListItem, Classroom, RosterStudent } from '../../lib/types';
import { ARTIFACT_META, OBSERVATION_META, emptyObservation, type ObservationKind } from '../../lib/pulse';
import { ClassroomHelp } from '../PulseProfiles';
import { ActivityFeed, type DraftRow, type PulseEvent } from './pulse/ActivityFeed';
import { CaptureDock, VocabularyDialog, typingTarget } from './pulse/CaptureDock';
import { ObservationDialog, selectStyle, type EditorState } from './pulse/ObservationEditor';
import { SeatArranger, SeatingChart, layoutFor, type Seat, type StudentActivity } from './pulse/SeatingChart';
import { ClassGuide } from './pulse/StudentGuide';
import { VoiceCapture } from './pulse/VoiceCapture';

type Section = Classroom['sections'][number] & { timezone: string; enabled: boolean };
type Session = { id: string; date: string; topic: string; objective: string; timezone: string; contextTags: string[] };

const todayIn = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Class Pulse™ — the teacher's home. The class is the primary object: a teacher selects a class,
 * opens today's session once, and captures observations for any enrolled student without a case.
 */
export function ClassPulse() {
  const q = useQuery({ queryKey: ['pulse-sections'], queryFn: () => api.get<Section[]>('/api/pulse/sections') });
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const enabled = (q.data ?? []).filter((s) => s.enabled);
  if (!enabled.length) {
    return (
      <div>
        <PageHeader eyebrow="Pulsera" title="Class Pulse" description="Live classroom capture for every student, no support case required." />
        <Empty
          icon={<LayoutGrid />}
          title={q.data?.length ? 'Class Pulse is not switched on for this workspace' : 'No classes assigned yet'}
          description={q.data?.length ? 'An administrator can enable it for a synthetic workspace in Administration → School structure. Your support work is unaffected.' : 'Once you are assigned to a class, it appears here with its seating chart.'}
          action={<Link to="/teacher/support"><Button variant="secondary"><BookOpen /> Open support work</Button></Link>}
        />
      </div>
    );
  }
  const section = enabled.find((s) => s.id === params.get('class')) ?? enabled[0]!;
  const choose = (id: string) => setParams((p) => { const next = new URLSearchParams(p); next.set('class', id); return next; }, { replace: true });
  return (
    <div>
      <PageHeader
        eyebrow="Class Pulse™"
        title={section.name}
        actions={
          <>
            {enabled.length > 1 && (enabled.length <= 4
              ? <Segmented size="sm" value={section.id} onChange={(id) => !pending && choose(id)} options={enabled.map((s) => ({ value: s.id, label: s.name }))} />
              : <select aria-label="Current class" className={cn(selectStyle, 'min-h-9 w-56')} value={section.id} disabled={pending} onChange={(e) => choose(e.target.value)}>{enabled.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
            <Link to="/teacher/support" className="max-lg:hidden"><Button variant="ghost" size="sm"><BookOpen /> Support</Button></Link>
          </>
        }
      />
      <PulseClass key={section.id} section={section} onPendingChange={setPending} />
    </div>
  );
}

/** Compact on phones (value and label only) so the seating chart stays above the fold. */
function PulseStat({ label, short, value, hint, active }: { label: string; short?: string; value: React.ReactNode; hint?: React.ReactNode; active?: boolean }) {
  return (
    <div className={cn('h-full rounded-lg border bg-elevated px-2.5 py-2 shadow-xs sm:px-4 sm:py-3', active ? 'border-info/50' : 'border-border')}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-subtle sm:text-[11px]">{short ? <><span className="sm:hidden">{short}</span><span className="max-sm:hidden">{label}</span></> : label}</div>
      <div className={cn('text-lg font-bold tabular-nums sm:text-2xl', active && 'text-info-fg')}>{value}</div>
      {hint && <div className="mt-0.5 hidden text-xs text-muted sm:block">{hint}</div>}
    </div>
  );
}

function PulseClass({ section, onPendingChange }: { section: Section; onPendingChange(value: boolean): void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roster = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const sessions = useQuery({ queryKey: ['pulse-sessions', section.id], queryFn: () => api.get<Session[]>(`/api/pulse/sessions?sectionId=${encodeURIComponent(section.id)}`) });
  const layout = useQuery({ queryKey: ['pulse-seating', section.id], queryFn: () => api.get<{ version: number; positions: Seat[] }>(`/api/pulse/seating?sectionId=${encodeURIComponent(section.id)}`) });
  const [sessionId, setSessionId] = useState('');
  const detail = useQuery({ queryKey: ['pulse-events', sessionId], enabled: !!sessionId, queryFn: () => api.get<{ session: Session; seating: Seat[]; events: PulseEvent[] }>(`/api/pulse/sessions/${sessionId}`) });
  const drafts = useQuery({
    queryKey: ['classroom-drafts'], enabled: !!sessionId, queryFn: () => api.get<DraftRow[]>('/api/pulse/drafts'),
    refetchInterval: (query) => (query.state.data ?? []).some((d) => ['queued', 'running'].includes(d.generationState)) ? 3000 : 20000,
  });
  const voice = useQuery({ queryKey: ['voice-status', section.id], queryFn: () => api.get<{ enabled: boolean; reason: string; limits?: { maxSeconds: number } }>(`/api/pulse/voice/status?sectionId=${encodeURIComponent(section.id)}`) });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const vocabulary = useQuery({ queryKey: ['capture-vocabulary'], queryFn: () => api.get<{ vocabulary: CaptureVocabulary; defaults: CaptureVocabulary; custom: boolean }>('/api/pulse/vocabulary') });
  const [editingVocabulary, setEditingVocabulary] = useState(false);
  const [vocabularyError, setVocabularyError] = useState('');
  const [projection, setProjection] = useState<PulseEvent | null>(null);
  const cases = useQuery({ queryKey: ['cases'], enabled: !!projection, queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const caseRoster = useQuery({ queryKey: ['roster'], enabled: !!projection, queryFn: () => api.get<RosterStudent[]>('/api/roster') });

  const today = todayIn(section.timezone);
  const [topic, setTopic] = useState('');
  const [objective, setObjective] = useState('');
  const [date, setDate] = useState(today);
  const [studentId, setStudentId] = useState('');
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const [dimObserved, setDimObserved] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const inFlight = useRef(false);
  const pendingAction = useRef<{ url: string; body: unknown; label?: string } | null>(null);
  const pendingSession = useRef<SessionInput | null>(null);
  const [sessionPending, setSessionPending] = useState(false);
  const autoPicked = useRef(false);

  // Carry context: today's session for this class reopens automatically.
  useEffect(() => {
    if (autoPicked.current || !sessions.data) return;
    autoPicked.current = true;
    const current = sessions.data.find((s) => s.date === today);
    if (current) setSessionId(current.id);
  }, [sessions.data, today]);

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

  const students = useMemo(() => (roster.data?.students ?? []).filter((s) => s.sectionIds.includes(section.id)), [roster.data, section.id]);
  const seatPositions = sessionId ? detail.data?.seating ?? [] : layout.data?.positions ?? [];
  // Arrow keys move between seats in chart order; Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (arranging || typingTarget(e)) return;
      if (e.key === 'Escape') { setStudentId(''); return; }
      const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!delta || !students.length) return;
      e.preventDefault();
      const { seats } = layoutFor(students, seatPositions);
      const current = seats.find((p) => p.studentId === studentId);
      if (!current) { const first = [...seats].sort((a, b) => a.row - b.row || a.column - b.column)[0]; if (first) setStudentId(first.studentId); return; }
      const [dr, dc] = delta as [number, number];
      const candidates = seats.filter((p) => dr ? Math.sign(p.row - current.row) === dr : p.row === current.row && Math.sign(p.column - current.column) === dc);
      const next = candidates.sort((a, b) => (Math.abs(a.row - current.row) + Math.abs(a.column - current.column) * (dr ? 0.5 : 1)) - (Math.abs(b.row - current.row) + Math.abs(b.column - current.column) * (dr ? 0.5 : 1)))[0];
      if (next) setStudentId(next.studentId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [students, seatPositions, studentId, arranging]);
  const events = detail.data?.events ?? [];
  const sessionDrafts = (drafts.data ?? []).filter((d) => d.sessionId === sessionId);
  const activity = useMemo(() => {
    const map = new Map<string, StudentActivity>();
    for (const e of events) {
      if (e.status === 'withdrawn') continue;
      const a = map.get(e.studentId) ?? { counts: {}, pending: 0, lastKind: null, lastAt: null };
      a.counts[e.observation.kind] = (a.counts[e.observation.kind] ?? 0) + 1;
      if (e.status === 'pending') a.pending++;
      if (!a.lastAt || e.observedAt > a.lastAt) { a.lastAt = e.observedAt; a.lastKind = e.observation.kind; }
      map.set(e.studentId, a);
    }
    return map;
  }, [events]);
  const nameOf = (id: string) => students.find((s) => s.id === id)?.displayName ?? 'Student';
  const refresh = () => qc.invalidateQueries({ queryKey: ['pulse-events', sessionId] });
  const session = detail.data?.session;
  const blocked = busy || retry;

  async function perform<T>(url: string, body: unknown, label?: string): Promise<T | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true; setBusy(true); setError(''); setStatus('Saving observation…');
    pendingAction.current = { url, body, label };
    try {
      const result = await api.post<T>(url, body);
      pendingAction.current = null; setRetry(false); setEditor(null);
      setStatus('Saved. Sharing and AI drafting are separate actions.'); await refresh();
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save';
      setError(message);
      const retryable = !(e instanceof ApiError && e.status >= 400 && e.status < 500);
      setRetry(retryable); if (!retryable) pendingAction.current = null;
      setStatus(retryable ? 'Not confirmed saved. Retry sends the same request.' : 'Not saved. Check the details and try again.');
      if (e instanceof ApiError && e.status === 409) await refresh();
      return undefined;
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function undo(id: string, revision: number) {
    const ok = await perform(`/api/pulse/events/${id}/withdraw`, { expectedRevision: revision });
    if (ok) toast('Observation undone', { description: 'Removed from current class history.' });
  }
  async function quick(observation: ClassroomObservation, label: string) {
    if (!studentId || !sessionId) return;
    const who = nameOf(studentId);
    const body: CaptureEvent = { requestId: crypto.randomUUID(), sessionId, studentId, observation, observedAt: new Date().toISOString(), source: 'teacher_tap', confirmed: true };
    const saved = await perform<{ id: string; revision: number }>('/api/pulse/events', body, label);
    if (saved) toast.success(`${label} · ${who}`, { description: 'Confirmed and logged to class history.', action: { label: 'Undo', onClick: () => void undo(saved.id, saved.revision) } });
  }
  async function submitEditor(confirmed: boolean) {
    if (!editor) return;
    if (editor.mode === 'correct') {
      const target = events.find((e) => e.id === editor.eventId);
      if (!target) return;
      const saved = await perform(`/api/pulse/events/${target.id}/revise`, { requestId: crypto.randomUUID(), expectedRevision: target.revision, studentId: editor.studentId, observation: editor.observation, reason: editor.reason, confirmed: true });
      if (saved) toast.success('Correction saved', { description: 'Drafts that used the earlier version are marked for review.' });
      return;
    }
    const body: CaptureEvent = { requestId: crypto.randomUUID(), sessionId, studentId: editor.studentId, observation: editor.observation, observedAt: new Date().toISOString(), source: 'teacher_text', confirmed };
    const saved = await perform<{ id: string; revision: number }>('/api/pulse/events', body);
    if (saved) toast.success(`${OBSERVATION_META[editor.observation.kind].label} · ${nameOf(editor.studentId)}`, { description: confirmed ? 'Confirmed and logged to class history.' : 'Saved as suggested. Confirm it from the activity list.' });
  }
  async function requestDraft(kind: ArtifactKind, sources: PulseEvent[]) {
    setBusy(true); setError('');
    try {
      await api.post('/api/pulse/drafts', { sessionId, kind, sources: sources.filter((e) => e.status === 'confirmed').map((e) => ({ eventId: e.id, revision: e.revision })) });
      await qc.invalidateQueries({ queryKey: ['classroom-drafts'] });
      setStatus('Draft requested. Review its status and wording in Drafts.');
      toast(`Drafting: ${ARTIFACT_META[kind].produces}`, { description: 'It stays a suggestion until you approve it in Drafts.' });
      return true;
    } catch (err) { const m = err instanceof Error ? err.message : 'Could not prepare draft'; setError(m); toast.error(m); return false; }
    finally { setBusy(false); }
  }
  async function openSession(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    const body = pendingSession.current ?? { requestId: crypto.randomUUID(), sectionId: section.id, date, topic, objective, contextTags: section.periodTag ? [section.periodTag] : [] };
    pendingSession.current = body; setSessionPending(true);
    try {
      const s = await api.post<{ id: string }>('/api/pulse/sessions', body);
      pendingSession.current = null; setSessionPending(false); setSessionId(s.id); setStartingNew(false);
      await qc.invalidateQueries({ queryKey: ['pulse-sessions', section.id] });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start session'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (roster.isLoading || sessions.isLoading) return <PageSkeleton />;
  if (roster.error || sessions.error) return <p role="alert">{(roster.error ?? sessions.error)?.message}</p>;

  const positions = seatPositions;
  const live = events.filter((e) => e.status !== 'withdrawn');
  const observedCount = students.filter((s) => activity.has(s.id)).length;
  const toConfirm = live.filter((e) => e.status === 'pending').length;
  const inReview = sessionDrafts.filter((d) => d.reviewState === 'suggested' && d.generationState === 'ready').length;
  const showSessionForm = !sessionId || startingNew;
  const selected = students.find((s) => s.id === studentId) ?? null;

  return (
    <div className="space-y-4">
      <ClassroomHelp sectionId={section.id} people={students.map((s) => ({ id: s.id, displayName: s.displayName, sections: [] }))} />

      {showSessionForm ? (
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-primary-soft via-info-soft/60 to-proposal-soft/60 px-5 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-soft-fg"><CalendarDays className="size-3.5" /> {prettyDate(today)} · {section.timezone.replace('_', ' ')}</div>
            <h2 className="mt-1 text-lg font-semibold">Open today’s class</h2>
            <p className="text-sm text-muted">Enter the lesson once. Every observation you capture carries this class, date and lesson automatically.</p>
          </div>
          <CardBody className="pt-4">
            <form className="grid gap-3 sm:grid-cols-[10rem_1fr]" onSubmit={openSession}>
              <label className="space-y-1.5 text-sm font-medium">Class date<Input type="date" required value={date} disabled={busy || !!pendingSession.current} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="space-y-1.5 text-sm font-medium">Lesson topic<Input maxLength={500} value={topic} disabled={busy || !!pendingSession.current} onChange={(e) => setTopic(e.target.value)} placeholder="Fractions on a number line" /></label>
              <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Lesson objective <span className="font-normal text-subtle">(optional)</span><Input maxLength={1000} value={objective} disabled={busy || !!pendingSession.current} onChange={(e) => setObjective(e.target.value)} placeholder="What will students practise?" /></label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button type="submit" loading={busy}>{pendingSession.current ? 'Retry starting session' : 'Open class'}</Button>
                {pendingSession.current && !busy && <Button variant="ghost" onClick={() => { pendingSession.current = null; setSessionPending(false); setError(''); }}>Edit session details</Button>}
                {startingNew && sessionId && <Button variant="ghost" onClick={() => setStartingNew(false)}>Back to current session</Button>}
                {!!sessions.data?.length && !startingNew && (
                  <Dropdown>
                    <DropdownTrigger asChild><Button variant="ghost"><RotateCcw /> Resume a session <ChevronDown /></Button></DropdownTrigger>
                    <DropdownContent align="start">{sessions.data.slice(0, 10).map((s) => <DropdownItem key={s.id} onSelect={() => setSessionId(s.id)}>{prettyDate(s.date)} · {s.topic || 'Untitled lesson'}</DropdownItem>)}</DropdownContent>
                  </Dropdown>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-elevated px-4 py-3 shadow-xs">
          <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-success" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{session ? prettyDate(session.date) : ''}{section.periodTag ? ` · ${humanize(section.periodTag)}` : ''}{session && session.date !== today ? ' · earlier session' : ' · in session'}</div>
            <div className="truncate text-sm font-semibold">{session?.topic || 'Untitled lesson'}{session?.objective && <span className="font-normal text-muted"> — <Target className="inline size-3.5" /> {session.objective}</span>}</div>
          </div>
          <Dropdown>
            <DropdownTrigger asChild><Button size="sm" variant="secondary" disabled={blocked || sessionPending}>Session <ChevronDown /></Button></DropdownTrigger>
            <DropdownContent>
              <DropdownItem icon={<Plus />} onSelect={() => { setStartingNew(true); setDate(today); setTopic(''); setObjective(''); }}>Start a new session</DropdownItem>
              <DropdownSeparator />
              <DropdownLabel>Recent sessions</DropdownLabel>
              {sessions.data?.slice(0, 8).map((s) => <DropdownItem key={s.id} onSelect={() => { setSessionId(s.id); setStudentId(''); setStatus(''); }}>{prettyDate(s.date)} · {s.topic || 'Untitled lesson'}{s.id === sessionId ? ' ✓' : ''}</DropdownItem>)}
            </DropdownContent>
          </Dropdown>
        </div>
      )}

      {sessionId && !startingNew && (
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          <PulseStat label="Observations" short="Notes" value={live.length} />
          <PulseStat label="Observed" value={`${observedCount}/${students.length}`} hint={students.length - observedCount ? `${students.length - observedCount} not yet — not a signal of anything` : 'Everyone has an observation'} />
          <PulseStat label="To confirm" short="Confirm" value={toConfirm} active={!!toConfirm} hint="Suggested until you confirm" />
          <Link to="/teacher/drafts" className="block rounded-lg focus-visible:outline-2 focus-visible:outline-primary"><PulseStat label="Drafts" value={inReview} active={!!inReview} hint={<span className="inline-flex items-center gap-1"><Inbox className="size-3" /> To review</span>} /></Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{arranging ? 'Arrange seats' : view === 'chart' ? 'Seating chart' : 'Class roster'}</h2>
            {!arranging && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant={dimObserved ? 'soft' : 'ghost'} aria-pressed={dimObserved} onClick={() => setDimObserved(!dimObserved)}>{dimObserved ? <EyeOff /> : <Eye />}<span className="max-sm:sr-only">Not yet observed</span></Button>
                <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: <span className="inline-flex items-center gap-1"><LayoutGrid className="size-3.5" />Chart</span> }, { value: 'list', label: <span className="inline-flex items-center gap-1"><List className="size-3.5" />List</span> }]} />
                <Button size="sm" variant="ghost" onClick={() => setArranging(true)} disabled={!students.length}><Move /><span className="max-sm:sr-only">Arrange</span></Button>
              </div>
            )}
          </div>
          {!students.length ? (
            <Empty compact title="No students in this class yet" description="Add students or import a roster from My class." action={<Link to="/teacher/class"><Button size="sm" variant="secondary">Manage roster</Button></Link>} />
          ) : arranging ? (
            <SeatArranger students={students} positions={layout.data?.positions ?? []} busy={busy} onCancel={() => setArranging(false)} onSave={async (seats) => {
              setBusy(true); setError('');
              try { await api.post(`/api/pulse/seating/${section.id}`, { expectedVersion: layout.data?.version ?? 0, positions: seats }); await qc.invalidateQueries({ queryKey: ['pulse-seating', section.id] }); setArranging(false); toast.success('Seating saved', { description: 'It applies from the next class session.' }); }
              catch (err) { const m = err instanceof Error ? err.message : 'Could not save seats'; setError(m); toast.error(m); }
              finally { setBusy(false); }
            }} />
          ) : (
            <SeatingChart students={students} positions={positions} activity={activity} selected={studentId} onSelect={setStudentId} view={view} dimObserved={dimObserved} />
          )}
          <p className="text-xs text-muted">No observation means no data — it is not evidence of disengagement. Seat changes apply to new sessions.</p>
        </div>

        {/* A direct grid child, so on phones it sticks above the tab bar while the chart scrolls. */}
        <Card className="sticky bottom-[calc(var(--bottom-nav)+0.5rem)] z-20 self-end border-primary/20 shadow-lg lg:bottom-auto lg:top-6 lg:self-start lg:shadow-sm">
            <CardBody className="p-3 sm:px-5 sm:pb-5 sm:pt-4">
              <CaptureDock student={selected} sessionOpen={!!sessionId && !startingNew} topic={session?.topic ?? ''} disabled={retry} saving={busy} onQuick={quick} onDetailed={(kind: ObservationKind) => setEditor({ mode: 'record', observation: emptyObservation(kind, session?.topic ?? ''), studentId, reason: '' })}
                vocabulary={vocabulary.data?.vocabulary ?? DEFAULT_CAPTURE_VOCABULARY} onEditVocabulary={() => { setVocabularyError(''); setEditingVocabulary(true); }}
                voice={{ enabled: !!voice.data?.enabled, reason: voice.data?.reason || 'Checking voice availability…' }} onVoice={() => setVoiceOpen(true)} />
              {retry && (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-sm text-warning-fg">
                  <p className="font-medium">Not confirmed saved{pendingAction.current?.label ? ` · ${pendingAction.current.label}` : ''}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" loading={busy} onClick={() => { const p = pendingAction.current; if (p) void perform(p.url, p.body, p.label); }}>Retry save</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { pendingAction.current = null; setRetry(false); setStatus('Retry dismissed. Refresh recent activity before capturing again.'); void refresh(); }}>Dismiss retry</Button>
                  </div>
                </div>
              )}
              {error && !retry && !editor && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
              <p role="status" className="sr-only">{status}</p>
            </CardBody>
        </Card>
      </div>

      {sessionId && !startingNew && (
        <section className="space-y-3 pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Today’s activity <span className="ml-1 text-xs font-normal text-muted">Teacher Confirm™: Suggested → Confirmed → Logged</span></h2>
            <Link to="/teacher/drafts" className="text-sm font-medium text-primary hover:underline">Open drafts</Link>
          </div>
          {detail.error && <p role="alert">{detail.error.message}</p>}
          <ClassGuide events={events} nameOf={nameOf} busy={blocked} onDraft={requestDraft} onPrepare={async () => {
            setBusy(true);
            try { const r = await api.post<{ message: string }>(`/api/pulse/tomorrow/${encodeURIComponent(section.id)}/prepare`); toast(r.message, { action: { label: 'Open Tomorrow', onClick: () => navigate('/teacher/tomorrow') } }); await qc.invalidateQueries({ queryKey: ['classroom-drafts'] }); }
            catch (err) { toast.error(err instanceof Error ? err.message : 'Could not prepare'); }
            finally { setBusy(false); }
          }} />
          <ActivityFeed
            events={events} drafts={sessionDrafts} nameOf={nameOf} selectedStudent={studentId} busy={blocked}
            onConfirm={(e) => void perform(`/api/pulse/events/${e.id}/confirm`, { expectedRevision: e.revision }).then((ok) => ok && toast.success('Confirmed', { description: `${OBSERVATION_META[e.observation.kind].label} · ${nameOf(e.studentId)}` }))}
            onCorrect={(e) => { setStudentId(e.studentId); setEditor({ mode: 'correct', observation: e.observation, studentId: e.studentId, reason: '', eventId: e.id }); }}
            onUndo={(e) => void undo(e.id, e.revision)}
            onProject={(e) => { setProjection(e); setDestination(''); }}
            onDraft={requestDraft}
          />
        </section>
      )}

      <ObservationDialog state={editor} onChange={setEditor} onClose={() => { setEditor(null); setError(''); }} onSubmit={(c) => void submitEditor(c)} students={students} topic={session?.topic ?? ''} busy={busy} blocked={retry} error={editor ? error : ''} />

      {voice.data?.enabled && (
        <VoiceCapture open={voiceOpen} onOpenChange={setVoiceOpen} sectionId={section.id} maxSeconds={voice.data.limits?.maxSeconds ?? 60} students={students} defaultStudentId={studentId} onSave={async (who, observation, confirmed) => {
          const body: CaptureEvent = { requestId: crypto.randomUUID(), sessionId, studentId: who, observation, observedAt: new Date().toISOString(), source: 'reviewed_transcript', confirmed };
          const saved = await perform<{ id: string; revision: number }>('/api/pulse/events', body);
          if (saved) toast.success(`Voice note · ${nameOf(who)}`, { description: confirmed ? 'Reviewed transcript confirmed and logged.' : 'Saved as suggested. Confirm it from the activity list.' });
          return !!saved;
        }} />
      )}

      <VocabularyDialog open={editingVocabulary} onOpenChange={setEditingVocabulary} vocabulary={vocabulary.data?.vocabulary ?? DEFAULT_CAPTURE_VOCABULARY} defaults={vocabulary.data?.defaults ?? DEFAULT_CAPTURE_VOCABULARY} busy={busy} error={vocabularyError} onSave={async (v) => {
        setBusy(true); setVocabularyError('');
        try { await api.post('/api/pulse/vocabulary', { vocabulary: v }); await qc.invalidateQueries({ queryKey: ['capture-vocabulary'] }); setEditingVocabulary(false); toast.success(v ? 'Quick-pick wording saved' : 'Quick-pick wording reset'); }
        catch (err) { setVocabularyError(err instanceof Error ? err.message : 'Could not save presets'); }
        finally { setBusy(false); }
      }} />

      <Dialog open={!!projection} onOpenChange={(open) => !open && setProjection(null)}>
        <DialogContent title="Connect observation to a support case" description="Only explicit attendance or a measured behavior count can be included. A correction or undo retires the projected signal.">
          <label className="block space-y-1.5 text-sm font-medium">Existing case<select className={selectStyle} value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">Choose this student’s case</option>{(cases.data ?? []).filter((c) => c.sectionId === section.id && caseRoster.data?.find((s) => s.id === projection?.studentId)?.caseKeys.includes(c.caseKey)).map((c) => <option key={c.caseKey} value={c.caseKey}>{projection ? nameOf(projection.studentId) : ''} · {humanize(c.status)} · {c.plan ? 'Support plan' : 'Case without plan'}</option>)}</select></label>
          <div className="mt-4 flex items-center gap-2"><Button disabled={!destination || busy} onClick={async () => { if (!projection) return; const ok = await perform(`/api/pulse/events/${projection.id}/project`, { expectedRevision: projection.revision, caseKey: destination, goalId: null, strategyId: null }); if (ok) toast.success('Connected to support case'); setProjection(null); }}>Confirm connection</Button>{cases.isLoading && <Badge>Loading cases…</Badge>}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
