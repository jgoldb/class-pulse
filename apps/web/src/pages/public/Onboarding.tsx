import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Activity, Building2, MailQuestion, School } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { forgetCheckout, recallCheckout } from '../../lib/checkout';
import { useAuth } from '../../lib/auth';
import { Button, Callout, Card, CardBody, FadeIn, Field, Input, PageSkeleton, Select } from '../../components/ui';

/**
 * A signed-in person who is not provisioned lands here. Two cases:
 *  - they paid for a plan (checkout id in the URL): create the workspace and become its administrator;
 *  - they signed in without an invitation: explain how access works.
 */
export function Onboarding() {
  const { signedIn, clerkLoaded, me, loading, refresh, roleBase, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  // Clerk's sign-up navigates with a full page load and loses the query string, so a customer
  // who has just paid can arrive here without it. The checkout page parked the id for this tab.
  const checkout = params.get('checkout') ?? recallCheckout();
  const nav = useNavigate();
  const [form, setForm] = useState({ workspaceName: '', schoolName: '', sectionName: '', gradeLevel: '6', periodTag: 'period_1' });
  // `refresh()` can flip `me.provisioned` (and fire the redirect below) before the explicit
  // navigate lands, so both exits have to agree on the destination or the welcome banner is lost.
  const [created, setCreated] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/onboarding/workspace', {
        checkoutId: checkout,
        workspaceName: form.workspaceName,
        schoolName: form.schoolName,
        firstSection: form.sectionName.trim() ? { name: form.sectionName.trim(), gradeLevel: form.gradeLevel, periodTag: form.periodTag } : null,
      }),
    onSuccess: async () => {
      forgetCheckout();
      setCreated(true);
      await refresh();
      nav('/admin?welcome=1', { replace: true });
    },
  });
  const err = create.error as ApiError | null;

  // Put the id back on the URL so this screen is the documented `/onboarding?checkout=…` again,
  // and survives another reload on its own.
  useEffect(() => {
    if (checkout && !params.get('checkout')) {
      const next = new URLSearchParams(params);
      next.set('checkout', checkout);
      setParams(next, { replace: true });
    }
  }, [checkout, params, setParams]);

  if (!clerkLoaded || loading) return <div className="mx-auto max-w-2xl p-6"><PageSkeleton /></div>;
  if (!signedIn) return <Navigate to={checkout ? `/sign-up?checkout=${checkout}` : '/sign-in'} replace />;
  if (me?.provisioned) return <Navigate to={created ? '/admin?welcome=1' : roleBase} replace />;

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,var(--primary-soft),var(--bg)_55%)]">
      <div className="mx-auto max-w-xl px-4 py-12">
        <FadeIn>
          <div className="mb-6 flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
              <Activity className="size-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>
          </div>
        </FadeIn>
        {checkout ? (
          <FadeIn delay={0.05}>
            <h1 className="text-3xl font-bold tracking-tight">Set up your workspace</h1>
            <p className="mt-2 text-muted">You will be the administrator. You can invite teachers, support staff, students and families from People &amp; access afterwards.</p>
            <Card className="mt-6">
              <CardBody className="pt-5">
                <form
                  className="space-y-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate();
                  }}
                >
                  <Field label="Workspace name" hint="usually the district or organization">
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-3 size-4 text-subtle" />
                      <Input className="pl-9" value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} required minLength={2} placeholder="Riverside Unified" />
                    </div>
                  </Field>
                  <Field label="First school">
                    <div className="relative">
                      <School className="pointer-events-none absolute left-3 top-3 size-4 text-subtle" />
                      <Input className="pl-9" value={form.schoolName} onChange={(e) => setForm({ ...form, schoolName: e.target.value })} required minLength={2} placeholder="Riverside Middle School" />
                    </div>
                  </Field>
                  <div className="rounded-lg border border-border bg-sunken/50 p-4">
                    <div className="text-sm font-medium">First class section <span className="font-normal text-muted">(optional, you can add more later)</span></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_90px_140px]">
                      <Input value={form.sectionName} onChange={(e) => setForm({ ...form, sectionName: e.target.value })} placeholder="Grade 6 — Period 3 Science" />
                      <Input value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} placeholder="Grade" />
                      <Select value={form.periodTag} onChange={(v) => setForm({ ...form, periodTag: v })} options={Array.from({ length: 8 }, (_, i) => ({ value: `period_${i + 1}`, label: `Period ${i + 1}` }))} />
                    </div>
                  </div>
                  {err && <Callout tone="danger">{err.message}</Callout>}
                  <Button type="submit" size="lg" className="w-full" loading={create.isPending} disabled={!form.workspaceName.trim() || !form.schoolName.trim()}>
                    Create workspace
                  </Button>
                </form>
              </CardBody>
            </Card>
          </FadeIn>
        ) : (
          <FadeIn delay={0.05}>
            <Card>
              <CardBody className="pt-6 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning-fg">
                  <MailQuestion className="size-5" />
                </span>
                <h1 className="mt-4 text-2xl font-bold tracking-tight">Your account isn't in a workspace yet</h1>
                <p className="mt-2 text-muted">
                  Class Pulse is invitation-based. Ask your school's administrator to invite <span className="font-medium text-fg">{me?.user?.email ?? 'this email'}</span>, then sign in again. If you are setting up a new school, start a workspace instead.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => void refresh()}>
                    I've been invited, check again
                  </Button>
                  <Button onClick={() => nav('/get-started')}>Start a workspace</Button>
                  <Button variant="ghost" onClick={() => void signOut().then(() => nav('/'))}>
                    Sign out
                  </Button>
                </div>
              </CardBody>
            </Card>
          </FadeIn>
        )}
      </div>
    </div>
  );
}
