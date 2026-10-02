import { z } from 'zod';
import { CONTEXT_DIMENSIONS } from './signals';

/**
 * A class section's teacher-editable metadata (Pulsera UX spec §9). The section id never changes,
 * so editing any of this keeps every session, observation, draft and seating version attached.
 *
 * The period is a schedule tag from the controlled context vocabulary, because Class Pulse copies
 * it onto each new session as a context tag the pattern engine reads. Free text would leak into
 * detection as an unknown tag, so the period is validated against the schedule dimension.
 */
export const SECTION_PERIODS = CONTEXT_DIMENSIONS.schedule;
export type SectionPeriod = (typeof SECTION_PERIODS)[number];

/** Accent colours a teacher can give a class card. Names, not hex: the theme decides the shade. */
export const SECTION_ACCENTS = ['blue', 'teal', 'violet', 'sky', 'indigo', 'slate'] as const;
export type SectionAccent = (typeof SECTION_ACCENTS)[number];

/** Blank optional text means "no value", so a cleared field stores null rather than "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

export const SectionFields = z.object({
  /** Section name, as the teacher says it out loud: "7 ELA - Section 2". */
  name: z.string().trim().min(1, 'Give the class a name').max(120),
  /** Subject or course: "English Language Arts 7". Optional; cards fall back to the name. */
  courseName: optionalText(120),
  gradeLevel: z.string().trim().min(1, 'Add a grade').max(20),
  periodTag: z.enum(SECTION_PERIODS).nullable(),
  room: optionalText(40),
  accent: z.enum(SECTION_ACCENTS).nullable(),
});
export type SectionFields = z.infer<typeof SectionFields>;

/**
 * PATCH body: any subset of the fields, at least one. `expectedUpdatedAt` is optional optimistic
 * concurrency — the edit dialog sends the value it loaded so two open tabs cannot silently
 * overwrite each other.
 */
export const SectionUpdate = SectionFields.partial()
  .extend({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedUpdatedAt'), { message: 'Nothing to change' });
export type SectionUpdate = z.infer<typeof SectionUpdate>;

/** A student typed into the Add Class flow before the section exists. */
export const NewRosterStudent = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  gradeLevel: z.string().trim().max(20).nullable().optional(),
});

export const SectionCreate = SectionFields.extend({
  schoolId: z.string().nullable().optional(),
  courseName: optionalText(120).optional().default(null),
  room: optionalText(40).optional().default(null),
  accent: z.enum(SECTION_ACCENTS).nullable().optional().default(null),
  periodTag: z.enum(SECTION_PERIODS).nullable().optional().default(null),
  /** Students added by hand in the same step are created with the section, atomically. */
  students: z.array(NewRosterStudent).max(200).optional().default([]),
});
export type SectionCreate = z.infer<typeof SectionCreate>;

/** "period_3" → "Period 3"; "morning" → "Morning". */
export function periodLabel(tag: string | null | undefined): string {
  if (!tag) return '';
  const m = /^period_(\d+)$/.exec(tag);
  return m ? `Period ${m[1]}` : tag.charAt(0).toUpperCase() + tag.slice(1);
}
