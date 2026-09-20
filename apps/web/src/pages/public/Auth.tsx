import { SignIn, SignUp } from '@clerk/react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Activity } from 'lucide-react';
import { FadeIn } from '../../components/ui';
import { recallCheckout } from '../../lib/checkout';

function AuthFrame({ children, side }: { children: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-[radial-gradient(ellipse_at_top_left,var(--primary-soft),var(--bg)_60%)] p-10 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
            <Activity className="size-4" />
          </span>
          <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>
        </Link>
        <div className="max-w-md">{side}</div>
        <div className="text-xs text-subtle">Names never reach the model. Every decision stays with a person.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <FadeIn className="w-full max-w-md">
          <Link to="/" className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
              <Activity className="size-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>
          </Link>
          {children}
        </FadeIn>
      </div>
    </div>
  );
}

export function SignInPage() {
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  return (
    <AuthFrame
      side={
        <>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back.</h1>
          <p className="mt-3 text-muted">Sign in with the account your workspace administrator invited. Teachers, support staff, students and families each see only what their role allows.</p>
        </>
      }
    >
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={from} forceRedirectUrl={from} />
    </AuthFrame>
  );
}

export function SignUpPage() {
  const [params] = useSearchParams();
  const invited = params.get('__clerk_ticket') || params.get('__clerk_status');
  // Clerk moves this component through `/sign-up/verify-email-address` with a full page load, so
  // the `?checkout=` we arrived with is gone by the time the redirect target is computed. Fall
  // back to the id the checkout page parked for this tab. An invitation takes precedence: that
  // person is joining an existing workspace, not buying one.
  const checkout = params.get('checkout') ?? (invited ? null : recallCheckout());
  const after = checkout ? `/onboarding?checkout=${encodeURIComponent(checkout)}` : '/';
  return (
    <AuthFrame
      side={
        <>
          <h1 className="text-3xl font-bold tracking-tight">{invited ? 'You have been invited.' : 'Create your account.'}</h1>
          <p className="mt-3 text-muted">
            {invited
              ? 'Your administrator has already set your role and scope. Create your account and you will land in the right place.'
              : checkout
                ? 'Payment is confirmed. Create the administrator account for your new workspace.'
                : 'Class Pulse is invitation-based. If you are starting a new workspace, begin with a plan; otherwise use the link from your administrator.'}
          </p>
          {!invited && !checkout && (
            <Link to="/get-started" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
              Start a workspace →
            </Link>
          )}
        </>
      }
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={after} forceRedirectUrl={after} />
    </AuthFrame>
  );
}
