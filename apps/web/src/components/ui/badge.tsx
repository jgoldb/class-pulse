import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap [&_svg]:size-3', {
  variants: {
    tone: {
      neutral: 'bg-sunken text-muted border border-border',
      primary: 'bg-primary-soft text-primary-soft-fg',
      success: 'bg-success-soft text-success-fg',
      warning: 'bg-warning-soft text-warning-fg',
      danger: 'bg-danger-soft text-danger-fg',
      info: 'bg-info-soft text-info-fg',
      evidence: 'bg-evidence-soft text-evidence',
      hypothesis: 'bg-hypothesis-soft text-hypothesis',
      proposal: 'bg-proposal-soft text-proposal',
      outline: 'border border-dashed border-border-strong text-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, dot, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {props.children}
    </span>
  );
}
