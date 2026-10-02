import { SECTION_ACCENTS, SECTION_PERIODS, SectionFields, periodLabel } from '@class-pulse/domain';
import { Check } from 'lucide-react';
import { Field, Input, Select, cn } from '../../../components/ui';
import { ACCENTS } from '../../../lib/classes';

/** The editable metadata of a class, as the form holds it (strings; blank means none). */
export type ClassDraft = { courseName: string; name: string; gradeLevel: string; periodTag: string; room: string; accent: string };
export const emptyClass: ClassDraft = { courseName: '', name: '', gradeLevel: '', periodTag: 'none', room: '', accent: 'blue' };

export function toFields(d: ClassDraft) {
  return { courseName: d.courseName.trim() || null, name: d.name.trim(), gradeLevel: d.gradeLevel.trim(), periodTag: d.periodTag === 'none' ? null : d.periodTag, room: d.room.trim() || null, accent: d.accent || null };
}

/** Inline validation with the same schema the API enforces, keyed by field. */
export function validate(d: ClassDraft): Partial<Record<keyof ClassDraft, string>> {
  const r = SectionFields.safeParse(toFields(d));
  if (r.success) return {};
  const errors: Partial<Record<keyof ClassDraft, string>> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as keyof ClassDraft;
    if (!errors[k]) errors[k] = issue.code === 'too_big' ? 'That is too long' : issue.message;
  }
  return errors;
}

const PERIOD_OPTIONS = [{ value: 'none', label: 'No set period' }, ...SECTION_PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))];

/**
 * Class information fields (visual spec §9.2): course, section name, grade, period, room and an
 * optional accent. Shared by Add Class and Edit Class so the two can never drift.
 */
export function ClassFields({ value, onChange, errors, showErrors }: { value: ClassDraft; onChange(v: ClassDraft): void; errors: Partial<Record<keyof ClassDraft, string>>; showErrors: Partial<Record<keyof ClassDraft, boolean>> }) {
  const set = (k: keyof ClassDraft) => (v: string) => onChange({ ...value, [k]: v });
  const err = (k: keyof ClassDraft) => (showErrors[k] ? errors[k] : undefined);
  return (
    <div className="space-y-4">
      <Field label="Subject or course" hint="optional" error={err('courseName')}>
        <Input value={value.courseName} onChange={(e) => set('courseName')(e.target.value)} placeholder="English Language Arts 7" maxLength={120} data-testid="class-course" aria-invalid={!!err('courseName')} />
      </Field>
      <Field label="Section name" hint="what you call it out loud" error={err('name')}>
        <Input value={value.name} onChange={(e) => set('name')(e.target.value)} placeholder="7 ELA - Section 2" maxLength={120} data-testid="section-name" aria-invalid={!!err('name')} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Grade" error={err('gradeLevel')}>
          <Input value={value.gradeLevel} onChange={(e) => set('gradeLevel')(e.target.value)} placeholder="7" maxLength={20} data-testid="section-grade" aria-invalid={!!err('gradeLevel')} required />
        </Field>
        <Field label="Period" error={err('periodTag')}>
          <Select ariaLabel="Period" value={value.periodTag} onChange={set('periodTag')} options={PERIOD_OPTIONS} />
        </Field>
        <Field label="Room" hint="optional" error={err('room')}>
          <Input value={value.room} onChange={(e) => set('room')(e.target.value)} placeholder="204" maxLength={40} data-testid="class-room" aria-invalid={!!err('room')} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Accent <span className="font-normal text-muted">optional</span></legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          {SECTION_ACCENTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={value.accent === a} aria-label={ACCENTS[a]!.label} onClick={() => set('accent')(a)}
              className={cn('flex size-10 items-center justify-center rounded-full border-2 transition-transform hover:scale-105', value.accent === a ? 'border-fg' : 'border-transparent')}>
              <span className="flex size-7 items-center justify-center rounded-full text-white" style={{ background: ACCENTS[a]!.swatch }}>{value.accent === a && <Check className="size-4" />}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
