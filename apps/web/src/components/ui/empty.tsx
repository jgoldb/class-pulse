import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Empty({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong/70 bg-sunken/40 text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-elevated text-muted shadow-sm [&_svg]:size-5">{icon}</div>}
      <div className="text-sm font-semibold text-fg">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children, icon, className, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'primary'; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string; action?: ReactNode }) {
  const t = {
    info: 'bg-info-soft text-info-fg border-info/20',
    warning: 'bg-warning-soft text-warning-fg border-warning/25',
    danger: 'bg-danger-soft text-danger-fg border-danger/25',
    success: 'bg-success-soft text-success-fg border-success/25',
    primary: 'bg-primary-soft text-primary-soft-fg border-primary/25',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm', t, className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info'; className?: string }) {
  const v = tone ? { success: 'text-success-fg', warning: 'text-warning-fg', danger: 'text-danger-fg', info: 'text-info-fg' }[tone] : 'text-fg';
  return (
    <div className={cn('rounded-lg border border-border bg-elevated px-4 py-3 shadow-sm', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', v)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Observation count rendered next to every figure (docs/05: render confidence alongside data). */
export function ObsCount({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-muted', className)} title="Observations behind this figure">
      n={n}
    </span>
  );
}
