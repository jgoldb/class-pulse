import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, FileText, Printer } from 'lucide-react';
import type { ArtifactKind } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { ConfirmChip } from '../../components/TeacherConfirm';
import { Avatar, Button, Card, CardBody, Empty, PageSkeleton, Select } from '../../components/ui';
import { api, fmtDate } from '../../lib/api';
import { ARTIFACT_META, draftStage } from '../../lib/pulse';
import type { Classroom } from '../../lib/types';

type DraftRow = { id: string; kind: ArtifactKind; revision: number; generationState: string; reviewState: string; publicationState: string; title?: string | null; students?: Array<{ id: string; displayName: string }>; createdAt: string; approvedAt?: string | null };
const REPORT_KINDS: ArtifactKind[] = ['sst_report', 'mtss_report', 'fba_observations'];
const ABOUT: Partial<Record<ArtifactKind, string>> = {
  sst_report: 'Evidence for a student support team meeting.',
  mtss_report: 'Documentation for a multi-tiered support review.',
  fba_observations: 'Behavior observations organised to support a functional assessment.',
};

/**
 * Pulsera Reports™ for the teacher: every evidence packet in one list, with its Teacher Confirm
 * state, and a plain way to start a new one from a student's confirmed observations. Reports are
 * for team discussion, never a determination.
 */
export function Reports() {
  const drafts = useQuery({ queryKey: ['classroom-drafts'], queryFn: () => api.get<DraftRow[]>('/api/pulse/drafts') });
  const classroom = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const [student, setStudent] = useState<string | null>(null);
  const nav = useNavigate();
  if (drafts.isLoading) return <PageSkeleton />;
  const reports = (drafts.data ?? []).filter((d) => REPORT_KINDS.includes(d.kind) && d.reviewState !== 'discarded');
  const students = classroom.data?.students ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="Evidence packets drafted from confirmed observations. You review and approve each one before it can be printed or shared." />

      <Card className="bg-ai-wash border-ai/20">
        <CardBody className="flex flex-wrap items-end gap-4 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Start a report</h2>
            <p className="text-sm text-muted">Choose a student, then pick the observations to include from their profile. Pulsera drafts only from what you select.</p>
          </div>
          <div className="w-full sm:w-64"><Select ariaLabel="Student" placeholder="Choose a student" value={student} onChange={setStudent} options={students.map((s) => ({ value: s.id, label: s.displayName }))} /></div>
          <Button variant="ai" disabled={!student} onClick={() => nav(`/teacher/students?student=${student}#guide`)}>Choose evidence <ArrowRight /></Button>
        </CardBody>
      </Card>

      {!reports.length ? (
        <Empty icon={<FileText />} title="No reports yet" description="SST, MTSS and FBA-support packets you prepare appear here with their review state." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((d) => {
            const stage = draftStage(d);
            const who = d.students?.[0]?.displayName;
            return (
              <Card key={d.id} className="flex flex-col">
                <CardBody className="flex flex-1 flex-col gap-3 pt-5">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-ai-soft text-ai-fg"><FileText className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{ARTIFACT_META[d.kind].label}</h3>
                      <p className="text-sm text-muted">{ABOUT[d.kind]}</p>
                    </div>
                    <ConfirmChip kind={stage.kind} label={stage.label} title={stage.detail} />
                  </div>
                  {who && <p className="flex items-center gap-2 text-sm"><Avatar name={who} size="sm" />{who}<span className="text-muted">· version {d.revision} · {fmtDate(d.createdAt)}</span></p>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    <Link to={`/teacher/drafts?draft=${d.id}`}><Button size="sm" variant={stage.kind === 'logged' ? 'secondary' : 'primary'}>{stage.kind === 'logged' ? 'View' : 'Review'}</Button></Link>
                    {stage.kind === 'logged' && <Link to={`/teacher/reports/${d.id}`}><Button size="sm" variant="ghost"><Printer /> Print or PDF</Button></Link>}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
