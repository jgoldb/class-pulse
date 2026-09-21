import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Lock, Sparkles } from 'lucide-react';
import { INTAKE_FIELD_LABELS, type IntakeFields } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Select } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { RosterStudent } from '../../lib/types';
import { PiiTextarea } from '../../components/PiiTextarea';

const EMPTY: IntakeFields = { gradeLevel: '', observableBehavior: '', baselineInformation: '', documentedPatterns: '', strengthsInterests: '', currentStrategies: '', desiredBehavior: '' };

const HINTS: Record<keyof IntakeFields, string> = {
  gradeLevel: '',
  observableBehavior: 'What you can see and count. No names, no reasons.',
  baselineInformation: 'Counts per period if you have them. If one number covers two behaviors, say so.',
  documentedPatterns: 'When it is more or less likely: task type, time, setting.',
  strengthsInterests: 'These become strategies. Be specific.',
  currentStrategies: 'What has been tried, and how the student responded.',
  desiredBehavior: 'Observable, positive phrasing.',
};
const ORDER = ['observableBehavior', 'baselineInformation', 'documentedPatterns', 'strengthsInterests', 'currentStrategies', 'desiredBehavior'] as const;

export function IntakePage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const [studentId, setStudentId] = useState(params.get('studentId') ?? '');
  const [fields, setFields] = useState<IntakeFields>(EMPTY);
  const [blocking, setBlocking] = useState<Record<string, boolean>>({});

  const submit = useMutation({
    mutationFn: () => api.post<{ caseKey: string; draftId: string }>('/api/intakes', { studentId, fields }),
    onSuccess: (r) => {
      toast.success('Intake submitted. Drafting the plan in the background.');
      nav(`${base}/drafts/${r.draftId}`);
    },
  });
  const err = submit.error as ApiError | null;
  const anyBlocking = Object.values(blocking).some(Boolean);
  const selected = roster.data?.find((s) => s.id === studentId);
  // Arriving from "Open a case" names the student in the URL; fill their grade the same way
  // picking them from the list does.
  useEffect(() => {
    if (selected && !fields.gradeLevel) setFields((f) => ({ ...f, gradeLevel: selected.gradeLevel }));
  }, [selected?.id]);
  const filled = ORDER.filter((k) => fields[k].trim()).length;

  return (
    <form
      className="mx-auto max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <PageHeader title="New intake" description="Seven de-identified fields. The draft plan generates in the background and lands in your review queue; nothing becomes active until you approve it." />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Student" description="The name stays on this screen. The case is keyed by a pseudonymous id and the model never receives the roster." />
          <CardBody>
            <Field label="Student from your roster">
              <Select
                ariaLabel="Student"
                value={studentId || null}
                onChange={(v) => {
                  setStudentId(v);
                  const s = roster.data?.find((x) => x.id === v);
                  if (s && !fields.gradeLevel) setFields((f) => ({ ...f, gradeLevel: s.gradeLevel }));
                }}
                options={(roster.data ?? []).map((s) => ({ value: s.id, label: s.displayName, description: s.sectionName }))}
              />
            </Field>
            {selected && selected.caseKeys.length > 0 && (
              <Callout tone="info" className="mt-3">
                This student already has a case. A new intake creates a second case; consider updating the existing plan instead.
              </Callout>
            )}
            <div className="mt-4 max-w-40">
              <Field label={INTAKE_FIELD_LABELS.gradeLevel}>
                <Input value={fields.gradeLevel} onChange={(e) => setFields({ ...fields, gradeLevel: e.target.value })} required data-testid="gradeLevel" />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Educator input"
            description="Scanned for identifying information as you type."
            action={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-muted">
                <Lock className="size-3" /> {filled}/6 filled
              </span>
            }
          />
          <CardBody className="space-y-5">
            {ORDER.map((k) => (
              <Field key={k} label={INTAKE_FIELD_LABELS[k]} hint={HINTS[k]}>
                <PiiTextarea testId={k} value={fields[k]} onChange={(v) => setFields({ ...fields, [k]: v })} rows={k === 'observableBehavior' ? 4 : 2} onBlockingChange={(b) => setBlocking((s) => ({ ...s, [k]: b }))} />
              </Field>
            ))}
          </CardBody>
        </Card>

        {err && (
          <Callout tone="danger" title={err.message}>
            {Array.isArray((err.details as { spans?: unknown[] })?.spans) && (
              <ul className="mt-1 list-disc pl-4">
                {((err.details as { spans: Array<{ field: string; text: string; hint: string }> }).spans ?? []).map((s, i) => (
                  <li key={i}>
                    {INTAKE_FIELD_LABELS[s.field as keyof IntakeFields] ?? s.field}: "{s.text}" — {s.hint}
                  </li>
                ))}
              </ul>
            )}
          </Callout>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{anyBlocking ? <span className="text-danger-fg">Remove identifying information before submitting.</span> : 'Generation takes about a minute. You can keep working.'}</p>
          <Button type="submit" size="lg" loading={submit.isPending} disabled={anyBlocking || !studentId} data-testid="submit-intake">
            <Sparkles /> Generate draft plan
          </Button>
        </div>
      </div>
    </form>
  );
}
