import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { HeartHandshake, PartyPopper, Sparkles } from 'lucide-react';
import { Badge, Button, Callout, Card, CardBody, Empty, PageSkeleton, ProgressRing, Stagger, StaggerItem, Textarea, cn, spring, tap } from '../../components/ui';
import { api, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CaseListItem, CaseView } from '../../lib/types';
import { ProgressChart } from '../../components/ProgressChart';

const RATINGS = [
  { v: 1, label: 'Not yet', emoji: '🌱', hint: 'Tomorrow is a new try' },
  { v: 2, label: 'Partly', emoji: '🌿', hint: 'Getting there' },
  { v: 3, label: 'Yes!', emoji: '🌳', hint: 'You did it' },
];

/**
 * The student surface (docs/00): a sixth grader is a real user. Big, plain, positive. Own goals,
 * strategies, progress, positive feedback, and a self-check. Nothing about other students, no
 * teacher notes, no hypotheses, no raw pattern candidates (enforced by the API, not by this UI).
 */
export function StudentHome() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const caseKey = cases.data?.find((c) => c.plan?.status === 'active')?.caseKey ?? cases.data?.[0]?.caseKey;
  const view = useQuery({ queryKey: ['case', caseKey], queryFn: () => api.get<CaseView>(`/api/cases/${caseKey}`), enabled: !!caseKey });
  const [rating, setRating] = useState<number | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [reflection, setReflection] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagText, setFlagText] = useState('');

  const check = useMutation({
    mutationFn: () => api.post(`/api/cases/${caseKey}/signals`, { type: 'self_check', value: rating, contextTags: [], observedAt: new Date().toISOString(), source: 'student_entry', sourceConfidence: 'medium', goalId, note: reflection.trim() || undefined }),
    onSuccess: () => {
      toast.success('Check-in saved. Nice work!', { icon: <PartyPopper className="size-4" /> });
      setRating(null);
      setReflection('');
      qc.invalidateQueries({ queryKey: ['case', caseKey] });
    },
  });
  const flag = useMutation({ mutationFn: () => api.post(`/api/cases/${caseKey}/safety-flags`, { description: flagText }), onSuccess: () => { toast.success('Sent to your teacher.'); setFlagOpen(false); setFlagText(''); } });

  if (cases.isLoading || view.isLoading) return <PageSkeleton />;
  if (!caseKey || !view.data) return <Empty icon={<Sparkles />} title="Nothing here yet" description="Your teacher will set up your goals with you." />;
  const v = view.data;
  const goals = v.goals ?? [];
  const strategies = v.strategies ?? [];
  const latestDecided = (v.reviewCycles ?? []).find((r) => r.narrativeStudent);
  const accomplishments = goals.flatMap((g) => (g.accomplishments ?? []).map((a) => ({ text: a, goal: g.targetBehavior })));
  const recentChecks = (v.signal_selfChecks ?? []).slice(0, 7);
  const yesCount = recentChecks.filter((c) => c.value >= 3).length;
  const activeGoal = goals.length > 1 ? goalId : goals[0]?.id ?? null;
  const firstName = me?.user?.displayName.split(' ')[0] ?? '';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hi {firstName} 👋</h1>
          <p className="mt-1 text-muted">Here are your goals and how it's going.</p>
        </div>
        {recentChecks.length > 0 && (
          <ProgressRing value={(yesCount / Math.max(recentChecks.length, 1)) * 100} size={72} tone="success" label={<span className="text-xs">{yesCount}/{recentChecks.length}</span>} />
        )}
      </div>

      {accomplishments.length > 0 && (
        <Card tone="success">
          <CardBody className="pt-5">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <PartyPopper className="size-5 text-success" /> Nice work
            </div>
            <ul className="mt-2 space-y-1.5 text-base">
              {accomplishments.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-success" />
                  <span>
                    {a.text} <span className="text-muted">· {a.goal}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {latestDecided?.narrativeStudent && (
        <Callout tone="info" title="From your last check-in with your teacher" className="text-base">
          {latestDecided.narrativeStudent}
        </Callout>
      )}

      <Stagger className="space-y-4">
        {goals.map((g) => (
          <StaggerItem key={g.id}>
            <Card>
              <CardBody className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{g.targetBehavior}</h2>
                  <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{g.observableDefinition}</p>
                <div className="mt-2">
                  {g.target?.status === 'proposed' && <Badge tone="info">Aiming for {g.target.value} {g.target.unit}</Badge>}
                  {g.target?.status === 'established' && <Badge tone="primary">Goal: {g.target.value} {g.target.unit}</Badge>}
                  {g.target?.status === 'blocked_on_baseline' && <Badge>Still finding out where you're starting from</Badge>}
                </div>
                {g.progress && (
                  <div className="mt-4">
                    <ProgressChart p={g.progress} height={150} simple />
                  </div>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      {strategies.length > 0 && (
        <Card>
          <CardBody className="pt-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <HeartHandshake className="size-4 text-primary" /> Things that help
            </h2>
            <ul className="mt-2 space-y-2 text-base">
              {strategies.map((s) => (
                <li key={s.id} className="rounded-md bg-sunken/60 p-3">
                  {s.description}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card tone="proposal">
        <CardBody className="pt-5">
          <h2 className="text-lg font-semibold">Today's check-in</h2>
          {goals.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {goals.map((g) => (
                <Button key={g.id} size="sm" variant={goalId === g.id ? 'primary' : 'secondary'} onClick={() => setGoalId(g.id)}>
                  {g.targetBehavior.length > 30 ? g.targetBehavior.slice(0, 28) + '…' : g.targetBehavior}
                </Button>
              ))}
            </div>
          )}
          <p className="mt-3 text-base">How did it go today?</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {RATINGS.map((o) => (
              <motion.button key={o.v} {...tap} onClick={() => setRating(o.v)} aria-pressed={rating === o.v} data-testid={`rating-${o.v}`} className={cn('rounded-2xl border-2 p-4 text-center transition-colors', rating === o.v ? 'border-primary bg-primary-soft' : 'border-border bg-elevated')}>
                <motion.div animate={rating === o.v ? { scale: [1, 1.25, 1] } : { scale: 1 }} transition={spring} className="text-4xl">
                  {o.emoji}
                </motion.div>
                <div className="mt-1 text-base font-semibold">{o.label}</div>
                <div className="text-xs text-muted">{o.hint}</div>
              </motion.button>
            ))}
          </div>
          <Textarea className="mt-3" rows={2} value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="One thing that helped, or one thing that was hard (optional)" />
          <Button size="xl" className="mt-3 w-full" disabled={rating === null || (goals.length > 1 && !activeGoal)} loading={check.isPending} onClick={() => check.mutate()} data-testid="save-checkin">
            Save my check-in
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-5">
          <h2 className="text-[15px] font-semibold">Recent check-ins</h2>
          {recentChecks.length === 0 && <p className="mt-1 text-sm text-muted">None yet — your first one is above.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {recentChecks.map((c) => (
              <Badge key={c.id} tone={c.value >= 3 ? 'success' : c.value === 2 ? 'info' : 'neutral'} className="px-2.5 py-1 text-xs">
                {fmtDate(c.observedAt)} · {RATINGS[c.value - 1]?.emoji} {RATINGS[c.value - 1]?.label ?? c.value}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="pb-6 text-center">
        {flagOpen ? (
          <Card>
            <CardBody className="pt-5">
              <p className="text-sm">If you or someone else is not safe, tell an adult right now. You can also leave a note here for your teacher.</p>
              <Textarea className="mt-3" rows={2} value={flagText} onChange={(e) => setFlagText(e.target.value)} />
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" loading={flag.isPending} onClick={() => flag.mutate()} disabled={flagText.trim().length < 3}>
                  Send to my teacher
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFlagOpen(false)}>
                  Cancel
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <button className="text-sm text-muted underline-offset-2 hover:underline" onClick={() => setFlagOpen(true)}>
            I need help with something
          </button>
        )}
      </div>
    </div>
  );
}
