import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sparkles, Users } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Callout, Card, CardBody, CardHeader, Empty, PageSkeleton } from '../../components/ui';
import { api, fmtDate, humanize } from '../../lib/api';
import type { CaseListItem, Candidate, RosterStudent } from '../../lib/types';

/** Support professional: the teacher surface plus a cross-case view of assigned students (docs/00). */
export function SupportHome() {
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const support = useQuery({ queryKey: ['queue', 'support'], queryFn: () => api.get<Candidate[]>('/api/patterns/queue?queue=support') });
  const teacher = useQuery({ queryKey: ['queue', 'teacher'], queryFn: () => api.get<Candidate[]>('/api/patterns/queue?queue=teacher') });
  if (cases.isLoading) return <PageSkeleton />;
  const name = (ck: string) => roster.data?.find((s) => s.caseKeys.includes(ck))?.displayName ?? 'Student';
  const openSupport = (support.data ?? []).filter((c) => ['detected', 'in_review'].includes(c.status));
  return (
    <div>
      <PageHeader title="My students" description="Every student assigned to you, across sections, with their plan state and anything waiting for a decision." />
      {openSupport.length > 0 && (
        <Callout tone="warning" icon={<Sparkles />} title="Support-team queue" className="mb-4">
          <ul className="mt-1 space-y-1">
            {openSupport.map((c) => (
              <li key={c.id}>
                <Link to={`/support/candidates/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                  {c.title}
                </Link>{' '}
                · {name(c.caseKey)} · {humanize(c.routing)}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <Card>
        <CardHeader title="Cross-case view" />
        <CardBody>
          {cases.data?.length === 0 && <Empty compact icon={<Users />} title="No assigned students with cases" />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-2 pr-3">Student</th>
                  <th className="pr-3">Grade</th>
                  <th className="pr-3">Plan</th>
                  <th className="pr-3">Waiting</th>
                  <th className="pr-3">Opened</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cases.data?.map((c) => {
                  const open = [...(teacher.data ?? []), ...(support.data ?? [])].filter((x) => x.caseKey === c.caseKey && ['detected', 'in_review'].includes(x.status)).length;
                  return (
                    <tr key={c.caseKey} className="border-t border-border">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2">
                          <Avatar name={name(c.caseKey)} size="sm" /> {name(c.caseKey)}
                        </span>
                      </td>
                      <td className="pr-3">{c.gradeLevel}</td>
                      <td className="pr-3">{c.plan ? <Badge tone={c.plan.status === 'active' ? 'success' : 'warning'}>{humanize(c.plan.status)}</Badge> : <Badge>draft {humanize(c.latestDraft?.status ?? 'none')}</Badge>}</td>
                      <td className="pr-3">{open > 0 ? <Badge tone="warning">{open} candidate{open === 1 ? '' : 's'}</Badge> : <span className="text-subtle">—</span>}</td>
                      <td className="pr-3 text-muted">{fmtDate(c.createdAt)}</td>
                      <td className="text-right">
                        <Link to={`/support/cases/${c.caseKey}`} className="text-sm font-medium text-primary hover:underline">
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
