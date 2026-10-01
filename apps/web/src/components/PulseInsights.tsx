import { useQuery } from '@tanstack/react-query';
import { BarChart3, BookOpenCheck, ClipboardList, Hand, Lightbulb, MessageCircle, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Callout, Card, CardBody, PageSkeleton, cn } from './ui';

type Cell = { key: string; count: number | null; suppressed: boolean; reason: string | null };
type Cells = { cells: Cell[]; total: number | null };
type Week = { weekStart: string; observed: number | null; total: number | null; suppressed: boolean };
type Insights = { windowDays: number; minCellSize: number; participation: Cells; participationTrend: Week[]; checkIns: Cells; instruction: Cells; followUps: Cells; documentation: Cells };

const TONES = ['bg-primary', 'bg-info', 'bg-proposal', 'bg-warning', 'bg-subtle'];

/** One proportional bar per view. Withheld cells are shown as withheld, never estimated. */
function Breakdown({ group, tones = TONES }: { group: Cells; tones?: string[] }) {
  const known = group.cells.filter((c) => !c.suppressed && c.count !== null);
  const total = group.total ?? known.reduce((n, c) => n + (c.count ?? 0), 0);
  if (!group.cells.length) return <p className="text-sm text-muted">No enabled classroom data yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-sunken" role="img" aria-label={group.cells.map((c) => `${c.key}: ${c.suppressed ? 'withheld' : c.count}`).join('; ')}>
        {group.total ? group.cells.map((c, i) => c.suppressed || !c.count ? null : <div key={c.key} className={tones[i % tones.length]} style={{ width: `${(c.count / total) * 100}%` }} />) : null}
        {group.total && group.cells.some((c) => c.suppressed) && <div className="flex-1 bg-[repeating-linear-gradient(135deg,var(--border)_0_4px,transparent_4px_8px)]" />}
      </div>
      <ul className="space-y-1 text-sm">
        {group.cells.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-sm', c.suppressed ? 'bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_2px,transparent_2px_4px)]' : tones[i % tones.length])} />
            <span className="flex-1">{c.key}</span>
            <span className="tabular-nums text-muted">{c.suppressed ? 'Withheld' : c.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function View({ icon, title, question, children }: { icon: React.ReactNode; title: string; question: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="space-y-3 pt-5">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-4">{icon}</span>
          <div><h3 className="text-[15px] font-semibold leading-tight">{title}</h3><p className="text-xs text-muted">{question}</p></div>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

/**
 * Pulsera Insights™: school-wide classroom trends for administrators. Learners are counted once,
 * cells under the minimum size and their complements are withheld, and there is no drill-down to
 * a class, teacher or student. Coverage of observation, never a rating of anyone.
 */
export function PulseInsights() {
  const q = useQuery({ queryKey: ['pulse-insights'], queryFn: () => api.get<Insights>('/api/pulse/insights') });
  if (q.error) return <p role="alert">{q.error.message}</p>;
  if (!q.data) return <PageSkeleton />;
  const d = q.data;
  const maxWeek = Math.max(1, ...d.participationTrend.map((w) => w.total ?? 0));
  return (
    <section className="space-y-4">
      <Callout tone="primary" icon={<ShieldCheck />} title="Support for educators, not surveillance">
        Each view counts current learners once across the enabled schools you administer, over the last {d.windowDays} days. These are observation-coverage and workflow measures. They are not ratings of learners, teachers or classes, and a missing observation is not evidence of anything. Cells under {d.minCellSize} learners, and any cell that would reveal one, are withheld.
      </Callout>
      <div className="grid gap-4 lg:grid-cols-2">
        <View icon={<Hand />} title="Participation patterns" question="How many learners had participation recorded, and how coverage moved week to week.">
          <Breakdown group={d.participation} />
          <div className="mt-2 flex h-24 items-end gap-2" aria-label="Weekly participation coverage">
            {d.participationTrend.map((w) => (
              <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
                <div className="relative flex w-full flex-1 items-end rounded-md bg-sunken">
                  {w.suppressed ? <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-border-strong bg-[repeating-linear-gradient(135deg,var(--border)_0_4px,transparent_4px_8px)] text-[10px] font-medium text-muted" title="Withheld">Withheld</div> : <div className="w-full rounded-md bg-primary" style={{ height: `${((w.observed ?? 0) / maxWeek) * 100}%` }} title={`${w.observed} of ${w.total}`} />}
                </div>
                <span className="text-[10px] text-muted">{new Date(`${w.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </View>
        <View icon={<MessageCircle />} title="Students who may need a check-in" question="Learners with and without a recorded teacher check-in. Use it to plan support, not to judge.">
          <Breakdown group={d.checkIns} tones={['bg-proposal', 'bg-subtle']} />
        </View>
        <View icon={<ClipboardList />} title="Intervention follow-up needs" question="Approved follow-ups that are due, open or done.">
          <Breakdown group={d.followUps} tones={['bg-warning', 'bg-info', 'bg-success', 'bg-subtle']} />
        </View>
        <View icon={<BookOpenCheck />} title="Documentation completion" question="Evidence packets approved, waiting for review, or not yet prepared.">
          <Breakdown group={d.documentation} tones={['bg-success', 'bg-warning', 'bg-subtle']} />
        </View>
        <View icon={<Lightbulb />} title="School-wide instructional insights" question="The latest recorded understanding check per learner. Checks cover different concepts and do not establish overall mastery.">
          <Breakdown group={d.instruction} tones={['bg-success', 'bg-warning', 'bg-info', 'bg-subtle']} />
        </View>
        <Card><CardBody className="flex h-full flex-col justify-center gap-2 pt-5 text-sm text-muted"><BarChart3 className="size-5 text-primary" /><p>Corrected, withdrawn, expired and superseded evidence is excluded. There is no drill-down to a class, teacher or learner, by design.</p></CardBody></Card>
      </div>
    </section>
  );
}
