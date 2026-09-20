import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'evidence' | 'hypothesis' | 'proposal' | 'warning' | 'danger' | 'info' | 'success' | 'primary';

const TONE_BORDER: Record<Tone, string> = {
  evidence: 'border-l-[3px] border-l-evidence',
  hypothesis: 'border-l-[3px] border-l-hypothesis',
  proposal: 'border-l-[3px] border-l-proposal',
  warning: 'border-l-[3px] border-l-warning',
  danger: 'border-l-[3px] border-l-danger',
  info: 'border-l-[3px] border-l-info',
  success: 'border-l-[3px] border-l-success',
  primary: 'border-l-[3px] border-l-primary',
};

export function Card({ className, tone, interactive, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-elevated shadow-sm',
        tone && TONE_BORDER[tone],
        interactive && 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-border-strong cursor-pointer',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, title, description, action, eyebrow }: { className?: string; title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold leading-snug text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)} {...props} />;
}
