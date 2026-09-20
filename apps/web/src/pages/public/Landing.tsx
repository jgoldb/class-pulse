import { Link } from 'react-router';
import { Activity, ArrowRight, Eye, ScanSearch, ShieldCheck, Sparkles, Timer, UserCheck } from 'lucide-react';
import { Button, FadeIn, Stagger, StaggerItem, cn } from '../../components/ui';

const PRINCIPLES = [
  { icon: UserCheck, title: 'Humans decide. Always.', body: 'The model drafts and proposes. Every plan, goal and strategy is approved by a named educator before it exists.' },
  { icon: ScanSearch, title: 'Detection is deterministic', body: 'Patterns are found by auditable rules over logged data. "Rule X fired on these 14 data points" is always the answer to "why was my student flagged?"' },
  { icon: Eye, title: 'Uncertainty is shown, not hidden', body: 'An unavailable baseline renders as an unavailable baseline. Three observations never look like a trend.' },
  { icon: ShieldCheck, title: 'Privacy is infrastructure', body: 'Names never reach the model. An egress gate strips and blocks identifiers, and every outbound call is logged.' },
  { icon: Timer, title: 'Built for a teacher\'s 15 seconds', body: 'Quick entry is a phone-first tap counter with context chips. If logging costs typing, it does not happen.' },
  { icon: Sparkles, title: 'Evidence first, hypothesis second', body: 'Every pattern card leads with the data, labels the hypothesis, and lists what would confirm each idea.' },
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
              <Activity className="size-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/sign-in">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link to="/get-started">
              <Button>
                Get started <ArrowRight />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--primary-soft),transparent_60%)]" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1 text-xs font-medium text-muted shadow-sm">
              <span className="size-1.5 rounded-full bg-success" /> Behavior support that shows its work
            </span>
          </FadeIn>
          <FadeIn delay={0.05}>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
              Notice what a busy teacher would miss. <span className="text-primary">Then ask, don't tell.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              A teacher submits de-identified observations. An AI drafts a structured behavior-support plan. A named educator approves it. Deterministic rules watch the logged data for
              patterns worth a human's attention, and every decision stays with people.
            </p>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/get-started">
                <Button size="lg">
                  Start a workspace <ArrowRight />
                </Button>
              </Link>
              <Link to="/sign-in">
                <Button size="lg" variant="secondary">
                  I have an invitation
                </Button>
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <StaggerItem key={p.title}>
              <div className={cn('h-full rounded-lg border border-border bg-elevated p-5 shadow-sm')}>
                <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg">
                  <p.icon className="size-4" />
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-muted">{p.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="border-t border-border bg-elevated">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">The core loop</h2>
            <ol className="mt-5 space-y-3 text-sm">
              {['Intake: seven de-identified fields, scanned for identifiers as you type.', 'Draft: the model returns a structured 16-section plan that passes deterministic guardrails.', 'Approval: section by section, edited by you; the diff is stored.', 'Logging: tap counters with context chips, under fifteen seconds.', 'Patterns: rules detect, the model interprets, you adjudicate.', 'Review: computed from your data; you make the call.'].map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-fg">{i + 1}</span>
                  <span className="text-muted">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-border bg-bg p-5 text-sm text-muted shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">What Class Pulse will never do</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Diagnose, or infer a disability, condition, or family circumstance</li>
              <li>Recommend discipline or placement</li>
              <li>Send a student's name, id or date of birth to a model</li>
              <li>Approve anything on its own</li>
            </ul>
          </div>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-subtle sm:px-6">Class Pulse · A role-scoped behavior-support planner with a deterministic pattern engine.</footer>
    </div>
  );
}
