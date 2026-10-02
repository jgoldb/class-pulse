import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { TeacherTopBar, useDraftCounts } from '../../components/TeacherTopBar';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useCurrentClass } from '../../lib/classes';
import type { Candidate } from '../../lib/types';

/** Teacher and support surfaces share a shell; the counts feed the navigation badges. */
export function TeacherShell({ surface }: { surface: 'teacher' | 'support' }) {
  return surface === 'teacher' ? <TeacherSurface /> : <SupportSurface />;
}

function TeacherSurface() {
  const { section } = useCurrentClass();
  const { drafts, tomorrow } = useDraftCounts(section?.id);
  // Teachers capture from Class Pulse; opening a support case is a Support-surface action.
  return <AppShell surface="teacher" counts={{ drafts, tomorrow }} topBar={<TeacherTopBar />} />;
}

function SupportSurface() {
  const queue = useQuery({ queryKey: ['queue', 'support'], queryFn: () => api.get<Candidate[]>('/api/patterns/queue?queue=support'), refetchInterval: 15_000 });
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<Array<{ status: string }>>('/api/reviews'), refetchInterval: 15_000 });
  const counts = {
    patterns: (queue.data ?? []).filter((c) => ['detected', 'in_review'].includes(c.status)).length,
    reviews: (reviews.data ?? []).filter((r) => r.status === 'open').length,
  };
  return (
    <AppShell
      surface="support"
      counts={counts}
      primaryAction={
        <Link to="/support/intake">
          <Button size="icon" aria-label="New intake">
            <Plus />
          </Button>
        </Link>
      }
    />
  );
}
