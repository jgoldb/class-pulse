import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mic } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { Badge, Button, Card, CardBody, Input } from './ui';

type Approval = { provider: string; approvedByName: string; approvedByTitle: string; policyReference: string; recordedAt: string } | null;

/**
 * The approved audio-provider boundary (guide §E). An administrator records the school
 * official's approval of a transcription provider; until then voice capture stays off.
 */
export function VoiceApprovals() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['voice-approvals'], queryFn: () => api.get<Array<{ schoolId: string; approval: Approval }>>('/api/pulse/voice/approvals') });
  const schools = useQuery({ queryKey: ['pulse-settings'], queryFn: () => api.get<Array<{ schoolId: string; name: string }>>('/api/pulse/settings') });
  const [form, setForm] = useState({ provider: 'OpenAI (gpt-4o-mini-transcribe)', approvedByName: '', approvedByTitle: '', policyReference: '' });
  const [busy, setBusy] = useState('');
  async function save(schoolId: string, approved: boolean) {
    setBusy(schoolId);
    try { await api.post('/api/pulse/voice/approvals', approved ? { schoolId, approved, ...form } : { schoolId, approved }); await qc.invalidateQueries({ queryKey: ['voice-approvals'] }); await qc.invalidateQueries({ queryKey: ['voice-status'] }); toast.success(approved ? 'Voice approval recorded' : 'Voice capture turned off'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(''); }
  }
  if (!q.data?.length) return null;
  return (
    <Card className="mb-4">
      <CardBody className="space-y-3 pt-5">
        <h2 className="flex items-center gap-2 font-semibold"><Mic className="size-4 text-primary" />Voice capture</h2>
        <p className="text-sm text-muted">Voice notes stay off until your school approves an audio transcription provider. Record who approved it and under which policy. Audio is never stored: each note is transcribed, discarded, and saved only as text a teacher reviews and confirms. No background recording or speaker identification.</p>
        {q.data.map(({ schoolId, approval }) => (
          <div key={schoolId} className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{schools.data?.find((s) => s.schoolId === schoolId)?.name ?? schoolId}</span>
              {approval ? <Badge tone="success">Approved</Badge> : <Badge tone="outline">Off — no approval recorded</Badge>}
            </div>
            {approval ? (
              <>
                <p className="text-xs">{approval.provider} · approved by {approval.approvedByName}, {approval.approvedByTitle} · {approval.policyReference} · recorded {fmtDate(approval.recordedAt)}</p>
                <Button size="sm" variant="ghost" className="text-danger-fg" loading={busy === schoolId} onClick={() => void save(schoolId, false)}>Withdraw approval</Button>
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium">Provider<Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></label>
                <label className="space-y-1 text-xs font-medium">Policy reference<Input value={form.policyReference} onChange={(e) => setForm({ ...form, policyReference: e.target.value })} placeholder="Data agreement 2026-14, section 3" /></label>
                <label className="space-y-1 text-xs font-medium">Approved by<Input value={form.approvedByName} onChange={(e) => setForm({ ...form, approvedByName: e.target.value })} placeholder="Name of the school official" /></label>
                <label className="space-y-1 text-xs font-medium">Their role<Input value={form.approvedByTitle} onChange={(e) => setForm({ ...form, approvedByTitle: e.target.value })} placeholder="Data protection lead" /></label>
                <Button size="sm" className="sm:col-span-2 sm:justify-self-start" loading={busy === schoolId} disabled={!form.provider || !form.approvedByName || !form.approvedByTitle || !form.policyReference} onClick={() => void save(schoolId, true)}>Record approval and turn on voice</Button>
              </div>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
