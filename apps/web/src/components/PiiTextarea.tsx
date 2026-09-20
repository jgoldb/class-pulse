import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert, Wand2 } from 'lucide-react';
import { Button, Textarea, cn } from './ui';
import { api } from '../lib/api';

interface Span {
  kind: string;
  start: number;
  end: number;
  text: string;
  confidence: 'high' | 'medium';
  hint: string;
}

/**
 * "Catch PII at the keyboard, not at the gate" (docs/04). Scans as the teacher types and offers
 * a one-tap fix: "This looks like a student name. Remove it? Class Pulse works without it."
 */
export function PiiTextarea({ value, onChange, rows = 3, placeholder, onBlockingChange, id, testId }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; onBlockingChange?: (blocking: boolean) => void; id?: string; testId?: string }) {
  const [spans, setSpans] = useState<Span[]>([]);
  const [redacted, setRedacted] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!value.trim()) {
      setSpans([]);
      onBlockingChange?.(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.post<{ spans: Span[]; redacted: string; blocking: boolean }>('/api/pii/scan', { text: value });
        setSpans(r.spans);
        setRedacted(r.spans.length ? r.redacted : null);
        onBlockingChange?.(r.blocking);
      } catch {
        /* best effort here; the API enforces at submit and at the gate */
      }
    }, 300);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [value]);

  const blocking = spans.some((s) => s.confidence === 'high');
  return (
    <div>
      <Textarea id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} aria-invalid={blocking || undefined} className={cn(blocking && 'border-danger')} />
      <AnimatePresence>
        {spans.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={cn('mt-2 flex items-start gap-3 rounded-md border p-3 text-xs', blocking ? 'border-danger/30 bg-danger-soft text-danger-fg' : 'border-warning/30 bg-warning-soft text-warning-fg')} data-testid="pii-warning">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{blocking ? 'This looks like identifying information.' : 'Worth a second look.'}</div>
                <ul className="mt-1 space-y-0.5">
                  {spans.slice(0, 4).map((s, i) => (
                    <li key={i}>
                      <span className="font-mono">"{s.text}"</span> — {s.hint}
                    </li>
                  ))}
                </ul>
                {redacted && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    data-testid="pii-fix"
                    onClick={() => {
                      onChange(redacted);
                      setSpans([]);
                      setRedacted(null);
                      onBlockingChange?.(false);
                    }}
                  >
                    <Wand2 /> Remove it — Class Pulse works without it
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
