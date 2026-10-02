import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, FileUp, Plus, Trash2, UserPlus } from 'lucide-react';
import { parseRosterCsv, periodLabel, type RosterImportRow } from '@class-pulse/domain';
import { Avatar, Button, Callout, Dialog, DialogContent, Input, Segmented, cn } from '../../../components/ui';
import { api } from '../../../lib/api';
import { accentOf } from '../../../lib/classes';
import { ClassFields, emptyClass, toFields, validate, type ClassDraft } from './ClassForm';

type Person = { firstName: string; lastName: string };
type Saved = { step: number; klass: ClassDraft; people: Person[] };
const KEY = 'cp.addClassDraft';
const STEPS = ['Class details', 'Students', 'Review'] as const;

function loadDraft(): Saved | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Saved) : null; } catch { return null; }
}

/** "Avery Jones", "Jones, Avery" or "Avery Mae Jones" → first and last name. */
function splitName(line: string): Person | null {
  const t = line.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if (t.includes(',')) { const [last, first] = t.split(',').map((s) => s.trim()); return first && last ? { firstName: first, lastName: last } : null; }
  const parts = t.split(' ');
  return parts.length < 2 ? null : { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}

/**
 * Add Class (visual spec §9.2): class information, then students (typed or imported), then a
 * review before anything is saved. No AI, intervention or administrative settings here. The form
 * autosaves to this browser as the teacher goes, so closing the dialog loses nothing.
 */
export function AddClassDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const qc = useQueryClient();
  const restored = useMemo(() => (open ? loadDraft() : null), [open]);
  const [step, setStep] = useState(0);
  const [klass, setKlass] = useState<ClassDraft>(emptyClass);
  const [people, setPeople] = useState<Person[]>([]);
  const [mode, setMode] = useState<'type' | 'csv'>('type');
  const [csv, setCsv] = useState<{ name: string; rows: RosterImportRow[] } | null>(null);
  const [csvError, setCsvError] = useState('');
  const [entry, setEntry] = useState({ firstName: '', lastName: '' });
  const [paste, setPaste] = useState('');
  const [touched, setTouched] = useState<Partial<Record<keyof ClassDraft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const d = restored;
    setStep(d?.step ?? 0); setKlass(d?.klass ?? emptyClass); setPeople(d?.people ?? []);
    setCsv(null); setCsvError(''); setError(''); setTouched({}); setMode('type');
  }, [open, restored]);
  // Autosave (spec §13: teachers should not fear losing work). CSV files are not kept; they are re-picked.
  useEffect(() => {
    if (!open) return;
    const dirty = JSON.stringify(klass) !== JSON.stringify(emptyClass) || people.length;
    try { if (dirty) localStorage.setItem(KEY, JSON.stringify({ step, klass, people })); } catch { /* storage unavailable */ }
  }, [open, step, klass, people]);

  const errors = validate(klass);
  const detailsOk = !Object.keys(errors).length;
  const addPerson = (p: Person | null) => { if (p && p.firstName.trim() && p.lastName.trim()) setPeople((list) => [...list, { firstName: p.firstName.trim(), lastName: p.lastName.trim() }]); };
  const studentCount = people.length + (csv?.rows.length ?? 0);

  function next() {
    if (step === 0 && !detailsOk) { setTouched({ name: true, gradeLevel: true, courseName: true, room: true }); return; }
    setStep((s) => Math.min(2, s + 1));
  }
  function discard() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setStep(0); setKlass(emptyClass); setPeople([]); setCsv(null);
  }
  async function create() {
    setBusy(true); setError('');
    try {
      const created = await api.post<{ id: string; students: number }>('/api/classroom/sections', { ...toFields(klass), students: people });
      let imported = 0;
      if (csv?.rows.length) {
        try {
          const r = await api.post<{ created: number; added: number }>('/api/classroom/import/confirm', { sectionId: created.id, rows: csv.rows, confirmed: true });
          imported = r.created + r.added;
        } catch (e) {
          toast.error('Class created, but the roster file was not imported', { description: `${e instanceof Error ? e.message : 'Import failed'} Open Manage Students to import it again.` });
        }
      }
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      await Promise.all([qc.invalidateQueries({ queryKey: ['classroom'] }), qc.invalidateQueries({ queryKey: ['pulse-sections'] }), qc.invalidateQueries({ queryKey: ['roster'] })]);
      toast.success('Class created', { description: `${klass.courseName || klass.name} · ${created.students + imported} student${created.students + imported === 1 ? '' : 's'}` });
      onOpenChange(false);
      setStep(0); setKlass(emptyClass); setPeople([]); setCsv(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the class. Your details are kept; try again.');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Add a class" description="Start with the basics. You can change any of this later with Edit Class." className="max-w-xl">
        <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} className="space-y-1.5">
              <div className={cn('h-1 rounded-full transition-colors', i <= step ? 'bg-primary' : 'bg-sunken')} />
              <div className={cn('text-xs font-medium', i === step ? 'text-fg' : 'text-muted')}>{i + 1}. {label}</div>
            </li>
          ))}
        </ol>

        {restored && step === (restored.step ?? 0) && JSON.stringify(klass) === JSON.stringify(restored.klass) && (
          <Callout tone="primary" className="mb-4" action={<Button size="sm" variant="ghost" onClick={discard}>Start over</Button>}>We kept the class you started earlier.</Callout>
        )}

        {step === 0 && <ClassFields value={klass} onChange={setKlass} errors={errors} showErrors={touched} />}

        {step === 1 && (
          <div className="space-y-4">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'type', label: 'Type names' }, { value: 'csv', label: 'Import a roster file' }]} />
            {mode === 'type' ? (
              <>
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); addPerson(entry); setEntry({ firstName: '', lastName: '' }); }}>
                  <label className="min-w-0 flex-1 space-y-1.5 text-sm font-medium">First name<Input value={entry.firstName} onChange={(e) => setEntry({ ...entry, firstName: e.target.value })} data-testid="new-student-first" /></label>
                  <label className="min-w-0 flex-1 space-y-1.5 text-sm font-medium">Last name<Input value={entry.lastName} onChange={(e) => setEntry({ ...entry, lastName: e.target.value })} data-testid="new-student-last" /></label>
                  <Button type="submit" variant="secondary" disabled={!entry.firstName.trim() || !entry.lastName.trim()} data-testid="new-student-add"><UserPlus /> Add</Button>
                </form>
                <details className="rounded-lg border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Paste a list of names</summary>
                  <p className="mt-2 text-xs text-muted">One student per line, as “First Last” or “Last, First”.</p>
                  <textarea className="mt-2 w-full rounded-md border border-border bg-elevated p-2 text-sm" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} />
                  <Button size="sm" variant="secondary" className="mt-2" disabled={!paste.trim()} onClick={() => { paste.split('\n').map(splitName).forEach(addPerson); setPaste(''); }}><Plus /> Add these names</Button>
                </details>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted">A CSV with the headers externalId, firstName, lastName and an optional gradeLevel. You will review it before anything is saved.</p>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-strong p-4 text-sm hover:bg-sunken/60">
                  <FileUp className="size-5 text-muted" />
                  <span className="flex-1">{csv ? <><span className="font-medium">{csv.name}</span> · {csv.rows.length} students</> : 'Choose a roster file'}</span>
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
                    const file = e.target.files?.[0]; setCsvError(''); setCsv(null);
                    if (!file) return;
                    try { setCsv({ name: file.name, rows: parseRosterCsv(await file.text()) }); }
                    catch (err) { setCsvError(err instanceof Error ? err.message : 'Could not read that file'); }
                  }} />
                </label>
                {csvError && <p role="alert" className="text-sm text-danger-fg">{csvError}. Check the headers and try again.</p>}
              </div>
            )}
            <StudentList people={people} csv={csv?.rows ?? []} onRemove={(i) => setPeople((list) => list.filter((_, n) => n !== i))} />
            {!studentCount && <p className="text-sm text-muted">Students are optional now. You can add them any time from Manage Students.</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="h-1.5" style={{ background: accentOf(klass.accent).swatch }} />
              <div className="space-y-1 p-4">
                <div className="text-lg font-semibold">{klass.courseName || klass.name}</div>
                <div className="text-sm text-muted">{[klass.courseName ? klass.name : null, `Grade ${klass.gradeLevel}`, periodLabel(klass.periodTag === 'none' ? null : klass.periodTag) || null, klass.room ? `Room ${klass.room}` : null].filter(Boolean).join(' · ')}</div>
                <div className="text-sm">{studentCount ? `${studentCount} student${studentCount === 1 ? '' : 's'}` : 'No students yet'}</div>
              </div>
            </div>
            <StudentList people={people} csv={csv?.rows ?? []} />
            <p className="text-xs text-muted">Students’ names stay in your school’s records. Pulsera’s detection and AI drafting only ever see de-identified observations.</p>
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-danger-fg">{error}</p>}
        <div className="mt-6 flex items-center justify-between gap-2 border-t border-border pt-4">
          {step > 0 ? <Button variant="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}><ArrowLeft /> Back</Button> : <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>}
          {step < 2
            ? <Button onClick={next} data-testid="add-class-next">{step === 1 && !studentCount ? 'Skip for now' : 'Continue'} <ArrowRight /></Button>
            : <Button loading={busy} onClick={() => void create()} data-testid="add-class-create"><Check /> Create class</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StudentList({ people, csv, onRemove }: { people: Person[]; csv: RosterImportRow[]; onRemove?(i: number): void }) {
  if (!people.length && !csv.length) return null;
  return (
    <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Students to add">
      {people.map((p, i) => (
        <li key={`p${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
          <Avatar name={`${p.firstName} ${p.lastName}`} size="sm" />
          <span className="flex-1">{p.firstName} {p.lastName}</span>
          {onRemove && <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${p.firstName} ${p.lastName}`} onClick={() => onRemove(i)}><Trash2 /></Button>}
        </li>
      ))}
      {csv.map((r) => (
        <li key={r.externalId} className="flex items-center gap-3 px-3 py-2 text-sm">
          <Avatar name={`${r.firstName} ${r.lastName}`} size="sm" />
          <span className="flex-1">{r.firstName} {r.lastName}</span>
          <span className="text-xs text-muted">from file</span>
        </li>
      ))}
    </ul>
  );
}
