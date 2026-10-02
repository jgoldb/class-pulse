import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router';
import { periodLabel } from '@class-pulse/domain';
import { api } from './api';

/** A section as Class Pulse sees it (`GET /api/pulse/sections`). */
export type PulseSection = {
  id: string; name: string; courseName: string | null; gradeLevel: string; periodTag: string | null; room: string | null; accent: string | null;
  schoolId: string; archivedAt: string | null; archived: boolean; updatedAt: string; timezone: string; enabled: boolean;
};

/*
 * The teacher's current class is shared by every surface (top bar selector, Class Pulse, Tomorrow),
 * so it lives in a tiny module store backed by localStorage rather than in one page's state. A
 * `?class=` link (from a class card) wins and becomes the new current class.
 */
const KEY = 'cp.class';
const listeners = new Set<() => void>();
let current: string | null = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
function setCurrent(id: string) {
  if (id === current) return;
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode: the session still follows the choice */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/**
 * Class Pulse raises this while a save is unconfirmed (retry pending), so switching class from the
 * top bar cannot silently drop it. The page's own link guard covers navigation; this covers the
 * selector, which changes class without navigating.
 */
let switchBlocked = false;
export function setClassSwitchBlocked(blocked: boolean) { switchBlocked = blocked; }

export function usePulseSections() {
  return useQuery({ queryKey: ['pulse-sections'], queryFn: () => api.get<PulseSection[]>('/api/pulse/sections') });
}

export function useCurrentClass() {
  const q = usePulseSections();
  const stored = useSyncExternalStore(subscribe, () => current, () => null);
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('class');
  useEffect(() => { if (fromUrl) setCurrent(fromUrl); }, [fromUrl]);
  // Without a timetable, period order is the honest proxy for "current or next class".
  const periodRank = (s: PulseSection) => { const m = /^period_(\d+)$/.exec(s.periodTag ?? ''); return m ? Number(m[1]) : s.periodTag === 'morning' ? 0 : s.periodTag === 'afternoon' ? 50 : 99; };
  const active = (q.data ?? []).filter((s) => s.enabled && !s.archived).sort((a, b) => periodRank(a) - periodRank(b) || classTitle(a).localeCompare(classTitle(b)));
  const section = active.find((s) => s.id === fromUrl) ?? active.find((s) => s.id === stored) ?? active[0] ?? null;
  const choose = (id: string) => {
    if (switchBlocked && id !== section?.id) { toast.warning('Finish or dismiss the pending save first', { description: 'An observation in this class is not confirmed saved yet.' }); return; }
    setCurrent(id);
    if (params.has('class')) setParams((p) => { const n = new URLSearchParams(p); n.set('class', id); return n; }, { replace: true });
  };
  return { sections: active, all: q.data ?? [], section, choose, isLoading: q.isLoading, error: q.error };
}

type Named = { name: string; courseName: string | null; periodTag: string | null; room: string | null };
/** The big line on a class: the course if the teacher gave one, otherwise the section name. */
export const classTitle = (s: Named) => s.courseName || s.name;
/** The supporting line: section (when the title is the course), period and room. */
export function classDetails(s: Named, extra: Array<string | null | undefined> = []) {
  return [s.courseName ? s.name : null, periodLabel(s.periodTag) || null, s.room ? `Room ${s.room}` : null, ...extra].filter(Boolean).join(' · ');
}

/** Accent swatches for class cards. Soft enough to sit beside the status colours without competing. */
export const ACCENTS: Record<string, { label: string; swatch: string; soft: string }> = {
  blue: { label: 'Blue', swatch: 'oklch(0.6 0.15 262)', soft: 'oklch(0.95 0.03 262)' },
  teal: { label: 'Teal', swatch: 'oklch(0.66 0.11 188)', soft: 'oklch(0.95 0.03 188)' },
  violet: { label: 'Violet', swatch: 'oklch(0.6 0.16 296)', soft: 'oklch(0.955 0.03 296)' },
  sky: { label: 'Sky', swatch: 'oklch(0.7 0.12 230)', soft: 'oklch(0.955 0.03 230)' },
  indigo: { label: 'Indigo', swatch: 'oklch(0.52 0.15 275)', soft: 'oklch(0.95 0.03 275)' },
  slate: { label: 'Slate', swatch: 'oklch(0.6 0.03 255)', soft: 'oklch(0.95 0.01 255)' },
};
export const accentOf = (accent: string | null | undefined) => ACCENTS[accent ?? ''] ?? ACCENTS.blue!;

export const todayIn = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function greeting(timezone?: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
