import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Link2, MoreHorizontal, Pencil, Sparkles, Undo2, X } from 'lucide-react';
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactSource, type ClassroomObservation } from '@class-pulse/domain';
import { Button, Dropdown, DropdownContent, DropdownItem, DropdownTrigger, Empty, Segmented, cn } from '../../../components/ui';
import { ObservationConfirm, TeacherConfirm } from '../../../components/TeacherConfirm';
import { fmtDateTime, humanize } from '../../../lib/api';
import { ARTIFACT_META, OBSERVATION_META, draftOptions, draftStage, observationText } from '../../../lib/pulse';

export type PulseEvent = { id: string; revision: number; status: string; studentId: string; observation: ClassroomObservation; observedAt: string; confirmedAt: string | null; confirmedBy: string | null; source: string };
export type DraftRow = { id: string; sessionId: string; kind: ArtifactKind; revision: number; sources: ArtifactSource[]; generationState: string; reviewState: string; publicationState: string };

const SOURCE_LABEL: Record<string, string> = { teacher_tap: 'Tapped', teacher_text: 'Written', reviewed_transcript: 'Reviewed transcript' };
/** Multi-source drafts are prepared from an explicit selection rather than a single observation. */
const SELECTION_KINDS = ARTIFACT_KINDS.filter((k) => !k.startsWith('guide_'));

export function ActivityFeed({ events, drafts, nameOf, selectedStudent, busy, onConfirm, onCorrect, onUndo, onProject, onDraft }: {
  events: PulseEvent[]; drafts: DraftRow[]; nameOf(id: string): string; selectedStudent: string; busy: boolean;
  onConfirm(e: PulseEvent): void; onCorrect(e: PulseEvent): void; onUndo(e: PulseEvent): void; onProject(e: PulseEvent): void;
  onDraft(kind: ArtifactKind, sources: PulseEvent[]): Promise<boolean>;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'student'>('all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState<ArtifactKind>('sst_report');
  const pending = events.filter((e) => e.status === 'pending').length;
  const visible = events.filter((e) => e.status !== 'withdrawn' && (filter === 'all' || (filter === 'pending' ? e.status === 'pending' : e.studentId === selectedStudent)));
  // Class-level activities go stale whenever new evidence arrives; Tomorrow offers the refresh, so they are not repeated here.
  const draftsFor = (e: PulseEvent) => drafts.filter((d) => d.reviewState !== 'discarded' && !(d.reviewState === 'stale' && ['do_now', 'reteach', 'small_group'].includes(d.kind)) && d.sources.some((s) => s.eventId === e.id && s.revision === e.revision));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented size="sm" value={filter} onChange={setFilter} options={[
          { value: 'all', label: `All (${events.filter((e) => e.status !== 'withdrawn').length})` },
          { value: 'pending', label: `To confirm (${pending})` },
          ...(selectedStudent ? [{ value: 'student' as const, label: nameOf(selectedStudent).split(' ')[0] }] : []),
        ]} />
        {selecting
          ? <Button size="sm" variant="ghost" onClick={() => { setSelecting(false); setPicked([]); }}><X /> Cancel selection</Button>
          : <Button size="sm" variant="secondary" disabled={!events.some((e) => e.status === 'confirmed')} onClick={() => setSelecting(true)}><Sparkles /> Draft from several</Button>}
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-proposal/30 bg-proposal-soft/50 p-2.5 text-sm">
          <span className="font-medium">{picked.length} selected</span>
          <label className="flex items-center gap-1.5">Draft
            <select aria-label="Draft type" className="h-8 rounded-md border border-border bg-elevated px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>
              {SELECTION_KINDS.map((k) => <option key={k} value={k}>{ARTIFACT_META[k].label}</option>)}
            </select>
          </label>
          <Button size="sm" disabled={!picked.length || busy} onClick={async () => { if (await onDraft(kind, events.filter((e) => picked.includes(e.id)))) { setSelecting(false); setPicked([]); } }}>Prepare from selected evidence</Button>
          <span className="text-xs text-muted">Small groups need 2–8 students on one concept; reports and notes concern one student.</span>
        </div>
      )}
      {!visible.length ? (
        <Empty compact title={filter === 'pending' ? 'Nothing to confirm' : 'No observations yet'} description={filter === 'pending' ? 'Everything you recorded is confirmed.' : 'Tap a student, then an action. Each observation appears here with its review state.'} />
      ) : (
        <ul className="space-y-2">
          {visible.map((event) => {
            const meta = OBSERVATION_META[event.observation.kind];
            const Icon = meta.icon;
            const linked = draftsFor(event);
            const options = event.status === 'confirmed' ? draftOptions(event.observation).filter((k) => !linked.some((d) => d.kind === k)) : [];
            return (
              <li key={event.id} className={cn('rounded-xl border bg-elevated p-3 shadow-xs', event.status === 'pending' ? 'border-info/50' : 'border-border')}>
                <div className="flex items-start gap-3">
                  {selecting && event.status === 'confirmed' && (
                    <input type="checkbox" className="mt-2 size-4 accent-[var(--primary)]" aria-label="Use this observation as draft evidence" checked={picked.includes(event.id)} onChange={(e) => setPicked((ids) => e.target.checked ? [...ids, event.id] : ids.filter((id) => id !== event.id))} />
                  )}
                  <span className={cn('mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg', meta.chip)}><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="text-sm">{nameOf(event.studentId)}</strong>
                      <span className="text-xs text-muted">{meta.label}</span>
                      <ObservationConfirm status={event.status} className="ml-auto" />
                    </div>
                    <p className="mt-0.5 text-sm">{observationText(event.observation)}</p>
                    {event.observation.kind !== 'note' && event.observation.note && <p className="mt-0.5 text-sm text-muted">{event.observation.note}</p>}
                    {event.observation.kind === 'behavior' && <p className="mt-1 text-xs text-muted">Antecedent: {event.observation.antecedent ?? 'Not recorded'} · Consequence: {event.observation.consequence ?? 'Not recorded'} · Count: {event.observation.measuredCount ?? 'Not measured'}</p>}
                    <p className="mt-1 text-[11px] text-subtle">{fmtDateTime(event.observedAt)} · {SOURCE_LABEL[event.source] ?? humanize(event.source)} · version {event.revision}</p>
                    {!!linked.length && (
                      <div className="mt-2 space-y-1">
                        {linked.map((d) => (
                          <Link key={d.id} to={`/teacher/drafts?draft=${d.id}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken/70 px-2.5 py-1.5 text-xs hover:bg-sunken">
                            <Sparkles className="size-3.5 text-ai-fg" />
                            <span className="font-medium">{ARTIFACT_META[d.kind].label}</span>
                            <TeacherConfirm compact stage={draftStage(d)} />
                            <ArrowRight className="ml-auto size-3.5 text-muted" />
                          </Link>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {event.status === 'pending' && <Button size="sm" disabled={busy} onClick={() => onConfirm(event)}>Confirm this version</Button>}
                      {options.map((k) => (
                        <Button key={k} size="sm" variant="ai" disabled={busy} onClick={() => void onDraft(k, [event])}><Sparkles /> {ARTIFACT_META[k].produces}</Button>
                      ))}
                      <Dropdown>
                        <DropdownTrigger asChild><Button size="icon" variant="ghost" className="ml-auto size-8" aria-label={`More actions for ${nameOf(event.studentId)}’s ${meta.label.toLowerCase()}`} disabled={busy}><MoreHorizontal /></Button></DropdownTrigger>
                        <DropdownContent>
                          <DropdownItem icon={<Pencil />} onSelect={() => onCorrect(event)}>Correct</DropdownItem>
                          <DropdownItem icon={<Undo2 />} onSelect={() => onUndo(event)}>Undo observation</DropdownItem>
                          {event.status === 'confirmed' && ['behavior', 'attendance'].includes(event.observation.kind) && <DropdownItem icon={<Link2 />} onSelect={() => onProject(event)}>Connect to support case…</DropdownItem>}
                        </DropdownContent>
                      </Dropdown>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
