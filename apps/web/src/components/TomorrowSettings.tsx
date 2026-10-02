import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TomorrowSchedule } from '@class-pulse/domain';
import { api } from '../lib/api';
import { classTitle, usePulseSections } from '../lib/classes';
import { Button, Card, CardBody, Input, Textarea } from './ui';

type Settings = { settings: TomorrowSchedule; timezone: string; lastResult: string | null; targetDate: string | null };
export function TomorrowSettings() {
  const q = usePulseSections();
  const [chosen, setChosen] = useState('');
  const sections = (q.data ?? []).filter((s) => s.enabled && !s.archived);
  const sectionId = sections.some((s) => s.id === chosen) ? chosen : sections[0]?.id;
  return <div className="mb-5 space-y-3">{sectionId && <>
    <label className="block text-sm">Preparation schedule for<select className="ml-2 min-h-10 rounded-md border border-border bg-elevated px-3" value={sectionId} onChange={(e) => setChosen(e.target.value)}>{sections.map((s) => <option key={s.id} value={s.id}>{classTitle(s)}</option>)}</select></label>
    <Schedule key={sectionId} sectionId={sectionId} />
  </>}</div>;
}
function Schedule({ sectionId }: { sectionId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tomorrow-settings', sectionId], queryFn: () => api.get<Settings>(`/api/pulse/tomorrow/${sectionId}`) });
  const [edit, setEdit] = useState<TomorrowSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const value = edit ?? q.data?.settings;
  if (!value) return q.error ? <p role="alert">{q.error.message}</p> : null;
  return <Card><CardBody className="space-y-3 pt-4">
    <p className="text-sm text-muted">One Do Now draft from the latest session on each class day. {q.data?.timezone}. Review and approval remain yours.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={(e) => setEdit({ ...value, enabled: e.target.checked })} />Prepare automatically after class</label>
    <label className="block text-sm">Preparation time<Input type="time" value={value.time} onChange={(e) => setEdit({ ...value, time: e.target.value })} /></label>
    <fieldset><legend className="mb-1 text-sm">Class days</legend><div className="flex flex-wrap gap-3">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => <label className="flex items-center gap-1 text-sm" key={day}><input type="checkbox" checked={value.classWeekdays.includes(day)} onChange={(e) => setEdit({ ...value, classWeekdays: e.target.checked ? [...value.classWeekdays, day] : value.classWeekdays.filter((d) => d !== day) })} />{label}</label>)}</div></fieldset>
    <label className="block text-sm">School closures (one YYYY-MM-DD date per line)<Textarea rows={2} value={value.closureDates.join('\n')} onChange={(e) => setEdit({ ...value, closureDates: e.target.value.split('\n') })} /></label>
    <Button disabled={busy || !value.classWeekdays.length} onClick={async () => { setBusy(true); try { await api.post(`/api/pulse/tomorrow/${sectionId}`, { ...value, closureDates: value.closureDates.map((d) => d.trim()).filter(Boolean) }); await qc.invalidateQueries({ queryKey: ['tomorrow-settings', sectionId] }); setEdit(null); setStatus('Preparation schedule saved'); } catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); } }}>Save schedule</Button>
    {q.data?.lastResult && <p className="text-sm">Next class: {q.data.targetDate} · {q.data.lastResult}</p>}
    <p role="status" className="text-sm">{status}</p>
  </CardBody></Card>;
}
