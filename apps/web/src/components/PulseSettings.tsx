import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Card, CardBody, Input } from './ui';
type Setting = { schoolId: string; name: string; timezone: string; enabled: boolean; familyWellbeingCollection: boolean; pendingRetentionDays: number; memoryWindowDays: number };
export function PulseSettings() {
  const q = useQuery({ queryKey: ['pulse-settings'], queryFn: () => api.get<Setting[]>('/api/pulse/settings') });
  return <div className="mb-4 space-y-3">{q.data?.map((s) => <SchoolSetting key={s.schoolId} setting={s} />)}</div>;
}
function SchoolSetting({ setting }: { setting: Setting }) {
  const qc = useQueryClient();
  const [timezone, setTimezone] = useState(setting.timezone);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(setting.pendingRetentionDays);
  const [memory, setMemory] = useState(setting.memoryWindowDays);
  const [status, setStatus] = useState('');
  return <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Pulsera · {setting.name}</h2>
    <p className="text-sm text-muted">On by default for synthetic workspaces. Turning it off hides Class Pulse and keeps every collected record. Real-student use awaits school approval.</p>
    <label className="block text-sm">School timezone<Input aria-label={`Timezone for ${setting.name}`} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enable Class Pulse</label>
    <Button disabled={busy} onClick={async () => { setBusy(true); try { await api.post('/api/pulse/settings', { schoolId: setting.schoolId, enabled, timezone }); setStatus('Settings saved'); await qc.invalidateQueries({ queryKey: ['pulse-settings'] }); await qc.invalidateQueries({ queryKey: ['pulse-sections'] }); } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not save settings'); } finally { setBusy(false); } }}>Save classroom settings</Button>
    <p role="status" className="text-sm">{status}</p>
    <div className="space-y-2 border-t border-border pt-3 text-sm">
      <p className="font-medium">Retention policy</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">Keep unapproved text (days)<Input type="number" min={1} max={90} className="block w-28" value={pending} onChange={(e) => setPending(Number(e.target.value))} /></label>
        <label className="space-y-1">Classroom-memory window (days)<Input type="number" min={30} max={365} className="block w-28" value={memory} onChange={(e) => setMemory(Number(e.target.value))} /></label>
        <Button variant="secondary" onClick={async () => { try { await api.post('/api/pulse/settings/retention', { schoolId: setting.schoolId, pendingRetentionDays: pending, memoryWindowDays: memory }); await qc.invalidateQueries({ queryKey: ['pulse-settings'] }); setStatus('Retention policy saved'); } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not save'); } }}>Save retention</Button>
      </div>
      <p className="text-xs text-muted">Unapproved observations, drafts and contributions are erased after this many days. Approved history older than the memory window is no longer retrieved for drafts or profiles. Audit metadata is kept without content.</p>
    </div>
    <label className="flex items-start gap-2 border-t border-border pt-3 text-sm"><input type="checkbox" className="mt-1" checked={setting.familyWellbeingCollection} onChange={async (e) => { try { await api.post('/api/pulse/settings/wellbeing', { schoolId: setting.schoolId, enabled: e.target.checked }); await qc.invalidateQueries({ queryKey: ['pulse-settings'] }); setStatus(e.target.checked ? 'Families can share sleep and mood observations' : 'Sleep and mood collection turned off'); } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not save'); } }} /><span><span className="font-medium">Collect family sleep and mood observations</span><span className="block text-xs text-muted">Optional, family-reported and attributed. Turn off if your school’s collection policy does not allow it; existing submissions are kept.</span></span></label>
  </CardBody></Card>;
}
