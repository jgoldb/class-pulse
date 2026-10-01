import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, humanize } from '../lib/api';
import { Badge, Button, Card, CardBody, Input, Textarea } from './ui';
import type { CreateFollowUp } from '@class-pulse/domain';

export function FollowUpForm({ draftId, revision }: { draftId: string; revision: number }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [action, setAction] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [kind, setKind] = useState<CreateFollowUp['kind']>('follow_up');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  return <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">Approve a follow-up or review reminder</summary><form className="mt-3 space-y-3" onSubmit={async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    const key = JSON.stringify({ draftId, revision, title, action, dueDate, kind });
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try { await api.post('/api/pulse/follow-ups', { requestId: request.current.id, draftId, artifactRevision: revision, title, action, dueDate, kind, confirmed: true }); await qc.invalidateQueries({ queryKey: ['follow-ups'] }); setMessage('Approved and assigned to you. Find it in Tomorrow Ready.'); setTitle(''); setAction(''); request.current = null; }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Could not save. Retry keeps the same request.'); }
    finally { setBusy(false); }
  }}>
    <p className="text-xs text-muted">Owner: you. This action stays private to your section and does not change a support plan. Due reminders appear in Tomorrow Ready.</p>
    <label className="block text-sm">Type<select className="ml-2 min-h-10 rounded border border-border bg-elevated" value={kind} onChange={(e) => setKind(e.target.value as CreateFollowUp['kind'])}><option value="follow_up">Follow-up</option><option value="intervention_review">Intervention review</option></select></label>
    <label className="block text-sm">Title<Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="block text-sm">Action to take<Textarea required maxLength={2000} value={action} onChange={(e) => setAction(e.target.value)} /></label>
    <label className="block text-sm">Due on (school date)<Input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
    <Button loading={busy} type="submit">Approve and assign to me</Button><p role="status" className="text-sm">{message}</p>
  </form></details>;
}

type Task = { id: string; draftId: string; revision: number; title: string; action: string; dueDate: string; status: string; kind: string; due: boolean; sourceChanged: boolean };
export function FollowUps() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['follow-ups'], queryFn: () => api.get<Task[]>('/api/pulse/follow-ups'), refetchInterval: 30000 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [closed, setClosed] = useState(false);
  async function update(task: Task, status: string) {
    setBusy(task.id); setError('');
    try { await api.post(`/api/pulse/follow-ups/${task.id}`, { expectedRevision: task.revision, status }); await qc.invalidateQueries({ queryKey: ['follow-ups'] }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update'); }
    finally { setBusy(''); }
  }
  return <Card className="mb-4"><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Your follow-ups and review reminders</h2>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />Include completed and cancelled</label>
    {q.isLoading && <p role="status">Loading follow-ups…</p>}
    {q.error && <p role="alert">{q.error.message}</p>}
    {!q.isLoading && !q.error && !q.data?.length && <p className="text-sm text-muted">No approved follow-ups yet. Add one while reviewing an approved draft.</p>}
    {q.data?.filter((t) => closed || ['open', 'needs_review'].includes(t.status)).map((t) => <div key={t.id} className="rounded border border-border p-3"><div className="flex flex-wrap gap-2"><strong>{t.title}</strong><Badge>{humanize(t.status)}</Badge>{t.due && <Badge>Due</Badge>}</div><p className="mt-1 text-sm">{t.action}</p><p className="text-xs text-muted">{humanize(t.kind)} · Due {t.dueDate} · Assigned to you</p>{['open', 'needs_review'].includes(t.status) && <div className="mt-2 flex gap-2">{!t.sourceChanged && t.status === 'open' && <Button size="sm" disabled={!!busy} onClick={() => void update(t, 'completed')}>Mark completed</Button>}<Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void update(t, 'cancelled')}>Cancel follow-up</Button></div>}</div>)}
    {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
  </CardBody></Card>;
}
