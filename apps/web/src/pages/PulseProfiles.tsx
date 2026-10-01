import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ClassroomObservation, ContributionContent, SubmitContribution } from '@class-pulse/domain';
import { classroomEvidenceText } from '@class-pulse/domain';
import { PageHeader } from '../components/AppShell';
import { PlanRevisionForm } from '../components/PlanRevisionForm';
import { Badge, Button, Card, CardBody, PageSkeleton, Textarea } from '../components/ui';
import { api, fmtDateTime, humanize } from '../lib/api';
import { StudentHome } from './student/StudentHome';
import { FamilyHome } from './family/FamilyHome';

type Role = 'teacher' | 'student' | 'guardian';
type Person = { id: string; displayName: string; sections: Array<{ id: string; name: string; teachers: Array<{ id: string; name: string }> }> };
type Shared = { id: string; title: string; message: string; educator: string; approvedAt: string };
type Strategy = { id: string; kind: string; content: { description: string } };
type Profile = { successes: Shared[]; updates: Shared[]; history: Array<{ id: string; revision: number; observation: ClassroomObservation; observedAt: string; source: string }>; acceptedContributions: Array<{ id: string; revision: number; sourceRole: string; content: ContributionContent; acceptedAt: string }>; strategies: Strategy[]; caseKeys: string[]; memoryWindowDays: number; coverageNote: string };
type Contribution = { id: string; revision: number; studentId: string; own: boolean; sourceRole: string; authorName: string; status: string; content: ContributionContent | null; response: string | null; respondedAt: string | null; createdAt: string; usedInPlanVersion?: number | null };
const selectStyle = 'min-h-11 w-full rounded border border-border bg-elevated px-3 text-sm';
function emptyContribution(kind: ContributionContent['kind']): ContributionContent {
  switch (kind) {
    case 'reflection': return { kind, whatHappened: '', whatHelped: '' };
    case 'proposal': return { kind, proposedChange: '', reason: '' };
    case 'strategy_choice': return { kind, strategyId: '', experience: '' };
    case 'family_observation': return { kind, observation: '', context: '' };
    case 'home_strategy': return { kind, strategy: '', observedOutcome: '' };
    case 'homework': return { kind, observation: '', whatHelped: '' };
  }
}

export function PulseProfiles({ role }: { role: Role }) {
  const q = useQuery({ queryKey: ['pulse-people', role], queryFn: () => api.get<Person[]>(`/api/pulse/people?role=${role}`) });
  const [selected, setSelected] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  if (!q.data?.length) return role === 'student' ? <StudentHome /> : role === 'guardian' ? <FamilyHome /> : <div><PageHeader title="Students" description="Enable Pulsera for a synthetic workspace to view classroom profiles." /><Link to="/teacher/class"><Button>Manage class roster</Button></Link></div>;
  const person = q.data.find((p) => p.id === selected) ?? q.data[0]!;
  const section = person.sections.find((s) => s.id === selectedSection) ?? person.sections[0]!;
  return <div className="space-y-4">
    <PageHeader title={role === 'teacher' ? 'Students' : role === 'student' ? 'My Pulse' : 'Family Pulse'} description={role === 'teacher' ? 'Classroom Memory and student/family contributions, scoped to your section.' : 'Recent successes, things that help, and a place to share your perspective.'} actions={role === 'teacher' ? <Link to="/teacher/class"><Button variant="secondary">Manage class roster</Button></Link> : undefined} />
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{role === 'guardian' ? 'Child' : 'Learner'}<select className={selectStyle} value={person.id} onChange={(e) => { setSelected(e.target.value); setSelectedSection(''); }}>{q.data.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><label className="text-sm">Class<select className={selectStyle} value={section.id} onChange={(e) => setSelectedSection(e.target.value)}>{person.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
    <ProfileDetail key={`${role}:${person.id}:${section.id}`} role={role} person={person} section={section} people={q.data} />
  </div>;
}

function ProfileDetail({ role, person, section, people }: { role: Role; person: Person; section: Person['sections'][number]; people: Person[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pulse-profile', role, person.id, section.id], queryFn: () => api.get<Profile>(`/api/pulse/people/${encodeURIComponent(person.id)}?role=${role}&sectionId=${encodeURIComponent(section.id)}`) });
  const contributions = useQuery({ queryKey: ['pulse-contributions', person.id, section.id], queryFn: () => api.get<Contribution[]>(`/api/pulse/contributions?studentId=${encodeURIComponent(person.id)}&sectionId=${encodeURIComponent(section.id)}`), refetchInterval: 15000 });
  const [editing, setEditing] = useState<Contribution | null>(null);
  const [selectedCase, setSelectedCase] = useState('');
  const [error, setError] = useState('');
  async function withdraw(item: Contribution) {
    try { await api.post(`/api/pulse/contributions/${item.id}/withdraw`, { expectedRevision: item.revision }); await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); await qc.invalidateQueries({ queryKey: ['pulse-profile'] }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not withdraw'); }
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <p role="alert">{q.error?.message ?? 'Profile unavailable'}</p>;
  const profile = q.data;
  const caseKey = profile.caseKeys.includes(selectedCase) ? selectedCase : profile.caseKeys[0];
  return <div className="space-y-4">
    <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Strengths and recent successes</h2>
      {profile.successes.map((s) => <SharedMessage key={s.id} item={s} />)}
      {role === 'teacher' && profile.history.filter((e) => ['praise', 'participation'].includes(e.observation.kind)).map((e) => <p key={e.id} className="text-sm">{e.observation.kind === 'praise' ? e.observation.strength : 'Recorded participation'} · {fmtDateTime(e.observedAt)}</p>)}
      {!profile.successes.length && !(role === 'teacher' && profile.history.some((e) => ['praise', 'participation'].includes(e.observation.kind))) && <p className="text-sm text-muted">No recent success has been shared here yet. This is not a rating of the learner.</p>}
    </CardBody></Card>
    {profile.updates.map((s) => <Card key={s.id}><CardBody className="pt-5"><SharedMessage item={s} /></CardBody></Card>)}
    {role === 'teacher' ? <>
      <ClassroomHelp sectionId={section.id} people={people} />
      <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Classroom Memory · last {profile.memoryWindowDays} days</h2><p className="text-xs text-muted">{profile.coverageNote} Your private observations stay within this section.</p>
        {!profile.history.length && <p className="text-sm text-muted">No eligible confirmed observations.</p>}
        {profile.history.map((e) => <div key={e.id} className="rounded border border-border p-3 text-sm"><Badge>Teacher observation</Badge><p className="mt-1">{classroomEvidenceText(e.observation)}</p><p className="text-xs text-muted">{fmtDateTime(e.observedAt)} · version {e.revision} · {humanize(e.source)}</p></div>)}
        {profile.acceptedContributions.map((c) => <div key={c.id} className="rounded border border-border p-3 text-sm"><Badge>Accepted {c.sourceRole === 'guardian' ? 'family' : 'student'} report</Badge><ContributionText content={c.content} strategies={profile.strategies} /><p className="text-xs text-muted">Version {c.revision} · accepted {fmtDateTime(c.acceptedAt)}. Reported perspective, not a teacher observation.</p></div>)}
      </CardBody></Card>
      <PlanRevisionForm caseKeys={profile.caseKeys} sources={[...profile.history.map((e) => ({ kind: 'event' as const, id: e.id, revision: e.revision, label: `${humanize(e.observation.kind)} · ${fmtDateTime(e.observedAt)}` })), ...profile.acceptedContributions.map((c) => ({ kind: 'contribution' as const, id: c.id, revision: c.revision, label: `${c.sourceRole === 'guardian' ? 'Family' : 'Student'} report · ${humanize(c.content.kind)}` }))]} />
    </> : <>
      {!!profile.strategies.length && <Card><CardBody className="space-y-2 pt-5"><h2 className="font-semibold">Approved things that help</h2>{profile.strategies.map((s) => <p key={s.id} className="text-sm">{s.content.description}</p>)}</CardBody></Card>}
      <ContributionForm key={editing?.id ?? 'new'} role={role} person={person} section={section} strategies={profile.strategies} editing={editing} onDone={() => setEditing(null)} />
      <HelpForm role={role} person={person} section={section} />
    </>}
    <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">{role === 'teacher' ? 'Contributions for your review' : 'Your contributions and educator responses'}</h2>
      {contributions.error && <p role="alert">{contributions.error.message}</p>}
      {!contributions.isLoading && !contributions.data?.length && <p className="text-sm text-muted">No contributions yet.</p>}
      {contributions.data?.map((c) => <div key={c.id} data-testid="contribution" className="space-y-2 rounded border border-border p-3"><div className="flex flex-wrap gap-2"><Badge>{humanize(c.status)}</Badge><span className="text-xs">{c.authorName} · {c.sourceRole === 'guardian' ? 'Family report' : 'Student report'} · version {c.revision}</span></div>{c.content && <ContributionText content={c.content} strategies={profile.strategies} />}{c.response && <p className="text-sm"><strong>Educator response:</strong> {c.response}</p>}
        {c.usedInPlanVersion && <p className="text-sm text-success-fg">This version informed approved support plan version {c.usedInPlanVersion}.</p>}
        {role === 'teacher' && ['pending', 'acknowledged'].includes(c.status) && <ContributionResponse item={c} />}
        {c.own && c.content && c.status !== 'withdrawn' && <div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(c)}>Correct contribution</Button><Button variant="ghost" onClick={() => void withdraw(c)}>Withdraw</Button></div>}
      </div>)}
      {error && <p role="alert">{error}</p>}
    </CardBody></Card>
    {profile.caseKeys.length > 0 && <div className="space-y-3"><h2 className="font-semibold">Support plans and progress</h2>{profile.caseKeys.length > 1 && <label className="block text-sm">Support record<select className={selectStyle} value={caseKey} onChange={(e) => setSelectedCase(e.target.value)}>{profile.caseKeys.map((key, index) => <option key={key} value={key}>Support record {index + 1}</option>)}</select></label>}{role === 'teacher' ? profile.caseKeys.map((key, index) => <Link key={key} className="mr-4 text-sm text-primary underline" to={`/teacher/cases/${key}`}>Open support record {index + 1}</Link>) : role === 'student' ? <StudentHome key={caseKey} selectedCaseKey={caseKey} /> : <FamilyHome key={caseKey} selectedCaseKey={caseKey} />}</div>}
  </div>;
}
function SharedMessage({ item }: { item: Shared }) { return <div className="text-sm"><h3 className="font-medium">{item.title}</h3><p>{item.message}</p><p className="mt-1 text-xs text-muted">Approved by {item.educator} · {fmtDateTime(item.approvedAt)}</p></div>; }
function ContributionText({ content, strategies }: { content: ContributionContent; strategies: Strategy[] }) { return <dl className="space-y-1 text-sm">{Object.entries(content).filter(([k]) => k !== 'kind').map(([key, value]) => <div key={key}><dt className="inline font-medium">{key === 'strategyId' ? 'Chosen strategy' : humanize(key)}: </dt><dd className="inline">{key === 'strategyId' ? strategies.find((s) => s.id === value)?.content.description ?? 'Previously approved strategy (no longer current)' : value || 'Not provided'}</dd></div>)}</dl>; }

function ContributionForm({ role, person, section, strategies, editing, onDone }: { role: 'student' | 'guardian'; person: Person; section: Person['sections'][number]; strategies: Strategy[]; editing: Contribution | null; onDone(): void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState<ContributionContent>(editing?.content ?? emptyContribution(role === 'student' ? 'reflection' : 'family_observation'));
  const [recipientId, setRecipientId] = useState(section.teachers[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const retry = useRef<{ key: string; requestId: string } | null>(null);
  const kinds: ContributionContent['kind'][] = role === 'student' ? ['reflection', 'proposal', ...(strategies.length ? ['strategy_choice' as const] : [])] : ['family_observation', 'home_strategy', 'homework', 'proposal', ...(strategies.length ? ['strategy_choice' as const] : [])];
  return <Card><CardBody className="pt-5"><h2 className="font-semibold">{editing ? 'Correct your contribution' : 'Share your perspective (optional)'}</h2><p className="my-2 text-xs text-muted">Visible to you and your selected teacher. Acceptance keeps this attributed to you; it does not become a teacher observation. Sleep and mood collection await school policy approval. Use the separate help request for urgent concerns.</p><form className="space-y-3" onSubmit={async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    const body = editing ? { expectedRevision: editing.revision, content } : { studentId: person.id, sectionId: section.id, recipientId, role, content } satisfies Omit<SubmitContribution, 'requestId'>;
    const key = JSON.stringify(body); if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
    try { await api.post(editing ? `/api/pulse/contributions/${editing.id}/correct` : '/api/pulse/contributions', { ...body, requestId: retry.current.requestId }); await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); await qc.invalidateQueries({ queryKey: ['pulse-profile'] }); retry.current = null; setContent(emptyContribution(content.kind)); setMessage('Submitted to your teacher. This is awaiting review.'); onDone(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Could not submit. Please retry.'); } finally { setBusy(false); }
  }}>
    {!editing && <label className="block text-sm">Teacher<select required className={selectStyle} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}><option value="">Choose a teacher</option>{section.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    <label className="block text-sm">Contribution type<select className={selectStyle} value={content.kind} onChange={(e) => setContent(emptyContribution(e.target.value as ContributionContent['kind']))}>{kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
    {Object.entries(content).filter(([key]) => key !== 'kind').map(([key, value]) => <label key={key} className="block text-sm">{key === 'strategyId' ? 'Approved strategy' : humanize(key)}{key === 'strategyId' ? <select required className={selectStyle} value={value} onChange={(e) => setContent({ ...content, strategyId: e.target.value } as ContributionContent)}><option value="">Choose a strategy</option>{strategies.map((s) => <option key={s.id} value={s.id}>{s.content.description}</option>)}</select> : <Textarea required={!['whatHelped', 'context'].includes(key)} maxLength={key === 'context' ? 1000 : 2000} value={value} onChange={(e) => setContent({ ...content, [key]: e.target.value } as ContributionContent)} />}</label>)}
    <Button type="submit" loading={busy}>{editing ? 'Submit corrected version' : 'Submit for teacher review'}</Button>{editing && <Button type="button" variant="ghost" onClick={onDone}>Cancel correction</Button>}<p role="status" className="text-sm">{message}</p>
  </form></CardBody></Card>;
}
function ContributionResponse({ item }: { item: Contribution }) {
  const qc = useQueryClient();
  const [response, setResponse] = useState(''); const [decision, setDecision] = useState('acknowledged'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await api.post(`/api/pulse/contributions/${item.id}/respond`, { expectedRevision: item.revision, decision, response }); await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); await qc.invalidateQueries({ queryKey: ['pulse-profile'] }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not respond'); } finally { setBusy(false); } }}><label className="block text-sm">Your response<Textarea required maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} /></label><label className="block text-sm">Decision<select className={selectStyle} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="acknowledged">Acknowledge receipt</option><option value="accepted">Accept this version into instructional history</option><option value="declined">Respond without accepting into history</option></select></label><Button loading={busy} type="submit">Save educator response</Button>{error && <p role="alert">{error}</p>}</form>;
}
function HelpForm({ role, person, section }: { role: 'student' | 'guardian'; person: Person; section: Person['sections'][number] }) {
  const [description, setDescription] = useState(''); const [recipientId, setRecipientId] = useState(section.teachers[0]?.id ?? ''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const retry = useRef<{ key: string; id: string } | null>(null);
  return <Card><CardBody className="pt-5"><h2 className="font-semibold">Ask for help</h2><p className="my-2 text-sm">This goes directly to the selected teacher's help inbox without waiting for draft review. This inbox is not continuously monitored. For urgent help, contact a trusted adult or use your school's immediate help process.</p><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMessage(''); const body = { studentId: person.id, sectionId: section.id, recipientId, role, description }; const key = JSON.stringify(body); if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }; try { await api.post('/api/pulse/help', { ...body, requestId: retry.current.id }); setMessage('Saved in your teacher’s help inbox. Contact an adult directly if you need help now.'); setDescription(''); retry.current = null; } catch (err) { setMessage(err instanceof Error ? err.message : 'Request failed. Contact an adult directly.'); } finally { setBusy(false); } }}><label className="block text-sm">Teacher for help<select required className={selectStyle} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}><option value="">Choose a teacher</option>{section.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="block text-sm">What help do you need?<Textarea required maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label><Button type="submit" loading={busy}>Send help request</Button><p role="status" className="text-sm">{message}</p></form></CardBody></Card>;
}
export function ClassroomHelp({ sectionId, people = [] }: { sectionId: string; people?: Person[] }) {
  const qc = useQueryClient(); const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['classroom-help', sectionId], queryFn: () => api.get<Array<{ id: string; studentId: string; description: string; status: string; createdAt: string }>>(`/api/pulse/help?sectionId=${encodeURIComponent(sectionId)}`), refetchInterval: 15000 });
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const open = q.data?.filter((r) => r.status === 'open') ?? [];
  if (!open.length) return null;
  return <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Help requests · follow school procedures</h2>{open.map((r) => <div key={r.id} className="space-y-2 rounded border border-border p-3"><p className="font-medium">{people.find((p) => p.id === r.studentId)?.displayName ?? 'Learner in this class'}</p><p className="text-sm">{r.description}</p><p className="text-xs text-muted">{fmtDateTime(r.createdAt)}</p><Button onClick={async () => { try { await api.post(`/api/pulse/help/${r.id}/acknowledge`); await qc.invalidateQueries({ queryKey: ['classroom-help'] }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not acknowledge'); } }}>Acknowledge and follow up</Button></div>)}{error && <p role="alert">{error}</p>}</CardBody></Card>;
}
