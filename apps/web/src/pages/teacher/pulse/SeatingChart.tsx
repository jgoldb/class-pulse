import { useState } from 'react';
import { Minus, Plus, Sparkles } from 'lucide-react';
import { Avatar, Button, cn } from '../../../components/ui';
import { relativeTime } from '../../../lib/utils';
import { OBSERVATION_META, type ObservationKind } from '../../../lib/pulse';

export type Seat = { studentId: string; row: number; column: number };
export type StudentActivity = { counts: Partial<Record<ObservationKind, number>>; pending: number; lastKind: ObservationKind | null; lastAt: string | null };
type Student = { id: string; displayName: string };

const KIND_ORDER: ObservationKind[] = ['participation', 'praise', 'understanding', 'check_in', 'behavior', 'note', 'exit_ticket', 'attendance'];

/** Place everyone: saved seats first, then anyone unseated fills the rows below. */
export function layoutFor(students: Student[], positions: Seat[], minColumns = 5) {
  const enrolled = positions.filter((p) => students.some((s) => s.id === p.studentId));
  const columns = Math.max(minColumns, ...enrolled.map((p) => p.column + 1));
  const taken = new Set(enrolled.map((p) => `${p.row}:${p.column}`));
  const seats = [...enrolled];
  let cursor = 0;
  for (const s of students) {
    if (seats.some((p) => p.studentId === s.id)) continue;
    while (taken.has(`${Math.floor(cursor / columns)}:${cursor % columns}`)) cursor++;
    seats.push({ studentId: s.id, row: Math.floor(cursor / columns), column: cursor % columns });
    taken.add(`${Math.floor(cursor / columns)}:${cursor % columns}`);
  }
  const rows = Math.max(1, ...seats.map((p) => p.row + 1));
  return { seats, columns, rows };
}

/** "Avery Synthetic" → "Avery S." so a seat stays readable at chart width. */
const shortName = (name: string) => { const [first, ...rest] = name.split(' '); return rest.length ? `${first} ${rest.at(-1)![0]}.` : name; };

function summary(a: StudentActivity | undefined) {
  if (!a || !a.lastAt) return 'No observations yet today';
  const parts = KIND_ORDER.filter((k) => a.counts[k]).map((k) => `${a.counts[k]} ${OBSERVATION_META[k].label.toLowerCase()}`);
  return `${parts.join(', ')}${a.pending ? `, ${a.pending} awaiting confirmation` : ''}`;
}

export function SeatingChart({ students, positions, activity, selected, onSelect, view, dimObserved }: {
  students: Student[]; positions: Seat[]; activity: Map<string, StudentActivity>;
  selected: string; onSelect(id: string): void; view: 'chart' | 'list'; dimObserved: boolean;
}) {
  const { seats, columns, rows } = layoutFor(students, positions);
  const seatOf = (id: string) => seats.find((s) => s.studentId === id)!;
  const ordered = [...students].sort((a, b) => { const x = seatOf(a.id), y = seatOf(b.id); return x.row - y.row || x.column - y.column; });
  return (
    <div className={cn(view === 'chart' && 'overflow-x-auto pb-1')}>
      {view === 'chart' && <div className="mb-4 flex justify-center"><span className="rounded-full bg-sunken px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Front of room</span></div>}
      <div
        role="listbox"
        aria-label={view === 'chart' ? 'Seating chart' : 'Class roster'}
        className={cn('grid gap-3', view === 'list' && 'sm:grid-cols-2')}
        style={view === 'chart' ? { gridTemplateColumns: `repeat(${columns}, minmax(6.25rem, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` } : undefined}
      >
        {ordered.map((s) => {
          const a = activity.get(s.id);
          const seat = seatOf(s.id);
          const isSelected = selected === s.id;
          const observed = !!a?.lastAt;
          const kinds = KIND_ORDER.filter((k) => a?.counts[k]);
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={`${s.displayName}. ${summary(a)}`}
              data-testid={`seat-${s.id}`}
              onClick={() => onSelect(s.id)}
              style={view === 'chart' ? { gridRow: seat.row + 1, gridColumn: seat.column + 1 } : undefined}
              className={cn(
                'group relative flex min-h-[5.5rem] flex-col rounded-xl border bg-elevated p-3 text-left shadow-xs transition-[transform,box-shadow,border-color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                isSelected ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm',
                dimObserved && observed && !isSelected && 'opacity-40',
                dimObserved && !observed && 'border-dashed border-primary/50',
              )}
            >
              <span className="flex items-center gap-2">
                <Avatar name={s.displayName} size="sm" className={cn(view === 'chart' && 'max-2xl:hidden')} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">{view === 'chart' ? shortName(s.displayName) : s.displayName}</span>
                {!!a?.pending && <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-ai-soft text-ai-fg" title={`${a.pending} awaiting confirmation`}><Sparkles className="size-2.5" /><span className="sr-only">{a.pending} to confirm</span></span>}
              </span>
              {/* Small indicators, not coloured backgrounds: strengths first, everything else neutral. */}
              <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1" aria-hidden>
                {kinds.map((k) => {
                  const meta = OBSERVATION_META[k];
                  const Icon = meta.icon;
                  return <span key={k} className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted"><span className={cn('size-1.5 rounded-full', meta.dot)} /><Icon className="size-3" />{a!.counts[k]}</span>;
                })}
              </span>
              <span className="mt-auto pt-2 text-[11px] leading-tight text-subtle">{observed ? `${OBSERVATION_META[a!.lastKind!].short} · ${relativeTime(a!.lastAt)}` : 'No observations yet today'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Click a student, then click any seat: empty seats move them, occupied seats swap. */
export function SeatArranger({ students, positions, busy, onSave, onCancel }: { students: Student[]; positions: Seat[]; busy: boolean; onSave(seats: Seat[]): void; onCancel(): void }) {
  const initial = layoutFor(students, positions);
  const [seats, setSeats] = useState<Seat[]>(initial.seats);
  const [columns, setColumns] = useState(initial.columns);
  const [picked, setPicked] = useState('');
  const rows = Math.max(...seats.map((p) => p.row + 1), 1) + 1;
  const name = (id: string) => students.find((s) => s.id === id)?.displayName ?? '';
  function place(row: number, column: number) {
    if (!picked) { const here = seats.find((p) => p.row === row && p.column === column); if (here) setPicked(here.studentId); return; }
    setSeats((current) => {
      const from = current.find((p) => p.studentId === picked)!;
      const other = current.find((p) => p.row === row && p.column === column);
      return current.map((p) => p.studentId === picked ? { ...p, row, column } : other && p.studentId === other.studentId ? { ...p, row: from.row, column: from.column } : p);
    });
    setPicked('');
  }
  const canShrink = seats.every((p) => p.column < columns - 1);
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-soft/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{picked ? <>Now choose a seat for <strong>{name(picked)}</strong>.</> : 'Choose a student, then the seat they should move to.'} <span className="text-muted">Changes apply from the next class session.</span></p>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          Columns
          <Button size="icon" variant="secondary" className="size-7" aria-label="Fewer columns" disabled={!canShrink || columns <= 2} onClick={() => setColumns((c) => c - 1)}><Minus /></Button>
          <span className="w-5 text-center font-semibold tabular-nums text-fg">{columns}</span>
          <Button size="icon" variant="secondary" className="size-7" aria-label="More columns" disabled={columns >= 10} onClick={() => setColumns((c) => c + 1)}><Plus /></Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(6.5rem, 1fr))` }}>
          {Array.from({ length: rows * columns }, (_, i) => {
            const row = Math.floor(i / columns), column = i % columns;
            const here = seats.find((p) => p.row === row && p.column === column);
            return (
              <button key={i} type="button" onClick={() => place(row, column)} aria-label={here ? `${name(here.studentId)}, row ${row + 1} seat ${column + 1}` : `Empty seat, row ${row + 1} seat ${column + 1}`}
                className={cn('flex h-14 items-center gap-1.5 rounded-lg border px-2 text-left text-xs transition-colors', here ? 'border-border bg-elevated font-medium' : 'border-dashed border-border-strong text-subtle hover:bg-elevated/70', here?.studentId === picked && 'border-primary ring-2 ring-primary/30')}>
                {here ? <><Avatar name={name(here.studentId)} size="sm" /><span className="truncate">{name(here.studentId)}</span></> : <span className="mx-auto">Empty</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <Button loading={busy} onClick={() => onSave(seats)}>Save seating</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
