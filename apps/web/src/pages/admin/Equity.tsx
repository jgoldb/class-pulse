import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/AppShell';
import { Badge, Card, CardBody, CardHeader, Empty, PageSkeleton, Stat, cn } from '../../components/ui';
import { api, humanize } from '../../lib/api';

export function AdminEquity() {
  const q = useQuery({ queryKey: ['admin', 'equity'], queryFn: () => api.get<any>('/api/admin/equity') });
  if (q.isLoading) return <PageSkeleton />;
  const e = q.data;
  return (
    <div>
      <PageHeader title="Equity monitoring" description={`Firing and confirmation rates by subgroup, aggregate only, minimum cell size ${e.minCellSize}. Detection rules and the interpretation prompt have no access to these attributes; this screen is the only place they are read. A disproportionality index ≥ 1.5 (or ≤ 0.67) raises an alert.`} />
      <Stat label="Overall fire rate" value={e.overallFireRate ?? '—'} hint="students with at least one visible candidate" className="mb-4 max-w-xs" />
      {e.attributes.length === 0 && <Empty title="No demographic attributes recorded" description="Attributes live only in the identified plane and are read only here." />}
      <div className="space-y-4">
        {e.attributes.map((a: any) => (
          <Card key={a.attribute}>
            <CardHeader title={humanize(a.attribute)} />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                    <tr>
                      <th className="py-2 pr-3">Group</th>
                      <th className="pr-3">Population</th>
                      <th className="pr-3">Fire rate</th>
                      <th className="pr-3">Confirmation rate</th>
                      <th className="pr-3">Disproportionality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.groups.map((g: any) => (
                      <tr key={g.value} className={cn('border-t border-border', g.alert && 'bg-danger-soft/60')}>
                        <td className="py-2 pr-3 font-medium">{g.value}</td>
                        <td className="pr-3">{g.suppressed ? <Badge tone="outline">suppressed</Badge> : g.population}</td>
                        <td className="pr-3 tabular-nums">{g.fireRate ?? '—'}</td>
                        <td className="pr-3 tabular-nums">{g.confirmationRate ?? '—'}</td>
                        <td className="pr-3 tabular-nums">
                          {g.disproportionalityIndex ?? '—'} {g.alert && <Badge tone="danger">alert</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
