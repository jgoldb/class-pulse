import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, Lock, RotateCcw } from 'lucide-react';
import { Button, Dialog, DialogContent } from '../../../components/ui';
import { ApiError, api } from '../../../lib/api';
import { classTitle } from '../../../lib/classes';
import type { ClassroomSection } from '../../../lib/types';
import { ClassFields, toFields, validate, type ClassDraft } from './ClassForm';

const draftOf = (s: ClassroomSection): ClassDraft => ({ courseName: s.courseName ?? '', name: s.name, gradeLevel: s.gradeLevel, periodTag: s.periodTag ?? 'none', room: s.room ?? '', accent: s.accent ?? 'blue' });

const ALL = { courseName: true, name: true, gradeLevel: true, periodTag: true, room: true, accent: true };

const invalidate = (qc: ReturnType<typeof useQueryClient>) => Promise.all([qc.invalidateQueries({ queryKey: ['classroom'] }), qc.invalidateQueries({ queryKey: ['pulse-sections'] })]);

/**
 * Edit Class (visual spec §9.3–9.4): pre-filled, Save stays disabled until something changes,
 * inline validation, and the section is updated in place — same id, same history. The teacher is
 * shown but not editable; reassigning a class is an administrator's decision. The roster is a
 * separate action (Manage Students) so metadata and roster changes never mix.
 */
export function EditClassDialog({ section, onOpenChange }: { section: ClassroomSection | null; onOpenChange(open: boolean): void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<ClassDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (section) { setValue(draftOf(section)); setError(''); } }, [section]);
  if (!section || !value) return <Dialog open={false} />;
  const initial = draftOf(section);
  const changed = (Object.keys(initial) as Array<keyof ClassDraft>).filter((k) => initial[k].trim() !== value[k].trim());
  const errors = validate(value);
  const valid = !Object.keys(errors).length;

  async function save() {
    if (!valid || !changed.length || !value || !section) return;
    setBusy(true); setError('');
    const fields = toFields(value);
    try {
      await api.patch(`/api/classroom/sections/${section.id}`, { ...Object.fromEntries(changed.map((k) => [k, fields[k]])), expectedUpdatedAt: section.updatedAt });
      await invalidate(qc);
      toast.success('Class updated.', { description: 'Every session, observation and draft stays with this class.' });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? `${e.message}` : e instanceof Error ? e.message : 'Could not save. Your changes are still here; try again.');
      if (e instanceof ApiError && e.status === 409) await invalidate(qc);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!section} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={`Edit ${classTitle(section)}`} description="Change the details below. History, drafts and the roster are not affected." className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {/* Every field starts filled in, so an error shows as soon as a change makes one invalid. */}
          <ClassFields value={value} onChange={setValue} errors={errors} showErrors={ALL} />
          <div className="mt-4 rounded-lg bg-sunken/70 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><Lock className="size-3.5 text-muted" /> Teacher</div>
            <p className="mt-0.5 text-muted">{section.teachers.map((t) => t.name).join(', ') || 'You'} · only your administrator can change who teaches this class.</p>
          </div>
          {changed.includes('periodTag') && <p className="mt-3 text-xs text-muted">The new period applies to sessions you open from now on. Past sessions keep the period they were taught in.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-danger-fg">{error}</p>}
          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!changed.length || !valid} data-testid="save-class">Save changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Archive with confirmation, never delete (spec §9.3): the class leaves Class Pulse; every record stays. */
export function ArchiveClassDialog({ section, onOpenChange }: { section: ClassroomSection | null; onOpenChange(open: boolean): void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!section) return <Dialog open={false} />;
  const archived = !!section.archivedAt;
  return (
    <Dialog open={!!section} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={archived ? `Restore ${classTitle(section)}?` : `Archive ${classTitle(section)}?`} description={archived ? 'It comes back to Class Pulse and can take new sessions again.' : 'It leaves Class Pulse and stops taking new sessions. Every observation, draft, approval and roster entry is kept, and you can restore it at any time.'}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={archived ? 'primary' : 'secondary'} loading={busy} data-testid="confirm-archive" onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/api/classroom/sections/${section.id}/archive`, { archived: !archived });
              await invalidate(qc);
              toast.success(archived ? 'Class restored.' : 'Class archived.', { description: archived ? undefined : 'Find it under Archived on this page.' });
              onOpenChange(false);
            } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update the class'); }
            finally { setBusy(false); }
          }}>{archived ? <><RotateCcw /> Restore class</> : <><Archive /> Archive class</>}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
