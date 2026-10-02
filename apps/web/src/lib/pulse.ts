import { CalendarCheck, ClipboardCheck, Eye, Hand, Lightbulb, MessageCircle, NotebookPen, Star, type LucideIcon } from 'lucide-react';
import type { ArtifactKind, ClassroomObservation } from '@class-pulse/domain';
import { humanize } from './api';

export type ObservationKind = ClassroomObservation['kind'];

/**
 * One vocabulary for every Pulsera surface. Strengths read in colour (participation blue, praise
 * teal, understanding sky); everything else stays neutral so a seat never looks like a warning.
 * Behavior in particular is a plain observation, never red or amber (visual spec §2.2, §5).
 * Colours are classes rather than tokens so Tailwind keeps them.
 */
export const OBSERVATION_META: Record<ObservationKind, { label: string; short: string; icon: LucideIcon; chip: string; dot: string; strength?: boolean }> = {
  participation: { label: 'Participation', short: 'Participated', icon: Hand, chip: 'bg-primary-soft text-primary-soft-fg', dot: 'bg-primary', strength: true },
  praise: { label: 'Praise', short: 'Praise', icon: Star, chip: 'bg-success-soft text-success-fg', dot: 'bg-success', strength: true },
  understanding: { label: 'Understanding', short: 'Understanding', icon: Lightbulb, chip: 'bg-info-soft text-info-fg', dot: 'bg-info', strength: true },
  check_in: { label: 'Check-in', short: 'Check-in', icon: MessageCircle, chip: 'bg-sunken text-fg/80', dot: 'bg-evidence' },
  behavior: { label: 'Behavior', short: 'Behavior', icon: Eye, chip: 'bg-sunken text-fg/80', dot: 'bg-evidence' },
  note: { label: 'Note', short: 'Note', icon: NotebookPen, chip: 'bg-sunken text-fg/80', dot: 'bg-evidence' },
  attendance: { label: 'Attendance', short: 'Attendance', icon: CalendarCheck, chip: 'bg-sunken text-muted', dot: 'bg-subtle' },
  exit_ticket: { label: 'Exit ticket', short: 'Exit ticket', icon: ClipboardCheck, chip: 'bg-info-soft text-info-fg', dot: 'bg-info' },
};

export function observationText(o: ClassroomObservation): string {
  switch (o.kind) {
    case 'participation': return humanize(o.action);
    case 'praise': return o.strength;
    case 'understanding': return `${o.concept} · ${o.evidence === 'demonstrated' ? 'demonstrated understanding' : o.evidence === 'needs_practice' ? 'needs more practice' : 'not checked'}`;
    case 'check_in': return o.observation;
    case 'behavior': return `${o.action}${o.measuredCount === null ? '' : ` · measured count ${o.measuredCount}`}`;
    case 'attendance': return humanize(o.status);
    case 'exit_ticket': return `${o.concept}: ${o.response} · ${humanize(o.assessment)}`;
    case 'note': return o.note;
  }
}

export function emptyObservation(kind: ObservationKind, topic = ''): ClassroomObservation {
  switch (kind) {
    case 'participation': return { kind, action: 'contributed', note: '' };
    case 'praise': return { kind, strength: '', note: '' };
    case 'understanding': return { kind, concept: topic, evidence: 'demonstrated', note: '' };
    case 'check_in': return { kind, observation: '', note: '' };
    case 'behavior': return { kind, action: '', antecedent: null, consequence: null, measuredCount: null, note: '' };
    case 'attendance': return { kind, status: 'present', note: '' };
    case 'exit_ticket': return { kind, concept: topic, response: '', assessment: 'not_assessed', note: '' };
    case 'note': return { kind, note: '' };
  }
}

export const ARTIFACT_META: Record<ArtifactKind, { label: string; group: InboxGroup; produces: string }> = {
  abc: { label: 'ABC observation', group: 'documentation', produces: 'ABC documentation draft' },
  positive_note: { label: 'Positive note', group: 'documentation', produces: 'Positive note' },
  parent_message: { label: 'Family message', group: 'family', produces: 'Parent communication draft' },
  do_now: { label: 'Do Now', group: 'tomorrow', produces: 'Tomorrow’s Do Now' },
  reteach: { label: 'Reteach plan', group: 'instruction', produces: 'Reteach suggestion' },
  small_group: { label: 'Small group', group: 'instruction', produces: 'Small-group plan' },
  sst_report: { label: 'SST evidence packet', group: 'intervention', produces: 'SST evidence packet' },
  mtss_report: { label: 'MTSS documentation', group: 'intervention', produces: 'MTSS documentation' },
  fba_observations: { label: 'FBA-support observations', group: 'intervention', produces: 'FBA-support observation summary' },
  guide_explain: { label: 'Guide · evidence explained', group: 'instruction', produces: 'Evidence explanation' },
  guide_adjust: { label: 'Guide · instructional adjustment', group: 'instruction', produces: 'Instructional adjustment' },
  guide_next_step: { label: 'Guide · next step', group: 'instruction', produces: 'Next step' },
  support_recommendation: { label: 'Support recommendation', group: 'intervention', produces: 'Support recommendation' },
};

export type InboxGroup = 'documentation' | 'instruction' | 'family' | 'tomorrow' | 'intervention';
/** The Draft Inbox filter chips, in the order the spec lists them (§8). */
export const INBOX_GROUPS: Array<{ id: InboxGroup; label: string; hint: string }> = [
  { id: 'documentation', label: 'Documentation', hint: 'ABC observations and positive notes from your taps.' },
  { id: 'instruction', label: 'Instruction', hint: 'Reteach, small groups and Guide suggestions.' },
  { id: 'family', label: 'Family', hint: 'Family messages. Approving never sends anything.' },
  { id: 'tomorrow', label: 'Tomorrow', hint: 'Next-class activities prepared from today.' },
  { id: 'intervention', label: 'Intervention', hint: 'Support recommendations and SST, MTSS and FBA-support evidence packets.' },
];

/** Who a draft is written for, in the teacher's words. */
export const ARTIFACT_AUDIENCE: Record<ArtifactKind, string> = {
  abc: 'Your records', positive_note: 'Student or family, if you choose', parent_message: 'Family, if you choose', do_now: 'Your class', reteach: 'Your class', small_group: 'A small group',
  sst_report: 'Student support team', mtss_report: 'MTSS team', fba_observations: 'Support team', guide_explain: 'You', guide_adjust: 'You', guide_next_step: 'You', support_recommendation: 'You and the student',
};

/**
 * Live-to-Draft: what Pulsera can draft from a single confirmed observation. The server
 * re-checks every rule (one student, matching evidence types); this only decides which buttons to
 * show.
 */
export function draftOptions(o: ClassroomObservation): ArtifactKind[] {
  switch (o.kind) {
    case 'praise':
    case 'participation': return ['positive_note', 'parent_message'];
    case 'behavior': return ['abc', 'parent_message'];
    case 'understanding': return o.evidence === 'needs_practice' ? ['reteach', 'do_now'] : ['positive_note'];
    case 'exit_ticket': return o.assessment === 'needs_practice' ? ['reteach', 'do_now'] : ['do_now'];
    case 'check_in':
    case 'note': return ['support_recommendation', 'guide_next_step'];
    case 'attendance': return [];
  }
}

/**
 * Teacher Confirm: Suggested → Confirmed → Logged (visual spec §7). Generation and review are
 * separate axes on the server; this folds them into the one state a teacher needs.
 *   suggested     violet — an AI draft or an unconfirmed observation, awaiting the teacher
 *   needs_review  amber  — something changed under it; look again before relying on it
 *   confirmed     teal   — the teacher confirmed it
 *   logged        quiet teal — approved and in the record
 * Off-path states (preparing, failed, AI off, discarded) show as a single labelled pill.
 */
export type ConfirmKind = 'suggested' | 'needs_review' | 'confirmed' | 'logged' | 'preparing' | 'failed' | 'off' | 'discarded';
export type ConfirmStage = { kind: ConfirmKind; step: 0 | 1 | 2 | 3; label: string; detail?: string };
export function draftStage(d: { generationState: string; reviewState: string; publicationState: string }): ConfirmStage {
  if (d.reviewState === 'discarded') return { kind: 'discarded', step: 0, label: 'Discarded' };
  if (d.reviewState === 'stale') return { kind: 'needs_review', step: 1, label: 'Needs review', detail: 'An observation it relied on was corrected or undone.' };
  if (d.generationState === 'queued' || d.generationState === 'running') return { kind: 'preparing', step: 0, label: 'Preparing', detail: 'Pulsera is drafting. Capture keeps working.' };
  if (d.generationState === 'failed') return { kind: 'failed', step: 0, label: 'Draft failed', detail: 'Your observations are saved. Try drafting again.' };
  if (d.generationState === 'disabled') return { kind: 'off', step: 0, label: 'AI is off', detail: 'The observation is saved; drafting is unavailable.' };
  if (d.reviewState === 'approved' && d.publicationState === 'needs_review') return { kind: 'needs_review', step: 3, label: 'Needs review', detail: 'A source was corrected after you approved it.' };
  if (d.reviewState === 'approved') return { kind: 'logged', step: 3, label: 'Logged', detail: 'Approved and in the record' };
  return { kind: 'suggested', step: 1, label: 'Suggested', detail: 'Awaiting your review' };
}
/** A draft waiting on the teacher: ready and suggested, or something changed under it. */
export const needsTeacher = (d: { generationState: string; reviewState: string; publicationState: string }) => d.generationState === 'ready' && ['suggested', 'needs_review'].includes(draftStage(d).kind);
