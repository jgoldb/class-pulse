import { CalendarCheck, ClipboardCheck, Hand, Lightbulb, MessageCircle, NotebookPen, Star, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ArtifactKind, ClassroomObservation } from '@class-pulse/domain';
import { humanize } from './api';

export type ObservationKind = ClassroomObservation['kind'];

/**
 * One vocabulary for every Pulsera surface. Colours are classes rather than tokens so Tailwind
 * keeps them; each pairs a soft background with a readable foreground in both themes.
 */
export const OBSERVATION_META: Record<ObservationKind, { label: string; icon: LucideIcon; chip: string; dot: string }> = {
  participation: { label: 'Participation', icon: Hand, chip: 'bg-primary-soft text-primary-soft-fg', dot: 'bg-primary' },
  praise: { label: 'Praise', icon: Star, chip: 'bg-warning-soft text-warning-fg', dot: 'bg-warning' },
  understanding: { label: 'Understanding', icon: Lightbulb, chip: 'bg-info-soft text-info-fg', dot: 'bg-info' },
  check_in: { label: 'Check-in', icon: MessageCircle, chip: 'bg-proposal-soft text-proposal', dot: 'bg-proposal' },
  behavior: { label: 'Behavior', icon: TriangleAlert, chip: 'bg-hypothesis-soft text-hypothesis', dot: 'bg-hypothesis' },
  note: { label: 'Note', icon: NotebookPen, chip: 'bg-evidence-soft text-evidence', dot: 'bg-evidence' },
  attendance: { label: 'Attendance', icon: CalendarCheck, chip: 'bg-sunken text-muted', dot: 'bg-subtle' },
  exit_ticket: { label: 'Exit ticket', icon: ClipboardCheck, chip: 'bg-info-soft text-info-fg', dot: 'bg-info' },
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
  positive_note: { label: 'Positive note', group: 'positive', produces: 'Positive behavior note' },
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

export type InboxGroup = 'documentation' | 'instruction' | 'family' | 'positive' | 'tomorrow' | 'intervention';
export const INBOX_GROUPS: Array<{ id: InboxGroup; label: string; hint: string }> = [
  { id: 'documentation', label: 'Documentation', hint: 'ABC observations drafted from behavior taps.' },
  { id: 'instruction', label: 'Instruction', hint: 'Reteach, small groups and Guide suggestions.' },
  { id: 'family', label: 'Family', hint: 'Parent communication. Approving never sends anything.' },
  { id: 'positive', label: 'Positive notes', hint: 'Praise and participation turned into notes.' },
  { id: 'tomorrow', label: 'Tomorrow', hint: 'Next-class activities prepared from today.' },
  { id: 'intervention', label: 'Intervention reviews', hint: 'Support recommendations and SST, MTSS and FBA-support evidence packets.' },
];

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
 * Teacher Confirm: Suggested → Confirmed → Logged. Generation and review are separate axes on
 * the server; this folds them into the one sentence a teacher needs.
 */
export type ConfirmStage = { step: 0 | 1 | 2 | 3; label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'; detail?: string };
export function draftStage(d: { generationState: string; reviewState: string; publicationState: string }): ConfirmStage {
  if (d.reviewState === 'discarded') return { step: 0, label: 'Discarded', tone: 'neutral' };
  if (d.reviewState === 'stale') return { step: 0, label: 'Source changed', tone: 'warning', detail: 'An observation it relied on was corrected or undone.' };
  if (d.generationState === 'queued' || d.generationState === 'running') return { step: 0, label: 'Preparing', tone: 'info', detail: 'Pulsera is drafting. Capture keeps working.' };
  if (d.generationState === 'failed') return { step: 0, label: 'Draft failed', tone: 'danger' };
  if (d.generationState === 'disabled') return { step: 0, label: 'AI is off', tone: 'neutral', detail: 'The observation is saved; drafting is unavailable.' };
  if (d.reviewState === 'approved' && d.publicationState === 'needs_review') return { step: 3, label: 'Logged · source review', tone: 'warning', detail: 'A source was corrected after approval.' };
  if (d.reviewState === 'approved') return { step: 3, label: 'Logged', tone: 'success' };
  return { step: 1, label: 'Suggested', tone: 'info', detail: 'Awaiting your review' };
}
