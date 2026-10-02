import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { FileUp, HeartHandshake, MoreHorizontal, Pencil, UserMinus, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../../../components/AppShell';
import { FamilyAccess } from '../../../components/FamilyAccess';
import { RosterImport } from '../../../components/RosterImport';
import { Avatar, Badge, Button, Card, Dialog, DialogContent, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, Empty, Field, Input, PageSkeleton, Segmented } from '../../../components/ui';
import { api } from '../../../lib/api';
import { classDetails, classTitle } from '../../../lib/classes';
import type { Classroom, ClassroomStudent } from '../../../lib/types';
import { EditClassDialog } from './EditClass';

/**
 * Manage Students (visual spec §9.3: "Roster — separate action"). Adding and removing students is
 * kept apart from Edit Class so class details and the roster never change in the same step.
 * Removing takes a student off this roster only; their records stay.
 */
export function ManageStudents() {
  const { sectionId = '' } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<ClassroomStudent | null>(null);
  const [sharing, setSharing] = useState<ClassroomStudent | null>(null);
  const refresh = () => Promise.all(['classroom', 'roster', 'pulse-people', 'pulse-sections'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (q.isLoading) return <PageSkeleton />;
  const c = q.data;
  const section = c?.sections.find((s) => s.id === sectionId);
  if (!c || !section) return <Empty title="This class is not one of yours" description="It may have been removed from your teaching assignment." action={<Link to="/teacher/classes"><Button variant="secondary">Back to My Classes</Button></Link>} />;
  const roster = c.students.filter((s) => s.sectionIds.includes(section.id));
  const access = (id: string) => c.access.filter((a) => a.studentId === id && a.status !== 'revoked');

  return (
    <div>
      <PageHeader
        back={{ to: '/teacher/classes', label: 'My Classes' }}
        title="Manage Students"
        description={<>{classTitle(section)}{classDetails(section) ? ` · ${classDetails(section)}` : ''} · {roster.length} {roster.length === 1 ? 'student' : 'students'}</>}
        actions={
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit Class</Button>
            <Button variant="secondary" onClick={() => setImporting(true)}><FileUp /> Import roster</Button>
            <Button onClick={() => setAdding(true)} data-testid="add-student"><UserPlus /> Add student</Button>
          </>
        }
      />
      {section.archivedAt && <p className="mb-4 rounded-lg bg-sunken px-4 py-3 text-sm text-muted">This class is archived. You can still change its roster; restore it from My Classes to teach it again.</p>}

      {!roster.length ? (
        <Empty icon={<Users />} title="No students in this class yet" description="Add them one at a time, or import your roster file." action={<Button onClick={() => setAdding(true)}><UserPlus /> Add student</Button>} />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Roster">
            {roster.map((s) => {
              const a = access(s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4" data-testid={`roster-row-${s.id}`}>
                  <Avatar name={s.displayName} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/teacher/students?student=${s.id}`} className="font-medium hover:underline">{s.displayName}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>Grade {s.gradeLevel}</span>
                      {a.length === 0 ? <Badge tone="neutral">No family access</Badge> : a.map((x) => <Badge key={x.id} tone={x.status === 'accepted' ? 'success' : 'neutral'}>{x.role === 'guardian' ? 'Family' : 'Student'} {x.status === 'accepted' ? 'connected' : 'invited'}</Badge>)}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSharing(s)} data-testid={`share-${s.id}`}><HeartHandshake /><span className="max-sm:sr-only">Family access</span></Button>
                  <Dropdown>
                    <DropdownTrigger asChild><Button size="icon" variant="ghost" aria-label={`More for ${s.displayName}`}><MoreHorizontal /></Button></DropdownTrigger>
                    <DropdownContent>
                      <DropdownItem onSelect={() => nav(`/teacher/intake?studentId=${s.id}`)}>Open a support case…</DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem icon={<UserMinus />} onSelect={() => setRemoving(s)} data-testid={`remove-${s.id}`}>Remove from this class</DropdownItem>
                    </DropdownContent>
                  </Dropdown>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <AddStudentDialog open={adding} onOpenChange={setAdding} sectionId={section.id} grade={section.gradeLevel} classroom={c} onDone={refresh} />

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent title="Import roster" description="Review the proposed changes before confirming." className="max-w-xl">
          {importing && <RosterImport sectionId={section.id} onImported={() => void refresh()} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        {removing && (
          <DialogContent title={`Remove ${removing.displayName} from ${classTitle(section)}?`} description="They come off this class roster and seating chart. Their observations, drafts, approvals and support records are kept, and adding them back brings their class history back with them.">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="danger" data-testid="confirm-remove" onClick={async () => {
                try {
                  await api.delete(`/api/classroom/sections/${section.id}/students/${removing.id}`);
                  toast.success(`${removing.displayName} removed from this class`, { description: 'Their records are kept.' });
                  setRemoving(null); await refresh();
                } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove the student'); }
              }}><UserMinus /> Remove from class</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!sharing} onOpenChange={(o) => !o && setSharing(null)}>
        <DialogContent title={sharing ? `Family and student access — ${sharing.displayName}` : ''}>
          {sharing && <FamilyAccess studentId={sharing.id} studentName={sharing.firstName} />}
        </DialogContent>
      </Dialog>

      <EditClassDialog section={editing ? section : null} onOpenChange={(o) => !o && setEditing(false)} />
    </div>
  );
}

function AddStudentDialog({ open, onOpenChange, sectionId, grade, classroom, onDone }: { open: boolean; onOpenChange(o: boolean): void; sectionId: string; grade: string; classroom: Classroom; onDone(): Promise<unknown> }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [form, setForm] = useState({ firstName: '', lastName: '', gradeLevel: '' });
  const [busy, setBusy] = useState(false);
  const elsewhere = classroom.students.filter((s) => !s.sectionIds.includes(sectionId));
  async function addNew(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/api/classroom/students', { sectionId, firstName: form.firstName, lastName: form.lastName, gradeLevel: form.gradeLevel || null });
      toast.success(`${form.firstName} ${form.lastName} added`);
      setForm({ firstName: '', lastName: '', gradeLevel: '' });
      await onDone();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add the student'); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a student" description="Their name stays in your school’s records: detection and AI drafting only ever see de-identified observations.">
        {!!elsewhere.length && <Segmented className="mb-4" value={mode} onChange={setMode} options={[{ value: 'new', label: 'New student' }, { value: 'existing', label: 'From your other classes' }]} />}
        {mode === 'new' || !elsewhere.length ? (
          <form className="space-y-4" onSubmit={addNew}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required maxLength={80} data-testid="student-first" /></Field>
              <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required maxLength={80} data-testid="student-last" /></Field>
            </div>
            <Field label="Grade" hint="leave blank to use the class's grade"><Input value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} placeholder={grade} maxLength={20} /></Field>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
              <Button type="submit" loading={busy} disabled={!form.firstName.trim() || !form.lastName.trim()} data-testid="save-student"><UserPlus /> Add student</Button>
            </div>
          </form>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {elsewhere.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Avatar name={s.displayName} size="sm" />
                <span className="flex-1">{s.displayName}<span className="block text-xs text-muted">{s.sectionIds.map((id) => classroom.sections.find((x) => x.id === id)).filter(Boolean).map((x) => classTitle(x!)).join(', ')}</span></span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { await api.post('/api/classroom/enrollments', { studentId: s.id, sectionId }); toast.success(`${s.displayName} added to this class`); await onDone(); }
                  catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add'); }
                  finally { setBusy(false); }
                }}>Add</Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
