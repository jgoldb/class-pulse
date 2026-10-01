import { Check } from 'lucide-react';
import { cn } from './ui';
import type { ConfirmStage } from '../lib/pulse';

const STEPS = ['Suggested', 'Confirmed', 'Logged'] as const;

/**
 * Teacher Confirm™, always visible: Suggested → Confirmed → Logged. Off-path states (preparing,
 * failed, discarded, source changed) replace the track with a single labelled pill.
 */
export function TeacherConfirm({ stage, compact, className }: { stage: ConfirmStage; compact?: boolean; className?: string }) {
  if (stage.step === 0) {
    const tone = { neutral: 'bg-sunken text-muted', info: 'bg-info-soft text-info-fg', warning: 'bg-warning-soft text-warning-fg', success: 'bg-success-soft text-success-fg', danger: 'bg-danger-soft text-danger-fg' }[stage.tone];
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone, className)} title={stage.detail}>
        {stage.tone === 'info' && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
        {stage.label}
      </span>
    );
  }
  return (
    <ol className={cn('inline-flex items-center gap-1', className)} aria-label={`Teacher Confirm: ${stage.label}`}>
      {STEPS.map((label, i) => {
        const index = i + 1;
        const done = stage.step > index || (stage.step === 3 && index === 3);
        const current = stage.step === index && index !== 3;
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className={cn('h-px w-3', stage.step >= index ? 'bg-success' : 'bg-border-strong')} />}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full text-[11px] font-semibold',
                compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5',
                done ? 'bg-success-soft text-success-fg' : current ? 'bg-info-soft text-info-fg ring-1 ring-info/40' : 'text-subtle',
              )}
              aria-current={current ? 'step' : undefined}
            >
              {done ? <Check className="size-3" /> : <span className={cn('size-1.5 rounded-full', current ? 'bg-current' : 'bg-border-strong')} />}
              {(!compact || current || (done && index === 3)) && label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Classroom observations are teacher-authored: a tap confirms; "Save for review" leaves it suggested. */
export function ObservationConfirm({ status, className }: { status: string; className?: string }) {
  if (status === 'withdrawn') return <span className={cn('rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted line-through', className)}>Undone</span>;
  if (status === 'pending') return <span className={cn('inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info-fg ring-1 ring-info/40', className)}><span className="size-1.5 rounded-full bg-current" />Suggested · confirm it</span>;
  return <span className={cn('inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-fg', className)}><Check className="size-3" />Confirmed</span>;
}
