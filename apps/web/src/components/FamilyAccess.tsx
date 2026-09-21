import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeartHandshake, MailPlus, UserRound } from 'lucide-react';
import { ApiError, api, fmtDateTime } from '../lib/api';
import type { AccessGrant } from '../lib/types';
import { Badge, Button, Callout, Empty, Input, Select } from './ui';

/**
 * Who can see this child's dashboards, and the teacher's way to open one. The family's and the
 * student's access is a teaching decision, so it is made here rather than by an administrator —
 * and it is free: guardian and student accounts are never seats (docs/04, docs/08).
 */
export function FamilyAccess({ studentId, studentName }: { studentId: string; studentName: string }) {
  const qc = useQueryClient();
  const key = ['access', studentId];
  const access = useQuery({ queryKey: key, queryFn: () => api.get<AccessGrant[]>(`/api/classroom/students/${studentId}/access`) });
  const [form, setForm] = useState({ email: '', role: 'guardian' as 'guardian' | 'student' });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['classroom'] });
  };
  const invite = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/api/classroom/students/${studentId}/access`, form),
    onSuccess: (r) => {
      toast.success(r.status === 'accepted' ? `${form.email} already had an account — access is on now.` : `Invitation sent to ${form.email}.`);
      setForm({ ...form, email: '' });
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/classroom/access/${id}/revoke`),
    onSuccess: () => {
      toast.success('Invitation revoked.');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const rows = (access.data ?? []).filter((a) => a.status !== 'revoked');
  const label = form.role === 'guardian' ? `${studentName}'s parent or guardian` : studentName;

  return (
    <div className="space-y-3">
      <Callout tone="primary" icon={<HeartHandshake />}>
        A parent sees their own child's goals, progress and home support, and can ask for a correction. A student sees their own goals and check-ins. Neither sees your notes, hypotheses or pattern candidates — and neither costs a seat.
      </Callout>

      {rows.length === 0 ? (
        <Empty compact icon={<UserRound />} title="Nobody at home has access yet" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{a.email}</div>
                <div className="text-xs text-muted">
                  {a.role === 'guardian' ? 'Parent / guardian' : 'Student'} · {a.status === 'accepted' ? (a.acceptedAt ? `signed in ${fmtDateTime(a.acceptedAt)}` : 'has access') : `invited ${fmtDateTime(a.createdAt)}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={a.status === 'accepted' ? 'success' : 'warning'}>{a.status === 'accepted' ? 'Active' : 'Invited'}</Badge>
                {a.status === 'pending' && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(a.id)} loading={revoke.isPending}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-2 sm:grid-cols-[185px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        <Select
          value={form.role}
          onChange={(v) => setForm({ ...form, role: v as 'guardian' | 'student' })}
          options={[
            { value: 'guardian', label: 'Parent / guardian' },
            { value: 'student', label: 'Student' },
          ]}
        />
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={`Email for ${label}`} data-testid="access-email" />
        <Button type="submit" disabled={!form.email.includes('@')} loading={invite.isPending} data-testid="send-access">
          <MailPlus /> Invite
        </Button>
      </form>
    </div>
  );
}
