import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Input, PageSkeleton, Stat, cn } from '../../components/ui';
import { ApiError, api, humanize } from '../../lib/api';

export function AdminCatalog() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'catalog'], queryFn: () => api.get<any[]>('/api/admin/catalog') });
  const [reviewer, setReviewer] = useState<Record<string, string>>({});
  const set = useMutation({
    mutationFn: (v: { id: string; status: string; reviewer: string | null }) => api.post(`/api/admin/definitions/${v.id}/status`, { status: v.status, reviewer: v.reviewer }),
    onSuccess: (_r, v) => {
      toast.success(`${v.id} is now ${v.status}.`);
      qc.invalidateQueries({ queryKey: ['admin', 'catalog'] });
    },
  });
  const err = set.error as ApiError | null;
  if (q.isLoading) return <PageSkeleton />;
  return (
    <div>
      <PageHeader title="Pattern catalog" description="Fire rate, confirmation rate, dismissal reasons and time to adjudication per rule. New rules enter as piloting (detected, shown to no one) and need a named reviewer before activation. Rules below the confirmation floor or firing disproportionately are retirable here." />
      {err && <Callout tone="danger" className="mb-4">{err.message}</Callout>}
      <div className="space-y-3">
        {q.data?.map((d) => (
          <Card key={d.id} className={cn(d.belowFloor && 'ring-1 ring-danger/50')}>
            <CardHeader
              eyebrow={`${d.id} v${d.version} · ${humanize(d.routing)}`}
              title={d.title}
              description={d.plainLanguage}
              action={<Badge tone={d.status === 'active' ? 'success' : d.status === 'retired' ? 'neutral' : 'info'} className="px-2.5 py-1">{d.status}</Badge>}
            />
            <CardBody>
              <div className="grid gap-2 sm:grid-cols-5">
                <Stat label="Fired" value={d.fired} hint={d.fireRatePerCase !== null ? `${d.fireRatePerCase}/case` : undefined} />
                <Stat label="Adjudicated" value={d.adjudicated} />
                <Stat label="Confirmation" value={d.confirmationRate ?? '—'} hint={d.belowFloor ? 'below floor' : undefined} tone={d.belowFloor ? 'danger' : undefined} />
                <Stat label="Days to decide" value={d.medianDaysToAdjudication ?? '—'} />
                <Stat label="Reviewer" value={<span className="text-base">{d.reviewer ?? '—'}</span>} />
              </div>
              {d.dismissalReasons.length > 0 && <div className="mt-2 text-xs text-muted">Dismissals: {d.dismissalReasons.map((r: any) => `${humanize(r.reason)} ×${r.count}`).join(', ')}</div>}
              <details className="mt-3 rounded-md border border-border p-3 text-xs text-muted">
                <summary className="cursor-pointer font-medium text-fg">Thresholds, confounders, proxy review</summary>
                <div className="mt-2 font-mono">{Object.entries(d.thresholds).map(([k, v]) => `${k}=${v}`).join('  ')}</div>
                <ul className="mt-2 list-disc pl-4">
                  {d.confounders.map((c: string) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <div className="mt-2"><span className="font-medium text-fg">Proxy review:</span> {d.proxyReview}</div>
              </details>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Named reviewer</label>
                  <Input value={reviewer[d.id] ?? d.reviewer ?? ''} onChange={(e) => setReviewer({ ...reviewer, [d.id]: e.target.value })} className="h-9 w-56" placeholder="Required to activate" />
                </div>
                {d.status !== 'active' && (
                  <Button size="sm" onClick={() => set.mutate({ id: d.id, status: 'active', reviewer: reviewer[d.id] ?? d.reviewer ?? null })}>
                    Activate
                  </Button>
                )}
                {d.status !== 'piloting' && (
                  <Button size="sm" variant="secondary" onClick={() => set.mutate({ id: d.id, status: 'piloting', reviewer: reviewer[d.id] ?? d.reviewer ?? null })}>
                    Back to piloting
                  </Button>
                )}
                {d.status !== 'retired' && (
                  <Button size="sm" variant="danger" onClick={() => set.mutate({ id: d.id, status: 'retired', reviewer: reviewer[d.id] ?? d.reviewer ?? null })}>
                    Retire
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
