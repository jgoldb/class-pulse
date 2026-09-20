import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import type { Candidate } from '../../lib/types';

/** Teacher and support surfaces share a shell; the counts feed the navigation badges. */
export function TeacherShell({ surface }: { surface: 'teacher' | 'support' }) {
  const base = surface === 'support' ? '/support' : '/teacher';
  const queue = useQuery({ queryKey: ['queue', surface === 'support' ? 'support' : 'teacher'], queryFn: () => api.get<Candidate[]>(`/api/patterns/queue?queue=${surface === 'support' ? 'support' : 'teacher'}`), refetchInterval: 15_000 });
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<Array<{ status: string }>>('/api/reviews'), refetchInterval: 15_000 });
  const requests = useQuery({ queryKey: ['corrections'], queryFn: () => api.get<Array<{ status: string }>>('/api/corrections'), refetchInterval: 30_000 });
  const counts = {
    patterns: (queue.data ?? []).filter((c) => ['detected', 'in_review'].includes(c.status)).length,
    reviews: (reviews.data ?? []).filter((r) => r.status === 'open').length,
    requests: (requests.data ?? []).filter((r) => r.status === 'open').length,
  };
  return (
    <AppShell
      surface={surface}
      counts={counts}
      primaryAction={
        <Link to={`${base}/intake`}>
          <Button size="icon" aria-label="New intake">
            <Plus />
          </Button>
        </Link>
      }
    />
  );
}
