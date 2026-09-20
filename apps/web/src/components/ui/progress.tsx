import * as ProgressPrimitive from '@radix-ui/react-progress';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const v = Math.max(0, Math.min(100, value));
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <ProgressPrimitive.Root value={v} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-sunken', className)}>
      <motion.div className={cn('h-full rounded-full', bar)} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
    </ProgressPrimitive.Root>
  );
}

/** Circular progress used on the student surface. */
export function ProgressRing({ value, size = 64, stroke = 7, label, tone = 'primary' }: { value: number; size?: number; stroke?: number; label?: React.ReactNode; tone?: 'primary' | 'success' | 'warning' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = { primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)' }[tone];
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--bg-sunken)" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * v) / 100 }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
      </svg>
      {label && <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{label}</div>}
    </div>
  );
}
