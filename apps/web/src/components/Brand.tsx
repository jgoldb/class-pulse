import { cn } from './ui';

/** The Pulsera mark: a pulse line on the blue → teal → violet brand gradient. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-sm', className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-[58%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" />
      </svg>
    </span>
  );
}

export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      {!compact && <span className="text-[15px] font-bold tracking-tight">Pulsera</span>}
    </span>
  );
}

/**
 * Clerk renders its application name ("Class Pulse" in the dashboard) in a few headings. The
 * product is Pulsera, so those strings are set here rather than depending on a dashboard setting.
 */
export const clerkLocalization = {
  signIn: {
    start: { title: 'Sign in to Pulsera', titleCombined: 'Continue to Pulsera', subtitle: 'Welcome back. Sign in to continue.', subtitleCombined: 'Welcome back. Sign in to continue.' },
    emailCode: { subtitle: 'to continue to Pulsera' },
    emailCodeMfa: { subtitle: 'to continue to Pulsera' },
    emailLink: { subtitle: 'to continue to Pulsera' },
    phoneCode: { subtitle: 'to continue to Pulsera' },
    phoneCodeMfa: { subtitle: 'to continue to Pulsera' },
  },
  signUp: {
    start: { title: 'Create your Pulsera account', titleCombined: 'Create your Pulsera account', subtitle: 'Welcome. Fill in your details to get started.', subtitleCombined: 'Welcome. Fill in your details to get started.' },
    emailCode: { subtitle: 'to continue to Pulsera' },
    emailLink: { subtitle: 'to continue to Pulsera' },
    phoneCode: { subtitle: 'to continue to Pulsera' },
  },
};
