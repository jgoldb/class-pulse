import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BookOpen, Plus, Search } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Button, Card, Empty, Input, PageSkeleton, Segmented, Stagger, StaggerItem } from '../../components/ui';
import { api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CaseListItem, RosterStudent } from '../../lib/types';

type Filter = 'all' | 'active' | 'drafts' | 'review';

export function CasesList() {
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  if (cases.isLoading || roster.isLoading) return <PageSkeleton />;
  const byCase = new Map<string, RosterStudent>();
  for (const s of roster.data ?? []) for (const ck of s.caseKeys) byCase.set(ck, s);
  const rows = (cases.data ?? [])
    .filter((c) => (filter === 'all' ? true : filter === 'active' ? c.plan?.status === 'active' : filter === 'drafts' ? !c.plan : c.plan?.status === 'under_review'))
    .filter((c) => !q.trim() || (byCase.get(c.caseKey)?.displayName ?? '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Cases"
        description="One case per student. A case holds the intake, the approved plan, every logged signal, and the patterns that fired."
        actions={
          <Link to={`${base}/intake`}>
            <Button>
              <Plus /> New intake
            </Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-subtle" />
          <Input className="pl-9" placeholder="Search students" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented<Filter> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active plans' }, { value: 'review', label: 'Under review' }, { value: 'drafts', label: 'Drafts' }]} />
      </div>
      {rows.length === 0 ? (
        <Empty icon={<BookOpen />} title="No cases match" description="Start an intake from the roster, or clear the filter." action={<Link to={`${base}/intake`}><Button variant="secondary">New intake</Button></Link>} />
      ) : (
        <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const s = byCase.get(c.caseKey);
            const status = c.plan ? c.plan.status : `draft_${c.latestDraft?.status ?? 'none'}`;
            const tone = c.plan?.status === 'active' ? 'success' : c.plan?.status === 'under_review' ? 'warning' : c.latestDraft?.status === 'ready' ? 'info' : ['failed', 'blocked_pii', 'needs_attention'].includes(c.latestDraft?.status ?? '') ? 'danger' : 'neutral';
            return (
              <StaggerItem key={c.caseKey}>
                <Link to={`${base}/cases/${c.caseKey}`}>
                  <Card interactive className="h-full p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={s?.displayName ?? 'Student'} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{s?.displayName ?? 'Student'}</div>
                        <div className="text-xs text-muted">
                          Grade {c.gradeLevel} · {s?.sectionName ?? ''}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge tone={tone}>{humanize(status.replace('draft_', 'draft '))}</Badge>
                          <Badge tone="outline">opened {fmtDate(c.createdAt)}</Badge>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
