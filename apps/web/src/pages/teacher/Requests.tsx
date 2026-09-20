import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Card, CardBody, Empty, PageSkeleton, Textarea } from '../../components/ui';
import { api, fmtDateTime } from '../../lib/api';
import type { RosterStudent } from '../../lib/types';

interface Correction {
  id: string;
  caseKey: string;
  subject: string;
  detail: string;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
}

/** Family correction requests (docs/04 transparency), resolved by the teacher with a note the family sees. */
export function Requests() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['corrections'], queryFn: () => api.get<Correction[]>('/api/corrections') });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/api/corrections/${id}/resolve`, { resolutionNote: notes[id] }),
    onSuccess: () => {
      toast.success('Marked resolved. The family can see your note.');
      qc.invalidateQueries({ queryKey: ['corrections'] });
    },
  });
  if (q.isLoading) return <PageSkeleton />;
  const name = (ck: string) => roster.data?.find((s) => s.caseKeys.includes(ck))?.displayName ?? 'Student';
  return (
    <div>
      <PageHeader title="Family requests" description="A family can dispute recorded information. Every request and your response is recorded in the audit log." />
      {q.data?.length === 0 && <Empty icon={<Inbox />} title="No requests" description="Families raise these from their own dashboard." />}
      <div className="space-y-3">
        {q.data?.map((c) => (
          <Card key={c.id}>
            <CardBody className="pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.subject}</div>
                  <div className="text-xs text-muted">
                    {name(c.caseKey)} · {fmtDateTime(c.createdAt)}
                  </div>
                </div>
                <Badge tone={c.status === 'open' ? 'warning' : 'success'}>{c.status}</Badge>
              </div>
              <p className="mt-3 text-sm">{c.detail}</p>
              {c.status === 'open' ? (
                <div className="mt-4">
                  <Textarea rows={2} placeholder="Your response (the family sees this)" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
                  <Button className="mt-2" size="sm" disabled={!notes[c.id]?.trim()} loading={resolve.isPending && resolve.variables === c.id} onClick={() => resolve.mutate(c.id)}>
                    Mark resolved
                  </Button>
                </div>
              ) : (
                <p className="mt-3 rounded-md bg-sunken p-3 text-sm">
                  <span className="font-medium">Response:</span> {c.resolutionNote}
                </p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
