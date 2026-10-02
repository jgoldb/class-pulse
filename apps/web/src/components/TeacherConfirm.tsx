import { AlertCircle, Check, CircleDashed, Loader2, Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './ui';
import type { ConfirmKind, ConfirmStage } from '../lib/pulse';

const STEPS = ['Suggested', 'Confirmed', 'Logged'] as const;

/** Each state pairs a colour with an icon and a word, so status never rests on colour alone (§14). */
const PILL: Record<ConfirmKind, { className: string; icon: React.ReactNode }> = {
  suggested: { className: 'bg-ai-soft text-ai-fg ring-1 ring-ai/25', icon: <Sparkles className="size-3" /> },
  needs_review: { className: 'bg-warning-soft text-warning-fg ring-1 ring-warning/30', icon: <AlertCircle className="size-3" /> },
  confirmed: { className: 'bg-success-soft text-success-fg', icon: <Check className="size-3" /> },
  logged: { className: 'bg-success-soft/70 text-success-fg', icon: <Check className="size-3" /> },
  preparing: { className: 'bg-ai-soft text-ai-fg', icon: <Loader2 className="size-3 animate-spin" /> },
  failed: { className: 'bg-sunken text-fg/80 ring-1 ring-border-strong', icon: <AlertCircle className="size-3" /> },
  off: { className: 'bg-sunken text-muted', icon: <CircleDashed className="size-3" /> },
  discarded: { className: 'bg-sunken text-muted line-through', icon: null },
};

/** A single Teacher Confirm state as a chip, with a short, calm change transition. */
export function ConfirmChip({ kind, label, title, className }: { kind: ConfirmKind; label: string; title?: string; className?: string }) {
  const reduce = useReducedMotion();
  const p = PILL[kind];
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={`${kind}:${label}`}
        initial={reduce ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        title={title}
        className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', p.className, className)}
      >
        {p.icon}
        {label}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * Teacher Confirm™, always visible: Suggested → Confirmed → Logged. `compact` shows only the
 * current state as a chip; the full form shows the three-step track so the teacher can see where
 * the item is. Off-path states (preparing, failed, discarded) replace the track with one chip.
 */
export function TeacherConfirm({ stage, compact, className }: { stage: ConfirmStage; compact?: boolean; className?: string }) {
  if (stage.step === 0 || compact) return <ConfirmChip kind={stage.kind} label={stage.label} title={stage.detail} className={className} />;
  const warning = stage.kind === 'needs_review';
  return (
    <ol className={cn('inline-flex items-center gap-1', className)} aria-label={`Teacher Confirm: ${stage.label}`}>
      {STEPS.map((label, i) => {
        const index = i + 1;
        const done = stage.step > index || (stage.step === 3 && index === 3);
        const current = stage.step === index && index !== 3;
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className={cn('h-px w-3', stage.step >= index ? 'bg-success' : 'bg-border-strong')} />}
            {current || (warning && index === stage.step) ? (
              <ConfirmChip kind={warning ? 'needs_review' : 'suggested'} label={warning ? 'Needs review' : label} title={stage.detail} />
            ) : (
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', done ? 'bg-success-soft text-success-fg' : 'text-subtle')}>
                {done ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-border-strong" />}
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Classroom observations are teacher-authored: a tap confirms; "Save for review" leaves it suggested. */
export function ObservationConfirm({ status, className }: { status: string; className?: string }) {
  if (status === 'withdrawn') return <ConfirmChip kind="discarded" label="Undone" className={className} />;
  if (status === 'pending') return <ConfirmChip kind="suggested" label="Suggested · confirm it" className={className} />;
  return <ConfirmChip kind="confirmed" label="Confirmed" className={className} />;
}
