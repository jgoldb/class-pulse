import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const base = 'w-full rounded-md border border-border bg-elevated px-3 text-sm text-fg placeholder:text-subtle shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn(base, 'h-10', className)} {...props} />);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn(base, 'py-2 leading-relaxed', className)} {...props} />);
Textarea.displayName = 'Textarea';

export function Label({ className, hint, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { hint?: ReactNode }) {
  return (
    <label className={cn('mb-1.5 block text-sm font-medium text-fg', className)} {...props}>
      {children}
      {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-0', className)}>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded border border-border bg-sunken px-1.5 font-mono text-[10px] font-medium text-muted">{children}</kbd>;
}
