import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GraduationCap, LayoutGrid, UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Empty, Field, Input, PageSkeleton, Select } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

interface Structure {
  schools: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; gradeLevel: string; schoolId: string; periodTag: string | null }>;
  students: Array<{ id: string; displayName: string; gradeLevel: string; schoolId: string }>;
  enrollments?: Array<{ sectionId: string; studentId: string }>;
}

/** Sections, students and enrollments. Manual for now; an SIS import maps onto the same tables (open question #3). */
export function AdminStructure() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'structure'], queryFn: () => api.get<Structure>('/api/admin/structure') });
  const [section, setSection] = useState({ schoolId: '', name: '', gradeLevel: '6', periodTag: 'period_1' });
  const [student, setStudent] = useState({ schoolId: '', firstName: '', lastName: '', gradeLevel: '6', sectionId: '' });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'structure'] });
  const addSection = useMutation({ mutationFn: () => api.post('/api/admin/sections', section), onSuccess: () => { toast.success('Section added.'); setSection({ ...section, name: '' }); invalidate(); } });
  const addStudent = useMutation({ mutationFn: () => api.post('/api/admin/students', student), onSuccess: () => { toast.success('Student added and enrolled.'); setStudent({ ...student, firstName: '', lastName: '' }); invalidate(); } });
  const err = (addSection.error ?? addStudent.error) as ApiError | null;
  if (q.isLoading) return <PageSkeleton />;
  const s = q.data!;
  const schoolOpts = s.schools.map((x) => ({ value: x.id, label: x.name }));
  const defaultSchool = s.schools[0]?.id ?? '';
  const secSchool = section.schoolId || defaultSchool;
  const stuSchool = student.schoolId || defaultSchool;
  const enrolled = new Map<string, string[]>();
  for (const e of s.enrollments ?? []) enrolled.set(e.studentId, [...(enrolled.get(e.studentId) ?? []), e.sectionId]);

  return (
    <div>
      <PageHeader title="School structure" description="Class sections and students. Teachers are invited per section; students, families and support staff per student. Student names live only in the identified plane and never reach the model." />
      {err && <Callout tone="danger" className="mb-4">{err.message}</Callout>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Add a class section" />
          <CardBody className="space-y-3">
            {s.schools.length > 1 && (
              <Field label="School">
                <Select value={secSchool} onChange={(v) => setSection({ ...section, schoolId: v })} options={schoolOpts} />
              </Field>
            )}
            <Field label="Section name">
              <Input value={section.name} onChange={(e) => setSection({ ...section, name: e.target.value })} placeholder="Grade 6 — Period 3 Science" data-testid="section-name" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grade level">
                <Input value={section.gradeLevel} onChange={(e) => setSection({ ...section, gradeLevel: e.target.value })} />
              </Field>
              <Field label="Default period" hint="pre-fills quick entry">
                <Select value={section.periodTag} onChange={(v) => setSection({ ...section, periodTag: v })} options={Array.from({ length: 8 }, (_, i) => ({ value: `period_${i + 1}`, label: `Period ${i + 1}` }))} />
              </Field>
            </div>
            <Button size="sm" disabled={!section.name.trim() || !secSchool} loading={addSection.isPending} onClick={() => { setSection({ ...section, schoolId: secSchool }); addSection.mutate(); }} data-testid="add-section">
              <LayoutGrid /> Add section
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Add a student" description="Enrolled in the chosen section immediately." />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input value={student.firstName} onChange={(e) => setStudent({ ...student, firstName: e.target.value })} data-testid="student-first" />
              </Field>
              <Field label="Last name">
                <Input value={student.lastName} onChange={(e) => setStudent({ ...student, lastName: e.target.value })} data-testid="student-last" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grade level">
                <Input value={student.gradeLevel} onChange={(e) => setStudent({ ...student, gradeLevel: e.target.value })} />
              </Field>
              <Field label="Section">
                <Select value={student.sectionId || null} onChange={(v) => setStudent({ ...student, sectionId: v })} options={s.sections.filter((x) => x.schoolId === stuSchool).map((x) => ({ value: x.id, label: x.name }))} placeholder={s.sections.length ? 'Choose' : 'Add a section first'} />
              </Field>
            </div>
            <Button size="sm" disabled={!student.firstName.trim() || !student.lastName.trim() || !student.sectionId} loading={addStudent.isPending} onClick={() => { setStudent({ ...student, schoolId: stuSchool }); addStudent.mutate(); }} data-testid="add-student">
              <UserPlus /> Add student
            </Button>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sections" action={<Badge>{s.sections.length}</Badge>} />
          <CardBody>
            {s.sections.length === 0 && <Empty compact icon={<LayoutGrid />} title="No sections yet" />}
            <ul className="divide-y divide-border text-sm">
              {s.sections.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2">
                  <span>
                    {x.name} <span className="text-muted">· grade {x.gradeLevel}</span>
                  </span>
                  <Badge>{[...enrolled.values()].filter((v) => v.includes(x.id)).length} students</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Students" action={<Badge>{s.students.length}</Badge>} />
          <CardBody>
            {s.students.length === 0 && <Empty compact icon={<GraduationCap />} title="No students yet" />}
            <ul className="divide-y divide-border text-sm">
              {s.students.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2">
                  <span>
                    {x.displayName} <span className="text-muted">· grade {x.gradeLevel}</span>
                  </span>
                  <span className="text-xs text-muted">{(enrolled.get(x.id) ?? []).map((sid) => s.sections.find((y) => y.id === sid)?.name).filter(Boolean).join(', ') || 'not enrolled'}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
