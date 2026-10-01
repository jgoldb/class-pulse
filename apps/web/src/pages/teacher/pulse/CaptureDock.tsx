import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, Keyboard, Loader2, Mic, MoreHorizontal, Pencil } from 'lucide-react';
import type { CaptureVocabulary, ClassroomObservation } from '@class-pulse/domain';
import { Avatar, Button, Dialog, DialogContent, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Input, Kbd, Popover, PopoverContent, PopoverTrigger, Textarea, Tooltip, cn } from '../../../components/ui';
import { OBSERVATION_META, type ObservationKind } from '../../../lib/pulse';

/** Icon-over-label tiles in the phone/tablet dock; icon-beside-label rows in the desktop side panel. */
const TILE = 'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-elevated px-1 py-1.5 text-center text-[10.5px] font-semibold shadow-xs sm:min-h-[4.25rem] sm:gap-1 sm:py-2 sm:text-[11px] disabled:pointer-events-none disabled:opacity-45 lg:min-h-11 lg:flex-row lg:justify-start lg:gap-1.5 lg:px-1.5 lg:py-1.5 lg:text-left lg:text-xs';
const TILE_ICON = 'inline-flex size-7 shrink-0 items-center justify-center rounded-lg sm:size-8 lg:size-7';

/** Break points for the two long labels so they wrap cleanly on a phone-width dock. */
const TILE_LABEL: Partial<Record<ObservationKind, string>> = { participation: 'Partici­pation', understanding: 'Under­standing' };

/** Single-letter capture shortcuts, active while a student is selected and nothing else has focus. */
export const SHORTCUTS: Array<{ key: string; action: 'participation' | 'praise' | 'understanding' | 'check_in' | 'behavior' | 'note' | 'voice'; label: string }> = [
  { key: 'p', action: 'participation', label: 'Participation' },
  { key: 's', action: 'praise', label: 'Praise' },
  { key: 'u', action: 'understanding', label: 'Understanding' },
  { key: 'c', action: 'check_in', label: 'Check-in' },
  { key: 'b', action: 'behavior', label: 'Behavior' },
  { key: 'n', action: 'note', label: 'Note' },
  { key: 'v', action: 'voice', label: 'Voice' },
];
const keyFor = (action: string) => SHORTCUTS.find((s) => s.action === action)?.key.toUpperCase();

/** True when a keystroke belongs to a field, dialog or menu rather than to capture. */
export function typingTarget(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return true;
  return !!document.querySelector('[role="dialog"], [role="menu"]');
}

/** Forwards ref and props so Radix triggers (popover, dropdown) can wrap it with `asChild`. */
const Tile = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { kind: ObservationKind; label?: string; trailing?: ReactNode; shortcut?: string }>(({ kind, label, trailing, shortcut, className, ...props }, ref) => {
  const meta = OBSERVATION_META[kind];
  const Icon = meta.icon;
  return (
    <button ref={ref} type="button" aria-label={label ?? meta.label} aria-keyshortcuts={shortcut} {...props} className={cn(TILE, shortcut && 'lg:[@media(hover:hover)]:pr-5', 'transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm active:scale-[0.97] data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/20', className)}>
      <span className={cn(TILE_ICON, meta.chip)}><Icon className="size-4" /></span>
      <span className="flex items-center gap-0.5 leading-tight">{label ?? (TILE_LABEL[kind] ? <><span className="lg:hidden">{TILE_LABEL[kind]}</span><span className="max-lg:hidden">{meta.label}</span></> : meta.label)}{trailing}</span>
      {shortcut && <kbd className="pointer-events-none absolute right-1 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-sunken px-1 font-mono text-[10px] font-medium text-subtle lg:[@media(hover:hover)]:block">{shortcut}</kbd>}
    </button>
  );
});
Tile.displayName = 'Tile';

type Picker = 'praise' | 'understanding' | 'check_in' | null;

function QuickPick({ kind, title, options, disabled, open, onOpenChange, onPick, onCustom, onEdit }: { kind: 'praise' | 'check_in'; title: string; options: string[]; disabled: boolean; open: boolean; onOpenChange(open: boolean): void; onPick(text: string): void; onCustom(): void; onEdit(): void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <Tile kind={kind} disabled={disabled} shortcut={keyFor(kind)} trailing={<ChevronDown className="size-3 opacity-60 lg:hidden" />} />
      </PopoverTrigger>
      <PopoverContent side="top" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button[data-option]')?.focus(); }}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</p>
        <div className="flex flex-col gap-1">
          {options.map((o, i) => (
            <button key={o} data-option type="button" onClick={() => { onOpenChange(false); onPick(o); }} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-sunken focus-visible:bg-sunken">
              <span className="flex-1">{o}</span>{i < 9 && <span className="hidden font-mono text-[10px] text-subtle [@media(hover:hover)]:inline">{i + 1}</span>}
            </button>
          ))}
          <button type="button" onClick={() => { onOpenChange(false); onCustom(); }} className="rounded-md px-2.5 py-2 text-left text-sm text-primary hover:bg-sunken">Write your own…</button>
          <button type="button" onClick={() => { onOpenChange(false); onEdit(); }} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs text-muted hover:bg-sunken"><Pencil className="size-3" />Edit these presets</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UnderstandingPick({ topic, disabled, open, onOpenChange, onPick, onCustom }: { topic: string; disabled: boolean; open: boolean; onOpenChange(open: boolean): void; onPick(concept: string, evidence: 'demonstrated' | 'needs_practice'): void; onCustom(): void }) {
  const [concept, setConcept] = useState(topic);
  useEffect(() => { if (open) setConcept((c) => c || topic); }, [open, topic]);
  const pick = (evidence: 'demonstrated' | 'needs_practice') => { if (!concept.trim()) return; onOpenChange(false); onPick(concept.trim(), evidence); };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <Tile kind="understanding" disabled={disabled} shortcut={keyFor('understanding')} trailing={<ChevronDown className="size-3 opacity-60 lg:hidden" />} />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80">
        <label className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">Concept
          <Input value={concept} maxLength={500} onChange={(e) => setConcept(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pick('demonstrated'); } }} placeholder="Equivalent fractions" className="normal-case tracking-normal" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="soft" disabled={!concept.trim()} onClick={() => pick('demonstrated')}>Demonstrated</Button>
          <Button variant="secondary" disabled={!concept.trim()} onClick={() => pick('needs_practice')}>Needs practice</Button>
        </div>
        <button type="button" onClick={() => { onOpenChange(false); onCustom(); }} className="mt-2 text-xs text-primary hover:underline">Add detail or a context note…</button>
      </PopoverContent>
    </Popover>
  );
}

/** Lets a teacher replace the quick-pick wording with their own (one preset per line). */
export function VocabularyDialog({ open, onOpenChange, vocabulary, defaults, onSave, busy, error }: { open: boolean; onOpenChange(open: boolean): void; vocabulary: CaptureVocabulary; defaults: CaptureVocabulary; onSave(v: CaptureVocabulary | null): void; busy: boolean; error: string }) {
  const [praise, setPraise] = useState(vocabulary.praise.join('\n'));
  const [checkIn, setCheckIn] = useState(vocabulary.checkIn.join('\n'));
  useEffect(() => { if (open) { setPraise(vocabulary.praise.join('\n')); setCheckIn(vocabulary.checkIn.join('\n')); } }, [open, vocabulary]);
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Quick-pick wording" description="One preset per line, up to eight each. Describe what you observe, never who — names are rejected. These are yours and apply in all your classes.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave({ praise: lines(praise), checkIn: lines(checkIn) }); }}>
          {error && <p role="alert" className="rounded-md bg-danger-soft p-2.5 text-sm text-danger-fg">{error}</p>}
          <label className="block space-y-1.5 text-sm font-medium">Praise presets<Textarea rows={5} value={praise} onChange={(e) => setPraise(e.target.value)} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Check-in presets<Textarea rows={4} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></label>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" loading={busy}>Save presets</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setPraise(defaults.praise.join('\n')); setCheckIn(defaults.checkIn.join('\n')); onSave(null); }}>Reset to defaults</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one-tap capture surface. Every quick action records a teacher-confirmed observation for
 * the selected student (an explicit tap is the confirmation, docs/09); anything written in a
 * dialog can instead be saved for review.
 */
export function CaptureDock({ student, sessionOpen, topic, disabled, saving, vocabulary, voice, onQuick, onDetailed, onVoice, onEditVocabulary }: {
  student: { id: string; displayName: string } | null; sessionOpen: boolean; topic: string; disabled: boolean; saving: boolean;
  vocabulary: CaptureVocabulary; voice: { enabled: boolean; reason: string };
  onQuick(o: ClassroomObservation, label: string): void; onDetailed(kind: ObservationKind): void; onVoice(): void; onEditVocabulary(): void;
}) {
  const off = disabled || saving || !student || !sessionOpen;
  const [picker, setPicker] = useState<Picker>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => { if (off) setPicker(null); }, [off]);

  // Letter shortcuts, plus 1–9 to choose a preset while a quick-pick list is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picker && /^[1-9]$/.test(e.key)) {
        const list = picker === 'praise' ? vocabulary.praise : picker === 'check_in' ? vocabulary.checkIn : null;
        const choice = list?.[Number(e.key) - 1];
        if (choice) { e.preventDefault(); setPicker(null); onQuick(picker === 'praise' ? { kind: 'praise', strength: choice, note: '' } : { kind: 'check_in', observation: choice, note: '' }, picker === 'praise' ? 'Praise' : 'Check-in'); }
        return;
      }
      if (e.key === '?' && !typingTarget(e)) { e.preventDefault(); setHelp(true); return; }
      if (off || typingTarget(e)) return;
      const hit = SHORTCUTS.find((s) => s.key === e.key.toLowerCase());
      if (!hit) return;
      e.preventDefault();
      if (hit.action === 'participation') onQuick({ kind: 'participation', action: 'contributed', note: '' }, 'Participation');
      else if (hit.action === 'praise' || hit.action === 'check_in' || hit.action === 'understanding') setPicker(hit.action);
      else if (hit.action === 'voice') { if (voice.enabled) onVoice(); }
      else onDetailed(hit.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [off, picker, vocabulary, voice.enabled, onQuick, onDetailed, onVoice]);

  const open = (p: Exclude<Picker, null>) => (o: boolean) => setPicker(o ? p : null);
  return (
    <div className="space-y-2.5 lg:space-y-3">
      <div className="flex min-h-9 items-center gap-2.5">
        {student ? <Avatar name={student.displayName} size="sm" /> : <span className="size-7 rounded-full border border-dashed border-border-strong" />}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{student ? student.displayName : 'Select a student'}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted">{saving && <Loader2 className="size-3 animate-spin" />}{!sessionOpen ? 'Open a class session to capture' : saving ? 'Saving…' : student ? 'Tap to record · each tap is confirmed' : 'Tap a seat on the chart'}</div>
        </div>
        <Tooltip content="Keyboard shortcuts (?)"><Button size="icon" variant="ghost" className="hidden size-7 lg:[@media(hover:hover)]:inline-flex" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}><Keyboard /></Button></Tooltip>
      </div>
      <div className={cn('grid grid-cols-4 gap-1.5 lg:grid-cols-2', saving && 'cursor-progress [&_button:disabled]:opacity-100', !student && 'max-lg:hidden')}>
        <Tile kind="participation" disabled={off} shortcut={keyFor('participation')} onClick={() => onQuick({ kind: 'participation', action: 'contributed', note: '' }, 'Participation')} />
        <QuickPick kind="praise" title="Praise for" options={vocabulary.praise} disabled={off} open={picker === 'praise'} onOpenChange={open('praise')} onPick={(strength) => onQuick({ kind: 'praise', strength, note: '' }, 'Praise')} onCustom={() => onDetailed('praise')} onEdit={onEditVocabulary} />
        <UnderstandingPick topic={topic} disabled={off} open={picker === 'understanding'} onOpenChange={open('understanding')} onPick={(concept, evidence) => onQuick({ kind: 'understanding', concept, evidence, note: '' }, 'Understanding')} onCustom={() => onDetailed('understanding')} />
        <QuickPick kind="check_in" title="Check-in" options={vocabulary.checkIn} disabled={off} open={picker === 'check_in'} onOpenChange={open('check_in')} onPick={(observation) => onQuick({ kind: 'check_in', observation, note: '' }, 'Check-in')} onCustom={() => onDetailed('check_in')} onEdit={onEditVocabulary} />
        <Tile kind="behavior" disabled={off} shortcut={keyFor('behavior')} onClick={() => onDetailed('behavior')} />
        <Tile kind="note" disabled={off} shortcut={keyFor('note')} onClick={() => onDetailed('note')} />
        {voice.enabled ? (
          <button type="button" disabled={off} onClick={onVoice} aria-label="Voice" aria-keyshortcuts="V" className={cn(TILE, 'transition-all hover:-translate-y-0.5 hover:border-border-strong lg:[@media(hover:hover)]:pr-6')}>
            <span className={cn(TILE_ICON, 'bg-danger-soft text-danger-fg')}><Mic className="size-4" /></span>Voice
            <kbd className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-sunken px-1 font-mono text-[10px] font-medium text-subtle lg:[@media(hover:hover)]:block">V</kbd>
          </button>
        ) : (
          <Tooltip content={voice.reason}>
            <span className="flex">
              <button type="button" disabled aria-label="Voice (not enabled)" className={cn(TILE, 'w-full border-dashed border-border-strong bg-transparent text-subtle shadow-none disabled:opacity-100')}>
                <span className={cn(TILE_ICON, 'bg-sunken')}><Mic className="size-4" /></span>
                Voice
              </button>
            </span>
          </Tooltip>
        )}
        <Dropdown>
          <DropdownTrigger asChild disabled={off}>
            <button type="button" disabled={off} className={cn(TILE, 'hover:border-border-strong')}>
              <span className={cn(TILE_ICON, 'bg-sunken text-muted')}><MoreHorizontal className="size-4" /></span>
              More
            </button>
          </DropdownTrigger>
          <DropdownContent side="top">
            <DropdownLabel>Attendance</DropdownLabel>
            <DropdownItem onSelect={() => onQuick({ kind: 'attendance', status: 'late', note: '' }, 'Marked late')}>Arrived late</DropdownItem>
            <DropdownItem onSelect={() => onQuick({ kind: 'attendance', status: 'absent', note: '' }, 'Marked absent')}>Absent</DropdownItem>
            <DropdownSeparator />
            <DropdownLabel>Detailed</DropdownLabel>
            <DropdownItem onSelect={() => onDetailed('participation')}>Participation type…</DropdownItem>
            <DropdownItem onSelect={() => onDetailed('exit_ticket')}>Exit ticket…</DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Pencil />} onSelect={onEditVocabulary}>Edit quick-pick wording…</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="Keyboard shortcuts" description="Active in Class Pulse while a student is selected and no field has focus.">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {[['←↑→↓', 'Move between seats'], ['Esc', 'Clear the selection'], ...SHORTCUTS.map((s) => [s.key.toUpperCase(), s.label + (s.action === 'voice' && !voice.enabled ? ' (when enabled)' : '')]), ['1–9', 'Choose a preset in an open list'], ['?', 'Show this help']].map(([k, label]) => (
              <li key={label} className="flex items-center gap-2"><Kbd>{k}</Kbd><span>{label}</span></li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
