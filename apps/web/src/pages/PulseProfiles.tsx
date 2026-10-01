import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ClassroomObservation, ContributionContent } from '@class-pulse/domain';
import { OBSERVATION_META, observationText } from '../lib/pulse';
import { PageHeader } from '../components/AppShell';
import { PlanRevisionForm } from '../components/PlanRevisionForm';
import { Avatar, Badge, Button, Card, CardBody, PageSkeleton, Textarea } from '../components/ui';
import { api, fmtDateTime, humanize } from '../lib/api';
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
  const [selected, setSelected] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  if (role !== 'teacher' && q.data?.length) return <LearnerPulse role={role} people={q.data} />;
  if (!q.data?.length) return role === 'student' ? <StudentHome /> : role === 'guardian' ? <FamilyHome /> : <div><PageHeader title="Students" description="Enable Pulsera for a synthetic workspace to view classroom profiles." /><Link to="/teacher/class"><Button>Manage class roster</Button></Link></div>;
  const people = [...q.data].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const person = people.find((p) => p.id === selected) ?? people[0]!;
  const section = person.sections.find((s) => s.id === selectedSection) ?? person.sections[0]!;
  const choose = (id: string) => { setSelected(id); setSelectedSection(''); };
  return <div className="space-y-4">
    <PageHeader eyebrow="Student Pulse™" title="Students" description="A living profile for each learner: strengths, Classroom Memory, interventions and attributed student and family input, scoped to your class." actions={<Link to="/teacher/class"><Button variant="secondary">Manage class roster</Button></Link>} />
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div role="radiogroup" aria-label="Learner" className="hidden max-h-[calc(100dvh-10rem)] space-y-1 overflow-y-auto lg:sticky lg:top-6 lg:block lg:self-start">
        {people.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === person.id} onClick={() => choose(p.id)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${p.id === person.id ? 'bg-primary-soft font-semibold text-primary-soft-fg' : 'text-muted hover:bg-sunken hover:text-fg'}`}>
            <Avatar name={p.displayName} size="sm" />{p.displayName}
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm lg:hidden">Learner<select className={selectStyle} value={person.id} onChange={(e) => choose(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
          {person.sections.length > 1 && <label className="text-sm">Class<select className={selectStyle} value={section.id} onChange={(e) => setSelectedSection(e.target.value)}>{person.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        </div>
        <div className="flex items-center gap-3"><Avatar name={person.displayName} size="lg" /><div><h2 className="text-xl font-bold tracking-tight">{person.displayName}</h2><p className="text-sm text-muted">{section.name}</p></div></div>
        <ProfileDetail key={`${role}:${person.id}:${section.id}`} role={role} person={person} section={section} people={people} />
      </div>
    </div>
  </div>;
}

function ProfileDetail({ role, person, section, people }: { role: Role; person: Person; section: Person['sections'][number]; people: Person[] }) {
  const q = useQuery({ queryKey: ['pulse-profile', role, person.id, section.id], queryFn: () => api.get<Profile>(`/api/pulse/people/${encodeURIComponent(person.id)}?role=${role}&sectionId=${encodeURIComponent(section.id)}`) });
  const contributions = useQuery({ queryKey: ['pulse-contributions', person.id, section.id], queryFn: () => api.get<Contribution[]>(`/api/pulse/contributions?studentId=${encodeURIComponent(person.id)}&sectionId=${encodeURIComponent(section.id)}`), refetchInterval: 15000 });
  const [selectedCase, setSelectedCase] = useState('');
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <p role="alert">{q.error?.message ?? 'Profile unavailable'}</p>;
  const profile = q.data;
  const caseKey = profile.caseKeys.includes(selectedCase) ? selectedCase : profile.caseKeys[0];
  return <div className="space-y-4">
    <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Strengths and recent successes</h2>
      {profile.successes.map((s) => <SharedMessage key={s.id} item={s} />)}
      {role === 'teacher' && profile.history.filter((e) => ['praise', 'participation'].includes(e.observation.kind)).map((e) => <p key={e.id} className="text-sm">{e.observation.kind === 'praise' ? e.observation.strength : `Participation · ${observationText(e.observation).toLowerCase()}`} · {fmtDateTime(e.observedAt)}</p>)}
      {!profile.successes.length && !(role === 'teacher' && profile.history.some((e) => ['praise', 'participation'].includes(e.observation.kind))) && <p className="text-sm text-muted">No recent success has been shared here yet. This is not a rating of the learner.</p>}
    </CardBody></Card>
    {profile.updates.map((s) => <Card key={s.id}><CardBody className="pt-5"><SharedMessage item={s} /></CardBody></Card>)}
    {role === 'teacher' ? <>
      <ClassroomHelp sectionId={section.id} people={people} />
      <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Classroom Memory · last {profile.memoryWindowDays} days</h2><p className="text-xs text-muted">{profile.coverageNote} Your private observations stay within this section.</p>
        {!profile.history.length && <p className="text-sm text-muted">No eligible confirmed observations.</p>}
        {profile.history.map((e) => <div key={e.id} className="rounded border border-border p-3 text-sm"><Badge>Teacher observation · {OBSERVATION_META[e.observation.kind].label}</Badge><p className="mt-1">{observationText(e.observation)}</p>{e.observation.kind !== 'note' && e.observation.note && <p className="text-muted">{e.observation.note}</p>}<p className="text-xs text-muted">{fmtDateTime(e.observedAt)} · version {e.revision} · {humanize(e.source)}</p></div>)}
        {profile.acceptedContributions.map((c) => <div key={c.id} className="rounded border border-border p-3 text-sm"><Badge>Accepted {c.sourceRole === 'guardian' ? 'family' : 'student'} report</Badge><ContributionText content={c.content} strategies={profile.strategies} /><p className="text-xs text-muted">Version {c.revision} · accepted {fmtDateTime(c.acceptedAt)}. Reported perspective, not a teacher observation.</p></div>)}
      </CardBody></Card>
      {profile.interventions && <Interventions history={profile.interventions} firstName={person.displayName.split(' ')[0]!} />}
      <StudentGuide firstName={person.displayName.split(' ')[0]!} history={profile.history} />
      <PlanRevisionForm caseKeys={profile.caseKeys} sources={[...profile.history.map((e) => ({ kind: 'event' as const, id: e.id, revision: e.revision, label: `${humanize(e.observation.kind)} · ${fmtDateTime(e.observedAt)}` })), ...profile.acceptedContributions.map((c) => ({ kind: 'contribution' as const, id: c.id, revision: c.revision, label: `${c.sourceRole === 'guardian' ? 'Family' : 'Student'} report · ${humanize(c.content.kind)}` }))]} />
    </> : null}
    <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">{role === 'teacher' ? 'Contributions for your review' : 'Your contributions and educator responses'}</h2>
      {contributions.error && <p role="alert">{contributions.error.message}</p>}
      {!contributions.isLoading && !contributions.data?.length && <p className="text-sm text-muted">No contributions yet.</p>}
      {contributions.data?.map((c) => <div key={c.id} data-testid="contribution" className="space-y-2 rounded border border-border p-3"><div className="flex flex-wrap gap-2"><Badge>{humanize(c.status)}</Badge><span className="text-xs">{c.authorName} · {c.sourceRole === 'guardian' ? 'Family report' : 'Student report'} · version {c.revision}</span></div>{c.content && <ContributionText content={c.content} strategies={profile.strategies} />}{c.response && <p className="text-sm"><strong>Educator response:</strong> {c.response}</p>}
        {c.usedInPlanVersion && <p className="text-sm text-success-fg">This version informed approved support plan version {c.usedInPlanVersion}.</p>}
        {role === 'teacher' && ['pending', 'acknowledged'].includes(c.status) && <ContributionResponse item={c} />}
      </div>)}
    </CardBody></Card>
    {profile.caseKeys.length > 0 && <div className="space-y-3"><h2 className="font-semibold">Support plans and progress</h2>{profile.caseKeys.length > 1 && <label className="block text-sm">Support record<select className={selectStyle} value={caseKey} onChange={(e) => setSelectedCase(e.target.value)}>{profile.caseKeys.map((key, index) => <option key={key} value={key}>Support record {index + 1}</option>)}</select></label>}{role === 'teacher' ? profile.caseKeys.map((key, index) => <Link key={key} className="mr-4 text-sm text-primary underline" to={`/teacher/cases/${key}`}>Open support record {index + 1}</Link>) : role === 'student' ? <StudentHome key={caseKey} selectedCaseKey={caseKey} /> : <FamilyHome key={caseKey} selectedCaseKey={caseKey} />}</div>}
  </div>;
}
function SharedMessage({ item }: { item: Shared }) { return <div className="text-sm"><h3 className="font-medium">{item.title}</h3><p>{item.message}</p><p className="mt-1 text-xs text-muted">Approved by {item.educator} · {fmtDateTime(item.approvedAt)}</p></div>; }
export function ContributionText({ content, strategies }: { content: ContributionContent; strategies: Strategy[] }) { return <dl className="space-y-1 text-sm">{Object.entries(content).filter(([k]) => k !== 'kind').map(([key, value]) => <div key={key}><dt className="inline font-medium">{key === 'strategyId' ? 'Chosen strategy' : humanize(key)}: </dt><dd className="inline">{key === 'strategyId' ? strategies.find((s) => s.id === value)?.content.description ?? 'Previously approved strategy (no longer current)' : value === null || value === '' ? 'Not provided' : String(value)}</dd></div>)}</dl>; }

function ContributionResponse({ item }: { item: Contribution }) {
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
