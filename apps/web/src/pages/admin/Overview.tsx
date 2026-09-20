import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PartyPopper, Users } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Empty, PageSkeleton, Stagger, StaggerItem, Stat } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Cells {
  cells: Array<{ key: string; count: number | null; suppressed: boolean; reason: string | null }>;
  total: number | null;
  minCellSize: number;
}

function CellChart({ title, data }: { title: string; data: Cells }) {
  const rows = data.cells.map((c) => ({ name: c.key, count: c.count ?? 0, suppressed: c.suppressed }));
  return (
    <Card>
      <CardHeader title={title} description={`Cells under n=${data.minCellSize} are suppressed, plus one complementary cell.`} />
      <CardBody>
        {rows.length === 0 ? (
          <Empty compact title="No data" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--fg-subtle)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--fg-subtle)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: 12 }} formatter={((v: number, _n: unknown, item: { payload?: { suppressed?: boolean } }) => [item?.payload?.suppressed ? 'suppressed' : v, 'count']) as never} />
              <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.cells.filter((c) => c.suppressed).map((c) => (
            <Badge key={c.key} tone="outline">
              {c.key}: suppressed{c.reason === 'complementary' ? ' (complementary)' : ''}
            </Badge>
          ))}
          <span className="ml-auto text-xs text-muted">Total {data.total ?? '—'}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export function AdminOverview() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['admin', 'trends'], queryFn: () => api.get<any>('/api/admin/trends') });
  const qe = useQuery({ queryKey: ['admin', 'quick-entry'], queryFn: () => api.get<any>('/api/admin/quick-entry') });
  if (q.isLoading) return <PageSkeleton />;
  const t = q.data;
  const welcome = params.get('welcome') === '1';
  return (
    <div>
      <PageHeader title={me?.workspace?.name ?? 'Overview'} description="Aggregate by default. No individual student record appears on this surface without an explicit, time-boxed authorization." />
      {welcome && (
        <Callout tone="success" icon={<PartyPopper />} title="Your workspace is ready" className="mb-4" action={<Link to="/admin/structure"><Button size="sm">Set up sections and students</Button></Link>}>
          Next: add class sections and students under School structure, then invite teachers from People &amp; access. Students and families are invited per student.
        </Callout>
      )}
      <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <Stat label="Active cases" value={t.activeCases ?? '—'} hint={t.activeCases === null ? `below n=${t.minCellSize}` : undefined} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Generation failure rate" value={t.generation.failureRate ?? '—'} hint={`${t.generation.total} model runs`} tone={t.generation.failureRate > 0.1 ? 'warning' : undefined} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Guardrail rejection rate" value={t.generation.rejectionRate ?? '—'} hint={`${t.generation.draftsNeedingAttention} drafts need attention`} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Quick-entry tagging" value={qe.data?.taggedShare ?? '—'} hint={`${qe.data?.teacherEntries ?? 0} teacher entries carry context`} tone={qe.data?.taggedShare !== null && qe.data?.taggedShare < 0.5 ? 'warning' : undefined} />
        </StaggerItem>
      </Stagger>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <CellChart title="Cases by grade" data={t.casesByGrade} />
        <CellChart title="Plans by status" data={t.plansByStatus} />
        <CellChart title="Review decisions" data={t.reviewDecisions} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Stat label="Intervention effectiveness" value={t.interventionEffectiveness.improvingShare ?? '—'} hint={t.interventionEffectiveness.decidedCycles === null ? 'below minimum cell size' : `${t.interventionEffectiveness.decidedCycles} decided review cycles with an improving goal`} />
        <Stat label="Median generation latency" value={t.generation.medianLatencyMs !== null ? `${(t.generation.medianLatencyMs / 1000).toFixed(1)}s` : '—'} hint="per model call, including the second-model check" />
      </div>
      <Card className="mt-4">
        <CardHeader title="Where to go next" />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          <Link to="/admin/people" className="flex items-center gap-2 rounded-md border border-border p-3 hover:bg-sunken"><Users className="size-4 text-muted" /> Invite people and manage individual access</Link>
          <Link to="/admin/catalog" className="flex items-center gap-2 rounded-md border border-border p-3 hover:bg-sunken">Tune or retire pattern rules</Link>
        </CardBody>
      </Card>
    </div>
  );
}
