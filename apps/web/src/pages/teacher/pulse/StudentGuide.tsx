import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, BookOpenCheck, Sparkles } from 'lucide-react';
import type { ArtifactKind, ClassroomObservation } from '@class-pulse/domain';
import { Button, Card, CardBody, cn } from '../../../components/ui';
import { api, fmtDateTime } from '../../../lib/api';
import { ARTIFACT_META, OBSERVATION_META, observationText } from '../../../lib/pulse';

export type HistoryEvent = { id: string; sessionId: string; revision: number; observation: ClassroomObservation; observedAt: string; source: string };

const GUIDE: Array<{ kind: ArtifactKind; label: string; hint: string }> = [
  { kind: 'guide_explain', label: 'Explain this evidence', hint: 'A plain summary of what was observed, and what it does not show.' },
  { kind: 'guide_adjust', label: 'Suggest an instructional adjustment', hint: 'One teaching change to try, tied to the evidence.' },
  { kind: 'guide_next_step', label: 'Draft a next step', hint: 'A concrete action for the next lesson.' },
  { kind: 'support_recommendation', label: 'Suggest support options', hint: '2–4 low-intensity options and how to let the student choose.' },
];
const REPORTS: Array<{ kind: ArtifactKind; label: string; behaviorOnly?: boolean }> = [
  { kind: 'sst_report', label: 'SST evidence packet' },
  { kind: 'mtss_report', label: 'MTSS documentation' },
  { kind: 'fba_observations', label: 'FBA-support observations', behaviorOnly: true },
];

/**
 * Pulsera Guide™ in a student's context: the teacher picks confirmed observations from this
 * student's Classroom Memory (any session in this class), and Guide or Pulsera Reports drafts from
 * exactly those. Every result is its own draft behind Teacher Confirm.
 */
export function StudentGuide({ firstName, history }: { firstName: string; history: HistoryEvent[] }) {
  const qc = useQueryClient();
  const recent = history.slice(0, 20);
  const [picked, setPicked] = useState<string[]>(() => recent.slice(0, 8).map((e) => e.id));
  const [busy, setBusy] = useState('');
  const [made, setMade] = useState<Array<{ id: string; kind: ArtifactKind }>>([]);
  if (!history.length) return null;
  const chosen = history.filter((e) => picked.includes(e.id)).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const anchor = [...chosen].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  async function draft(kind: ArtifactKind, sources: HistoryEvent[]) {
    if (!sources.length || !anchor) return;
    setBusy(kind);
    try {
      const r = await api.post<{ id: string }>('/api/pulse/drafts', { sessionId: anchor.sessionId, kind, sources: sources.map((e) => ({ eventId: e.id, revision: e.revision })) });
      setMade((m) => [{ id: r.id, kind }, ...m.filter((x) => x.id !== r.id)]);
      await qc.invalidateQueries({ queryKey: ['classroom-drafts'] });
      toast(`Drafting: ${ARTIFACT_META[kind].produces}`, { description: 'Review it in Drafts before anything is logged.' });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not prepare'); }
    finally { setBusy(''); }
  }
  const behavior = chosen.filter((e) => e.observation.kind === 'behavior');
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-proposal-soft text-proposal"><Sparkles className="size-4" /></span>
          <div><h2 className="text-[15px] font-semibold">Pulsera Guide™ · {firstName}</h2><p className="text-xs text-muted">Choose the evidence, then what you need. Guide works only from what you select and never bypasses your approval.</p></div>
        </div>
        <fieldset>
          <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-subtle">Evidence ({chosen.length} selected)
            <span className="flex gap-2 normal-case tracking-normal"><button type="button" className="text-primary hover:underline" onClick={() => setPicked(recent.map((e) => e.id))}>All recent</button><button type="button" className="text-muted hover:underline" onClick={() => setPicked([])}>None</button></span>
          </legend>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
            {recent.map((e) => {
              const meta = OBSERVATION_META[e.observation.kind];
              return (
                <label key={e.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken', picked.includes(e.id) && 'bg-sunken/70')}>
                  <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={picked.includes(e.id)} onChange={(ev) => setPicked((ids) => ev.target.checked ? [...ids, e.id] : ids.filter((id) => id !== e.id))} />
                  <span className="min-w-0 flex-1"><span className={cn('mr-1.5 rounded px-1 text-[10px] font-semibold', meta.chip)}>{meta.label}</span>{observationText(e.observation)}<span className="block text-[11px] text-subtle">{fmtDateTime(e.observedAt)}</span></span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          {GUIDE.map((g) => (
            <button key={g.kind} type="button" disabled={!chosen.length || !!busy} onClick={() => void draft(g.kind, chosen)} className="rounded-lg border border-border bg-elevated p-3 text-left transition-colors hover:border-proposal/50 disabled:opacity-50">
              <span className="block text-sm font-semibold">{busy === g.kind ? 'Requesting…' : g.label}</span>
              <span className="block text-xs text-muted">{g.hint}</span>
            </button>
          ))}
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle"><BookOpenCheck className="size-3.5" />Pulsera Reports™</p>
          <div className="flex flex-wrap gap-2">
            {REPORTS.map((r) => <Button key={r.kind} size="sm" variant="secondary" disabled={!!busy || !(r.behaviorOnly ? behavior.length : chosen.length)} loading={busy === r.kind} onClick={() => void draft(r.kind, r.behaviorOnly ? behavior : chosen)}>{r.label}</Button>)}
          </div>
          <p className="mt-1 text-[11px] text-muted">Evidence packets for team discussion, never a determination. FBA-support uses only the selected behavior observations.</p>
        </div>
        {!!made.length && (
          <ul className="space-y-1">
            {made.map((m) => <li key={m.id}><Link to={`/teacher/drafts?draft=${m.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{ARTIFACT_META[m.kind].label} — review in Drafts<ArrowRight className="size-3.5" /></Link></li>)}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Pulsera Guide™ in the class's context: practice groups proposed from today's needs-practice
 * evidence, and Tomorrow Ready on demand.
 */
export function ClassGuide<T extends { status: string; studentId: string; observation: ClassroomObservation }>({ events, nameOf, busy, onDraft, onPrepare }: { events: T[]; nameOf(id: string): string; busy: boolean; onDraft(kind: ArtifactKind, sources: T[]): Promise<boolean>; onPrepare(): void }) {
  const practice = events.filter((e) => e.status === 'confirmed' && ((e.observation.kind === 'understanding' && e.observation.evidence === 'needs_practice') || (e.observation.kind === 'exit_ticket' && e.observation.assessment === 'needs_practice')));
  const groups = [...practice.reduce((m, e) => { const c = 'concept' in e.observation ? e.observation.concept.trim() : ''; const k = c.toLowerCase(); if (c) m.set(k, { concept: c, items: [...(m.get(k)?.items ?? []), e] }); return m; }, new Map<string, { concept: string; items: typeof practice }>()).values()]
    .map((g) => ({ ...g, students: [...new Set(g.items.map((e) => e.studentId))] }));
  return (
    <Card>
      <CardBody className="space-y-3 pt-5">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-proposal-soft text-proposal"><Sparkles className="size-4" /></span>
          <div><h2 className="text-[15px] font-semibold">Pulsera Guide™ for this class</h2><p className="text-xs text-muted">Suggestions from today’s confirmed observations. Each one is a draft for you to review.</p></div>
        </div>
        <div className="space-y-2">
          {groups.map((g) => {
            const ok = g.students.length >= 2 && g.students.length <= 8;
            return (
              <div key={g.concept} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="font-medium">{g.concept}</span> · {g.students.length} student{g.students.length === 1 ? '' : 's'} need practice<span className="block truncate text-xs text-muted">{g.students.map(nameOf).join(', ')}</span></span>
                <Button size="sm" variant="soft" disabled={!ok || busy} title={ok ? undefined : 'A practice group needs 2–8 students on one concept'} onClick={() => void onDraft('small_group', g.items)}><Sparkles />Suggest a small group</Button>
              </div>
            );
          })}
          {!groups.length && <p className="rounded-lg bg-sunken/60 px-3 py-2 text-sm text-muted">Mark understanding checks or exit tickets “needs practice” and Guide can propose practice groups.</p>}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="flex-1"><span className="font-medium">Help prepare Tomorrow</span><span className="block text-xs text-muted">Do Now, reteach and groups from this session, ready to review.</span></span>
            <Button size="sm" variant="secondary" disabled={busy || !events.some((e) => e.status === 'confirmed')} onClick={onPrepare}>Prepare tomorrow</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
