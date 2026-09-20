import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Printer } from 'lucide-react';
import type { PlanContent } from '@class-pulse/domain';
import { Button, PageSkeleton } from '../../components/ui';
import { api, fmtDateTime } from '../../lib/api';
import type { CaseView } from '../../lib/types';
import { PlanSections } from '../../components/PlanSections';

/** Plan export for family meetings (docs/06 Phase 2): a print stylesheet, saved as PDF by the browser. */
export function PrintPlan() {
  const { caseKey = '' } = useParams();
  const view = useQuery({ queryKey: ['case', caseKey], queryFn: () => api.get<CaseView>(`/api/cases/${caseKey}`) });
  if (view.isLoading) return <PageSkeleton />;
  const v = view.data;
  if (!v?.planId) return <div>No approved plan.</div>;
  const plan = Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('plan_')).map(([k, val]) => [k.slice(5), val])) as unknown as PlanContent;
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-border bg-elevated p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
      <div className="no-print mb-6 flex justify-end">
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Behavior-support plan</h1>
      <div className="mb-6 mt-1 text-sm text-muted">
        {v.student?.displayName ?? 'Student'} · grade {v.case_gradeLevel} · plan v{v.plan_provenance?.version} · drafted with AI assistance, reviewed and approved by {v.plan_provenance?.approvedBy ?? '—'} on {fmtDateTime(v.plan_provenance?.approvedAt)}
      </div>
      <PlanSections content={plan} compact />
      <div className="mt-8 border-t border-border pt-3 text-xs text-muted">
        This plan is an educational support document. It is not a diagnosis, a disability determination, a disciplinary record, or a placement decision. Targets marked "proposed" are not yet established.
      </div>
    </div>
  );
}
