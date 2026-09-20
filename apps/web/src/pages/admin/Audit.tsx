import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/AppShell';
import { Badge, Card, CardBody, Empty, Input, PageSkeleton } from '../../components/ui';
import { api, fmtDateTime } from '../../lib/api';

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'> = {
  'student.read': 'neutral',
  'plane.join': 'warning',
  'egress.call': 'info',
  'authorization.grant': 'danger',
  'authorization.revoke': 'danger',
  'plan.approve': 'success',
  'candidate.adjudicate': 'primary',
  'review.decide': 'primary',
};

export function AdminAudit() {
  const [filter, setFilter] = useState({ action: '', caseKey: '', studentId: '' });
  const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ['admin', 'audit', params], queryFn: () => api.get<any[]>(`/api/admin/audit?${params}`) });
  return (
    <div>
      <PageHeader title="Audit log" description="Append-only at the database. Every individual read, plane join, egress call, authorization, approval and adjudication." />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Input placeholder="action (e.g. student.read)" value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })} />
        <Input placeholder="case key" value={filter.caseKey} onChange={(e) => setFilter({ ...filter, caseKey: e.target.value })} />
        <Input placeholder="student id" value={filter.studentId} onChange={(e) => setFilter({ ...filter, studentId: e.target.value })} />
      </div>
      {q.isLoading && <PageSkeleton />}
      {q.data && (
        <Card>
          <CardBody className="pt-4">
            {q.data.length === 0 && <Empty compact title="No events match" />}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="py-2 pr-3">When</th>
                    <th className="pr-3">Actor</th>
                    <th className="pr-3">Action</th>
                    <th className="pr-3">Target</th>
                    <th className="pr-3">Case</th>
                    <th className="pr-3">Student</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="whitespace-nowrap py-1.5 pr-3 text-muted">{fmtDateTime(e.at)}</td>
                      <td className="pr-3 font-mono">{e.actorUserId ?? 'system'}{e.actorRole ? ` · ${e.actorRole}` : ''}</td>
                      <td className="pr-3"><Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{e.action}</Badge></td>
                      <td className="pr-3 font-mono">{e.targetType}{e.targetId ? `:${String(e.targetId).slice(0, 8)}` : ''}</td>
                      <td className="pr-3 font-mono">{e.caseKey ?? ''}</td>
                      <td className="pr-3 font-mono">{e.studentId ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
