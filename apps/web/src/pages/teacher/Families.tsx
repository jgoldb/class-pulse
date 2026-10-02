import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, HeartHandshake, Inbox, MessageSquareHeart, UserRoundCheck } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { FamilyAccess } from '../../components/FamilyAccess';
import { ConfirmChip } from '../../components/TeacherConfirm';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Empty, PageSkeleton } from '../../components/ui';
import { api, fmtDateTime } from '../../lib/api';
import { classTitle } from '../../lib/classes';
import { draftStage, needsTeacher } from '../../lib/pulse';
import type { Classroom, ClassroomStudent } from '../../lib/types';
import { ContributionResponse, ContributionText, type Contribution } from '../PulseProfiles';

type DraftRow = { id: string; kind: string; generationState: string; reviewState: string; publicationState: string; title?: string | null; students?: Array<{ id: string; displayName: string }>; createdAt: string };

/**
 * Families (visual spec §3 navigation). Everything to do with home in one place: who is connected,
 * what families have shared that is waiting for a response, and family messages waiting in Drafts.
 * Nothing here sends a message; approving a draft never does either.
 */
export function Families() {
  const classroom = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const drafts = useQuery({ queryKey: ['classroom-drafts'], queryFn: () => api.get<DraftRow[]>('/api/pulse/drafts') });
  const sections = (classroom.data?.sections ?? []).filter((s) => !s.archivedAt);
  const inputs = useQueries({ queries: sections.map((s) => ({ queryKey: ['pulse-contributions', 'section', s.id], queryFn: () => api.get<Contribution[]>(`/api/pulse/contributions?sectionId=${encodeURIComponent(s.id)}`), retry: false })) });
  const [sharing, setSharing] = useState<ClassroomStudent | null>(null);
  if (classroom.isLoading) return <PageSkeleton />;
  const c = classroom.data;
  if (!c?.sections.length) return <div><PageHeader title="Families" /><Empty icon={<HeartHandshake />} title="No classes yet" description="Add a class and its students, then invite families from here." action={<Link to="/teacher/classes"><Button>Go to My Classes</Button></Link>} /></div>;

  const access = (id: string) => c.access.filter((a) => a.studentId === id && a.role === 'guardian' && a.status !== 'revoked');
  const students = c.students.filter((s) => s.sectionIds.some((id) => sections.some((x) => x.id === id)));
  const connected = students.filter((s) => access(s.id).some((a) => a.status === 'accepted')).length;
  const invited = students.filter((s) => access(s.id).some((a) => a.status === 'pending')).length;
  const familyInput = [...new Map(inputs.flatMap((q, i) => (q.data ?? []).filter((x) => x.sourceRole === 'guardian').map((x) => [x.id, { ...x, sectionId: sections[i]!.id }] as const))).values()];
  const waiting = familyInput.filter((x) => ['pending', 'acknowledged'].includes(x.status));
  const messages = (drafts.data ?? []).filter((d) => d.kind === 'parent_message' && d.reviewState !== 'discarded');
  const messagesToReview = messages.filter(needsTeacher);
  const nameOf = (id: string) => c.students.find((s) => s.id === id)?.displayName ?? 'A student in your class';

  return (
    <div className="space-y-8">
      <PageHeader title="Families" description="Who is connected at home, what families have shared, and messages waiting for your approval." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon={<UserRoundCheck />} label="Families connected" value={`${connected} of ${students.length}`} hint={invited ? `${invited} invitation${invited === 1 ? '' : 's'} waiting to be accepted` : 'Invite a family from any student below'} />
        <Tile icon={<MessageSquareHeart />} label="Family input to answer" value={waiting.length} hint={waiting.length ? 'Shared with you from home' : 'Nothing waiting'} />
        <Tile icon={<Inbox />} label="Family messages to review" value={messagesToReview.length} hint="Drafts only — approving never sends" to={messagesToReview.length ? '/teacher/drafts?group=family' : undefined} />
      </div>

      {!!waiting.length && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Shared from home</h2>
          {waiting.map((x) => (
            <Card key={x.id}>
              <CardBody className="space-y-3 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar name={nameOf(x.studentId)} size="sm" />
                  <span className="font-medium">{nameOf(x.studentId)}</span>
                  <span className="text-sm text-muted">· shared by {x.authorName} · {fmtDateTime(x.createdAt)}</span>
                  <Badge tone="neutral" className="ml-auto">Family perspective</Badge>
                </div>
                {x.content && <ContributionText content={x.content} strategies={[]} />}
                <details className="group">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-sunken group-open:mb-3"><MessageSquareHeart className="size-4 text-primary" />Respond</summary>
                  <ContributionResponse item={x} />
                </details>
              </CardBody>
            </Card>
          ))}
        </section>
      )}

      {!!messages.length && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Family messages</h2>
          <Card>
            <ul className="divide-y divide-border">
              {messages.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link to={`/teacher/drafts?draft=${d.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-sunken/60">
                    <span className="font-medium">{d.students?.map((s) => s.displayName).join(', ') || 'Family message'}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{d.title}</span>
                    <ConfirmChip kind={draftStage(d).kind} label={draftStage(d).label} />
                    <ArrowRight className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {sections.map((sec) => {
        const roster = students.filter((s) => s.sectionIds.includes(sec.id));
        if (!roster.length) return null;
        return (
          <Card key={sec.id}>
            <CardHeader title={classTitle(sec)} description={`${roster.filter((s) => access(s.id).some((a) => a.status === 'accepted')).length} of ${roster.length} families connected`} />
            <ul className="divide-y divide-border border-t border-border">
              {roster.map((s) => {
                const a = access(s.id);
                const on = a.some((x) => x.status === 'accepted');
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Avatar name={s.displayName} size="sm" />
                    <span className="min-w-0 flex-1 font-medium">{s.displayName}</span>
                    <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Connected' : a.length ? 'Invited' : 'Not connected'}</Badge>
                    <Button size="sm" variant={on ? 'ghost' : 'secondary'} onClick={() => setSharing(s)}><HeartHandshake /> {on ? 'Manage' : 'Invite family'}</Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      <Dialog open={!!sharing} onOpenChange={(o) => !o && setSharing(null)}>
        <DialogContent title={sharing ? `Family and student access — ${sharing.displayName}` : ''}>
          {sharing && <FamilyAccess studentId={sharing.id} studentName={sharing.firstName} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ icon, label, value, hint, to }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string; to?: string }) {
  const body = (
    <div className="flex h-full items-start gap-4 rounded-xl border border-border bg-elevated p-5 shadow-xs">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-5">{icon}</span>
      <div>
        <div className="text-sm text-muted">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-0.5 text-xs text-muted">{hint}</div>
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl transition-transform hover:-translate-y-0.5">{body}</Link> : body;
}
