import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, BookOpenCheck } from 'lucide-react';
import type { ArtifactKind } from '@class-pulse/domain';
import { Badge, Button, Card, CardBody, Empty, PageSkeleton, Textarea } from './ui';
import { api, fmtDate, humanize } from '../lib/api';
import { ARTIFACT_META } from '../lib/pulse';

type Validation = { name: string; role: string; validatedAt: string; notes: string } | null;
type School = { schoolId: string; schoolName: string; canValidate: boolean; templates: Array<{ kind: ArtifactKind; validation: Validation }> };

const WHAT: Partial<Record<ArtifactKind, string>> = {
  abc: 'One behavior observation with its antecedent and consequence, missing parts left as “Not recorded”.',
  sst_report: 'Every selected observation copied exactly, the purpose, questions for the team, and limitations.',
  mtss_report: 'Every selected observation copied exactly, the purpose, questions for the team, and limitations.',
  fba_observations: 'Selected behavior observations copied exactly; never infers behavioral function.',
  support_recommendation: 'Two to four low-intensity classroom options and how to involve the student in choosing.',
};

/**
 * Educator validation of Pulsera Reports™ templates (docs/09 Q9). A support professional or
 * administrator signs off per school; reports show the status, and unvalidated ones say so.
 */
export function ReportTemplates() {
  const q = useQuery({ queryKey: ['report-templates'], queryFn: () => api.get<School[]>('/api/pulse/report-templates') });
  if (q.isLoading) return <PageSkeleton />;
  if (!q.data?.length) return <Empty icon={<BookOpenCheck />} title="No schools to show" description="Report templates are validated per school by a support professional or administrator." />;
  return (
    <div className="space-y-4">
      {q.data.map((school) => (
        <Card key={school.schoolId}>
          <CardBody className="space-y-3 pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{school.schoolName}</h2>
              {!school.canValidate && <span className="text-xs text-muted">View only — a support professional or administrator validates templates.</span>}
            </div>
            <ul className="space-y-2">{school.templates.map((t) => <TemplateRow key={t.kind} schoolId={school.schoolId} kind={t.kind} validation={t.validation} canValidate={school.canValidate} />)}</ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function TemplateRow({ schoolId, kind, validation, canValidate }: { schoolId: string; kind: ArtifactKind; validation: Validation; canValidate: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(validated: boolean) {
    setBusy(true);
    try { await api.post('/api/pulse/report-templates', { schoolId, kind, validated, notes }); await qc.invalidateQueries({ queryKey: ['report-templates'] }); setOpen(false); setNotes(''); toast.success(validated ? `${ARTIFACT_META[kind].label} template validated` : 'Validation withdrawn'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{ARTIFACT_META[kind].label}</span>
        {validation ? <Badge tone="success"><BadgeCheck />Validated</Badge> : <Badge tone="warning">Awaiting validation</Badge>}
        {canValidate && !open && <Button size="sm" variant={validation ? 'ghost' : 'secondary'} className="ml-auto" onClick={() => setOpen(true)}>{validation ? 'Update' : 'Validate'}</Button>}
      </div>
      <p className="mt-1 text-xs text-muted">{WHAT[kind]}</p>
      {validation && <p className="mt-1 text-xs">By {validation.name} ({humanize(validation.role)}) on {fmtDate(validation.validatedAt)}{validation.notes && <> — “{validation.notes}”</>}</p>}
      {open && (
        <div className="mt-3 space-y-2">
          <label className="block space-y-1.5 text-xs font-medium">What you reviewed it against <span className="font-normal text-subtle">(optional)</span><Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Our SST referral form and team protocol" /></label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={() => void save(true)}>Validate for this school</Button>
            {validation && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(false)}>Withdraw validation</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}
