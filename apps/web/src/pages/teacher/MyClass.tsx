import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { BookOpen, CircleUserRound, HeartHandshake, Plus, School, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { FamilyAccess } from '../../components/FamilyAccess';
import { Avatar, Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, DialogContent, Empty, FadeIn, Field, Input, PageSkeleton, Select, Stagger, StaggerItem } from '../../components/ui';
import { ApiError, api, humanize } from '../../lib/api';
import type { Classroom } from '../../lib/types';

const PERIODS = Array.from({ length: 8 }, (_, i) => ({ value: `period_${i + 1}`, label: `Period ${i + 1}` }));

/**
 * The teacher's own roster. In a real school the person who knows who is in the room is the
 * teacher, so sections, students, and the family and student dashboards are opened from here —
 * no administrator in the loop, and no cost to the family.
 */
export function MyClass() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const [addSection, setAddSection] = useState(false);
  const [section, setSection] = useState({ name: '', gradeLevel: '6', periodTag: 'period_1' });
  const [addTo, setAddTo] = useState<string | null>(null);
  const [student, setStudent] = useState({ firstName: '', lastName: '', gradeLevel: '' });
  const [sharing, setSharing] = useState<{ id: string; displayName: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['classroom'] });
    void qc.invalidateQueries({ queryKey: ['roster'] });
  };
  const createSection = useMutation({
    mutationFn: () => api.post('/api/classroom/sections', section),
    onSuccess: () => {
      toast.success('Section added.');
      setAddSection(false);
      setSection({ name: '', gradeLevel: '6', periodTag: 'period_1' });
      refresh();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const createStudent = useMutation({
    mutationFn: () => api.post('/api/classroom/students', { sectionId: addTo, ...student, gradeLevel: student.gradeLevel || null }),
    onSuccess: () => {
      toast.success(`${student.firstName} ${student.lastName} added.`);
      setStudent({ firstName: '', lastName: '', gradeLevel: '' });
      setAddTo(null);
      refresh();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (q.isLoading) return <PageSkeleton />;
  const c = q.data ?? { schools: [], sections: [], students: [], access: [] };
  const accessFor = (studentId: string) => c.access.filter((a) => a.studentId === studentId && a.status !== 'revoked');

  return (
    <div>
      <PageHeader
        title="My class"
        description="Your sections and the students in them. Adding a family or a student here gives them their own dashboard — free, scoped to that one child, and revocable."
        actions={
          <Button onClick={() => setAddSection(true)} data-testid="add-section">
            <Plus /> Add a section
          </Button>
        }
      />

      {c.sections.length === 0 ? (
        <Empty
          icon={<School />}
          title="You don't teach a section yet"
          description="Add the class you teach, then put your students on the roster. If your school already set one up for you, ask your administrator to add you to it."
          action={
            <Button onClick={() => setAddSection(true)}>
              <Plus /> Add a section
            </Button>
          }
        />
      ) : (
        <Stagger className="space-y-4">
          {c.sections.map((sec) => {
            const roster = c.students.filter((s) => s.sectionIds.includes(sec.id));
            return (
              <StaggerItem key={sec.id}>
                <Card>
                  <CardHeader
                    title={sec.name}
                    description={`Grade ${sec.gradeLevel}${sec.periodTag ? ` · ${humanize(sec.periodTag)}` : ''} · ${roster.length} student${roster.length === 1 ? '' : 's'}`}
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setAddTo(sec.id)} data-testid={`add-student-${sec.id}`}>
                        <UserPlus /> Add a student
                      </Button>
                    }
                  />
                  <CardBody>
                    {roster.length === 0 ? (
                      <Empty compact icon={<Users />} title="No students on this roster yet" />
                    ) : (
                      <ul className="divide-y divide-border">
                        {roster.map((s) => {
                          const access = accessFor(s.id);
                          return (
                            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar name={s.displayName} />
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{s.displayName}</div>
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                                    <span>Grade {s.gradeLevel}</span>
                                    {access.length === 0 ? (
                                      <Badge tone="neutral">No family access</Badge>
                                    ) : (
                                      access.map((a) => (
                                        <Badge key={a.id} tone={a.status === 'accepted' ? 'success' : 'warning'}>
                                          {a.role === 'guardian' ? 'Family' : 'Student'} {a.status === 'accepted' ? 'active' : 'invited'}
                                        </Badge>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setSharing({ id: s.id, displayName: s.displayName })} data-testid={`share-${s.id}`}>
                                  <HeartHandshake /> Family access
                                </Button>
                                <Link to={`/teacher/intake?studentId=${s.id}`}>
                                  <Button size="sm" variant="secondary">
                                    <BookOpen /> Open a case
                                  </Button>
                                </Link>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <FadeIn delay={0.1}>
        <Callout className="mt-4" icon={<CircleUserRound />} title="Who else can you invite?">
          Another teacher, a support professional or an administrator takes an educator seat, so those invitations stay with your school's administrator. Parents and students never do.
        </Callout>
      </FadeIn>

      <Dialog open={addSection} onOpenChange={setAddSection}>
        <DialogContent title="Add a section">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createSection.mutate();
          }}
        >
          <Field label="Section name" hint="what you'd call it out loud">
            <Input value={section.name} onChange={(e) => setSection({ ...section, name: e.target.value })} placeholder="Grade 6 — Period 3 Science" required data-testid="section-name" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Grade">
              <Input value={section.gradeLevel} onChange={(e) => setSection({ ...section, gradeLevel: e.target.value })} required data-testid="section-grade" />
            </Field>
            <Field label="Period">
              <Select value={section.periodTag} onChange={(v) => setSection({ ...section, periodTag: v })} options={PERIODS} />
            </Field>
          </div>
          <Button type="submit" className="w-full" loading={createSection.isPending} disabled={!section.name.trim() || !section.gradeLevel.trim()}>
            Add section
          </Button>
        </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addTo} onOpenChange={(o) => !o && setAddTo(null)}>
        <DialogContent title="Add a student" description="Their name stays on this side of the wall: detection and the model only ever see de-identified observations.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createStudent.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <Input value={student.firstName} onChange={(e) => setStudent({ ...student, firstName: e.target.value })} required data-testid="student-first" />
            </Field>
            <Field label="Last name">
              <Input value={student.lastName} onChange={(e) => setStudent({ ...student, lastName: e.target.value })} required data-testid="student-last" />
            </Field>
          </div>
          <Field label="Grade" hint="leave blank to use the section's grade">
            <Input value={student.gradeLevel} onChange={(e) => setStudent({ ...student, gradeLevel: e.target.value })} placeholder={c.sections.find((s) => s.id === addTo)?.gradeLevel ?? ''} />
          </Field>
          <Button type="submit" className="w-full" loading={createStudent.isPending} disabled={!student.firstName.trim() || !student.lastName.trim()} data-testid="save-student">
            Add student
          </Button>
        </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sharing} onOpenChange={(o) => !o && setSharing(null)}>
        <DialogContent title={sharing ? `Family and student access — ${sharing.displayName}` : ''}>
          {sharing && <FamilyAccess studentId={sharing.id} studentName={sharing.displayName.split(' ')[0] ?? sharing.displayName} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
