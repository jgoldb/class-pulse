import { Link } from 'react-router';
import { ArrowRight, BarChart3, BookOpenCheck, CalendarClock, Check, ClipboardCheck, Hand, HeartHandshake, Lightbulb, MessageCircle, Mic, NotebookPen, ShieldCheck, Sparkles, Star, TriangleAlert, Users } from 'lucide-react';
import { Button, FadeIn, Stagger, StaggerItem, cn } from '../../components/ui';
import { Brand } from '../../components/Brand';

const PRODUCTS = [
  { icon: Users, name: 'Class Pulse™', body: 'A live seating chart for the class in front of you. One tap records participation, praise, understanding or a check-in — no case or plan required.' },
  { icon: ClipboardCheck, name: 'Teacher Confirm™', body: 'Every AI suggestion is visibly Suggested → Confirmed → Logged. Nothing becomes a record until you approve the exact version.' },
  { icon: Sparkles, name: 'Pulsera Guide™', body: 'Contextual help on the evidence you are looking at: explain it, suggest an adjustment, draft a next step. Never a shortcut around approval.' },
  { icon: CalendarClock, name: 'Tomorrow Ready™', body: 'Today’s confirmed observations become tomorrow’s Do Now, reteach, small groups, family drafts and reminders — prepared for your review.' },
  { icon: HeartHandshake, name: 'Family Pulse™', body: 'Families see goals and growth, share what works at home, and get a response. Their input stays theirs, clearly attributed.' },
  { icon: Star, name: 'My Pulse™', body: 'Students see strengths first, their goals and progress, and help choose the strategies that work for them.' },
  { icon: BookOpenCheck, name: 'Pulsera Reports™', body: 'ABC, SST, MTSS and FBA-support evidence packets built from what you already recorded. Generate, review, edit, approve, export.' },
  { icon: BarChart3, name: 'Pulsera Insights™', body: 'School-wide participation, follow-up and documentation trends, suppressed for privacy. Support for educators, never surveillance.' },
];

const LOOP = ['Class', 'Student', 'Classroom event', 'Teacher Confirm', 'AI draft', 'Teacher approval', 'History · Instruction · Family · Tomorrow', 'Observe outcomes'];

const SEATS = [
  ['Avery S.', [['hand', 2], ['star', 1]]], ['Blake F.', [['bulb', 1]]], ['Casey S.', []], ['Devon D.', [['hand', 1]]],
  ['Emery P.', [['chat', 1]]], ['Finley E.', [['hand', 3], ['star', 1]]], ['Harper M.', []], ['Indigo T.', [['bulb', 1], ['hand', 1]]],
] as const;
const CHIP = { hand: [Hand, 'bg-primary-soft text-primary-soft-fg'], star: [Star, 'bg-warning-soft text-warning-fg'], bulb: [Lightbulb, 'bg-info-soft text-info-fg'], chat: [MessageCircle, 'bg-proposal-soft text-proposal'] } as const;

/** A static, synthetic preview of Class Pulse for the hero. */
function ClassPreview() {
  return (
    <div className="relative rounded-2xl border border-border bg-elevated p-4 shadow-lg">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>
        <span className="font-semibold">Period 3 · Equivalent fractions</span>
        <span className="ml-auto text-muted">9/14 observed</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {SEATS.map(([name, chips], i) => (
          <div key={name} className={cn('rounded-lg border p-1.5 text-[10px]', i === 5 ? 'border-primary ring-2 ring-primary/25' : 'border-border')}>
            <div className="truncate font-semibold">{name}</div>
            <div className="mt-1 flex min-h-4 flex-wrap gap-0.5">
              {chips.map(([kind, n]) => { const [Icon, tone] = CHIP[kind]; return <span key={kind} className={cn('inline-flex items-center gap-0.5 rounded px-1 font-semibold', tone)}><Icon className="size-2.5" />{n}</span>; })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-[10px] font-semibold">
        {[[Hand, 'Participation'], [Star, 'Praise'], [Lightbulb, 'Understanding'], [MessageCircle, 'Check-in'], [TriangleAlert, 'Behavior'], [NotebookPen, 'Note'], [Mic, 'Voice']].map(([Icon, label]) => {
          const I = Icon as typeof Hand;
          return <div key={label as string} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-1"><I className="size-3 text-muted" /><span className="truncate">{label as string}</span></div>;
        })}
      </div>
      <div className="absolute -bottom-16 -right-3 hidden w-64 rounded-xl border border-border bg-elevated p-3 text-xs shadow-lg sm:block">
        <div className="flex items-center gap-1.5 font-semibold"><Sparkles className="size-3.5 text-proposal" />Positive note · Finley</div>
        <p className="mt-1 text-muted">“Explained their reasoning to a partner during practice…”</p>
        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold"><span className="rounded-full bg-info-soft px-1.5 py-0.5 text-info-fg">Suggested</span><span className="text-subtle">→ Confirmed → Logged</span></div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-2">
            <Link to="/sign-in"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/get-started"><Button>Get started <ArrowRight /></Button></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklch,var(--brand-blue)_16%,transparent),transparent_55%),radial-gradient(ellipse_at_top_right,color-mix(in_oklch,var(--brand-violet)_12%,transparent),transparent_50%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <FadeIn>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1 text-xs font-medium text-muted shadow-sm">
                <span className="size-1.5 rounded-full bg-brand" /> The AI classroom operating system
              </span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">Teach naturally. <span className="text-brand">Leave class ready for tomorrow.</span></h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mt-5 max-w-xl text-lg text-muted">
                Pulsera works during instruction. Tap what you notice, and it drafts the documentation, the next instructional step, the family note and tomorrow’s Do Now — for you to approve. Nothing becomes a permanent record until you do.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/get-started"><Button size="lg">Start a workspace <ArrowRight /></Button></Link>
                <Link to="/sign-in"><Button size="lg" variant="secondary">I have an invitation</Button></Link>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.1}><ClassPreview /></FadeIn>
        </div>
      </section>

      <section className="border-y border-border bg-elevated">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-subtle">The Pulsera loop</h2>
          <ol className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-sm">
            {LOOP.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className={cn('rounded-full border px-3 py-1.5 font-medium', step === 'Teacher Confirm' || step === 'Teacher approval' ? 'border-primary/40 bg-primary-soft text-primary-soft-fg' : 'border-border bg-bg')}>{step}</span>
                {i < LOOP.length - 1 && <ArrowRight className="size-3.5 text-subtle" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">One platform, built around the class</h2>
        <p className="mt-2 max-w-2xl text-muted">The classroom is the primary object. Support plans, reports and family collaboration grow out of what happens during instruction instead of being recreated after school.</p>
        <Stagger className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((p) => (
            <StaggerItem key={p.name}>
              <div className="h-full rounded-xl border border-border bg-elevated p-5 shadow-sm">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand text-white"><p.icon className="size-4" /></span>
                <h3 className="mt-3 text-[15px] font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted">{p.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="border-t border-border bg-elevated">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ShieldCheck className="size-6 text-primary" />Trust is the product</h2>
            <ul className="mt-5 space-y-2.5 text-sm text-muted">
              {['Teacher approval before anything becomes a permanent record.', 'Source evidence and version history on every draft.', 'Teacher, student and family contributions kept separate and attributed.', 'Names and identifiers never reach the model; every outbound call is logged.', 'Voice stays off until your school approves an audio provider.'].map((t) => (
                <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-bg p-5 text-sm text-muted shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">What Pulsera will never do</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Diagnose, or infer a disability, condition, or family circumstance</li>
              <li>Make a special-education, behavioral, discipline or placement determination</li>
              <li>Record continuously or identify speakers automatically</li>
              <li>Approve anything on its own</li>
            </ul>
          </div>
        </div>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-8 text-xs text-subtle sm:px-6"><Brand className="opacity-80" /><span>Class Pulse™ · Teacher Confirm™ · Tomorrow Ready™ · Family Pulse™ · My Pulse™ are Pulsera products.</span></footer>
    </div>
  );
}
