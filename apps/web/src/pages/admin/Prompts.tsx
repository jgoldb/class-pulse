import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Rocket } from 'lucide-react';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, PageSkeleton, Select, Textarea } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

export function AdminPrompts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'prompts'], queryFn: () => api.get<any[]>('/api/admin/prompts') });
  const diffs = useQuery({ queryKey: ['admin', 'draft-diffs'], queryFn: () => api.get<any>('/api/admin/draft-diffs') });
  const [result, setResult] = useState<any>(null);
  const [form, setForm] = useState({ surface: 'plan_generation', body: '', changelog: '', model: 'default', reasoningEffort: '', maxTokens: 8000 });
  const runEvals = useMutation({
    mutationFn: (id: string) => api.post<any>(`/api/admin/prompts/${id}/evals`, { judge: true }),
    onSuccess: (r) => {
      setResult(r);
      toast[r.passed ? 'success' : 'error'](`Eval: ${r.passedCases}/${r.totalCases} cases passed`);
      qc.invalidateQueries({ queryKey: ['admin', 'prompts'] });
    },
  });
  const promote = useMutation({ mutationFn: (id: string) => api.post(`/api/admin/prompts/${id}/promote`), onSuccess: () => { toast.success('Promoted to active.'); qc.invalidateQueries({ queryKey: ['admin', 'prompts'] }); } });
  const create = useMutation({
    mutationFn: () => api.post('/api/admin/prompts', { surface: form.surface, body: form.body, changelog: form.changelog, model: form.model, params: { reasoningEffort: form.reasoningEffort || null, maxTokens: form.maxTokens } }),
    onSuccess: () => {
      toast.success('Draft version created.');
      setForm({ ...form, body: '', changelog: '' });
      qc.invalidateQueries({ queryKey: ['admin', 'prompts'] });
    },
  });
  const perr = (promote.error ?? create.error ?? runEvals.error) as ApiError | null;
  if (q.isLoading) return <PageSkeleton />;
  return (
    <div>
      <PageHeader title="Prompts & evals" description="Prompts are immutable, versioned application code. A plan-generation version cannot become active without a recorded passing eval run on the real model. A full run takes about 17 minutes." />
      {perr && <Callout tone="danger" className="mb-4">{perr.message}{perr.details ? ` — ${JSON.stringify(perr.details)}` : ''}</Callout>}
      {result && (
        <Callout tone={result.passed ? 'success' : 'danger'} title={`Eval run: ${result.passedCases}/${result.totalCases} cases passed`} className="mb-4">
          <div className="text-xs">Rubric means: {Object.entries(result.rubricMeans).map(([k, v]) => `${k}=${v ?? '-'}`).join(' · ')}</div>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {result.cases.filter((c: any) => !c.passed).map((c: any) => (
              <li key={c.id}>{c.id} {c.title}: {c.failures.map((f: any) => `${f.assertion} (${f.detail})`).join('; ')}</li>
            ))}
          </ul>
        </Callout>
      )}
      <Card>
        <CardBody className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-2 pr-3">Version</th>
                  <th className="pr-3">Model</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">Latest eval</th>
                  <th className="pr-3">Changelog</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data?.map((p) => (
                  <tr key={p.id} className="border-t border-border align-top">
                    <td className="py-2.5 pr-3 font-mono text-xs">{p.id}</td>
                    <td className="pr-3 text-xs">{p.model}{p.params?.reasoningEffort ? ` · ${p.params.reasoningEffort}` : ''}</td>
                    <td className="pr-3"><Badge tone={p.status === 'active' ? 'success' : p.status === 'retired' ? 'neutral' : 'info'}>{p.status}</Badge></td>
                    <td className="pr-3 text-xs">{p.latestEval ? <Badge tone={p.latestEval.passed ? 'success' : 'danger'}>{p.latestEval.passedCases}/{p.latestEval.totalCases} · {p.latestEval.model}</Badge> : '—'}</td>
                    <td className="max-w-md pr-3 text-xs text-muted">{p.changelog}</td>
                    <td className="whitespace-nowrap text-right">
                      {p.surface === 'plan_generation' && (
                        <Button size="sm" variant="secondary" loading={runEvals.isPending && runEvals.variables === p.id} disabled={runEvals.isPending} onClick={() => runEvals.mutate(p.id)}>
                          <FlaskConical /> Run evals
                        </Button>
                      )}{' '}
                      {p.status === 'draft' && (
                        <Button size="sm" onClick={() => promote.mutate(p.id)}>
                          <Rocket /> Promote
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where educators rewrite the draft" description="Tuning input: the diff between AI draft and approved plan, aggregated by section." />
          <CardBody>
            {diffs.data && (
              <div className="text-sm">
                <div className="text-xs text-muted">{diffs.data.approvedPlans} approved plans</div>
                <ul className="mt-1">
                  {diffs.data.bySection.map((s: any) => (
                    <li key={s.section} className="flex justify-between border-t border-border py-1.5">
                      <span>{s.section}</span>
                      <span className="text-xs text-muted">changed {s.changed} · added {s.added} · removed {s.removed}</span>
                    </li>
                  ))}
                  {diffs.data.bySection.length === 0 && <li className="text-muted">No edits recorded yet.</li>}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New prompt version" description="Created as a draft. Run evals, then promote." />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Surface">
                <Select value={form.surface} onChange={(v) => setForm({ ...form, surface: v })} options={['plan_generation', 'pattern_interpretation', 'review_narration', 'guardrail_classifier', 'eval_judge'].map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Model" hint='"default" = from environment'>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field label="Reasoning effort">
                <Select value={form.reasoningEffort || 'default'} onChange={(v) => setForm({ ...form, reasoningEffort: v === 'default' ? '' : v })} options={[{ value: 'default', label: 'default' }, ...['minimal', 'low', 'medium', 'high'].map((s) => ({ value: s, label: s }))]} />
              </Field>
              <Field label="Max output tokens">
                <Input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Body">
              <Textarea rows={8} className="font-mono text-xs" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <Field label="Changelog" hint="what problem in the prior version this addresses">
              <Input value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} />
            </Field>
            <Button size="sm" disabled={form.body.length < 50 || form.changelog.length < 5} loading={create.isPending} onClick={() => create.mutate()}>
              Create draft version
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
