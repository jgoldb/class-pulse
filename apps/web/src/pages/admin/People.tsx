import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, MailPlus, ShieldCheck, UserPlus } from 'lucide-react';
import { ROLES } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Empty, Field, Input, PageSkeleton, Select } from '../../components/ui';
import { ApiError, api, fmtDateTime, humanize } from '../../lib/api';

interface Structure {
  schools: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; gradeLevel: string; schoolId: string }>;
  students: Array<{ id: string; displayName: string; gradeLevel: string; schoolId: string }>;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  sectionId: string | null;
  studentId: string | null;
  schoolId: string | null;
  status: string;
  createdAt: string;
}

const ROLE_HELP: Record<string, string> = {
  teacher: 'Scoped to one class section. Sees every student in it.',
  support_professional: 'Scoped to one student. Sees that student across sections, plus the support queue.',
  administrator: 'Scoped to a school. Aggregates only, unless individually authorized.',
  student: 'Their own goals, strategies, progress and check-ins.',
  guardian: "Their child's goals, progress summaries and home support.",
};

/** Invitations (Clerk delivers the email; we own role and scope) and time-boxed individual access for administrators. */
export function AdminPeople() {
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ['admin', 'structure'], queryFn: () => api.get<Structure>('/api/admin/structure') });
  const invitations = useQuery({ queryKey: ['admin', 'invitations'], queryFn: () => api.get<Invitation[]>('/api/admin/invitations') });
  const auths = useQuery({ queryKey: ['admin', 'authorizations'], queryFn: () => api.get<any[]>('/api/admin/authorizations') });
  const dir = useQuery({ queryKey: ['admin', 'directory'], queryFn: () => api.get<any>('/api/admin/directory') });
  const [form, setForm] = useState({ email: '', role: 'teacher', sectionId: '', studentId: '', schoolId: '' });
  const [grant, setGrant] = useState({ adminUserId: '', studentId: '', reason: '', days: 14 });

  const invite = useMutation({
    mutationFn: () => api.post<{ status: string }>('/api/admin/invitations', { email: form.email, role: form.role, sectionId: form.role === 'teacher' ? form.sectionId : null, studentId: ['student', 'guardian', 'support_professional'].includes(form.role) ? form.studentId : null, schoolId: form.role === 'administrator' ? form.schoolId : null }),
    onSuccess: (r) => {
      toast.success(r.status === 'accepted' ? 'Role added to an existing member.' : `Invitation email sent to ${form.email}.`);
      setForm({ ...form, email: '' });
      qc.invalidateQueries({ queryKey: ['admin', 'invitations'] });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/api/admin/invitations/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'invitations'] }) });
  const doGrant = useMutation({
    mutationFn: () => api.post('/api/admin/authorizations', grant),
    onSuccess: () => {
      toast.success('Access granted and audited.');
      setGrant({ ...grant, studentId: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['admin', 'authorizations'] });
    },
  });
  const revokeAuth = useMutation({ mutationFn: (id: string) => api.post(`/api/admin/authorizations/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'authorizations'] }) });
  const err = (invite.error ?? doGrant.error) as ApiError | null;
  if (structure.isLoading) return <PageSkeleton />;
  const s = structure.data!;
  const needsSection = form.role === 'teacher';
  const needsStudent = ['student', 'guardian', 'support_professional'].includes(form.role);
  const needsSchool = form.role === 'administrator';
  const scopeReady = (needsSection && form.sectionId) || (needsStudent && form.studentId) || (needsSchool && form.schoolId);
  const name = (inv: Invitation) => (inv.sectionId ? s.sections.find((x) => x.id === inv.sectionId)?.name : inv.studentId ? s.students.find((x) => x.id === inv.studentId)?.displayName : s.schools.find((x) => x.id === inv.schoolId)?.name) ?? '';

  return (
    <div>
      <PageHeader title="People & access" description="Everyone is invited with a role and a scope. Roles are never global: a teacher's is per section, a family's is per child. Clerk delivers the invitation email; when the person signs up, they land in the right place." />
      {err && <Callout tone="danger" className="mb-4">{err.message}</Callout>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Invite someone" description={ROLE_HELP[form.role]} />
          <CardBody className="space-y-3">
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@school.org" data-testid="invite-email" />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(v) => setForm({ ...form, role: v, sectionId: '', studentId: '', schoolId: '' })} options={ROLES.map((r) => ({ value: r, label: humanize(r) }))} />
            </Field>
            {needsSection && (
              <Field label="Class section">
                <Select value={form.sectionId || null} onChange={(v) => setForm({ ...form, sectionId: v })} options={s.sections.map((x) => ({ value: x.id, label: x.name, description: `Grade ${x.gradeLevel}` }))} placeholder={s.sections.length ? 'Choose a section' : 'Add sections under School structure first'} />
              </Field>
            )}
            {needsStudent && (
              <Field label="Student">
                <Select value={form.studentId || null} onChange={(v) => setForm({ ...form, studentId: v })} options={s.students.map((x) => ({ value: x.id, label: x.displayName, description: `Grade ${x.gradeLevel}` }))} placeholder={s.students.length ? 'Choose a student' : 'Add students under School structure first'} />
              </Field>
            )}
            {needsSchool && (
              <Field label="School">
                <Select value={form.schoolId || null} onChange={(v) => setForm({ ...form, schoolId: v })} options={s.schools.map((x) => ({ value: x.id, label: x.name }))} />
              </Field>
            )}
            <Button disabled={!form.email.includes('@') || !scopeReady} loading={invite.isPending} onClick={() => invite.mutate()} data-testid="send-invite">
              <MailPlus /> Send invitation
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Invitations" />
          <CardBody>
            {(invitations.data ?? []).length === 0 && <Empty compact icon={<UserPlus />} title="No invitations yet" />}
            <ul className="divide-y divide-border">
              {(invitations.data ?? []).map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{inv.email}</div>
                    <div className="text-xs text-muted">
                      {humanize(inv.role)} · {name(inv)} · {fmtDateTime(inv.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={inv.status === 'accepted' ? 'success' : inv.status === 'pending' ? 'warning' : 'neutral'}>{inv.status}</Badge>
                    {inv.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(inv.id)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Individual access for administrators" description="Administrators see aggregates. Individual access requires an explicit, time-boxed record: who, for which student, why, for how long. Every grant, revocation and read is audited." />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Administrator">
              <Select value={grant.adminUserId || null} onChange={(v) => setGrant({ ...grant, adminUserId: v })} options={(dir.data?.admins ?? []).map((a: any) => ({ value: a.id, label: a.displayName }))} />
            </Field>
            <Field label="Student">
              <Select value={grant.studentId || null} onChange={(v) => setGrant({ ...grant, studentId: v })} options={(dir.data?.students ?? []).map((x: any) => ({ value: x.id, label: x.displayName, description: `Grade ${x.gradeLevel}` }))} />
            </Field>
            <Field label="Reason">
              <Input value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} placeholder="Family meeting preparation" />
            </Field>
            <Field label="Days">
              <Input type="number" min={1} max={90} value={grant.days} onChange={(e) => setGrant({ ...grant, days: Number(e.target.value) })} />
            </Field>
          </div>
          <Button className="mt-3" size="sm" disabled={!grant.adminUserId || !grant.studentId || grant.reason.length < 5} loading={doGrant.isPending} onClick={() => doGrant.mutate()}>
            <KeyRound /> Grant access
          </Button>
          <ul className="mt-4 divide-y divide-border text-sm">
            {(auths.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <span className="font-medium">{r.adminName}</span> → {r.studentName} · {r.reason}
                  <div className="text-xs text-muted">granted {fmtDateTime(r.grantedAt)} · expires {fmtDateTime(r.expiresAt)}{r.revokedAt ? ` · revoked ${fmtDateTime(r.revokedAt)}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'active' : 'inactive'}</Badge>
                  {r.active && (
                    <Button size="sm" variant="danger" onClick={() => revokeAuth.mutate(r.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {(auths.data ?? []).length === 0 && <li className="py-3"><Empty compact icon={<ShieldCheck />} title="No individual access grants" /></li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
