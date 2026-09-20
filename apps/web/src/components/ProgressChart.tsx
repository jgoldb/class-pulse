import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, ObsCount } from './ui';
import type { ProgressSeries } from '../lib/types';

/**
 * docs/05: everywhere data is charted, render confidence alongside it — observation counts next
 * to every figure, distinct styling for pre-baseline states, explicit proposed vs. established
 * target markers. Three observations must not look like a trend.
 */
export function ProgressChart({ p, height = 220, simple }: { p: ProgressSeries; height?: number; simple?: boolean }) {
  const data = p.points.map((pt) => ({ ...pt, label: new Date(pt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  const baseline = p.baseline.status === 'available' ? p.baseline.value : null;
  const target = p.target.status !== 'blocked_on_baseline' ? p.target.value : null;
  const thin = p.totalObservations < 5;
  const tooltipFormatter = (v: unknown, _n: unknown, item: { payload?: { observations?: number } }) => [`${v} ${p.unit} · n=${item?.payload?.observations ?? '?'}`, p.targetBehavior];
  const stroke = p.preBaseline ? 'var(--fg-subtle)' : 'var(--primary)';
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ObsCount n={p.totalObservations} />
        {p.preBaseline && <Badge tone="warning">Pre-baseline</Badge>}
        {thin && <Badge tone="outline">Too few points for a trend</Badge>}
        {baseline !== null && <Badge tone="success">Baseline band</Badge>}
        {target !== null && <Badge tone={p.target.status === 'established' ? 'primary' : 'info'}>{p.target.status === 'established' ? 'Target' : 'Proposed target'}</Badge>}
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border-strong/60 text-xs text-muted" style={{ height: height * 0.6 }}>
          No entries yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${p.goalId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--fg-subtle)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--fg-subtle)' }} allowDecimals={false} axisLine={false} tickLine={false} />
            {!simple && <Tooltip formatter={tooltipFormatter as never} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: 12, color: 'var(--fg)' }} />}
            {baseline !== null && <ReferenceArea y1={baseline * 0.9} y2={baseline * 1.1} fill="var(--success)" fillOpacity={0.08} />}
            {baseline !== null && <ReferenceLine y={baseline} stroke="var(--success)" strokeDasharray="4 3" label={{ value: 'baseline', fontSize: 10, fill: 'var(--success)', position: 'insideTopLeft' }} />}
            {target !== null && (
              <ReferenceLine y={target} stroke={p.target.status === 'established' ? 'var(--primary)' : 'var(--info)'} strokeDasharray={p.target.status === 'established' ? undefined : '2 6'} label={{ value: p.target.status === 'established' ? 'target' : 'proposed', fontSize: 10, fill: 'var(--info)', position: 'insideTopRight' }} />
            )}
            <Area type="monotone" dataKey="value" stroke="none" fill={`url(#fill-${p.goalId})`} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke={stroke} strokeWidth={2} strokeDasharray={p.preBaseline ? '5 4' : undefined} dot={{ r: 3, fill: 'var(--bg-elevated)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
