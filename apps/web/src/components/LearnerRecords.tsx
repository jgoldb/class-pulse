import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileLock2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, CardBody, Dialog, DialogContent, Input } from './ui';

type Learner = { id: string; displayName: string; gradeLevel: string; synthetic: boolean };

/**
 * Portability and erasure on request (guide §P). Export is a JSON record of one learner's
 * classroom data; erasure removes it after the administrator types the learner's full name.
 */
export function LearnerRecords() {
  const q = useQuery({ queryKey: ['records-learners'], queryFn: () => api.get<Learner[]>('/api/pulse/learners') });
  const [id, setId] = useState('');
  const [erasing, setErasing] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const learner = q.data?.find((l) => l.id === id);
  async function download() {
    if (!learner) return;
    setBusy(true);
    try {
      const record = await api.get<unknown>(`/api/pulse/learners/${encodeURIComponent(learner.id)}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `pulsera-learner-record-${learner.id}.json`; a.click(); URL.revokeObjectURL(url);
      toast.success('Learner record exported');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  }
  async function erase() {
    if (!learner) return;
    setBusy(true);
    try {
      const r = await api.post<{ observations: number; drafts: number; contributions: number; helpRequests: number }>(`/api/pulse/learners/${encodeURIComponent(learner.id)}/erase`, { confirm });
      toast.success(`Erased ${r.observations} observation revisions, ${r.drafts} derived drafts, ${r.contributions} contributions and ${r.helpRequests} help requests`);
      setErasing(false); setConfirm('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erasure failed'); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-4">
      <CardBody className="space-y-3 pt-5">
        <h2 className="flex items-center gap-2 font-semibold"><FileLock2 className="size-4 text-primary" />Learner records</h2>
        <p className="text-sm text-muted">Export one learner’s classroom record (confirmed observations, attributed contributions and approved artifacts) or erase it on request. Erasure also removes drafts derived from their observations, including shared group drafts. Projected support-plan signals are retired; support-plan records follow their own process. The audit log keeps counts, never content. Backups follow the database’s point-in-time window (docs/10).</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 space-y-1.5 text-sm font-medium">Learner
            <select className="min-h-10 w-full rounded-md border border-border bg-elevated px-3 text-sm" value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Choose a learner</option>
              {q.data?.map((l) => <option key={l.id} value={l.id}>{l.displayName} · grade {l.gradeLevel}{l.synthetic ? '' : ' · real'}</option>)}
            </select>
          </label>
          <Button variant="secondary" disabled={!learner || busy} onClick={() => void download()}><Download />Export record</Button>
          <Button variant="ghost" className="text-danger-fg" disabled={!learner || busy} onClick={() => { setConfirm(''); setErasing(true); }}><Trash2 />Erase…</Button>
        </div>
      </CardBody>
      <Dialog open={erasing} onOpenChange={(o) => !busy && setErasing(o)}>
        {learner && (
          <DialogContent title={`Erase ${learner.displayName}’s classroom data`} description="This cannot be undone. Export the record first if the family or school needs a copy.">
            <label className="block space-y-1.5 text-sm font-medium">Type <span className="font-semibold">{learner.displayName}</span> to confirm<Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></label>
            <div className="mt-4 flex gap-2">
              <Button variant="danger" loading={busy} disabled={confirm.trim() !== learner.displayName} onClick={() => void erase()}>Erase permanently</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setErasing(false)}>Cancel</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
