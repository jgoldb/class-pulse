import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, CircleCheck, Eye, EyeOff, Inbox, Info, LayoutGrid, List, Move, Play, Plus, RotateCcw, School, Sparkles, Square, Target, UserPlus } from 'lucide-react';
import { DEFAULT_CAPTURE_VOCABULARY, type ArtifactKind, type CaptureEvent, type CaptureVocabulary, type ClassroomObservation, type SessionInput } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { ConfirmChip, ObservationConfirm } from '../../components/TeacherConfirm';
import { Avatar, Badge, Button, Card, CardBody, Dialog, DialogContent, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Empty, Input, PageSkeleton, Segmented, SheetContent, cn } from '../../components/ui';
import { ApiError, api, fmtDateTime, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { accentOf, classDetails, classTitle, greeting, setClassSwitchBlocked, todayIn, useCurrentClass, type PulseSection } from '../../lib/classes';
import type { CaseListItem, Classroom, RosterStudent } from '../../lib/types';
import { ARTIFACT_META, OBSERVATION_META, draftStage, emptyObservation, needsTeacher, observationText, type ObservationKind } from '../../lib/pulse';
import { ClassroomHelp } from '../PulseProfiles';
import { ActivityFeed, type DraftRow, type PulseEvent } from './pulse/ActivityFeed';
import { CaptureDock, VocabularyDialog, typingTarget } from './pulse/CaptureDock';
import { GuidePanel } from './pulse/GuidePanel';
import { ObservationDialog, selectStyle, type EditorState } from './pulse/ObservationEditor';
import { SeatArranger, SeatingChart, layoutFor, type Seat, type StudentActivity } from './pulse/SeatingChart';
import { VoiceCapture } from './pulse/VoiceCapture';

type Session = { id: string; date: string; topic: string; objective: string; timezone: string; contextTags: string[]; endedAt?: string | null };
type Draft = DraftRow & { sectionId?: string; title?: string | null; students?: Array<{ id: string; displayName: string }>; deferredUntil?: string | null };

const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const longDate = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/**
 * Class Pulse™ — the teacher's home (visual spec §4). The class is the primary object: a greeting,
 * which class this is, where the session stands, and the seating chart as the dominant workspace.
 * Capture is one tap from the chart; Drafts and Tomorrow are present but secondary; Guide opens
 * only when asked.
 */
export function ClassPulse() {
  const { section, all, isLoading, error } = useCurrentClass();
  const { me } = useAuth();
  if (isLoading) return <PageSkeleton />;
  if (error) return <Empty title="Class Pulse could not load" description={`${error.message} Refresh the page to try again.`} />;
  const firstName = me?.user?.displayName.split(' ')[0];
  if (!section) {
    const disabled = all.some((s) => !s.enabled);
    return (
      <div>
        <PageHeader eyebrow={longDate()} title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} description="Class Pulse is where you teach: your seating chart, one-tap capture, and the drafts Pulsera prepares for you." />
        <Empty
          icon={<School />}
          title={disabled ? 'Class Pulse is not switched on for this workspace' : all.length ? 'All your classes are archived' : 'Add the class you teach'}
          description={disabled ? 'An administrator can enable it in Administration → School structure. Your support work is unaffected.' : all.length ? 'Restore a class from My Classes to teach it here again.' : 'Give it a name and period, add your students, and it opens here with its seating chart.'}
          action={disabled ? <Link to="/teacher/support"><Button variant="secondary"><BookOpen /> Open support work</Button></Link> : <Link to="/teacher/classes"><Button><Plus /> {all.length ? 'Go to My Classes' : 'Add Class'}</Button></Link>}
        />
      </div>
    );
  }
  return <PulseClass key={section.id} section={section} firstName={firstName} />;
}

function PulseClass({ section, firstName }: { section: PulseSection; firstName?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const roster = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const sessions = useQuery({ queryKey: ['pulse-sessions', section.id], queryFn: () => api.get<Session[]>(`/api/pulse/sessions?sectionId=${encodeURIComponent(section.id)}`) });
  const layout = useQuery({ queryKey: ['pulse-seating', section.id], queryFn: () => api.get<{ version: number; positions: Seat[] }>(`/api/pulse/seating?sectionId=${encodeURIComponent(section.id)}`) });
  const [sessionId, setSessionId] = useState('');
  const detail = useQuery({ queryKey: ['pulse-events', sessionId], enabled: !!sessionId, queryFn: () => api.get<{ session: Session; seating: Seat[]; events: PulseEvent[] }>(`/api/pulse/sessions/${sessionId}`) });
  const drafts = useQuery({
    queryKey: ['classroom-drafts'], queryFn: () => api.get<Draft[]>('/api/pulse/drafts'),
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
  const [arranging, setArranging] = useState(params.get('arrange') === '1');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStudent, setGuideStudent] = useState(false);
  const [studentSheet, setStudentSheet] = useState(false);
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

  // Seating Chart from a class card arrives with ?arrange=1; consume it so a refresh does not re-open the editor.
  useEffect(() => {
    if (params.get('arrange') !== '1') return;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('arrange'); return n; }, { replace: true });
  }, [params, setParams]);

  // Carry context: today's session for this class reopens automatically.
  useEffect(() => {
    if (autoPicked.current || !sessions.data) return;
    autoPicked.current = true;
    const current = sessions.data.find((s) => s.date === today);
    if (current) setSessionId(current.id);
  }, [sessions.data, today]);

  useEffect(() => {
    const pending = busy || retry || sessionPending;
    setClassSwitchBlocked(retry || sessionPending);
    const warn = (e: BeforeUnloadEvent) => { if (pending) { e.preventDefault(); e.returnValue = ''; } };
    // Keep page-memory retry work from being silently lost to navigation or refresh.
    const guardLinks = (e: MouseEvent) => { if ((retry || sessionPending) && e.target instanceof Element && e.target.closest('a[href]')) { e.preventDefault(); e.stopPropagation(); setStatus('Finish or dismiss the pending save before leaving this class.'); toast.warning('Finish or dismiss the pending save first'); } };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLinks, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardLinks, true); setClassSwitchBlocked(false); };
  }, [busy, retry, sessionPending]);

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
  const sectionDrafts = (drafts.data ?? []).filter((d) => d.sectionId === section.id && d.reviewState !== 'discarded');
  const sessionDrafts = sectionDrafts.filter((d) => d.sessionId === sessionId);
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
  const nameOf = (id: string) => students.find((s) => s.id === id)?.displayName ?? 'Former student';
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
      toast(`Drafting: ${ARTIFACT_META[kind].produces}`, { description: 'It stays a suggestion until you approve it in Drafts.', action: { label: 'Open Drafts', onClick: () => navigate('/teacher/drafts') } });
      return true;
    } catch (err) { const m = err instanceof Error ? err.message : 'Could not prepare draft'; setError(m); toast.error(m); return false; }
    finally { setBusy(false); }
  }
  async function prepareTomorrow() {
    setBusy(true);
    try { const r = await api.post<{ message: string }>(`/api/pulse/tomorrow/${encodeURIComponent(section.id)}/prepare`); toast(r.message, { action: { label: 'Open Tomorrow', onClick: () => navigate('/teacher/tomorrow') } }); await qc.invalidateQueries({ queryKey: ['classroom-drafts'] }); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not prepare'); }
    finally { setBusy(false); }
  }
  async function openSession(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    const body = pendingSession.current ?? { requestId: crypto.randomUUID(), sectionId: section.id, date, topic, objective, contextTags: section.periodTag ? [section.periodTag] : [] };
    pendingSession.current = body; setSessionPending(true);
    try {
      const s = await api.post<{ id: string }>('/api/pulse/sessions', body);
      pendingSession.current = null; setSessionPending(false); setSessionId(s.id); setStartingNew(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ['pulse-sessions', section.id] }), qc.invalidateQueries({ queryKey: ['classroom'] })]);
      toast.success('Class started', { description: 'Tap a student, then an action.' });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start class'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function endSession(ended: boolean) {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.post(`/api/pulse/sessions/${sessionId}/end`, { ended });
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['classroom'] }), qc.invalidateQueries({ queryKey: ['pulse-sessions', section.id] })]);
      if (ended) toast.success('Session complete', { description: 'You can still confirm, correct and draft from today.', action: { label: 'Open Tomorrow', onClick: () => navigate('/teacher/tomorrow') } });
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update the session'); }
    finally { setBusy(false); }
  }

  if (roster.isLoading || sessions.isLoading) return <PageSkeleton />;
  if (roster.error || sessions.error) return <Empty title="This class could not load" description={`${(roster.error ?? sessions.error)?.message} Refresh to try again.`} />;

  const positions = seatPositions;
  const live = events.filter((e) => e.status !== 'withdrawn');
  const observedCount = students.filter((s) => activity.has(s.id)).length;
  const toConfirm = live.filter((e) => e.status === 'pending').length;
  const showSessionForm = !sessionId || startingNew;
  const complete = !!session?.endedAt;
  const earlier = !!session && session.date !== today;
  const capturing = !!sessionId && !startingNew && !complete;
  const selected = students.find((s) => s.id === studentId) ?? null;
  const selectedToday = selected ? live.filter((e) => e.studentId === selected.id) : [];
  const accent = accentOf(section.accent);

  return (
    <div className="space-y-6">
      {/* Greeting and class identity (§4: "Good morning, [Teacher]" with today's date and section). */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{longDate()}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{greeting(section.timezone)}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]" data-testid="class-identity">
            <span className="size-2.5 rounded-full" style={{ background: accent.swatch }} aria-hidden />
            <span className="font-semibold">{classTitle(section)}</span>
            <span className="text-muted">{classDetails(section, [`${students.length} ${students.length === 1 ? 'student' : 'students'}`])}</span>
          </p>
        </div>
        <Button variant="ai" onClick={() => { setGuideStudent(false); setGuideOpen(true); }} data-testid="ask-guide"><Sparkles /> Ask Guide about this class</Button>
      </div>

      <ClassroomHelp sectionId={section.id} people={students.map((s) => ({ id: s.id, displayName: s.displayName, sections: [] }))} />

      {/* Session strip: Ready to teach / Class in progress / Session complete. */}
      {showSessionForm ? (
        <Card className="overflow-hidden" data-testid="session-ready">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary-soft/40 px-6 py-4">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-fg"><Play className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Ready to teach</h2>
              <p className="text-sm text-muted">Enter the lesson once. Everything you capture carries this class, date and lesson.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"><CalendarDays className="size-3.5" />{prettyDate(today)}</span>
          </div>
          <CardBody className="pt-5">
            <form className="grid gap-4 sm:grid-cols-[10rem_1fr_1fr]" onSubmit={openSession}>
              <label className="space-y-1.5 text-sm font-medium">Class date<Input type="date" required value={date} disabled={busy || !!pendingSession.current} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="space-y-1.5 text-sm font-medium">Lesson topic<Input maxLength={500} value={topic} disabled={busy || !!pendingSession.current} onChange={(e) => setTopic(e.target.value)} placeholder="Fractions on a number line" data-testid="session-topic" /></label>
              <label className="space-y-1.5 text-sm font-medium">Objective <span className="font-normal text-subtle">(optional)</span><Input maxLength={1000} value={objective} disabled={busy || !!pendingSession.current} onChange={(e) => setObjective(e.target.value)} placeholder="What will students practise?" /></label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                <Button type="submit" loading={busy} data-testid="start-class"><Play /> {pendingSession.current ? 'Retry starting class' : 'Start class'}</Button>
                {pendingSession.current && !busy && <Button variant="ghost" onClick={() => { pendingSession.current = null; setSessionPending(false); setError(''); }}>Edit session details</Button>}
                {startingNew && sessionId && <Button variant="ghost" onClick={() => setStartingNew(false)}>Back to current session</Button>}
                {!!sessions.data?.length && !startingNew && (
                  <Dropdown>
                    <DropdownTrigger asChild><Button variant="ghost"><RotateCcw /> Resume a session <ChevronDown /></Button></DropdownTrigger>
                    <DropdownContent align="start">{sessions.data.slice(0, 10).map((s) => <DropdownItem key={s.id} onSelect={() => setSessionId(s.id)}>{prettyDate(s.date)} · {s.topic || 'Untitled lesson'}</DropdownItem>)}</DropdownContent>
                  </Dropdown>
                )}
                {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
        <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-elevated px-5 py-4 shadow-xs', complete || earlier ? 'border-border' : 'border-success/30')} data-testid={complete ? 'session-complete' : 'session-live'}>
          <div className="flex min-w-0 basis-full items-center gap-3 md:basis-auto md:flex-1">
            {complete || earlier
              ? <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg"><CircleCheck className="size-5" /></span>
              : <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft"><span className="absolute size-3 rounded-full bg-success/40 motion-safe:animate-ping" /><span className="relative size-3 rounded-full bg-success" /></span>}
            <div className="min-w-0">
              <div className="text-sm font-semibold">{complete ? 'Session complete' : earlier ? `Earlier session · ${session ? prettyDate(session.date) : ''}` : 'Class in progress'}</div>
              <div className="truncate text-sm text-muted">{session?.topic || 'Untitled lesson'}{session?.objective && <> · <Target className="inline size-3.5" /> {session.objective}</>}</div>
            </div>
          </div>
          <dl className="flex gap-6 text-sm max-md:pl-12">
            <div><dt className="text-xs text-muted">Observed</dt><dd className="font-semibold tabular-nums">{observedCount} of {students.length}</dd></div>
            <div><dt className="text-xs text-muted">Notes</dt><dd className="font-semibold tabular-nums">{live.length}</dd></div>
            {!!toConfirm && <div><dt className="text-xs text-muted">To confirm</dt><dd className="font-semibold tabular-nums text-ai-fg">{toConfirm}</dd></div>}
          </dl>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {complete
              ? <Button size="sm" variant="secondary" disabled={blocked} onClick={() => void endSession(false)}><RotateCcw /> Resume class</Button>
              : !earlier && <Button size="sm" variant="secondary" disabled={blocked} onClick={() => void endSession(true)} data-testid="end-class"><Square className="size-3.5" /> End class</Button>}
            <Dropdown>
              <DropdownTrigger asChild><Button size="sm" variant="ghost" disabled={blocked || sessionPending}>Sessions <ChevronDown /></Button></DropdownTrigger>
              <DropdownContent>
                <DropdownItem icon={<Plus />} onSelect={() => { setStartingNew(true); setDate(today); setTopic(''); setObjective(''); }}>Start a new session</DropdownItem>
                <DropdownSeparator />
                <DropdownLabel>Recent sessions</DropdownLabel>
                {sessions.data?.slice(0, 8).map((s) => <DropdownItem key={s.id} onSelect={() => { setSessionId(s.id); setStudentId(''); setStatus(''); }}>{prettyDate(s.date)} · {s.topic || 'Untitled lesson'}{s.id === sessionId ? ' ✓' : ''}</DropdownItem>)}
              </DropdownContent>
            </Dropdown>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {/* The dominant workspace. */}
          <Card className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{arranging ? 'Arrange seats' : view === 'chart' ? 'Seating chart' : 'Class list'}</h2>
              {!arranging && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant={dimObserved ? 'soft' : 'ghost'} aria-pressed={dimObserved} onClick={() => setDimObserved(!dimObserved)}>{dimObserved ? <EyeOff /> : <Eye />}<span className="max-sm:sr-only">Not yet observed</span></Button>
                  <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: <span className="inline-flex items-center gap-1"><LayoutGrid className="size-3.5" />Chart</span> }, { value: 'list', label: <span className="inline-flex items-center gap-1"><List className="size-3.5" />List</span> }]} />
                  <Button size="sm" variant="ghost" onClick={() => setArranging(true)} disabled={!students.length}><Move /><span className="max-sm:sr-only">Arrange</span></Button>
                </div>
              )}
            </div>
            {!students.length ? (
              <Empty compact icon={<UserPlus />} title="No students in this class yet" description="Add students or import your roster, and they appear here as seats." action={<Link to={`/teacher/classes/${section.id}/students`}><Button size="sm"><UserPlus /> Manage Students</Button></Link>} />
            ) : arranging ? (
              <SeatArranger students={students} positions={layout.data?.positions ?? []} busy={busy} onCancel={() => setArranging(false)} onSave={async (seats) => {
                setBusy(true); setError('');
                try { await api.post(`/api/pulse/seating/${section.id}`, { expectedVersion: layout.data?.version ?? 0, positions: seats }); await qc.invalidateQueries({ queryKey: ['pulse-seating', section.id] }); setArranging(false); toast.success('Seating saved', { description: 'It applies from the next class session. Past sessions keep their seating.' }); }
                catch (err) { const m = err instanceof Error ? err.message : 'Could not save seats'; setError(m); toast.error(m); }
                finally { setBusy(false); }
              }} />
            ) : (
              <SeatingChart students={students} positions={positions} activity={activity} selected={studentId} onSelect={setStudentId} view={view} dimObserved={dimObserved} />
            )}
            {!arranging && !!students.length && <p className="mt-4 text-xs text-muted">No observation means no data — it is not evidence of anything. Seat changes apply to new sessions.</p>}
          </Card>

          {/* Secondary: drafts and tomorrow, present but quiet. */}
          <div className="grid gap-6 md:grid-cols-2">
            <DraftTray drafts={sessionId ? sessionDrafts : []} />
            <TomorrowPreview drafts={sectionDrafts.filter((d) => ['do_now', 'reteach', 'small_group'].includes(d.kind))} canPrepare={live.some((e) => e.status === 'confirmed')} busy={blocked} onPrepare={() => void prepareTomorrow()} />
          </div>
        </div>

        {/* Student panel. A direct grid child, so on phones it sticks above the tab bar while the chart scrolls. */}
        <Card className="sticky bottom-[calc(var(--bottom-nav)+0.5rem)] z-20 self-end border-primary/20 shadow-lg lg:top-24 lg:bottom-auto lg:self-start lg:shadow-xs" data-testid="student-panel">
          <CardBody className="p-3 sm:p-5">
            <CaptureDock
              student={selected} sessionOpen={capturing} closedReason={complete ? 'Session complete · resume class to capture' : startingNew || !sessionId ? 'Start class to capture' : undefined}
              topic={session?.topic ?? ''} disabled={retry} saving={busy} onQuick={quick}
              onDetailed={(kind: ObservationKind) => setEditor({ mode: 'record', observation: emptyObservation(kind, session?.topic ?? ''), studentId, reason: '' })}
              vocabulary={vocabulary.data?.vocabulary ?? DEFAULT_CAPTURE_VOCABULARY} onEditVocabulary={() => { setVocabularyError(''); setEditingVocabulary(true); }}
              voice={{ enabled: !!voice.data?.enabled, reason: voice.data?.reason || 'Checking voice availability…' }} onVoice={() => setVoiceOpen(true)}
              headerAction={selected ? <Button size="icon" variant="ghost" className="size-8" aria-label={`About ${selected.displayName} today`} onClick={() => setStudentSheet(true)}><Info /></Button> : null}
            />
            {retry && (
              <div className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-fg">
                <p className="font-medium">Not confirmed saved{pendingAction.current?.label ? ` · ${pendingAction.current.label}` : ''}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" loading={busy} onClick={() => { const p = pendingAction.current; if (p) void perform(p.url, p.body, p.label); }}>Retry save</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { pendingAction.current = null; setRetry(false); setStatus('Retry dismissed. Refresh recent activity before capturing again.'); void refresh(); }}>Dismiss retry</Button>
                </div>
              </div>
            )}
            {error && !retry && !editor && !showSessionForm && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
            <p role="status" className="sr-only">{status}</p>
            {selected && (
              <div className="mt-5 border-t border-border pt-4 max-lg:hidden">
                <StudentToday events={selectedToday} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="ai" onClick={() => { setGuideStudent(true); setGuideOpen(true); }}><Sparkles /> Explain recent evidence</Button>
                  <Link to={`/teacher/students?student=${selected.id}`}><Button size="sm" variant="ghost">Profile <ArrowRight /></Button></Link>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {sessionId && !startingNew && (
        <section className="space-y-4 pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{earlier ? 'Session activity' : 'Today’s activity'} <span className="ml-1 text-sm font-normal text-muted">Suggested → Confirmed → Logged</span></h2>
            <Link to="/teacher/drafts" className="text-sm font-medium text-primary hover:underline">Open Drafts</Link>
          </div>
          {detail.error && <p role="alert">{detail.error.message}</p>}
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

      <GuidePanel open={guideOpen} onOpenChange={setGuideOpen} student={guideStudent ? selected : null} events={events} nameOf={nameOf} busy={blocked} canPrepare={live.some((e) => e.status === 'confirmed')} onDraft={requestDraft} onPrepare={() => void prepareTomorrow()} />

      <Dialog open={studentSheet && !!selected} onOpenChange={setStudentSheet}>
        {selected && (
          <SheetContent side="right" className="max-w-md" title={<span className="inline-flex items-center gap-2"><Avatar name={selected.displayName} size="sm" />{selected.displayName}</span>} description={`${classTitle(section)} · today`}>
            <StudentToday events={selectedToday} />
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="ai" onClick={() => { setStudentSheet(false); setGuideStudent(true); setGuideOpen(true); }}><Sparkles /> Explain recent evidence</Button>
              <Link to={`/teacher/students?student=${selected.id}`}><Button variant="secondary">Open profile <ArrowRight /></Button></Link>
            </div>
          </SheetContent>
        )}
      </Dialog>

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

/** One student's observations this session, strengths first, each with its Teacher Confirm state. */
function StudentToday({ events }: { events: PulseEvent[] }) {
  if (!events.length) return <p className="rounded-lg bg-sunken/70 px-4 py-3 text-sm text-muted">No observations yet today.</p>;
  const ordered = [...events].sort((a, b) => Number(!!OBSERVATION_META[b.observation.kind].strength) - Number(!!OBSERVATION_META[a.observation.kind].strength) || b.observedAt.localeCompare(a.observedAt));
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Today</h3>
      <ul className="space-y-2">
        {ordered.slice(0, 6).map((e) => {
          const m = OBSERVATION_META[e.observation.kind];
          return (
            <li key={e.id} className="flex items-start gap-2.5 text-sm">
              <span className={cn('mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md', m.chip)}><m.icon className="size-3.5" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate">{observationText(e.observation)}</span><span className="text-[11px] text-subtle">{fmtDateTime(e.observedAt)}</span></span>
              <ObservationConfirm status={e.status} />
            </li>
          );
        })}
      </ul>
      {events.length > 6 && <p className="mt-2 text-xs text-muted">+{events.length - 6} more in today’s activity</p>}
    </div>
  );
}

/** "3 drafts ready for review", with how many are suggested, need review, or are already logged. */
function DraftTray({ drafts }: { drafts: Draft[] }) {
  const waiting = drafts.filter(needsTeacher);
  const suggested = drafts.filter((d) => draftStage(d).kind === 'suggested').length;
  const review = drafts.filter((d) => draftStage(d).kind === 'needs_review').length;
  const logged = drafts.filter((d) => draftStage(d).kind === 'logged').length;
  const preparing = drafts.filter((d) => draftStage(d).kind === 'preparing').length;
  return (
    <Card className="flex flex-col" data-testid="draft-tray">
      <CardBody className="flex flex-1 flex-col gap-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-ai-soft text-ai-fg"><Inbox className="size-4" /></span>
          <div className="min-w-0">
            <h2 className="font-semibold">{waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'draft' : 'drafts'} ready for review` : 'Drafts'}</h2>
            <p className="text-sm text-muted">{drafts.length ? 'Pulsera prepares the paperwork. You decide what becomes official.' : 'Choose what to draft from a confirmed observation below.'}</p>
          </div>
        </div>
        {!!drafts.length && (
          <div className="flex flex-wrap gap-2">
            {!!suggested && <ConfirmChip kind="suggested" label={`${suggested} suggested`} />}
            {!!review && <ConfirmChip kind="needs_review" label={`${review} needs review`} />}
            {!!logged && <ConfirmChip kind="logged" label={`${logged} logged`} />}
            {!!preparing && <ConfirmChip kind="preparing" label={`${preparing} preparing`} />}
          </div>
        )}
        {waiting.slice(0, 3).map((d) => (
          <Link key={d.id} to={`/teacher/drafts?draft=${d.id}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-ai/40">
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{ARTIFACT_META[d.kind].label}</span>{d.students?.[0] && <span className="text-muted"> · {d.students.map((s) => s.displayName).join(', ')}</span>}</span>
            <ArrowRight className="size-4 text-muted" />
          </Link>
        ))}
        <Link to="/teacher/drafts" className="mt-auto"><Button size="sm" variant={waiting.length ? 'primary' : 'secondary'}>{waiting.length ? 'Review drafts' : 'Open Drafts'}</Button></Link>
      </CardBody>
    </Card>
  );
}

/** A small card of what is prepared for tomorrow; never the focus during live teaching. */
function TomorrowPreview({ drafts, canPrepare, busy, onPrepare }: { drafts: Draft[]; canPrepare: boolean; busy: boolean; onPrepare(): void }) {
  const ready = drafts.filter((d) => d.generationState === 'ready' && d.reviewState !== 'stale');
  const approved = ready.filter((d) => d.reviewState === 'approved').length;
  return (
    <Card className="flex flex-col bg-ai-wash border-ai/15" data-testid="tomorrow-preview">
      <CardBody className="flex flex-1 flex-col gap-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-ai-fg shadow-xs"><Sparkles className="size-4" /></span>
          <div className="min-w-0">
            <h2 className="font-semibold">Tomorrow Ready</h2>
            <p className="text-sm text-muted">{ready.length ? `${ready.length} prepared · ${approved} approved` : 'Do Now, reteach and small groups from today’s evidence.'}</p>
          </div>
        </div>
        {ready.slice(0, 3).map((d) => (
          <Link key={d.id} to={`/teacher/drafts?draft=${d.id}`} className="flex items-center gap-2 rounded-lg bg-elevated/80 px-3 py-2 text-sm hover:bg-elevated">
            <span className="min-w-0 flex-1 truncate font-medium">{d.title ?? ARTIFACT_META[d.kind].label}</span>
            {d.reviewState === 'approved' ? <Check className="size-4 text-success-fg" aria-label="Approved" /> : <ConfirmChip kind="suggested" label="Suggested" />}
          </Link>
        ))}
        <div className="mt-auto flex flex-wrap gap-2">
          {!ready.length && <Button size="sm" variant="ai" disabled={!canPrepare || busy} onClick={onPrepare}><Sparkles /> Prepare tomorrow</Button>}
          <Link to="/teacher/tomorrow"><Button size="sm" variant="ghost">Open Tomorrow <ArrowRight /></Button></Link>
        </div>
      </CardBody>
    </Card>
  );
}
