import type { ClassroomObservation } from '@class-pulse/domain';
import { Button, Dialog, DialogContent, Input, Segmented, Textarea, cn } from '../../../components/ui';
import { OBSERVATION_META, emptyObservation, type ObservationKind } from '../../../lib/pulse';

export const selectStyle = 'min-h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm';
const field = 'block space-y-1.5 text-sm font-medium';

/** Kinds a teacher can choose when writing or correcting an observation by hand. */
const EDITABLE: ObservationKind[] = ['participation', 'praise', 'understanding', 'check_in', 'behavior', 'note', 'attendance', 'exit_ticket'];

export function ObservationFields({ value: o, onChange: set, topic, lockKind }: { value: ClassroomObservation; onChange(v: ClassroomObservation): void; topic: string; lockKind?: boolean }) {
  return (
    <div className="space-y-4">
      {!lockKind && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Observation type</legend>
          <div className="flex flex-wrap gap-1.5">
            {EDITABLE.map((k) => {
              const meta = OBSERVATION_META[k];
              const Icon = meta.icon;
              return (
                <button key={k} type="button" aria-pressed={o.kind === k} onClick={() => o.kind !== k && set(emptyObservation(k, topic))} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors', o.kind === k ? cn(meta.chip, 'border-transparent') : 'border-border text-muted hover:text-fg')}>
                  <Icon className="size-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {o.kind === 'participation' && (
        <div className={field}><span>Action</span>
          <Segmented size="sm" value={o.action} onChange={(action) => set({ ...o, action })} options={[{ value: 'contributed', label: 'Contributed' }, { value: 'asked_question', label: 'Asked a question' }, { value: 'collaborated', label: 'Collaborated' }]} />
        </div>
      )}
      {o.kind === 'praise' && <label className={field}>Strength or success<Input required maxLength={500} value={o.strength} onChange={(e) => set({ ...o, strength: e.target.value })} placeholder="Explained their reasoning to a partner" /></label>}
      {(o.kind === 'understanding' || o.kind === 'exit_ticket') && <label className={field}>Concept<Input required maxLength={500} value={o.concept} onChange={(e) => set({ ...o, concept: e.target.value })} placeholder="Equivalent fractions" /></label>}
      {o.kind === 'understanding' && (
        <div className={field}><span>Observed evidence</span>
          <Segmented size="sm" value={o.evidence} onChange={(evidence) => set({ ...o, evidence })} options={[{ value: 'demonstrated', label: 'Demonstrated' }, { value: 'needs_practice', label: 'Needs practice' }, { value: 'not_checked', label: 'Not checked' }]} />
        </div>
      )}
      {o.kind === 'check_in' && <label className={field}>What did you observe?<Input required maxLength={500} value={o.observation} onChange={(e) => set({ ...o, observation: e.target.value })} placeholder="Checked progress on problem 3" /></label>}
      {o.kind === 'behavior' && (
        <>
          <label className={field}>Observable behavior<Input required maxLength={500} value={o.action} onChange={(e) => set({ ...o, action: e.target.value })} placeholder="Left assigned seat during independent work" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Antecedent — what happened before <span className="font-normal text-subtle">(optional)</span><Textarea rows={2} maxLength={2000} value={o.antecedent ?? ''} onChange={(e) => set({ ...o, antecedent: e.target.value || null })} /></label>
            <label className={field}>Consequence — what happened after <span className="font-normal text-subtle">(optional)</span><Textarea rows={2} maxLength={2000} value={o.consequence ?? ''} onChange={(e) => set({ ...o, consequence: e.target.value || null })} /></label>
          </div>
          <label className={field}>Measured count <span className="font-normal text-subtle">(leave blank if you did not count)</span><Input type="number" min={0} max={10000} step={1} value={o.measuredCount ?? ''} onChange={(e) => set({ ...o, measuredCount: e.target.value === '' ? null : Number(e.target.value) })} className="block max-w-32" /></label>
        </>
      )}
      {o.kind === 'attendance' && (
        <div className={field}><span>Attendance</span>
          <Segmented size="sm" value={o.status} onChange={(status) => set({ ...o, status })} options={[{ value: 'present', label: 'Present' }, { value: 'late', label: 'Late' }, { value: 'absent', label: 'Absent' }]} />
        </div>
      )}
      {o.kind === 'exit_ticket' && (
        <>
          <label className={field}>Reviewed response<Input required maxLength={500} value={o.response} onChange={(e) => set({ ...o, response: e.target.value })} /></label>
          <div className={field}><span>Assessment</span>
            <Segmented size="sm" value={o.assessment} onChange={(assessment) => set({ ...o, assessment })} options={[{ value: 'demonstrated', label: 'Demonstrated' }, { value: 'needs_practice', label: 'Needs practice' }, { value: 'not_assessed', label: 'Not assessed' }]} />
          </div>
        </>
      )}
      {o.kind === 'note' ? (
        <label className={field}>Note<Textarea required rows={4} maxLength={2000} value={o.note} onChange={(e) => set({ ...o, note: e.target.value })} placeholder="Observable actions and context, without names or diagnoses" /></label>
      ) : (
        <label className={field}>Context note <span className="font-normal text-subtle">(optional)</span><Textarea rows={2} maxLength={2000} value={o.note} onChange={(e) => set({ ...o, note: e.target.value })} placeholder="Observable actions, without names or diagnoses" /></label>
      )}
    </div>
  );
}

export interface EditorState {
  mode: 'record' | 'correct';
  observation: ClassroomObservation;
  studentId: string;
  reason: string;
  /** The observation being corrected. */
  eventId?: string;
}

/** Record a detailed observation, or correct an existing one with a reason (a new revision). */
export function ObservationDialog({ state, onChange, onClose, onSubmit, students, topic, busy, blocked, error }: {
  state: EditorState | null; onChange(s: EditorState): void; onClose(): void;
  onSubmit(confirmed: boolean): void; students: Array<{ id: string; displayName: string }>;
  topic: string; busy: boolean; blocked: boolean; error: string;
}) {
  const correcting = state?.mode === 'correct';
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && !busy && onClose()}>
      {state && (
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" title={correcting ? 'Correct observation' : `Record ${OBSERVATION_META[state.observation.kind].label.toLowerCase()}`} description={correcting ? 'Corrections save a new version. Drafts that used the old version are marked for review.' : 'Check the wording and the student before you confirm.'}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(true); }}>
            {error && <p role="alert" className="rounded-md bg-danger-soft p-2.5 text-sm text-danger-fg">{error}</p>}
            <label className={field}>Student<select className={selectStyle} value={state.studentId} onChange={(e) => onChange({ ...state, studentId: e.target.value })}>{students.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
            <ObservationFields value={state.observation} onChange={(observation) => onChange({ ...state, observation })} topic={topic} lockKind={!correcting} />
            {correcting && <label className={field}>Reason for correction<Input required maxLength={500} value={state.reason} onChange={(e) => onChange({ ...state, reason: e.target.value })} placeholder="Selected the wrong student" /></label>}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={busy || blocked} loading={busy}>Confirm {correcting ? 'correction' : 'observation'}</Button>
              {!correcting && <Button type="button" variant="secondary" disabled={busy || blocked} onClick={() => onSubmit(false)}>Save for review</Button>}
              <span className="text-xs text-muted">{correcting ? '' : 'Saved for review stays “Suggested” until you confirm it.'}</span>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
