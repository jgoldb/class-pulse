import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth as useClerkAuth } from '@clerk/react';
import { Activity, Check, CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { ApiError, api, money } from '../../lib/api';
import { rememberCheckout } from '../../lib/checkout';
import { Badge, Button, Callout, Card, CardBody, FadeIn, Field, Input, Stagger, StaggerItem, cn } from '../../components/ui';

interface Plan {
  id: string;
  name: string;
  seats: number;
  monthlyCents: number;
  blurb: string;
}

function Frame({ children, step }: { children: React.ReactNode; step: 1 | 2 | 3 }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
              <Activity className="size-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>
          </Link>
          <ol className="flex items-center gap-2 text-xs text-muted">
            {['Plan', 'Payment', 'Workspace'].map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className={cn('flex size-5 items-center justify-center rounded-full text-[10px] font-bold', i + 1 < step ? 'bg-success text-white' : i + 1 === step ? 'bg-primary text-primary-fg' : 'bg-sunken text-subtle')}>{i + 1 < step ? <Check className="size-3" /> : i + 1}</span>
                <span className={cn(i + 1 === step && 'font-semibold text-fg')}>{label}</span>
                {i < 2 && <span className="mx-1 h-px w-6 bg-border" />}
              </li>
            ))}
          </ol>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}

export function GetStarted() {
  const nav = useNavigate();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/api/signup/plans') });
  const [selected, setSelected] = useState<string>('school');
  const checkout = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/signup/checkout', { plan: selected }),
    onSuccess: (r) => nav(`/checkout/${r.id}`),
  });
  return (
    <Frame step={1}>
      <FadeIn>
        <h1 className="text-3xl font-bold tracking-tight">Choose a plan</h1>
        <p className="mt-2 max-w-xl text-muted">Every plan includes the full product: intake, AI drafting with guardrails, approval workflow, quick entry, the pattern engine, every role surface, and audit. Plans differ in seats and scope.</p>
      </FadeIn>
      <Stagger className="mt-8 grid gap-4 md:grid-cols-3">
        {(plans.data ?? []).map((p) => (
          <StaggerItem key={p.id}>
            <button onClick={() => setSelected(p.id)} className={cn('h-full w-full rounded-xl border-2 bg-elevated p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md', selected === p.id ? 'border-primary' : 'border-border')} aria-pressed={selected === p.id}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{p.name}</span>
                {p.id === 'school' && <Badge tone="primary">Most common</Badge>}
              </div>
              <div className="mt-3 text-3xl font-bold tracking-tight">
                {money(p.monthlyCents)}
                <span className="text-sm font-normal text-muted"> / month</span>
              </div>
              <div className="mt-1 text-sm text-muted">{p.blurb}</div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {[`${p.seats} educator seats`, 'Free, unlimited student and family accounts', 'AI drafting with guardrails and evals', 'Pattern engine and equity monitoring'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-muted">
                    <Check className="size-4 text-success" /> {f}
                  </li>
                ))}
              </ul>
            </button>
          </StaggerItem>
        ))}
      </Stagger>
      <div className="mt-8 flex items-center justify-between">
        <span className="text-xs text-subtle">30-day free trial on every plan. Cancel any time.</span>
        <Button size="lg" loading={checkout.isPending} onClick={() => checkout.mutate()}>
          Continue to payment
        </Button>
      </div>
    </Frame>
  );
}

/**
 * The simulated payment page. This is the one stand-in in the product: it plays the part of
 * Stripe Checkout until Stripe is wired, and says so on screen. Nothing here touches a real card.
 */
export function CheckoutPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const clerk = useClerkAuth();
  const session = useQuery({ queryKey: ['checkout', id], queryFn: () => api.get<{ id: string; planName: string; seats: number; amountCents: number; status: string }>(`/api/signup/checkout/${id}`) });
  const [form, setForm] = useState({ cardholder: '', number: '4242 4242 4242 4242', exp: '12 / 30', cvc: '123' });
  const pay = useMutation({
    mutationFn: () => api.post(`/api/signup/checkout/${id}/pay`, { cardholder: form.cardholder, last4: form.number.replace(/\s/g, '').slice(-4) }),
    onSuccess: () => {
      // Clerk's own navigation drops the query string; keep the id for the rest of the flow.
      rememberCheckout(id);
      nav(clerk.isSignedIn ? `/onboarding?checkout=${id}` : `/sign-up?checkout=${id}`);
    },
  });
  const err = pay.error as ApiError | null;
  const s = session.data;
  return (
    <Frame step={2}>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <FadeIn>
          <Card>
            <CardBody className="pt-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="size-4 text-muted" /> Payment details
              </div>
              <Callout tone="warning" className="mt-3" icon={<Lock />} title="Simulated checkout">
                This page stands in for Stripe Checkout during development. No card is charged and nothing is sent to a payment processor. Any card number works.
              </Callout>
              <form
                className="mt-5 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  pay.mutate();
                }}
              >
                <Field label="Name on card">
                  <Input value={form.cardholder} onChange={(e) => setForm({ ...form, cardholder: e.target.value })} required autoComplete="cc-name" data-testid="cardholder" />
                </Field>
                <Field label="Card number">
                  <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} inputMode="numeric" autoComplete="cc-number" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Expiry">
                    <Input value={form.exp} onChange={(e) => setForm({ ...form, exp: e.target.value })} />
                  </Field>
                  <Field label="CVC">
                    <Input value={form.cvc} onChange={(e) => setForm({ ...form, cvc: e.target.value })} />
                  </Field>
                </div>
                {err && <Callout tone="danger">{err.message}</Callout>}
                <Button type="submit" size="lg" className="w-full" loading={pay.isPending} disabled={!form.cardholder.trim() || !s}>
                  {s ? `Pay ${money(s.amountCents)} / month` : 'Loading…'}
                </Button>
                <p className="flex items-center justify-center gap-1.5 text-xs text-subtle">
                  <ShieldCheck className="size-3.5" /> Simulated · no real payment is made
                </p>
              </form>
            </CardBody>
          </Card>
        </FadeIn>
        <FadeIn delay={0.05}>
          <Card>
            <CardBody className="pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Order summary</div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-semibold">{s?.planName ?? '…'} plan</span>
                <span className="font-semibold tabular-nums">{s ? money(s.amountCents) : ''}</span>
              </div>
              <div className="text-sm text-muted">{s?.seats} educator seats · billed monthly after a 30-day trial</div>
              <div className="mt-4 border-t border-border pt-3 text-sm text-muted">After payment you will create your account, then set up your own class or a whole school.</div>
            </CardBody>
          </Card>
        </FadeIn>
      </div>
    </Frame>
  );
}
