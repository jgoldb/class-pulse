import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Card, CardBody, Empty, PageSkeleton } from '../../components/ui';
import { api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { RosterStudent } from '../../lib/types';

interface ReviewItem {
  id: string;
  caseKey: string;
  planId: string;
  dueAt: string;
  status: string;
  narrativeStatus: string | null;
  computedDecision: string | null;
}

export function ReviewsList() {
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewItem[]>('/api/reviews'), refetchInterval: 10_000 });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  if (reviews.isLoading) return <PageSkeleton />;
  const name = (ck: string) => roster.data?.find((s) => s.caseKeys.includes(ck))?.displayName ?? 'Student';
  const open = (reviews.data ?? []).filter((r) => r.status === 'open');
  const scheduled = (reviews.data ?? []).filter((r) => r.status === 'scheduled');
  const row = (r: ReviewItem) => (
    <li key={r.id}>
      <Link to={`${base}/reviews/${r.id}`} className="flex items-center gap-3 py-3 transition-colors hover:bg-sunken/50">
        <Avatar name={name(r.caseKey)} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{name(r.caseKey)}</div>
          <div className="text-xs text-muted">{r.status === 'open' ? 'Open now' : `Due ${fmtDate(r.dueAt)}`}</div>
        </div>
        {r.computedDecision && <Badge tone="info">Computed: {humanize(r.computedDecision)}</Badge>}
        <Badge tone={r.status === 'open' ? 'warning' : 'neutral'}>{humanize(r.status)}</Badge>
      </Link>
    </li>
  );
  return (
    <div>
      <PageHeader title="Plan reviews" description="A review cycle computes a recommendation from the logged data. The narrative is drafted around it. The decision is yours, and a rationale is required when you disagree." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody className="pt-5">
            <h2 className="mb-2 text-[15px] font-semibold">Open</h2>
            {open.length === 0 ? <Empty compact icon={<ClipboardList />} title="Nothing open" description="Cycles open automatically when they come due, or from a case page." /> : <ul className="divide-y divide-border">{open.map(row)}</ul>}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-5">
            <h2 className="mb-2 text-[15px] font-semibold">Coming up</h2>
            {scheduled.length === 0 ? <Empty compact title="No reviews due this week" /> : <ul className="divide-y divide-border">{scheduled.map(row)}</ul>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
