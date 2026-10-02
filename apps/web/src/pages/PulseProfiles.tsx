import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Star, Target, Users } from 'lucide-react';
import type { ClassroomObservation, ContributionContent } from '@class-pulse/domain';
import { OBSERVATION_META, observationText } from '../lib/pulse';
import { PageHeader } from '../components/AppShell';
import { PlanRevisionForm } from '../components/PlanRevisionForm';
import { Avatar, Badge, Button, Card, CardBody, Empty, Input, PageSkeleton, ProgressRing, Segmented, Textarea, cn } from '../components/ui';
import { api, fmtDate, fmtDateTime, humanize } from '../lib/api';
import { StudentHome } from './student/StudentHome';
import { FamilyHome } from './family/FamilyHome';
import { LearnerPulse } from './MyPulse';
import { StudentGuide } from './teacher/pulse/StudentGuide';
import { Interventions, type InterventionHistory } from './teacher/pulse/Interventions';

type Role = 'teacher' | 'student' | 'guardian';
export type Person = { id: string; displayName: string; sections: Array<{ id: string; name: string; teachers: Array<{ id: string; name: string }> }> };
export type Shared = { id: string; title: string; message: string; educator: string; approvedAt: string };
export type Strategy = { id: string; kind: string; content: { description: string } };
export type Profile = { collection?: { wellbeing: boolean }; interventions?: InterventionHistory | null; successes: Shared[]; updates: Shared[]; history: Array<{ id: string; sessionId: string; revision: number; observation: ClassroomObservation; observedAt: string; source: string }>; acceptedContributions: Array<{ id: string; revision: number; sourceRole: string; content: ContributionContent; acceptedAt: string }>; strategies: Strategy[]; caseKeys: string[]; memoryWindowDays: number; coverageNote: string };
export type Contribution = { id: string; revision: number; studentId: string; own: boolean; sharedView?: boolean; visibility?: 'teacher' | 'teacher_and_student'; sourceRole: string; authorName: string; status: string; content: ContributionContent | null; response: string | null; respondedAt: string | null; createdAt: string; usedInPlanVersion?: number | null };
const selectStyle = 'min-h-11 w-full rounded border border-border bg-elevated px-3 text-sm';
export function PulseProfiles({ role }: { role: Role }) {
  const q = useQuery({ queryKey: ['pulse-people', role], queryFn: () => api.get<Person[]>(`/api/pulse/people?role=${role}`) });
  const [params, setParams] = useSearchParams();
  const [selectedSection, setSelectedSection] = useState('');
  const [filter, setFilter] = useState('');
  const selected = params.get('student') ?? '';
  useEffect(() => {
    // #guide (from Reports or Class Pulse) scrolls to Guide once the profile has rendered.
    if (location.hash !== '#guide' || !q.data) return;
    const t = setTimeout(() => document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    return () => clearTimeout(t);
  }, [q.data, selected]);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <Empty title="Students could not load" description={`${q.error.message} Refresh to try again.`} />;
  if (role !== 'teacher' && q.data?.length) return <LearnerPulse role={role} people={q.data} />;
  if (!q.data?.length) return role === 'student' ? <StudentHome /> : role === 'guardian' ? <FamilyHome /> : <div><PageHeader title="Students" description="Students in your classes appear here with their strengths and history." /><Empty icon={<Users />} title="No students yet" description="Add students to a class and they appear here." action={<Link to="/teacher/classes"><Button>Go to My Classes</Button></Link>} /></div>;
  const people = [...q.data].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const person = people.find((p) => p.id === selected) ?? people[0]!;
  const section = person.sections.find((s) => s.id === selectedSection) ?? person.sections[0]!;
  const choose = (id: string) => { setParams((p) => { const n = new URLSearchParams(p); n.set('student', id); return n; }, { replace: true }); setSelectedSection(''); };
  const shown = people.filter((p) => p.displayName.toLowerCase().includes(filter.trim().toLowerCase()));
  return <div className="space-y-6">
    <PageHeader title="Students" description="Strengths first, then everything you have confirmed, and what students and families have shared." />
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="hidden space-y-3 lg:sticky lg:top-24 lg:block lg:self-start">
        <Input aria-label="Find a student" placeholder="Find a student" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div role="radiogroup" aria-label="Learner" className="max-h-[calc(100dvh-14rem)] space-y-0.5 overflow-y-auto">
          {shown.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === person.id} onClick={() => choose(p.id)} className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm', p.id === person.id ? 'bg-primary-soft font-semibold text-primary-soft-fg' : 'text-muted hover:bg-sunken hover:text-fg')}>
              <Avatar name={p.displayName} size="sm" />{p.displayName}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
          <label className="text-sm font-medium">Student<select className={selectStyle} value={person.id} onChange={(e) => choose(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={person.displayName} size="xl" />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-tight">{person.displayName}</h2>
            <p className="text-sm text-muted">{section.name}{section.teachers.length ? ` · ${section.teachers.map((t) => t.name).join(', ')}` : ''}</p>
          </div>
          {person.sections.length > 1 && <Segmented size="sm" value={section.id} onChange={setSelectedSection} options={person.sections.map((s) => ({ value: s.id, label: s.name }))} />}
        </div>
        <ProfileDetail key={`${role}:${person.id}:${section.id}`} role={role} person={person} section={section} people={people} />
      </div>
    </div>
  </div>;
}

const STRENGTH_KINDS = ['praise', 'participation'];

function ProfileDetail({ role, person, section, people }: { role: Role; person: Person; section: Person['sections'][number]; people: Person[] }) {
  const q = useQuery({ queryKey: ['pulse-profile', role, person.id, section.id], queryFn: () => api.get<Profile>(`/api/pulse/people/${encodeURIComponent(person.id)}?role=${role}&sectionId=${encodeURIComponent(section.id)}`) });
  const contributions = useQuery({ queryKey: ['pulse-contributions', person.id, section.id], queryFn: () => api.get<Contribution[]>(`/api/pulse/contributions?studentId=${encodeURIComponent(person.id)}&sectionId=${encodeURIComponent(section.id)}`), refetchInterval: 15000 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <Empty title="This profile is not available" description={q.error?.message ?? 'Try another student.'} />;
  const profile = q.data;
  const first = person.displayName.split(' ')[0]!;
  const wins = profile.history.filter((e) => STRENGTH_KINDS.includes(e.observation.kind) || (e.observation.kind === 'understanding' && e.observation.evidence === 'demonstrated'));
  const checks = profile.history.filter((e) => e.observation.kind === 'understanding' && e.observation.evidence !== 'not_checked');
  const shown = checks.filter((e) => e.observation.kind === 'understanding' && e.observation.evidence === 'demonstrated').length;
  const participation = profile.history.filter((e) => e.observation.kind === 'participation').length;
  const input = (contributions.data ?? []).length + profile.acceptedContributions.length;
  return <div className="space-y-6">
    {/* Strengths first (spec §10). */}
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 bg-success-soft px-5 py-3 text-sm font-semibold text-success-fg"><Star className="size-4" />Strengths and recent wins</div>
      <CardBody className="space-y-3 pt-4">
        {!!wins.length && <ul className="flex flex-wrap gap-2">{wins.slice(0, 8).map((e) => <li key={e.id} className="rounded-full bg-sunken px-3 py-1.5 text-sm">{e.observation.kind === 'praise' ? e.observation.strength : e.observation.kind === 'understanding' ? `Understood ${e.observation.concept}` : `Participated · ${observationText(e.observation).toLowerCase()}`}<span className="ml-1.5 text-xs text-subtle">{fmtDate(e.observedAt)}</span></li>)}</ul>}
        {profile.successes.map((s) => <SharedMessage key={s.id} item={s} />)}
        {!wins.length && !profile.successes.length && <p className="text-sm text-muted">No wins recorded yet. Tap Praise or Participated for {first} in Class Pulse and they appear here. This is not a rating.</p>}
      </CardBody>
    </Card>

    {/* Simple indicators, never scores: each says how much evidence is behind it. */}
    <div className="grid gap-4 sm:grid-cols-3">
      <Card><CardBody className="flex items-center gap-4 pt-5">
        <ProgressRing value={checks.length >= 3 ? (shown / checks.length) * 100 : 0} tone="success" label={checks.length >= 3 ? `${shown}/${checks.length}` : '—'} />
        <div><div className="text-sm font-semibold">Understanding shown</div><div className="text-xs text-muted">{checks.length >= 3 ? `${shown} of ${checks.length} checks` : `Not enough checks yet (${checks.length} of 3)`}</div></div>
      </CardBody></Card>
      <Card><CardBody className="flex items-center gap-4 pt-5">
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-primary-soft text-xl font-semibold text-primary-soft-fg">{participation}</span>
        <div><div className="text-sm font-semibold">Participation</div><div className="text-xs text-muted">in the last {profile.memoryWindowDays} days</div></div>
      </CardBody></Card>
      <Card><CardBody className="flex items-center gap-4 pt-5">
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-sunken text-xl font-semibold">{input}</span>
        <div><div className="text-sm font-semibold">From home and {first}</div><div className="text-xs text-muted">reports shared with you</div></div>
      </CardBody></Card>
    </div>

    {profile.caseKeys.length > 0 && (
      <Card><CardBody className="flex flex-wrap items-center gap-4 pt-5">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg"><Target className="size-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-semibold">Current goals</h3><p className="text-sm text-muted">{first}’s goals and progress live in the approved support plan.</p></div>
        {profile.caseKeys.map((key, index) => <Link key={key} to={`/teacher/cases/${key}`}><Button variant="secondary">Open support plan{profile.caseKeys.length > 1 ? ` ${index + 1}` : ''} <ArrowRight /></Button></Link>)}
      </CardBody></Card>
    )}

    <ClassroomHelp sectionId={section.id} people={people} />

    <Card><CardBody className="space-y-4 pt-5">
      <div><h3 className="font-semibold">Classroom Memory</h3><p className="text-xs text-muted">Your confirmed observations from the last {profile.memoryWindowDays} days, and reports you accepted. {profile.coverageNote}</p></div>
      {!profile.history.length && !profile.acceptedContributions.length && <p className="text-sm text-muted">No confirmed observations yet.</p>}
      <ol className="space-y-2">
        {profile.history.map((e) => { const m = OBSERVATION_META[e.observation.kind]; return <li key={e.id} className="flex gap-3 rounded-lg border border-border p-3 text-sm"><span className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg', m.chip)}><m.icon className="size-4" /></span><div className="min-w-0 flex-1"><p>{observationText(e.observation)}</p>{e.observation.kind !== 'note' && e.observation.note && <p className="text-muted">{e.observation.note}</p>}<p className="mt-0.5 text-xs text-subtle">Your observation · {m.label} · {fmtDateTime(e.observedAt)} · version {e.revision}</p></div></li>; })}
        {profile.acceptedContributions.map((c) => <li key={c.id} className="rounded-lg border border-dashed border-border-strong p-3 text-sm"><Badge tone="neutral">{c.sourceRole === 'guardian' ? 'Family' : 'Student'} perspective · accepted</Badge><ContributionText content={c.content} strategies={profile.strategies} /><p className="mt-0.5 text-xs text-subtle">Version {c.revision} · accepted {fmtDateTime(c.acceptedAt)}. Reported by the {c.sourceRole === 'guardian' ? 'family' : 'student'}, not a teacher observation.</p></li>)}
      </ol>
    </CardBody></Card>

    <Card><CardBody className="space-y-4 pt-5"><h3 className="font-semibold">Shared with you by {first} and family</h3>
      {contributions.error && <p role="alert">{contributions.error.message}</p>}
      {!contributions.isLoading && !contributions.data?.length && <p className="text-sm text-muted">Nothing shared yet.</p>}
      {contributions.data?.map((c) => <div key={c.id} data-testid="contribution" className="space-y-2 rounded-lg border border-border p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone={['pending', 'acknowledged'].includes(c.status) ? 'warning' : 'neutral'}>{humanize(c.status)}</Badge><span className="text-xs text-muted">{c.authorName} · {c.sourceRole === 'guardian' ? 'Family report' : 'Student report'} · version {c.revision}</span></div>{c.content && <ContributionText content={c.content} strategies={profile.strategies} />}{c.response && <p className="text-sm"><strong>Your response:</strong> {c.response}</p>}
        {c.usedInPlanVersion && <p className="text-sm text-success-fg">This version informed approved support plan version {c.usedInPlanVersion}.</p>}
        {['pending', 'acknowledged'].includes(c.status) && <ContributionResponse item={c} />}
      </div>)}
    </CardBody></Card>

    {profile.interventions && <Interventions history={profile.interventions} firstName={first} />}
    <div id="guide" className="scroll-mt-24"><StudentGuide firstName={first} history={profile.history} /></div>
    <PlanRevisionForm caseKeys={profile.caseKeys} sources={[...profile.history.map((e) => ({ kind: 'event' as const, id: e.id, revision: e.revision, label: `${humanize(e.observation.kind)} · ${fmtDateTime(e.observedAt)}` })), ...profile.acceptedContributions.map((c) => ({ kind: 'contribution' as const, id: c.id, revision: c.revision, label: `${c.sourceRole === 'guardian' ? 'Family' : 'Student'} report · ${humanize(c.content.kind)}` }))]} />
  </div>;
}

function SharedMessage({ item }: { item: Shared }) { return <div className="text-sm"><h3 className="font-medium">{item.title}</h3><p>{item.message}</p><p className="mt-1 text-xs text-muted">Approved by {item.educator} · {fmtDateTime(item.approvedAt)}</p></div>; }
export function ContributionText({ content, strategies }: { content: ContributionContent; strategies: Strategy[] }) { return <dl className="space-y-1 text-sm">{Object.entries(content).filter(([k]) => k !== 'kind').map(([key, value]) => <div key={key}><dt className="inline font-medium">{key === 'strategyId' ? 'Chosen strategy' : humanize(key)}: </dt><dd className="inline">{key === 'strategyId' ? strategies.find((s) => s.id === value)?.content.description ?? 'Previously approved strategy (no longer current)' : value === null || value === '' ? 'Not provided' : String(value)}</dd></div>)}</dl>; }

export function ContributionResponse({ item }: { item: Contribution }) {
  const qc = useQueryClient();
  const [response, setResponse] = useState(''); const [decision, setDecision] = useState('acknowledged'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await api.post(`/api/pulse/contributions/${item.id}/respond`, { expectedRevision: item.revision, decision, response }); await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); await qc.invalidateQueries({ queryKey: ['pulse-profile'] }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not respond'); } finally { setBusy(false); } }}><label className="block text-sm">Your response<Textarea required maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} /></label><label className="block text-sm">Decision<select className={selectStyle} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="acknowledged">Acknowledge receipt</option><option value="accepted">Accept this version into instructional history</option><option value="declined">Respond without accepting into history</option></select></label><Button loading={busy} type="submit">Save educator response</Button>{error && <p role="alert">{error}</p>}</form>;
}
export function ClassroomHelp({ sectionId, people = [] }: { sectionId: string; people?: Person[] }) {
  const qc = useQueryClient(); const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['classroom-help', sectionId], queryFn: () => api.get<Array<{ id: string; studentId: string; description: string; status: string; createdAt: string }>>(`/api/pulse/help?sectionId=${encodeURIComponent(sectionId)}`), refetchInterval: 15000 });
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const open = q.data?.filter((r) => r.status === 'open') ?? [];
  if (!open.length) return null;
  return <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Help requests · follow school procedures</h2>{open.map((r) => <div key={r.id} className="space-y-2 rounded border border-border p-3"><p className="font-medium">{people.find((p) => p.id === r.studentId)?.displayName ?? 'Learner in this class'}</p><p className="text-sm">{r.description}</p><p className="text-xs text-muted">{fmtDateTime(r.createdAt)}</p><Button onClick={async () => { try { await api.post(`/api/pulse/help/${r.id}/acknowledge`); await qc.invalidateQueries({ queryKey: ['classroom-help'] }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not acknowledge'); } }}>Acknowledge and follow up</Button></div>)}{error && <p role="alert">{error}</p>}</CardBody></Card>;
}
