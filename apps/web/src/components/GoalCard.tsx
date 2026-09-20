import type { Baseline, GoalTarget } from '@class-pulse/domain';
import { Badge } from './ui';

/** docs/01: each Baseline state renders differently; `ambiguous` gets its own affordance. */
export function BaselineBadge({ baseline, status }: { baseline?: Baseline; status?: string }) {
  const s = baseline?.status ?? status;
  if (s === 'available' && baseline?.status === 'available')
    return (
      <Badge tone="success">
        Baseline {baseline.value} {baseline.unit} <span className="opacity-70">· n={baseline.observations}</span>
      </Badge>
    );
  if (s === 'ambiguous') return <Badge tone="warning">Baseline ambiguous</Badge>;
  return <Badge tone="neutral">No baseline yet</Badge>;
}

export function BaselineDetail({ baseline }: { baseline: Baseline }) {
  if (baseline.status === 'ambiguous')
    return (
      <div className="rounded-md bg-warning-soft p-3 text-xs text-warning-fg">
        <div className="font-semibold">Why this baseline can't be used yet</div>
        <div className="mt-0.5">{baseline.whyAmbiguous}</div>
        <div className="mt-1.5 italic opacity-80">Reported: "{baseline.rawInput}"</div>
        {baseline.candidateBehaviors.length > 0 && <div className="mt-1">Could refer to: {baseline.candidateBehaviors.join(' / ')}</div>}
      </div>
    );
  if (baseline.status === 'unavailable') return <div className="rounded-md bg-sunken p-3 text-xs text-muted">{baseline.reason}</div>;
  return null;
}

/** A proposed target is visually and structurally distinct from an established one (docs/01). */
export function TargetBadge({ target }: { target?: GoalTarget }) {
  if (!target) return null;
  if (target.status === 'established')
    return (
      <Badge tone="primary">
        Target {target.value} {target.unit} · established
      </Badge>
    );
  if (target.status === 'proposed')
    return (
      <Badge tone="info" className="border border-dashed border-info/50">
        Proposed {target.value} {target.unit}
      </Badge>
    );
  return <Badge tone="outline">Target waits for a baseline</Badge>;
}
