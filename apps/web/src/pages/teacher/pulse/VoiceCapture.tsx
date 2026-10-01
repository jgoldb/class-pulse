import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import type { ClassroomObservation } from '@class-pulse/domain';
import { Button, Dialog, DialogContent, Segmented, Textarea, cn } from '../../../components/ui';
import { api } from '../../../lib/api';
import { selectStyle } from './ObservationEditor';

type Phase = 'idle' | 'recording' | 'transcribing' | 'review';
type Kind = 'note' | 'check_in' | 'praise';

/**
 * Voice capture (guide §E): a deliberate, push-to-talk note of at most a minute. Recording is
 * visible and cancellable, audio stays in memory and is discarded after transcription, the
 * transcript is draft text the teacher edits, and the teacher chooses the student — no speaker
 * identification. Saving goes through the normal observation path (source: reviewed transcript).
 */
export function VoiceCapture({ open, onOpenChange, sectionId, maxSeconds, students, defaultStudentId, onSave }: {
  open: boolean; onOpenChange(open: boolean): void; sectionId: string; maxSeconds: number;
  students: Array<{ id: string; displayName: string }>; defaultStudentId: string;
  onSave(studentId: string, observation: ClassroomObservation, confirmed: boolean): Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [flagged, setFlagged] = useState(0);
  const [studentId, setStudentId] = useState(defaultStudentId);
  const [kind, setKind] = useState<Kind>('note');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => { if (open) { setPhase('idle'); setTranscript(''); setFlagged(0); setError(''); setSeconds(0); setStudentId(defaultStudentId); setKind('note'); } }, [open, defaultStudentId]);
  useEffect(() => () => stopTracks(), []);

  function stopTracks() {
    if (timer.current) window.clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }
  async function start() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = []; cancelled.current = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => { stopTracks(); if (!cancelled.current) void upload(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })); chunks.current = []; };
      recorder.current = rec; rec.start(); setPhase('recording'); setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((s) => { if (s + 1 >= maxSeconds) stop(); return s + 1; }), 1000);
    } catch { setError('Microphone access was blocked. Allow it in the browser, or type the observation instead.'); }
  }
  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); }
  function cancel() { cancelled.current = true; stop(); stopTracks(); chunks.current = []; setPhase('idle'); setSeconds(0); }
  async function upload(blob: Blob) {
    setPhase('transcribing');
    try {
      const body = await api.upload<{ transcript: string; flagged: unknown[] }>(`/api/pulse/voice/transcribe?sectionId=${encodeURIComponent(sectionId)}`, blob, blob.type.split(';')[0] || 'audio/webm');
      setTranscript(body.transcript ?? ''); setFlagged(body.flagged.length); setPhase('review');
    } catch (e) { setError(e instanceof Error ? e.message : 'Transcription failed'); setPhase('idle'); }
  }
  const observation = (): ClassroomObservation => kind === 'note' ? { kind, note: transcript.trim() } : kind === 'check_in' ? { kind, observation: transcript.trim().slice(0, 500), note: '' } : { kind, strength: transcript.trim().slice(0, 500), note: '' };
  async function save(confirmed: boolean) {
    setSaving(true); setError('');
    const ok = await onSave(studentId, observation(), confirmed);
    setSaving(false);
    if (ok) onOpenChange(false);
    else setError('Not saved. Remove any names from the transcript and check the student, then try again.');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { cancel(); } onOpenChange(o); }}>
      <DialogContent className="max-w-lg" title="Voice note" description={`Push to talk, up to ${maxSeconds} seconds. Audio is transcribed and discarded; you review the words and choose the student before anything is saved.`}>
        {error && <p role="alert" className="mb-3 rounded-md bg-danger-soft p-2.5 text-sm text-danger-fg">{error}</p>}
        {phase !== 'review' ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <button
              type="button"
              aria-pressed={phase === 'recording'}
              aria-label={phase === 'recording' ? 'Stop recording' : 'Start recording'}
              disabled={phase === 'transcribing'}
              onClick={() => (phase === 'recording' ? stop() : void start())}
              className={cn('relative flex size-24 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-60', phase === 'recording' ? 'bg-danger' : 'bg-brand')}
            >
              {phase === 'recording' && <span className="absolute inset-0 animate-ping rounded-full bg-danger/40" />}
              {phase === 'recording' ? <Square className="relative size-8" /> : <Mic className="relative size-9" />}
            </button>
            <p role="status" className="text-sm font-medium">
              {phase === 'recording' ? <span className="text-danger-fg">● Recording — {seconds}s of {maxSeconds}s</span> : phase === 'transcribing' ? 'Transcribing…' : 'Tap to start, tap again to stop'}
            </p>
            {phase === 'recording' && <Button variant="ghost" size="sm" onClick={cancel}><X />Cancel and discard</Button>}
            <p className="text-center text-xs text-muted">Describe what you observed. Leave out names — you pick the student next.</p>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(true); }}>
            <label className="block space-y-1.5 text-sm font-medium">Transcript (edit before saving)<Textarea rows={4} maxLength={2000} value={transcript} onChange={(e) => setTranscript(e.target.value)} required /></label>
            {flagged > 0 && <p className="rounded-md bg-warning-soft p-2.5 text-xs text-warning-fg">The transcript appears to contain {flagged} name or identifier{flagged === 1 ? '' : 's'}. Remove {flagged === 1 ? 'it' : 'them'} — the student is attributed separately.</p>}
            <label className="block space-y-1.5 text-sm font-medium">Student<select className={selectStyle} required value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Choose the student</option>{students.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
            <div className="space-y-1.5 text-sm font-medium"><span>Save as</span>
              <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: 'note', label: 'Note' }, { value: 'check_in', label: 'Check-in' }, { value: 'praise', label: 'Praise' }]} />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button type="submit" loading={saving} disabled={!studentId || !transcript.trim()}>Confirm observation</Button>
              <Button type="button" variant="secondary" disabled={saving || !studentId || !transcript.trim()} onClick={() => void save(false)}>Save for review</Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => { setTranscript(''); setPhase('idle'); }}>Record again</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
