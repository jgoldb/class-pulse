import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import type { ArtifactContent, ArtifactKind, ClassroomObservation } from '@class-pulse/domain';
import { BrandMark } from '../../components/Brand';
import { Button, Callout, PageSkeleton } from '../../components/ui';
import { api, fmtDate, fmtDateTime, humanize } from '../../lib/api';
import { ARTIFACT_META, OBSERVATION_META, observationText } from '../../lib/pulse';

type Exported = {
  kind: ArtifactKind; content: ArtifactContent;
  publication: { revision: number; audience: string; approvedAt: string; approverName?: string };
  evidence: Array<{ number: number; observation: ClassroomObservation }>;
  sourceContext?: Array<{ number: number; firstName: string; lastName: string; observedAt: string; source: string }>;
  session: { date: string; topic: string; sectionName: string } | null;
  template: { validation: { name: string; role: string; validatedAt: string; notes: string } | null } | null;
};
const SKIP = ['kind', 'sourceNumbers', 'title', 'observations', 'evidenceSummary'];

/**
 * Pulsera Reports™ print view (Generate → Review → Edit → Approve → Export). Only an approved
 * version can be exported; the page carries its source history, approval and template status so
 * a printed copy stands on its own.
 */
export function ReportPrint() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['report-export', id], queryFn: () => api.post<Exported>(`/api/pulse/drafts/${encodeURIComponent(id)}/export`) });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <Callout tone="warning" title="This report can’t be printed">{q.error?.message ?? 'Unavailable'} Approve the current version first.</Callout>;
  const r = q.data;
  const meta = ARTIFACT_META[r.kind];
  const students = [...new Set((r.sourceContext ?? []).map((s) => `${s.firstName} ${s.lastName}`))];
  const dates = (r.sourceContext ?? []).map((s) => s.observedAt).sort();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link to={`/teacher/drafts?draft=${id}`}><Button variant="ghost" size="sm"><ArrowLeft />Back to the draft</Button></Link>
        <Button size="sm" className="ml-auto" onClick={() => window.print()}><Printer />Print or save as PDF</Button>
      </div>
      <article className="rounded-xl border border-border bg-elevated p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start gap-3 border-b border-border pb-4">
          <BrandMark className="print:shadow-none" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Pulsera Reports™ · {meta.label}</div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{'title' in r.content ? r.content.title : meta.label}</h1>
            <p className="mt-1 text-sm text-muted">{students.join(', ')}{r.session && <> · {r.session.sectionName}</>}{dates.length > 0 && <> · observations {fmtDate(dates[0])}{dates.length > 1 && dates[0] !== dates.at(-1) ? `–${fmtDate(dates.at(-1))}` : ''}</>}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <p><span className="text-muted">Approved by</span> {r.publication.approverName ?? 'Educator'}</p>
          <p><span className="text-muted">Approved</span> {fmtDateTime(r.publication.approvedAt)}</p>
          <p><span className="text-muted">Version</span> {r.publication.revision}</p>
          <p><span className="text-muted">Audience</span> {humanize(r.publication.audience)}</p>
        </section>
        {r.template && (r.template.validation
          ? <p className="mt-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success-fg">Template validated by {r.template.validation.name} ({humanize(r.template.validation.role)}) on {fmtDate(r.template.validation.validatedAt)}.</p>
          : <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">This template has not yet been validated by a qualified educator at this school. Use it for discussion only.</p>)}

        {Object.entries(r.content).filter(([k]) => !SKIP.includes(k)).map(([k, v]) => (
          <section key={k} className="mt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">{humanize(k)}</h2>
            {Array.isArray(v) ? <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ol> : <p className="mt-1.5 whitespace-pre-wrap text-sm">{v === null || v === '' ? 'Not recorded' : String(v)}</p>}
          </section>
        ))}

        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">Source evidence and history</h2>
          <table className="mt-2 w-full border-collapse text-left text-sm">
            <thead><tr className="border-b border-border text-xs text-muted"><th className="py-1.5 pr-3 font-medium">#</th><th className="py-1.5 pr-3 font-medium">Observed</th><th className="py-1.5 pr-3 font-medium">Type</th><th className="py-1.5 font-medium">Teacher observation (confirmed)</th></tr></thead>
            <tbody>
              {r.evidence.map((e) => {
                const ctx = r.sourceContext?.find((s) => s.number === e.number);
                return (
                  <tr key={e.number} className="border-b border-border align-top">
                    <td className="py-1.5 pr-3 tabular-nums">{e.number}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{ctx ? fmtDateTime(ctx.observedAt) : '—'}</td>
                    <td className="py-1.5 pr-3">{OBSERVATION_META[e.observation.kind].label}</td>
                    <td className="py-1.5">{observationText(e.observation)}{e.observation.kind === 'behavior' && <span className="block text-xs text-muted">Antecedent: {e.observation.antecedent ?? 'Not recorded'} · Consequence: {e.observation.consequence ?? 'Not recorded'} · Count: {e.observation.measuredCount ?? 'Not measured'}</span>}{e.observation.kind !== 'note' && e.observation.note && <span className="block text-xs text-muted">Note: {e.observation.note}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <footer className="mt-8 border-t border-border pt-3 text-xs text-muted">
          Drafted with AI assistance from teacher-confirmed observations and approved by a named educator. This document is evidence for educator discussion. It is not a diagnosis, evaluation, eligibility, placement or disciplinary determination; formal decisions follow the school’s own process. Exporting does not send it to anyone.
        </footer>
      </article>
    </div>
  );
}
