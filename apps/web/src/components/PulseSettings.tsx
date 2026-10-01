import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Card, CardBody, Input } from './ui';
type Setting = { schoolId: string; name: string; timezone: string; enabled: boolean };
export function PulseSettings() {
  const q = useQuery({ queryKey: ['pulse-settings'], queryFn: () => api.get<Setting[]>('/api/pulse/settings') });
  return <div className="mb-4 space-y-3">{q.data?.map((s) => <SchoolSetting key={s.schoolId} setting={s} />)}</div>;
}
function SchoolSetting({ setting }: { setting: Setting }) {
  const qc = useQueryClient();
  const [timezone, setTimezone] = useState(setting.timezone);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  return <Card><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">Pulsera · {setting.name}</h2>
    <p className="text-sm text-muted">Synthetic development only. Enabling applies to this workspace. Turning it off preserves collected records. Real-student use awaits school approval.</p>
    <label className="block text-sm">School timezone<Input aria-label={`Timezone for ${setting.name}`} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enable Class Pulse</label>
    <Button disabled={busy} onClick={async () => { setBusy(true); try { await api.post('/api/pulse/settings', { schoolId: setting.schoolId, enabled, timezone }); setStatus('Settings saved'); await qc.invalidateQueries({ queryKey: ['pulse-settings'] }); await qc.invalidateQueries({ queryKey: ['pulse-sections'] }); } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not save settings'); } finally { setBusy(false); } }}>Save classroom settings</Button>
    <p role="status" className="text-sm">{status}</p>
  </CardBody></Card>;
}
