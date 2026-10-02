import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Archive, ChevronDown, Circle, CircleCheck, LayoutGrid, MoreHorizontal, Pencil, Plus, RotateCcw, School, Users } from 'lucide-react';
import { PageHeader } from '../../../components/AppShell';
import { Button, Callout, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, Empty, PageSkeleton, Stagger, StaggerItem, cn } from '../../../components/ui';
import { api } from '../../../lib/api';
import { accentOf, classDetails, classTitle } from '../../../lib/classes';
import type { Classroom, ClassroomSection } from '../../../lib/types';
import { AddClassDialog } from './AddClass';
import { ArchiveClassDialog, EditClassDialog } from './EditClass';

const TODAY = {
  not_started: { label: 'Not started today', icon: Circle, className: 'text-muted' },
  in_progress: { label: 'Class in progress', icon: Circle, className: 'text-success-fg' },
  complete: { label: 'Session complete', icon: CircleCheck, className: 'text-success-fg' },
} as const;

/**
 * My Classes (visual spec §9.1). Each class is a card that opens Class Pulse for that section; its
 * menu holds Edit Class, Manage Students, Seating Chart and Archive.
 */
export function Classes() {
  const q = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [editing, setEditing] = useState<ClassroomSection | null>(null);
  const [archiving, setArchiving] = useState<ClassroomSection | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <Empty title="Your classes could not be loaded" description={`${q.error.message} Refresh the page to try again.`} />;
  const c = q.data!;
  const active = c.sections.filter((s) => !s.archivedAt);
  const archived = c.sections.filter((s) => s.archivedAt);
  const count = (id: string) => c.students.filter((s) => s.sectionIds.includes(id)).length;

  return (
    <div>
      <PageHeader title="My Classes" description="Open a class to teach it. Edit its details or roster at any time; its history always stays." actions={<Button onClick={() => setAdding(true)} data-testid="add-class"><Plus /> Add Class</Button>} />

      {params.get('welcome') && !!active.length && (
        <div data-testid="welcome" className="mb-6">
          <Callout tone="primary" title="Welcome to Pulsera. Your class is ready." action={<Link to={`/teacher/classes/${active[0]!.id}/students`}><Button size="sm">Add your students</Button></Link>}>
            Add your students next, then open the class to see its seating chart in Class Pulse.
          </Callout>
        </div>
      )}

      {!active.length ? (
        <Empty icon={<School />} title="Add the class you teach" description="Give it a name and a period, then add your students. If your school already set one up for you, ask your administrator to add you to it." action={<Button onClick={() => setAdding(true)}><Plus /> Add Class</Button>} />
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((s) => (
            <StaggerItem key={s.id}>
              <ClassCard section={s} students={count(s.id)} onEdit={() => setEditing(s)} onArchive={() => setArchiving(s)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {!!archived.length && (
        <section className="mt-10">
          <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)} className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg">
            <ChevronDown className={cn('size-4 transition-transform', !showArchived && '-rotate-90')} /> Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-4 space-y-2">
              {archived.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-elevated px-4 py-3">
                  <span className="size-2.5 rounded-full opacity-60" style={{ background: accentOf(s.accent).swatch }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{classTitle(s)}</div>
                    <div className="text-xs text-muted">{classDetails(s, [`${count(s.id)} students`])} · records kept</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setArchiving(s)}><RotateCcw /> Restore</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AddClassDialog open={adding} onOpenChange={(o) => { setAdding(o); if (!o && params.has('add')) setParams({}, { replace: true }); }} />
      <EditClassDialog section={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ArchiveClassDialog section={archiving} onOpenChange={(o) => !o && setArchiving(null)} />
    </div>
  );
}

function ClassCard({ section: s, students, onEdit, onArchive }: { section: ClassroomSection; students: number; onEdit(): void; onArchive(): void }) {
  const nav = useNavigate();
  const today = TODAY[s.today.status];
  const accent = accentOf(s.accent);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md" data-testid={`class-card-${s.id}`}>
      <div className="h-1.5" style={{ background: accent.swatch }} aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* The whole card opens Class Pulse; the link's box covers it, the menu sits above. */}
            <Link to={`/teacher?class=${s.id}`} className="block text-lg font-semibold leading-snug after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-primary">
              {classTitle(s)}
            </Link>
            <p className="mt-1 text-sm text-muted">{classDetails(s) || `Grade ${s.gradeLevel}`}</p>
          </div>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button size="icon" variant="ghost" className="relative z-10 -mr-2 -mt-1" aria-label={`Actions for ${classTitle(s)}`} data-testid={`class-menu-${s.id}`}><MoreHorizontal /></Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem icon={<Pencil />} onSelect={onEdit}>Edit Class</DropdownItem>
              <DropdownItem icon={<Users />} onSelect={() => nav(`/teacher/classes/${s.id}/students`)}>Manage Students</DropdownItem>
              <DropdownItem icon={<LayoutGrid />} onSelect={() => nav(`/teacher?class=${s.id}&arrange=1`)}>Seating Chart</DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={<Archive />} onSelect={onArchive}>Archive</DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-muted"><Users className="size-4" />{students} {students === 1 ? 'student' : 'students'} · Grade {s.gradeLevel}</span>
          <span className={cn('inline-flex items-center gap-1.5 font-medium', today.className)}>
            <today.icon className={cn('size-3', s.today.status === 'in_progress' && 'fill-current')} />
            {today.label}{s.today.observations ? ` · ${s.today.observations} noted` : ''}
          </span>
        </div>
      </div>
    </article>
  );
}
