import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, ClipboardList, FileText, Inbox, Plus, Sparkles, Zap } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Button, Card, CardBody, Empty, PageSkeleton, Stagger, StaggerItem, Stat } from '../../components/ui';
import { api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CaseListItem, Candidate, RosterStudent } from '../../lib/types';

interface ReviewItem {
  id: string;
  caseKey: string;
  planId: string;
  dueAt: string;
  status: string;
  computedDecision: string | null;
}

/** The teacher's landing screen: what needs a human today, then the fastest paths into logging. */
export function TeacherToday() {
  const { me, primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases'), refetchInterval: 8000 });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewItem[]>('/api/reviews') });
  const queue = useQuery({ queryKey: ['queue', 'teacher'], queryFn: () => api.get<Candidate[]>('/api/patterns/queue?queue=teacher') });
  const requests = useQuery({ queryKey: ['corrections'], queryFn: () => api.get<Array<{ id: string; status: string; subject: string; caseKey: string }>>('/api/corrections') });

  if (cases.isLoading || roster.isLoading) return <PageSkeleton />;
  const byCase = new Map<string, RosterStudent>();
  for (const s of roster.data ?? []) for (const ck of s.caseKeys) byCase.set(ck, s);
  const name = (ck: string) => byCase.get(ck)?.displayName ?? 'Student';

  const openReviews = (reviews.data ?? []).filter((r) => r.status === 'open');
  const dueSoon = (reviews.data ?? []).filter((r) => r.status === 'scheduled');
  const openCandidates = (queue.data ?? []).filter((c) => ['detected', 'in_review'].includes(c.status));
  const readyDrafts = (cases.data ?? []).filter((c) => !c.plan && c.latestDraft && ['ready', 'needs_attention'].includes(c.latestDraft.status));
  const activeCases = (cases.data ?? []).filter((c) => c.plan?.status === 'active');
  const openRequests = (requests.data ?? []).filter((r) => r.status === 'open');
  const attention = openReviews.length + openCandidates.length + readyDrafts.length + openRequests.length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${me?.user?.displayName.split(' ')[0] ?? ''}`}
        description={attention === 0 ? 'Nothing is waiting on you. Log a few observations when you have fifteen seconds.' : `${attention} thing${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} a decision from you.`}
        actions={
          <Link to={`${base}/intake`}>
            <Button>
              <Plus /> New intake
            </Button>
          </Link>
        }
      />

      <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <Stat label="Active plans" value={activeCases.length} hint={`${cases.data?.length ?? 0} cases total`} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Patterns to review" value={openCandidates.length} tone={openCandidates.length ? 'warning' : undefined} hint="ranked by evidence" />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Reviews open" value={openReviews.length} tone={openReviews.length ? 'warning' : undefined} hint={dueSoon.length ? `${dueSoon.length} due this week` : 'none due this week'} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Drafts to approve" value={readyDrafts.length} tone={readyDrafts.length ? 'info' : undefined} hint="AI drafts waiting for you" />
        </StaggerItem>
      </Stagger>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardBody className="pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">Needs you</h2>
                {attention > 0 && <Badge tone="warning">{attention}</Badge>}
              </div>
              {attention === 0 ? (
                <Empty compact icon={<Sparkles />} title="All clear" description="New pattern candidates and review cycles will appear here." />
              ) : (
                <ul className="divide-y divide-border">
                  {readyDrafts.map((c) => (
                    <Row key={c.caseKey} icon={<FileText />} to={`${base}/drafts/${c.latestDraft!.id}`} title={`Review the draft plan for ${name(c.caseKey)}`} meta={c.latestDraft!.status === 'needs_attention' ? 'Failed a guardrail twice — needs your judgement' : 'Passed guardrails'} tone={c.latestDraft!.status === 'needs_attention' ? 'danger' : 'info'} />
                  ))}
                  {openReviews.map((r) => (
                    <Row key={r.id} icon={<ClipboardList />} to={`${base}/reviews/${r.id}`} title={`Decide the plan review for ${name(r.caseKey)}`} meta={r.computedDecision ? `Computed recommendation: ${humanize(r.computedDecision)}` : 'Computing…'} tone="warning" />
                  ))}
                  {openCandidates.map((c) => (
                    <Row key={c.id} icon={<Sparkles />} to={`${base}/candidates/${c.id}`} title={c.title} meta={`${name(c.caseKey)} · ${c.evidenceRefs.length} data points · strength ${Math.round(c.strength * 100)}%`} tone="hypothesis" />
                  ))}
                  {openRequests.map((r) => (
                    <Row key={r.id} icon={<Inbox />} to={`${base}/requests`} title={`Family request: ${r.subject}`} meta={name(r.caseKey)} tone="info" />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">Quick entry</h2>
                <Link to={`${base}/cases`} className="text-xs font-medium text-primary hover:underline">
                  All cases
                </Link>
              </div>
              {activeCases.length === 0 ? (
                <Empty compact icon={<Zap />} title="No active plans yet" description="Approve a draft and quick entry appears here." />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {activeCases.map((c) => (
                    <Link key={c.caseKey} to={`${base}/cases/${c.caseKey}/log`} className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md">
                      <Avatar name={name(c.caseKey)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{name(c.caseKey)}</div>
                        <div className="text-xs text-muted">Grade {c.gradeLevel} · tap to log</div>
                      </div>
                      <Zap className="size-4 text-muted transition-colors group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardBody className="pt-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Roster</h2>
              <span className="text-xs text-muted">{roster.data?.length ?? 0} students</span>
            </div>
            <ul className="divide-y divide-border">
              {(roster.data ?? []).map((s) => {
                const c = (cases.data ?? []).find((x) => s.caseKeys.includes(x.caseKey));
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <Avatar name={s.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{s.displayName}</div>
                      <div className="truncate text-[11px] text-subtle">{s.sectionName}</div>
                    </div>
                    {c ? (
                      <Link to={`${base}/cases/${c.caseKey}`}>
                        <Badge tone={c.plan?.status === 'active' ? 'success' : c.plan ? 'warning' : 'info'}>{c.plan ? humanize(c.plan.status) : `draft ${humanize(c.latestDraft?.status ?? '')}`}</Badge>
                      </Link>
                    ) : (
                      <Link to={`${base}/intake?studentId=${s.id}`} className="text-xs font-medium text-primary hover:underline">
                        Start intake
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ icon, to, title, meta, tone }: { icon: React.ReactNode; to: string; title: string; meta: string; tone: 'info' | 'warning' | 'danger' | 'hypothesis' }) {
  const t = { info: 'bg-info-soft text-info-fg', warning: 'bg-warning-soft text-warning-fg', danger: 'bg-danger-soft text-danger-fg', hypothesis: 'bg-hypothesis-soft text-hypothesis' }[tone];
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 py-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4 ${t}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="truncate text-xs text-muted">{meta}</div>
        </div>
        <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </Link>
    </li>
  );
}

export { fmtDate };
