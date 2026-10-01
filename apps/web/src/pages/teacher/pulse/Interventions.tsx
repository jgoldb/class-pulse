import { Link } from 'react-router';
import { Activity, ArrowRight, ClipboardList } from 'lucide-react';
import type { ArtifactKind } from '@class-pulse/domain';
import { Badge, Card, CardBody } from '../../../components/ui';
import { fmtDate, humanize } from '../../../lib/api';
import { relativeTime } from '../../../lib/utils';
import { ARTIFACT_META } from '../../../lib/pulse';

export type InterventionHistory = {
  windowDays: number;
  strategies: Array<{ id: string; kind: string; description: string; uses: number; lastUsedAt: string | null }>;
  supports: Array<{ draftId: string; kind: ArtifactKind; title: string | null; options: string[] | null; approvedAt: string; needsReview: boolean }>;
  followUps: Array<{ id: string; draftId: string; kind: string; title: string; dueDate: string; status: string }>;
};

/** Behavior & intervention intelligence, framed as support: what is in place, what was used, what is next. */
export function Interventions({ history, firstName }: { history: InterventionHistory; firstName: string }) {
  const { strategies, supports, followUps, windowDays } = history;
  if (!strategies.length && !supports.length && !followUps.length) return null;
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-hypothesis-soft text-hypothesis"><Activity className="size-4" /></span>
          <div><h2 className="text-[15px] font-semibold">Interventions over time · {firstName}</h2><p className="text-xs text-muted">What is in place, how often its use was recorded, and what comes next. A use count is activity, not evidence that a strategy works.</p></div>
        </div>

        {!!strategies.length && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">Approved strategies · last {windowDays} days</h3>
            <ul className="space-y-1.5">
              {strategies.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{s.description}<span className="block text-[11px] text-subtle">{humanize(s.kind)}</span></span>
                  {s.uses ? <Badge tone="primary">{s.uses} recorded use{s.uses === 1 ? '' : 's'}</Badge> : <Badge tone="outline">No recorded use</Badge>}
                  {s.lastUsedAt && <span className="text-[11px] text-muted">last {relativeTime(s.lastUsedAt)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!supports.length && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">Approved support and documentation</h3>
            <ol className="relative space-y-2 border-l border-border pl-4">
              {supports.map((s) => (
                <li key={s.draftId} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-elevated bg-primary" />
                  <Link to={`/teacher/drafts?draft=${s.draftId}`} className="inline-flex items-center gap-1 font-medium hover:underline">{ARTIFACT_META[s.kind].label}{s.title && <span className="font-normal text-muted"> · {s.title}</span>}<ArrowRight className="size-3" /></Link>
                  <span className="block text-[11px] text-subtle">Approved {fmtDate(s.approvedAt)}{s.needsReview && ' · a source changed since approval — review it'}</span>
                  {s.options && <ul className="mt-1 list-disc pl-5 text-xs text-muted">{s.options.map((o) => <li key={o}>{o}</li>)}</ul>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {!!followUps.length && (
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle"><ClipboardList className="size-3.5" />Follow-ups and reviews</h3>
            <ul className="space-y-1">
              {followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1">{f.title}</span>
                  <Badge tone={f.status === 'completed' ? 'success' : f.status === 'needs_review' ? 'warning' : 'neutral'}>{humanize(f.status)}</Badge>
                  <span className="text-[11px] text-muted">{humanize(f.kind)} · due {f.dueDate}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardBody>
    </Card>
  );
}
