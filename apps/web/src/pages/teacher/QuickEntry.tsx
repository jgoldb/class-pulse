import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Minus, Plus, StickyNote, Undo2 } from 'lucide-react';
import { Avatar, Badge, Button, Callout, PageSkeleton, cn, spring, tap } from '../../components/ui';
import { api, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CaseView } from '../../lib/types';
import { PiiTextarea } from '../../components/PiiTextarea';

interface TagInfo {
  dimensions: Record<string, string[]>;
  defaults: string[];
  sectionPeriod: string | null;
}

const DIM_LABEL: Record<string, string> = { work_arrangement: 'Setting', task_length: 'Task', structure: 'Structure', assessment_type: 'Assessment', schedule: 'When' };
const SINGLE = new Set(['work_arrangement', 'task_length', 'structure', 'assessment_type']);

/**
 * The ~15-second interaction that decides whether the product survives a classroom (docs/05).
 * Phone-first: big tap counters with spring feedback, context chips pre-filled from the current
 * period and the last entry, no free text required. Measures its own completion time.
 */
export function QuickEntry() {
  const { caseKey = '' } = useParams();
  const qc = useQueryClient();
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const view = useQuery({ queryKey: ['case', caseKey], queryFn: () => api.get<CaseView>(`/api/cases/${caseKey}`) });
  const tags = useQuery({ queryKey: ['tags', caseKey], queryFn: () => api.get<TagInfo>(`/api/cases/${caseKey}/context-tags`) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [strategyUsed, setStrategyUsed] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [noteBlocking, setNoteBlocking] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const startedAt = useRef<number>(performance.now());

  useEffect(() => {
    if (tags.data && selected.size === 0) setSelected(new Set(tags.data.defaults));
  }, [tags.data]);

  const goals = view.data?.goals ?? [];
  const strategies = (view.data?.strategies ?? []).filter((s) => s.kind === 'preventive' || s.kind === 'response');
  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0) + strategyUsed.size, [counts, strategyUsed]);

  const save = useMutation({
    mutationFn: async () => {
      const observedAt = new Date().toISOString();
      const contextTags = [...selected];
      const writes: Promise<unknown>[] = [];
      for (const [goalId, n] of Object.entries(counts)) {
        for (let i = 0; i < n; i++) {
          writes.push(api.post(`/api/cases/${caseKey}/signals`, { type: 'behavior_event', value: 1, contextTags, observedAt, source: 'teacher_entry', sourceConfidence: 'high', goalId, note: i === 0 && note.trim() ? note.trim() : undefined }));
        }
      }
      for (const strategyId of strategyUsed) {
        writes.push(api.post(`/api/cases/${caseKey}/signals`, { type: 'strategy_use', value: 1, contextTags, observedAt, source: 'teacher_entry', sourceConfidence: 'high', strategyId }));
      }
      if (writes.length === 0 && note.trim()) {
        writes.push(api.post(`/api/cases/${caseKey}/signals`, { type: 'interval_observation', value: 0, contextTags, observedAt, source: 'teacher_entry', sourceConfidence: 'medium', note: note.trim() }));
      }
      await Promise.all(writes);
      return writes.length;
    },
    onSuccess: (n) => {
      const ms = Math.round(performance.now() - startedAt.current);
      toast.success(`Saved ${n} entr${n === 1 ? 'y' : 'ies'} in ${(ms / 1000).toFixed(1)}s`, { icon: <Undo2 className="size-4" /> });
      setCounts({});
      setStrategyUsed(new Set());
      setNote('');
      setShowNote(false);
      startedAt.current = performance.now();
      qc.invalidateQueries({ queryKey: ['case', caseKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (view.isLoading || tags.isLoading) return <PageSkeleton />;
  if (!view.data?.planId) return <Callout tone="warning">Approve a plan first; quick entry logs against its goals and strategies.</Callout>;

  const toggle = (tag: string, dim: string) => {
    const next = new Set(selected);
    if (next.has(tag)) next.delete(tag);
    else {
      if (SINGLE.has(dim)) for (const t of tags.data!.dimensions[dim] ?? []) next.delete(t);
      if (dim === 'schedule' && tag.startsWith('period_')) for (const t of tags.data!.dimensions.schedule ?? []) if (t.startsWith('period_')) next.delete(t);
      next.add(tag);
    }
    setSelected(next);
  };
  const dims = Object.entries(tags.data!.dimensions);
  const visibleDims = showAllChips ? dims : dims.filter(([d]) => ['work_arrangement', 'task_length', 'structure'].includes(d));

  return (
    <div className="mx-auto max-w-md pb-28">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`${base}/cases/${caseKey}`} className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-fg" aria-label="Back to case">
          <ChevronLeft className="size-5" />
        </Link>
        <Avatar name={view.data.student?.displayName ?? 'Student'} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{view.data.student?.displayName ?? 'Quick entry'}</div>
          <div className="text-xs text-muted">Tap to count · chips remember your last entry</div>
        </div>
      </div>

      <div className="space-y-3">
        {goals.map((g) => (
          <div key={g.id} className="flex items-center gap-3 rounded-xl border border-border bg-elevated p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{g.targetBehavior}</div>
              <div className="line-clamp-2 text-xs text-muted">{g.observableDefinition}</div>
            </div>
            <div className="flex items-center gap-1">
              <motion.button {...tap} aria-label={`decrease ${g.targetBehavior}`} onClick={() => setCounts((c) => ({ ...c, [g.id]: Math.max(0, (c[g.id] ?? 0) - 1) }))} className="flex size-12 items-center justify-center rounded-lg border border-border bg-sunken text-fg disabled:opacity-40" disabled={!counts[g.id]}>
                <Minus className="size-5" />
              </motion.button>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={counts[g.id] ?? 0} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={spring} className="w-9 text-center text-2xl font-bold tabular-nums">
                  {counts[g.id] ?? 0}
                </motion.span>
              </AnimatePresence>
              <motion.button {...tap} aria-label={`count ${g.targetBehavior}`} data-testid={`count-${g.id}`} onClick={() => setCounts((c) => ({ ...c, [g.id]: (c[g.id] ?? 0) + 1 }))} className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
                <Plus className="size-6" />
              </motion.button>
            </div>
          </div>
        ))}
      </div>

      {strategies.length > 0 && (
        <section className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Strategy used</div>
          <div className="flex flex-wrap gap-2">
            {strategies.map((s) => {
              const on = strategyUsed.has(s.id);
              return (
                <motion.button
                  key={s.id}
                  {...tap}
                  aria-pressed={on}
                  onClick={() =>
                    setStrategyUsed((set) => {
                      const n = new Set(set);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                  className={cn('rounded-full border px-3.5 py-2 text-left text-sm transition-colors', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-elevated text-fg')}
                >
                  {s.description.length > 44 ? s.description.slice(0, 42) + '…' : s.description}
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-4">
        {visibleDims.map(([dim, list]) => (
          <div key={dim} className="mb-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{DIM_LABEL[dim] ?? humanize(dim)}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((t) => {
                const on = selected.has(t);
                return (
                  <motion.button key={t} {...tap} aria-pressed={on} onClick={() => toggle(t, dim)} className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-elevated text-muted')}>
                    {humanize(t)}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
        <button className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => setShowAllChips((s) => !s)}>
          {showAllChips ? 'Fewer chips' : 'More chips (assessment, period)'}
        </button>
      </section>

      <section className="mt-4">
        {showNote ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Note (no names)</div>
            <PiiTextarea value={note} onChange={setNote} rows={2} onBlockingChange={setNoteBlocking} />
          </div>
        ) : (
          <button className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={() => setShowNote(true)}>
            <StickyNote className="size-4" /> Add a note
          </button>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-elevated/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <Badge tone={total ? 'primary' : 'neutral'}>{total} to save</Badge>
            <div className="mt-1 truncate text-[11px] text-subtle">{[...selected].map(humanize).join(' · ') || 'no context chips'}</div>
          </div>
          <Button size="xl" className="min-w-32" loading={save.isPending} disabled={noteBlocking || (total === 0 && !note.trim())} onClick={() => save.mutate()} data-testid="save-entry">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
