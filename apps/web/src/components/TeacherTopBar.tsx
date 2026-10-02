import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { Check, ChevronDown, Circle, CircleCheck, Inbox, LayoutGrid, Sparkles } from 'lucide-react';
import type { ArtifactKind } from '@class-pulse/domain';
import { api } from '../lib/api';
import { accentOf, classDetails, classTitle, useCurrentClass } from '../lib/classes';
import { ARTIFACT_META, needsTeacher } from '../lib/pulse';
import type { Classroom } from '../lib/types';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, cn } from './ui';

export type InboxDraft = { id: string; sectionId: string; kind: ArtifactKind; generationState: string; reviewState: string; publicationState: string; deferredUntil: string | null };

/** Drafts the teacher still has to look at, and Tomorrow items prepared and waiting. One query, shared with the pages. */
export function useDraftCounts(sectionId?: string | null) {
  const q = useQuery({
    queryKey: ['classroom-drafts'], queryFn: () => api.get<InboxDraft[]>('/api/pulse/drafts'),
    refetchInterval: (query) => (query.state.data ?? []).some((d) => ['queued', 'running'].includes(d.generationState)) ? 4000 : 30_000,
  });
  const live = (q.data ?? []).filter((d) => !(d.deferredUntil && new Date(d.deferredUntil) > new Date()));
  const review = live.filter(needsTeacher);
  const tomorrow = review.filter((d) => ARTIFACT_META[d.kind].group === 'tomorrow' || ['reteach', 'small_group'].includes(d.kind));
  return {
    drafts: review.length,
    tomorrow: (sectionId ? tomorrow.filter((d) => d.sectionId === sectionId) : tomorrow).length,
    preparing: live.some((d) => ['queued', 'running'].includes(d.generationState)),
  };
}

const plural = (n: number) => `${n} ${n === 1 ? 'student' : 'students'}`;

const STATUS = {
  not_started: { label: 'Ready to teach', icon: Circle, className: 'text-muted' },
  in_progress: { label: 'Class in progress', icon: Circle, className: 'text-success-fg' },
  complete: { label: 'Session complete', icon: CircleCheck, className: 'text-success-fg' },
} as const;

/**
 * The teacher's top bar (visual spec §3): which class, today's session status, and how much is
 * waiting in Drafts and Tomorrow. Present on every teacher page so the teacher always knows
 * which class they are working with.
 */
export function TeacherTopBar() {
  const { section, sections, choose } = useCurrentClass();
  const classroom = useQuery({ queryKey: ['classroom'], queryFn: () => api.get<Classroom>('/api/classroom') });
  const counts = useDraftCounts(section?.id);
  const nav = useNavigate();
  const loc = useLocation();
  const studentsIn = (id: string) => (classroom.data?.students ?? []).filter((s) => s.sectionIds.includes(id)).length;
  const today = classroom.data?.sections?.find((s) => s.id === section?.id)?.today;
  const status = STATUS[today?.status ?? 'not_started'];
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const pick = (id: string) => {
    choose(id);
    // On pages that are not about one class, choosing a class takes you to it.
    if (!['/teacher', '/teacher/tomorrow'].includes(loc.pathname)) nav('/teacher');
  };

  return (
    <>
      {section ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" data-testid="class-selector" aria-label={`Current class: ${classTitle(section)}. Change class`} className="flex h-11 min-w-0 max-w-[15rem] items-center gap-2.5 rounded-lg border border-border bg-elevated px-3 text-left shadow-xs transition-colors hover:border-border-strong sm:max-w-sm xl:max-w-lg">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: accentOf(section.accent).swatch }} aria-hidden />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold">{classTitle(section)}</span>
                <span className="block truncate text-[11px] text-muted">{classDetails(section, [classroom.data ? plural(studentsIn(section.id)) : null])}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="start" className="w-80">
            <DropdownLabel>Your classes</DropdownLabel>
            {sections.map((s) => (
              <DropdownItem key={s.id} onSelect={() => pick(s.id)} className="items-start py-2.5">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: accentOf(s.accent).swatch }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{classTitle(s)}</span>
                  <span className="block truncate text-xs text-muted">{classDetails(s, [classroom.data ? plural(studentsIn(s.id)) : null])}</span>
                </span>
                {s.id === section.id && <Check className="mt-1 text-primary" />}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownItem icon={<LayoutGrid />} onSelect={() => nav('/teacher/classes')}>Manage classes</DropdownItem>
          </DropdownContent>
        </Dropdown>
      ) : (
        <Link to="/teacher/classes" className="text-sm font-semibold text-primary hover:underline">Add your first class</Link>
      )}

      {section && (
        <div className="hidden min-w-0 items-center gap-2 text-sm md:flex" data-testid="session-status">
          <span className="text-muted">{date}</span>
          <span aria-hidden className="text-border-strong">·</span>
          <span className={cn('inline-flex items-center gap-1.5 font-medium', status.className)}>
            <status.icon className={cn('size-3', today?.status === 'in_progress' && 'fill-current')} />
            {status.label}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Link to="/teacher/drafts" data-testid="topbar-drafts" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-elevated px-3 text-sm font-medium text-fg shadow-xs transition-colors hover:border-ai/40" aria-label={`${counts.drafts} drafts to review`}>
          <Inbox className="size-4 text-ai-fg" />
          <span className="tabular-nums">{counts.drafts}</span>
          <span className="max-sm:hidden">{counts.drafts === 1 ? 'draft' : 'drafts'}</span>
        </Link>
        <Link to="/teacher/tomorrow" data-testid="topbar-tomorrow" className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium shadow-xs transition-colors', counts.tomorrow ? 'border-ai/30 bg-ai-soft text-ai-fg' : 'border-border bg-elevated text-muted hover:text-fg')} aria-label={counts.tomorrow ? `Tomorrow: ${counts.tomorrow} ready to review` : 'Tomorrow'}>
          <Sparkles className="size-4" />
          <span className="max-sm:hidden">{counts.tomorrow ? 'Tomorrow ready' : 'Tomorrow'}</span>
          {!!counts.tomorrow && <span className="tabular-nums">{counts.tomorrow}</span>}
        </Link>
      </div>
    </>
  );
}
