import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, HeartHandshake, LifeBuoy, MessageCircleHeart, Moon, PartyPopper, Smile, Sparkles, ThumbsUp } from 'lucide-react';
import type { ContributionContent, ContributionVisibility, SubmitContribution } from '@class-pulse/domain';
import { PageHeader } from '../components/AppShell';
import { Avatar, Badge, Button, Card, CardBody, Dialog, DialogContent, Input, PageSkeleton, Segmented, Textarea, cn } from '../components/ui';
import { api, fmtDateTime, humanize } from '../lib/api';
import { StudentHome } from './student/StudentHome';
import { FamilyHome } from './family/FamilyHome';
import { ContributionText, type Contribution, type Person, type Profile, type Shared, type Strategy } from './PulseProfiles';

type Role = 'student' | 'guardian';
const selectStyle = 'min-h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm';

export function emptyContribution(kind: ContributionContent['kind']): ContributionContent {
  switch (kind) {
    case 'reflection': return { kind, whatHappened: '', whatHelped: '' };
    case 'proposal': return { kind, proposedChange: '', reason: '' };
    case 'strategy_choice': return { kind, strategyId: '', experience: '' };
    case 'family_observation': return { kind, observation: '', context: '' };
    case 'home_strategy': return { kind, strategy: '', observedOutcome: '' };
    case 'homework': return { kind, observation: '', whatHelped: '' };
    case 'sleep': return { kind, quality: 'rested', hours: null, note: '' };
    case 'mood': return { kind, description: '', note: '' };
  }
}
const KIND_LABEL: Record<ContributionContent['kind'], string> = {
  reflection: 'A reflection', proposal: 'An idea for a change', strategy_choice: 'A strategy that helps',
  family_observation: 'Something we noticed at home', home_strategy: 'Something that worked at home', homework: 'Homework',
  sleep: 'Sleep last night', mood: 'How they seemed before school',
};

/**
 * My Pulse™ (students) and Family Pulse™ (guardians). Strengths first, then goals with progress,
 * the strategies that help (which the learner and family can choose), and an attributed record of
 * everyone's contributions. Nothing here shows teacher notes, pending drafts or hypotheses.
 */
export function LearnerPulse({ role, people }: { role: Role; people: Person[] }) {
  const [selected, setSelected] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const person = people.find((p) => p.id === selected) ?? people[0]!;
  const section = person.sections.find((s) => s.id === selectedSection) ?? person.sections[0]!;
  const first = person.displayName.split(' ')[0];
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={role === 'student' ? 'My Pulse™' : 'Family Pulse™'}
        title={role === 'student' ? `Hi ${first} 👋` : `${first}’s Pulse`}
        description={role === 'student' ? 'Your strengths, your goals, and the things that help you.' : 'Goals, growth and what’s coming up — and a place to share what you see at home.'}
      />
      {(people.length > 1 || person.sections.length > 1) && (
        <div className="flex flex-wrap items-center gap-3">
          {people.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Child">
              {people.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === person.id} onClick={() => { setSelected(p.id); setSelectedSection(''); }} className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium', p.id === person.id ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-elevated text-muted hover:text-fg')}>
                  <Avatar name={p.displayName} size="sm" />{p.displayName}
                </button>
              ))}
            </div>
          )}
          {person.sections.length > 1 && <Segmented size="sm" value={section.id} onChange={setSelectedSection} options={person.sections.map((s) => ({ value: s.id, label: s.name }))} />}
        </div>
      )}
      <PulseBody key={`${person.id}:${section.id}`} role={role} person={person} section={section} />
    </div>
  );
}

function PulseBody({ role, person, section }: { role: Role; person: Person; section: Person['sections'][number] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pulse-profile', role, person.id, section.id], queryFn: () => api.get<Profile>(`/api/pulse/people/${encodeURIComponent(person.id)}?role=${role}&sectionId=${encodeURIComponent(section.id)}`) });
  const contributions = useQuery({ queryKey: ['pulse-contributions', person.id, section.id], queryFn: () => api.get<Contribution[]>(`/api/pulse/contributions?studentId=${encodeURIComponent(person.id)}&sectionId=${encodeURIComponent(section.id)}`), refetchInterval: 15000 });
  const [composer, setComposer] = useState<{ content: ContributionContent; editing: Contribution | null } | null>(null);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <p role="alert">{q.error?.message ?? 'Profile unavailable'}</p>;
  const profile = q.data;
  const caseKey = profile.caseKeys[0];
  const mine = (contributions.data ?? []).filter((c) => c.own);
  const sharedWithMe = (contributions.data ?? []).filter((c) => c.sharedView);
  const start = (kind: ContributionContent['kind'], extra?: Partial<ContributionContent>) => setComposer({ content: { ...emptyContribution(kind), ...extra } as ContributionContent, editing: null });
  async function withdraw(item: Contribution) {
    try { await api.post(`/api/pulse/contributions/${item.id}/withdraw`, { expectedRevision: item.revision }); await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); toast('Withdrawn'); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not withdraw'); }
  }

  const share = (
      <Card><CardBody className="space-y-3 pt-5">
        <h2 className="text-[15px] font-semibold">{role === 'student' ? 'Share with your teacher' : 'Share what you see at home'}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(role === 'student' ? (['reflection', 'proposal'] as const) : (['family_observation', 'home_strategy', 'homework', ...(profile.collection?.wellbeing ? ['sleep', 'mood'] as const : []), 'proposal'] as const)).map((k) => (
            <button key={k} type="button" onClick={() => start(k)} className="flex items-center gap-2.5 rounded-lg border border-border bg-elevated px-3 py-2.5 text-left text-sm font-medium hover:border-border-strong">
              {k === 'sleep' ? <Moon className="size-4 text-proposal" /> : k === 'mood' ? <Smile className="size-4 text-warning" /> : <Sparkles className="size-4 text-primary" />}{KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">Optional. It stays attributed to you{role === 'guardian' ? ' as a family report' : ''} and never becomes a teacher observation. The teacher may respond or accept it into the learning record.{role === 'guardian' && !profile.collection?.wellbeing && ' Your school does not collect sleep or mood observations.'}</p>
      </CardBody></Card>
  );

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-2 text-sm font-semibold"><PartyPopper className="size-4" />{role === 'student' ? 'Your strengths and recent wins' : 'Strengths and recent wins'}</div>
        </div>
        <CardBody className="space-y-3 pt-4">
          {profile.successes.map((s) => <SharedNote key={s.id} item={s} />)}
          {!profile.successes.length && <p className="text-sm text-muted">{role === 'student' ? 'When your teacher shares a success with you, it shows up here.' : 'When a teacher shares a success, it shows up here.'} This is not a rating.</p>}
        </CardBody>
      </Card>

      {!!profile.updates.length && (
        <Card><CardBody className="space-y-3 pt-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><MessageCircleHeart className="size-4 text-primary" />From {role === 'student' ? 'your' : 'the'} teacher</h2>
          {profile.updates.map((s) => <SharedNote key={s.id} item={s} />)}
        </CardBody></Card>
      )}

      {role === 'guardian' && share}
      {caseKey && (role === 'student' ? <StudentHome selectedCaseKey={caseKey} embedded /> : <FamilyHome selectedCaseKey={caseKey} embedded />)}

      {!!profile.strategies.length && (
        <Card><CardBody className="space-y-3 pt-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><HeartHandshake className="size-4 text-primary" />{role === 'student' ? 'Things that help me' : 'Things that help'}</h2>
          <p className="text-xs text-muted">{role === 'student' ? 'Your teacher approved these. Tell them which ones work for you.' : 'Approved strategies. Tell the teacher which ones work.'}</p>
          <ul className="space-y-2">
            {profile.strategies.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken/60 p-3 text-sm">
                <span className="flex-1">{s.content.description}</span>
                <Button size="sm" variant="soft" onClick={() => start('strategy_choice', { strategyId: s.id } as Partial<ContributionContent>)}><ThumbsUp />{role === 'student' ? 'This helps me' : 'This works'}</Button>
              </li>
            ))}
          </ul>
        </CardBody></Card>
      )}

      {role === 'student' && share}

      <Card><CardBody className="space-y-3 pt-5">
        <h2 className="text-[15px] font-semibold">Contributions and responses</h2>
        {!mine.length && !sharedWithMe.length && <p className="text-sm text-muted">Nothing shared yet.</p>}
        {[...mine, ...sharedWithMe].map((c) => (
          <div key={c.id} data-testid="contribution" className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.sourceRole === 'guardian' ? 'warning' : 'primary'}>{c.own ? 'You' : c.sourceRole === 'guardian' ? 'Family' : 'Student'}</Badge>
              <span className="text-xs text-muted">{c.authorName} · {c.content ? KIND_LABEL[c.content.kind] : 'Withdrawn'} · version {c.revision}</span>
              {c.sourceRole === 'guardian' && <span className="inline-flex items-center gap-1 text-[11px] text-subtle">{c.visibility === 'teacher_and_student' ? <><Eye className="size-3" />Shared with the student</> : <><EyeOff className="size-3" />Teacher only</>}</span>}
              <Badge className="ml-auto">{humanize(c.status)}</Badge>
            </div>
            {c.content && <ContributionText content={c.content} strategies={profile.strategies} />}
            {c.response && <p className="rounded-md bg-sunken/60 p-2 text-sm"><span className="font-medium">Teacher response:</span> {c.response}</p>}
            {c.usedInPlanVersion && <p className="text-sm text-success-fg">This version informed approved support plan version {c.usedInPlanVersion}.</p>}
            {c.own && c.content && c.status !== 'withdrawn' && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setComposer({ content: c.content!, editing: c })}>Correct contribution</Button><Button size="sm" variant="ghost" onClick={() => void withdraw(c)}>Withdraw</Button></div>}
          </div>
        ))}
      </CardBody></Card>

      <HelpForm role={role} person={person} section={section} />
      <ContributionDialog state={composer} onClose={() => setComposer(null)} role={role} person={person} section={section} strategies={profile.strategies} wellbeing={!!profile.collection?.wellbeing} />
    </div>
  );
}

function SharedNote({ item }: { item: Shared }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <h3 className="font-semibold">{item.title}</h3>
      <p className="mt-0.5">{item.message}</p>
      <p className="mt-1 text-xs text-muted">From {item.educator} · {fmtDateTime(item.approvedAt)}</p>
    </div>
  );
}

function ContributionDialog({ state, onClose, role, person, section, strategies, wellbeing }: { state: { content: ContributionContent; editing: Contribution | null } | null; onClose(): void; role: Role; person: Person; section: Person['sections'][number]; strategies: Strategy[]; wellbeing: boolean }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      {state && (
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" title={state.editing ? 'Correct your contribution' : KIND_LABEL[state.content.kind]} description="Visible to you and the teacher you choose. Use “Ask for help” below for anything urgent.">
          <ContributionForm key={state.editing?.id ?? state.content.kind} initial={state.content} editing={state.editing} role={role} person={person} section={section} strategies={strategies} wellbeing={wellbeing} onDone={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ContributionForm({ initial, editing, role, person, section, strategies, wellbeing, onDone }: { initial: ContributionContent; editing: Contribution | null; role: Role; person: Person; section: Person['sections'][number]; strategies: Strategy[]; wellbeing: boolean; onDone(): void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState<ContributionContent>(initial);
  const [recipientId, setRecipientId] = useState(section.teachers[0]?.id ?? '');
  const [visibility, setVisibility] = useState<ContributionVisibility>(editing?.visibility ?? 'teacher');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const retry = useRef<{ key: string; requestId: string } | null>(null);
  const set = (patch: Partial<Record<string, unknown>>) => setContent({ ...content, ...patch } as ContributionContent);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (busy) return; setBusy(true); setMessage('');
      const body = editing ? { expectedRevision: editing.revision, content } : { studentId: person.id, sectionId: section.id, recipientId, role, content, visibility } satisfies Omit<SubmitContribution, 'requestId'>;
      const key = JSON.stringify(body); if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
      try {
        await api.post(editing ? `/api/pulse/contributions/${editing.id}/correct` : '/api/pulse/contributions', { ...body, requestId: retry.current.requestId });
        await qc.invalidateQueries({ queryKey: ['pulse-contributions'] }); await qc.invalidateQueries({ queryKey: ['pulse-profile'] });
        retry.current = null; toast.success('Submitted to your teacher. This is awaiting review.'); onDone();
      } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not submit. Please retry.'); }
      finally { setBusy(false); }
    }}>
      {message && <p role="alert" className="rounded-md bg-danger-soft p-2.5 text-sm text-danger-fg">{message}</p>}
      {!editing && <label className="block space-y-1.5 text-sm font-medium">Teacher<select required className={selectStyle} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}><option value="">Choose a teacher</option>{section.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      {!editing && (
        <label className="block space-y-1.5 text-sm font-medium">Contribution type
          <select className={selectStyle} value={content.kind} onChange={(e) => setContent(emptyContribution(e.target.value as ContributionContent['kind']))}>
            {(role === 'student' ? ['reflection', 'proposal', ...(strategies.length ? ['strategy_choice'] : [])] : ['family_observation', 'home_strategy', 'homework', ...(wellbeing ? ['sleep', 'mood'] : []), 'proposal', ...(strategies.length ? ['strategy_choice'] : [])]).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
          </select>
        </label>
      )}
      {content.kind === 'sleep' ? (
        <>
          <div className="space-y-1.5 text-sm font-medium"><span>How rested did they seem?</span>
            <Segmented size="sm" value={content.quality} onChange={(quality) => set({ quality })} options={[{ value: 'rested', label: 'Rested' }, { value: 'somewhat_tired', label: 'A bit tired' }, { value: 'very_tired', label: 'Very tired' }, { value: 'not_sure', label: 'Not sure' }]} />
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Hours of sleep <span className="font-normal text-subtle">(optional)</span><Input type="number" min={0} max={16} step={0.5} className="block max-w-28" value={content.hours ?? ''} onChange={(e) => set({ hours: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Anything else <span className="font-normal text-subtle">(optional)</span><Textarea maxLength={1000} value={content.note} onChange={(e) => set({ note: e.target.value })} /></label>
        </>
      ) : (
        Object.entries(content).filter(([key]) => key !== 'kind').map(([key, value]) => (
          <label key={key} className="block space-y-1.5 text-sm font-medium">{key === 'strategyId' ? 'Approved strategy' : humanize(key)}
            {key === 'strategyId'
              ? <select required className={selectStyle} value={String(value)} onChange={(e) => set({ strategyId: e.target.value })}><option value="">Choose a strategy</option>{strategies.map((s) => <option key={s.id} value={s.id}>{s.content.description}</option>)}</select>
              : <Textarea required={!['whatHelped', 'context', 'note'].includes(key)} maxLength={['context', 'note'].includes(key) ? 1000 : 2000} value={String(value ?? '')} onChange={(e) => set({ [key]: e.target.value })} />}
          </label>
        ))
      )}
      {role === 'guardian' && !editing && (
        <div className="space-y-1.5 text-sm font-medium"><span>Who can see this</span>
          <Segmented size="sm" value={visibility} onChange={setVisibility} options={[{ value: 'teacher', label: 'Teacher only' }, { value: 'teacher_and_student', label: `Teacher and ${person.displayName.split(' ')[0]}` }]} />
        </div>
      )}
      <div className="flex gap-2 border-t border-border pt-3">
        <Button type="submit" loading={busy}>{editing ? 'Submit corrected version' : 'Submit for teacher review'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function HelpForm({ role, person, section }: { role: Role; person: Person; section: Person['sections'][number] }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(''); const [recipientId, setRecipientId] = useState(section.teachers[0]?.id ?? ''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const retry = useRef<{ key: string; id: string } | null>(null);
  if (!open) return <div className="pb-4 text-center"><button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-muted underline-offset-2 hover:underline"><LifeBuoy className="size-4" />Ask for help</button></div>;
  return (
    <Card><CardBody className="pt-5">
      <h2 className="flex items-center gap-2 font-semibold"><LifeBuoy className="size-4 text-danger-fg" />Ask for help</h2>
      <p className="my-2 text-sm">This goes straight to the teacher’s help inbox — it does not wait for any review. The inbox is not watched all the time: for urgent help, talk to a trusted adult or use your school’s immediate help process.</p>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMessage(''); const body = { studentId: person.id, sectionId: section.id, recipientId, role, description }; const key = JSON.stringify(body); if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }; try { await api.post('/api/pulse/help', { ...body, requestId: retry.current.id }); setMessage('Saved in your teacher’s help inbox. Contact an adult directly if you need help now.'); setDescription(''); retry.current = null; } catch (err) { setMessage(err instanceof Error ? err.message : 'Request failed. Contact an adult directly.'); } finally { setBusy(false); } }}>
        <label className="block space-y-1.5 text-sm font-medium">Teacher for help<select required className={selectStyle} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}><option value="">Choose a teacher</option>{section.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="block space-y-1.5 text-sm font-medium">What help do you need?<Textarea required maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="flex gap-2"><Button type="submit" loading={busy}>Send help request</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
        <p role="status" className="text-sm">{message}</p>
      </form>
    </CardBody></Card>
  );
}
