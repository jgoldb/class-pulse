import type { PlanContent } from '@class-pulse/domain';
import { PLAN_SECTIONS } from '@class-pulse/domain';
import { Badge, cn } from './ui';
import { humanize } from '../lib/api';
import { BaselineBadge, TargetBadge } from './GoalCard';

type Section = (typeof PLAN_SECTIONS)[number];

const list = (items: string[], compact?: boolean) => (
  <ul className={cn('list-disc space-y-1 pl-5 text-sm', compact && 'space-y-0.5')}>
    {items.map((s, i) => (
      <li key={i}>{s}</li>
    ))}
  </ul>
);

/** Render prose *from* the structure (docs/03), never the reverse. */
export function SectionBody({ section, content, compact }: { section: Section; content: PlanContent; compact?: boolean }) {
  const value = content[section.key] as unknown;
  const empty = Array.isArray(value) && value.length === 0;
  if (empty) return <p className="text-sm italic text-subtle">Nothing documented for this section.</p>;
  switch (section.key) {
    case 'behavioralConcern':
      return <p className="text-sm leading-relaxed">{value as string}</p>;
    case 'studentStrengths':
    case 'documentedPatterns':
    case 'missingInformation':
      return list(value as string[], compact);
    case 'hypothesesToMonitor':
      return (
        <ul className="space-y-2 text-sm">
          {content.hypothesesToMonitor.map((h, i) => (
            <li key={i} className="rounded-md border border-border bg-sunken/40 p-3">
              <div className="flex items-start gap-2">
                <Badge tone="hypothesis">Hypothesis</Badge>
                <span>{h.hypothesis}</span>
              </div>
              <div className="mt-1.5 text-muted">
                <span className="font-medium text-fg">Observe:</span> {h.whatToObserve}
              </div>
            </li>
          ))}
        </ul>
      );
    case 'measurableGoals':
      return (
        <ol className="space-y-2 text-sm">
          {content.measurableGoals.map((g, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {i + 1}. {g.targetBehavior}
                </span>
                <Badge>{humanize(g.measurementMethod)}</Badge>
                <Badge>{g.direction}</Badge>
              </div>
              <p className="mt-1 text-muted">{g.observableDefinition}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <BaselineBadge baseline={g.baseline} />
                <TargetBadge target={g.target} />
                <Badge>Review every {g.reviewPeriodDays} days</Badge>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'replacementBehaviors':
      return (
        <ul className="space-y-2 text-sm">
          {content.replacementBehaviors.map((r, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <div className="font-medium">{r.behavior}</div>
              <div className="mt-1 text-muted">
                <span className="font-medium text-fg">Replaces:</span> {r.replaces}
              </div>
              <div className="text-muted">
                <span className="font-medium text-fg">How to teach:</span> {r.howToTeach}
              </div>
            </li>
          ))}
        </ul>
      );
    case 'preventiveStrategies':
    case 'teacherResponseStrategies':
    case 'studentSelfMonitoring':
    case 'parentGuardianSupport':
      return (
        <ul className="space-y-2 text-sm">
          {(value as PlanContent['preventiveStrategies']).map((s, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.description}</span>
                <Badge tone={s.effortLevel === 'high' ? 'warning' : 'neutral'}>{s.effortLevel} effort</Badge>
              </div>
              <div className="mt-1 text-muted">{s.rationale}</div>
              {s.usesStrengths.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.usesStrengths.map((u) => (
                    <Badge key={u} tone="success">
                      uses: {u}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      );
    case 'progressMonitoring':
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-sunken/60 text-left text-[11px] uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Frequency</th>
                <th className="px-3 py-2 text-right">Min/day</th>
              </tr>
            </thead>
            <tbody>
              {content.progressMonitoring.map((m, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">{m.what}</td>
                  <td className="px-3 py-2 text-muted">{m.method}</td>
                  <td className="px-3 py-2 text-muted">{m.frequency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.estimatedMinutesPerDay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'dashboardRecommendations':
    case 'informationNotToDisplay':
      return (
        <ul className="space-y-1.5 text-sm">
          {(value as Array<{ audience: string; include?: string[]; exclude?: string[] }>).map((d, i) => (
            <li key={i} className="flex gap-2">
              <Badge className="mt-0.5 shrink-0">{humanize(d.audience)}</Badge>
              <span className="text-muted">{(d.include ?? d.exclude ?? []).join('; ')}</span>
            </li>
          ))}
        </ul>
      );
    case 'reviewCriteria':
      return (
        <ul className="space-y-1.5 text-sm">
          {content.reviewCriteria.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{humanize(c.decision)}</Badge>
              <span>{c.description}</span>
              <span className="font-mono text-[11px] text-subtle">
                {c.metric} {c.comparator} {c.value ?? ''} · {c.windowDays}d · n≥{c.minObservations}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'privacyAndHumanReviewNotes': {
      const n = content.privacyAndHumanReviewNotes;
      return (
        <div className="space-y-3 text-sm">
          {n.safetyConcern && (
            <div className="rounded-md bg-danger-soft p-3 text-danger-fg">
              <span className="font-semibold">Safety concern: </span>
              {n.safetyNote}
            </div>
          )}
          {n.outOfScopeRequestNoted && <div className="rounded-md bg-warning-soft p-3 text-warning-fg">{n.outOfScopeRequestNoted}</div>}
          <div>
            <div className="mb-1 font-medium">Privacy</div>
            {list(n.privacyNotes)}
          </div>
          <div>
            <div className="mb-1 font-medium">Human review required</div>
            {list(n.humanReviewRequired)}
          </div>
        </div>
      );
    }
    default:
      return <pre className="text-xs">{JSON.stringify(value, null, 2)}</pre>;
  }
}

export function PlanSections({ content, only, compact }: { content: PlanContent; only?: Array<keyof PlanContent>; compact?: boolean }) {
  const sections = only ? PLAN_SECTIONS.filter((s) => only.includes(s.key)) : PLAN_SECTIONS;
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.key} className="break-inside-avoid">
          <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            <span className="flex size-5 items-center justify-center rounded bg-sunken font-mono text-[10px] text-muted">{s.number}</span>
            {s.title}
          </h3>
          <SectionBody section={s} content={content} compact={compact} />
        </section>
      ))}
    </div>
  );
}
