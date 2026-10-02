import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, Keyboard, MessageSquareText, Palette, Sparkles } from 'lucide-react';
import { DEFAULT_CAPTURE_VOCABULARY, type CaptureVocabulary } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { TomorrowSettings } from '../../components/TomorrowSettings';
import { Button, Card, CardBody, CardHeader, Kbd, Segmented } from '../../components/ui';
import { api } from '../../lib/api';
import { applyTheme, storedTheme, type Theme } from '../../lib/theme';
import { SHORTCUTS, VocabularyDialog } from './pulse/CaptureDock';

/**
 * Teacher settings, kept off the main path (visual spec §3: "Put Settings lower"). Nothing here is
 * needed to start teaching; every setting has a working default.
 */
export function TeacherSettings() {
  const qc = useQueryClient();
  const vocabulary = useQuery({ queryKey: ['capture-vocabulary'], queryFn: () => api.get<{ vocabulary: CaptureVocabulary; defaults: CaptureVocabulary; custom: boolean }>('/api/pulse/vocabulary') });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const v = vocabulary.data?.vocabulary ?? DEFAULT_CAPTURE_VOCABULARY;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Quick-pick wording, Tomorrow preparation and how Pulsera looks for you." />

      <Card>
        <CardHeader eyebrow={<span className="inline-flex items-center gap-1.5"><MessageSquareText className="size-3.5" />Quick capture</span>} title="Quick-pick wording" description={vocabulary.data?.custom ? 'Your own wording, used in all your classes.' : 'Pulsera’s default wording. Make it sound like you.'} action={<Button variant="secondary" onClick={() => { setError(''); setEditing(true); }}>Edit wording</Button>} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div><div className="mb-2 text-sm font-medium">Praise</div><ul className="flex flex-wrap gap-1.5">{v.praise.map((p) => <li key={p} className="rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success-fg">{p}</li>)}</ul></div>
          <div><div className="mb-2 text-sm font-medium">Check-in</div><ul className="flex flex-wrap gap-1.5">{v.checkIn.map((p) => <li key={p} className="rounded-full bg-sunken px-3 py-1 text-xs font-medium">{p}</li>)}</ul></div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader eyebrow={<span className="inline-flex items-center gap-1.5 text-ai-fg"><Sparkles className="size-3.5" />Tomorrow Ready</span>} title="Automatic preparation" description="Pulsera can prepare tomorrow’s Do Now after class. Everything it prepares waits for your review." />
        <CardBody><TomorrowSettings /></CardBody>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader eyebrow={<span className="inline-flex items-center gap-1.5"><Palette className="size-3.5" />Appearance</span>} title="Theme" description="Follow your device, or choose one." />
          <CardBody>
            <Segmented value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }} options={[{ value: 'system', label: 'Device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader eyebrow={<span className="inline-flex items-center gap-1.5"><Keyboard className="size-3.5" />Keyboard</span>} title="Class Pulse shortcuts" description="With a student selected and no field in focus." />
          <CardBody>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {[['←↑→↓', 'Move between seats'], ['Esc', 'Clear selection'], ...SHORTCUTS.map((s) => [s.key.toUpperCase(), s.label])].map(([k, label]) => <li key={label} className="flex items-center gap-2"><Kbd>{k}</Kbd>{label}</li>)}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Link to="/teacher/classes" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Class names, periods, rooms and rosters live in My Classes <ArrowRight className="size-4" /></Link>

      <VocabularyDialog open={editing} onOpenChange={setEditing} vocabulary={v} defaults={vocabulary.data?.defaults ?? DEFAULT_CAPTURE_VOCABULARY} busy={busy} error={error} onSave={async (next) => {
        setBusy(true); setError('');
        try { await api.post('/api/pulse/vocabulary', { vocabulary: next }); await qc.invalidateQueries({ queryKey: ['capture-vocabulary'] }); setEditing(false); toast.success(next ? 'Quick-pick wording saved' : 'Quick-pick wording reset'); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); }
        finally { setBusy(false); }
      }} />
    </div>
  );
}
