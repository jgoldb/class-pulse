import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Avatar, Badge, Card, CardBody, Empty, PageSkeleton, Stagger, StaggerItem } from '../../components/ui';
import { api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Candidate, RosterStudent } from '../../lib/types';

/** Weekly-digest style queue (docs/02 "Alert fatigue"): capped, ranked by evidence strength. */
export function PatternQueue({ queue }: { queue: 'teacher' | 'support' }) {
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const q = useQuery({ queryKey: ['queue', queue], queryFn: () => api.get<Candidate[]>(`/api/patterns/queue?queue=${queue}`), refetchInterval: 8000 });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  if (q.isLoading) return <PageSkeleton />;
  const name = (ck: string) => roster.data?.find((s) => s.caseKeys.includes(ck))?.displayName ?? 'Student';
  const open = (q.data ?? []).filter((c) => ['detected', 'in_review', 'needs_more_data'].includes(c.status));
  const done = (q.data ?? []).filter((c) => !['detected', 'in_review', 'needs_more_data'].includes(c.status));

  const CandidateRow = ({ c }: { c: Candidate }) => (
    <Link to={`${base}/candidates/${c.id}`}>
      <Card interactive className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={name(c.caseKey)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.title}</span>
              <Badge tone={c.status === 'confirmed' ? 'success' : c.status === 'dismissed' ? 'neutral' : c.status === 'in_review' ? 'info' : 'warning'}>{humanize(c.status)}</Badge>
            </div>
            <div className="mt-0.5 text-sm text-muted">{c.plainLanguage}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
              <span>{name(c.caseKey)}</span>·<span>rule {c.definitionId} v{c.definitionVersion}</span>·<span>{c.evidenceRefs.length} data points</span>·<span>{fmtDate(c.detectedAt)}</span>
              <Badge tone="evidence">strength {Math.round(c.strength * 100)}%</Badge>
              {c.routing !== 'teacher_review' && <Badge tone="warning">{humanize(c.routing)}</Badge>}
              {c.proposalStatus === 'pending' && <Badge tone="info">interpreting…</Badge>}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );

  return (
    <div>
      <PageHeader title={queue === 'support' ? 'Support-team queue' : 'Pattern queue'} description="Candidates are detected by deterministic rules over logged data, capped per teacher, and ranked by evidence strength. A candidate is a question for you, not a finding." />
      {open.length === 0 ? (
        <Empty icon={<Sparkles />} title="Nothing waiting on you" description="New candidates appear after the nightly sweep or when you re-evaluate a case. Rules that need more data are listed on each case's Data quality tab." />
      ) : (
        <Stagger className="space-y-3">
          {open.map((c) => (
            <StaggerItem key={c.id}>
              <CandidateRow c={c} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
      {done.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-muted">Decided ({done.length})</summary>
          <div className="mt-3 space-y-3">
            {done.map((c) => (
              <CandidateRow key={c.id} c={c} />
            ))}
          </div>
        </details>
      )}
      <CardBody className="hidden" />
    </div>
  );
}
