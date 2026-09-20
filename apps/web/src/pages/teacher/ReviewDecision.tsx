import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Check, Scale, ScrollText } from 'lucide-react';
import { REVIEW_DECISIONS } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, ObsCount, PageSkeleton, Textarea, cn } from '../../components/ui';
import { ApiError, api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ReviewCycleFull, RosterStudent } from '../../lib/types';

const DECISION_HELP: Record<string, string> = { continue: 'Keep the plan as written', modify: 'Change goals or strategies', collect_more: 'Too little data to decide', seek_support: 'Bring in the support team', fade: 'Goals met; step down support' };

/** The engine computed it from logged data; the model narrated it; the named reviewer decides. */
export function ReviewDecision() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const q = useQuery({ queryKey: ['review', id], queryFn: () => api.get<ReviewCycleFull>(`/api/reviews/${id}`), refetchInterval: (x) => (x.state.data?.narrativeStatus === 'pending' ? 2500 : false) });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const [decision, setDecision] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const decide = useMutation({
    mutationFn: () => api.post(`/api/reviews/${id}/decide`, { decision, rationale: rationale || null }),
    onSuccess: () => {
      toast.success(`Review decided: ${humanize(decision ?? '')}.`);
      qc.invalidateQueries();
      nav(`${base}/cases/${q.data!.caseKey}`);
    },
  });
  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <Callout tone="danger">Review cycle not found.</Callout>;
  const r = q.data;
  const c = r.computed;
  const n = r.narrative;
  const err = decide.error as ApiError | null;
  const differs = decision && c && decision !== c.decision;
  const student = roster.data?.find((s) => s.caseKeys.includes(r.caseKey))?.displayName ?? 'Student';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ to: `${base}/reviews`, label: 'Reviews' }} eyebrow={`${student} · due ${fmtDate(r.dueAt)}`} title="Plan review" actions={<Badge tone={r.status === 'open' ? 'warning' : 'success'} className="px-3 py-1 text-xs">{humanize(r.status)}</Badge>} />

      {c && (
        <Card tone="evidence" className="mb-4">
          <CardBody className="pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-evidence-soft text-evidence"><Scale className="size-4" /></span>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-evidence">Computed from your logged data</div>
                  <h2 className="text-[15px] font-semibold">Recommendation: {humanize(c.decision)}</h2>
                </div>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {c.goalSummaries.map((g) => (
                <li key={g.goalIndex} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{g.targetBehavior}</span>
                    <Badge tone={g.trend === 'improving' ? 'success' : g.trend === 'worsening' ? 'danger' : g.trend === 'insufficient_data' ? 'warning' : 'neutral'}>{humanize(g.trend)}</Badge>
                    <ObsCount n={g.observations} />
                    <span className="text-xs text-subtle">{g.windowDays}-day window</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Current {g.currentValue ?? '—'} · baseline {g.baselineValue ?? 'not available'}
                    {g.changePct !== null && ` · change ${g.changePct > 0 ? '+' : ''}${g.changePct}%`}
                  </div>
                </li>
              ))}
            </ul>
            {c.firedCriteria.length > 0 && (
              <div className="mt-4 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Review criteria that fired</div>
                <ul className="mt-1 space-y-1">
                  {c.firedCriteria.map((f) => (
                    <li key={f.criterionIndex} className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{humanize(f.decision)}</Badge> <span>{f.description}</span> <ObsCount n={f.observations} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Strategy use logged in {c.implementationConsistency.weeksWithStrategyUse} of {c.implementationConsistency.weeksInWindow} weeks ({c.implementationConsistency.strategyUsesInWindow} entries). {c.rationale.join(' ')}
            </p>
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody className="pt-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-sunken text-muted"><ScrollText className="size-4" /></span>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Narrative</div>
              <h2 className="text-[15px] font-semibold">Drafted by the model around the computed result</h2>
            </div>
          </div>
          {r.narrativeStatus === 'pending' && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted">
              <span className="size-2 animate-ping rounded-full bg-primary" /> Drafting…
            </div>
          )}
          {r.narrativeStatus === 'needs_attention' && <Callout tone="warning" className="mt-3">The narrative failed a guardrail; the computed result above is authoritative.</Callout>}
          {n && (
            <div className="mt-3 space-y-3 text-sm">
              <p className="leading-relaxed">{n.summaryForTeacher}</p>
              {n.suggestedAdjustments.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Suggested adjustments (options, not instructions)</div>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {n.suggestedAdjustments.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="rounded-md bg-sunken/60 p-2.5 text-xs text-muted">{n.humanReviewNotes}</p>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">What the student and family will see once you decide</summary>
                <div className="mt-2 space-y-1">
                  <div><span className="font-medium text-fg">Student:</span> {n.summaryForStudent}</div>
                  <div><span className="font-medium text-fg">Family:</span> {n.summaryForFamily}</div>
                </div>
              </details>
            </div>
          )}
        </CardBody>
      </Card>

      {r.status === 'open' && (
        <Card>
          <CardBody className="pt-5">
            <h2 className="text-[15px] font-semibold">Your decision</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              {REVIEW_DECISIONS.map((d) => (
                <button key={d} onClick={() => setDecision(d)} aria-pressed={decision === d} data-testid={`review-${d}`} className={cn('rounded-lg border-2 px-3 py-3 text-left text-sm font-medium transition-all', decision === d ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-elevated hover:border-border-strong')}>
                  {humanize(d)}
                  {c?.decision === d && <Badge tone="info" className="ml-1">computed</Badge>}
                  <div className="mt-0.5 text-xs font-normal text-muted">{DECISION_HELP[d]}</div>
                </button>
              ))}
            </div>
            {differs && <Callout tone="warning" className="mt-3">Your decision differs from the computed recommendation. A rationale is required.</Callout>}
            <Textarea className="mt-3" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (required when you disagree with the computed recommendation)" data-testid="review-rationale" />
            {err && <Callout tone="danger" className="mt-3">{err.message}</Callout>}
            <Button size="lg" className="mt-4" disabled={!decision} loading={decide.isPending} onClick={() => decide.mutate()} data-testid="record-review">
              <Check /> Record decision
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
