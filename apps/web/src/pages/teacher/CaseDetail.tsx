import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, ClipboardList, FileText, Printer, RefreshCw, Sparkles, Zap } from 'lucide-react';
import type { PlanContent } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Button, Callout, Card, CardBody, CardHeader, Empty, ObsCount, PageSkeleton, Tabs, TabsContent, TabsList } from '../../components/ui';
import { FamilyAccess } from '../../components/FamilyAccess';
import { api, fmtDate, fmtDateTime, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CaseView, Draft } from '../../lib/types';
import { PlanSections } from '../../components/PlanSections';
import { ProgressChart } from '../../components/ProgressChart';
import { BaselineBadge, BaselineDetail, TargetBadge } from '../../components/GoalCard';

export function CaseDetail() {
  const { caseKey = '' } = useParams();
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const view = useQuery({ queryKey: ['case', caseKey], queryFn: () => api.get<CaseView>(`/api/cases/${caseKey}`), refetchInterval: 8000 });
  const drafts = useQuery({ queryKey: ['drafts', caseKey], queryFn: () => api.get<Draft[]>(`/api/cases/${caseKey}/drafts`) });
  const quality = useQuery({ queryKey: ['quality', caseKey], queryFn: () => api.get<Array<{ definitionId: string; title: string; missing: string[]; at: string }>>(`/api/cases/${caseKey}/data-quality`) });
  const sweep = useMutation({
    mutationFn: () => api.post<{ created: number; insufficient: number }>(`/api/cases/${caseKey}/sweep`),
    onSuccess: (r) => {
      toast.success(r.created ? `${r.created} new candidate${r.created === 1 ? '' : 's'} detected.` : 'No new candidates. See Data quality for what each rule still needs.');
      qc.invalidateQueries();
    },
  });
  const reviewNow = useMutation({ mutationFn: (planId: string) => api.post(`/api/plans/${planId}/review-now`), onSuccess: () => { toast.success('Review cycle opened.'); qc.invalidateQueries(); } });
  const ack = useMutation({ mutationFn: (id: string) => api.post(`/api/cases/${caseKey}/safety-flags/${id}/acknowledge`), onSuccess: () => qc.invalidateQueries({ queryKey: ['case', caseKey] }) });

  if (view.isLoading) return <PageSkeleton />;
  if (view.error || !view.data) return <Callout tone="danger">Could not load this case.</Callout>;
  const v = view.data;
  const plan = v.planId ? (Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('plan_')).map(([k, val]) => [k.slice(5), val])) as unknown as PlanContent) : null;
  const openFlags = (v.safety_flags ?? []).filter((f) => f.status === 'open');
  const latestDraft = drafts.data?.[0];
  const candidates = v.pattern_candidates ?? [];
  const goals = v.goals ?? [];

  return (
    <div>
      <PageHeader
        back={{ to: `${base}/cases`, label: 'Cases' }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={v.student?.displayName ?? 'Student'} size="lg" />
            <span>
              {v.student?.displayName ?? 'Student'}
              <span className="ml-2 align-middle">{v.plan_status && <Badge tone={v.plan_status === 'active' ? 'success' : 'warning'}>Plan {humanize(v.plan_status)}</Badge>}</span>
            </span>
          </span>
        }
        description={`Grade ${v.case_gradeLevel} · case ${caseKey} · viewing as ${humanize(v.role)}`}
        actions={
          <>
            {v.planId && (
              <Link to={`${base}/cases/${caseKey}/print`}>
                <Button variant="secondary">
                  <Printer /> Print
                </Button>
              </Link>
            )}
            {!v.planId && latestDraft && ['ready', 'needs_attention', 'blocked_pii', 'failed'].includes(latestDraft.status) && (
              <Link to={`${base}/drafts/${latestDraft.id}`}>
                <Button>
                  <FileText /> Review draft
                </Button>
              </Link>
            )}
            {v.plan_status === 'active' && (
              <Link to={`${base}/cases/${caseKey}/log`}>
                <Button data-testid="quick-entry">
                  <Zap /> Quick entry
                </Button>
              </Link>
            )}
          </>
        }
      />

      {openFlags.length > 0 && (
        <Callout tone="danger" icon={<AlertTriangle />} title="Safety concern flagged" className="mb-4">
          {openFlags.map((f) => (
            <div key={f.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span>{f.description}</span>
              <Button size="sm" variant="secondary" onClick={() => ack.mutate(f.id)}>
                Acknowledge — procedure followed
              </Button>
            </div>
          ))}
          <div className="mt-2 text-xs">Follow established school safety procedures and involve appropriate personnel. This plan does not address the safety concern itself.</div>
        </Callout>
      )}

      {!v.planId && latestDraft && (
        <Callout tone={latestDraft.status === 'ready' ? 'info' : ['queued', 'running'].includes(latestDraft.status) ? 'primary' : 'warning'} title={`Draft ${humanize(latestDraft.status)}`} className="mb-4" action={['ready', 'needs_attention'].includes(latestDraft.status) ? <Link to={`${base}/drafts/${latestDraft.id}`}><Button size="sm">Open</Button></Link> : undefined}>
          {['queued', 'running'].includes(latestDraft.status) ? 'The model is drafting in the background. This page refreshes automatically.' : latestDraft.error ?? 'Review each section before approval.'}
        </Callout>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList value={tab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'plan', label: 'Plan' }, { id: 'progress', label: 'Progress' }, { id: 'patterns', label: 'Patterns', count: candidates.length }, { id: 'data', label: 'Data quality', count: quality.data?.length }]} className="mb-4" />

        <TabsContent value="overview" className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Plan" description={v.plan_provenance ? `Drafted with AI · approved by ${v.plan_provenance.approvedBy ?? '—'} · ${fmtDateTime(v.plan_provenance.approvedAt)}` : 'No approved plan yet.'} />
            <CardBody>
              {v.plan_provenance ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-subtle">Version</dt>
                    <dd className="font-medium">v{v.plan_provenance.version}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Edited before approval</dt>
                    <dd className="font-medium">{v.plan_draftDiff ? `${Object.keys(v.plan_draftDiff.bySection).length} section(s)` : 'none'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Goals</dt>
                    <dd className="font-medium">{goals.filter((g) => g.status === 'active').length} active</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Strategies</dt>
                    <dd className="font-medium">{(v.strategies ?? []).length} active</dd>
                  </div>
                </dl>
              ) : (
                <Empty compact icon={<FileText />} title="Nothing approved yet" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Goals" />
            <CardBody className="space-y-3">
              {goals.length === 0 && <Empty compact title="No goals yet" />}
              {goals.map((g) => (
                <div key={g.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{g.targetBehavior}</span>
                    <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status}</Badge>
                    {g.progress && <ObsCount n={g.progress.totalObservations} />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <BaselineBadge baseline={g.baseline} status={g.baselineStatus} />
                    <TargetBadge target={g.target} />
                  </div>
                  {g.baseline && g.baseline.status !== 'available' && <div className="mt-2"><BaselineDetail baseline={g.baseline} /></div>}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Review cycles" action={v.planId && v.plan_status === 'active' && <Button size="sm" variant="secondary" loading={reviewNow.isPending} onClick={() => reviewNow.mutate(v.planId!)}><ClipboardList /> Review now</Button>} />
            <CardBody>
              {(v.reviewCycles ?? []).length === 0 && <Empty compact title="No review cycles" />}
              <ul className="space-y-2 text-sm">
                {(v.reviewCycles ?? []).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === 'open' ? 'warning' : r.status === 'decided' ? 'success' : 'neutral'}>{humanize(r.status)}</Badge>
                    <span className="text-muted">Due {fmtDate(r.dueAt)}</span>
                    {r.computed && <Badge tone="info">Computed: {humanize(r.computed.decision)}</Badge>}
                    {r.decision && <Badge tone="primary">Decided: {humanize(r.decision)}</Badge>}
                    {r.status === 'open' && (
                      <Link className="text-xs font-medium text-primary hover:underline" to={`${base}/reviews/${r.id}`}>
                        Decide →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent notes" description="Your free-text notes. Never shown to students or families." />
            <CardBody>
              {(v.signal_behaviorEventNotes ?? []).length === 0 && <Empty compact title="No notes" />}
              <ul className="space-y-1.5 text-sm">
                {(v.signal_behaviorEventNotes ?? []).slice(0, 8).map((n) => (
                  <li key={n.id}>
                    <span className="text-subtle">{fmtDate(n.observedAt)} · </span>
                    {n.note}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {v.student && (
            <Card className="md:col-span-2">
              <CardHeader title="Family and student access" description="Open this child's own dashboards. Scoped to them, free, and revocable — you don't need an administrator for it." />
              <CardBody>
                <FamilyAccess studentId={v.student.id} studentName={v.student.displayName.split(' ')[0] ?? v.student.displayName} />
              </CardBody>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="plan">{plan ? <Card><CardBody className="pt-5"><PlanSections content={plan} /></CardBody></Card> : <Empty icon={<FileText />} title="No approved plan yet" />}</TabsContent>

        <TabsContent value="progress" className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.id}>
              <CardHeader title={g.targetBehavior} description={g.observableDefinition} />
              <CardBody>{g.progress ? <ProgressChart p={g.progress} /> : <Empty compact title="No progress data" />}</CardBody>
            </Card>
          ))}
          {goals.length === 0 && <Empty title="Approve a plan to start logging" />}
        </TabsContent>

        <TabsContent value="patterns">
          <Card>
            <CardHeader title="Pattern candidates" description="Detected by deterministic rules over logged data. Every card shows the rule and the numbers first." action={<Button size="sm" variant="secondary" loading={sweep.isPending} onClick={() => sweep.mutate()}><RefreshCw /> Re-evaluate</Button>} />
            <CardBody>
              {candidates.length === 0 && <Empty compact icon={<Sparkles />} title="No visible candidates" description="Rules that need more data are listed under Data quality." />}
              <ul className="divide-y divide-border">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <Link to={`${base}/candidates/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-sunken/50">
                      <div>
                        <div className="text-sm font-medium">{c.title}</div>
                        <div className="text-xs text-muted">
                          {c.definitionId} · {fmtDate(c.detectedAt)} · strength {Math.round(c.strength * 100)}%
                        </div>
                      </div>
                      <Badge tone={c.status === 'confirmed' ? 'success' : c.status === 'dismissed' ? 'neutral' : 'warning'}>{humanize(c.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card>
            <CardHeader title="Data quality" description="Rules that could not run yet, and exactly what each one still needs. Visible only to you." />
            <CardBody className="space-y-3">
              {(quality.data ?? []).length === 0 && <Empty compact title="Every rule has enough data, or no sweep has run yet." />}
              {(quality.data ?? []).map((n) => (
                <div key={n.definitionId} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{n.title}</div>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {n.missing.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {v.intake_fields && (
                <details className="rounded-md border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Intake v{v.intake_fields.version} · {fmtDate(v.intake_fields.createdAt)}</summary>
                  <dl className="mt-2 space-y-2">
                    {Object.entries(v.intake_fields.fields).map(([k, val]) => (
                      <div key={k}>
                        <dt className="text-xs text-subtle">{humanize(k)}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
