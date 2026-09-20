import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Check, FlaskConical, Lightbulb, RefreshCw, Scale, Sparkles } from 'lucide-react';
import { DISMISSAL_REASONS } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, Field, Input, PageSkeleton, Select, Stagger, StaggerItem, Textarea, cn } from '../../components/ui';
import { ApiError, api, fmtDate, humanize } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Candidate, RosterStudent } from '../../lib/types';

type Decision = 'confirmed' | 'dismissed' | 'needs_more_data' | 'escalated';

/**
 * The pattern card (docs/02 §3): evidence first, hypothesis second, proposals third — visually
 * distinct and always in that order. A card that led with the hypothesis would invite the
 * reader to treat it as a finding.
 */
export function PatternCard() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { primaryRole } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const q = useQuery({ queryKey: ['candidate', id], queryFn: () => api.get<Candidate>(`/api/candidates/${id}`), refetchInterval: (x) => (x.state.data?.proposalStatus === 'pending' ? 2500 : false) });
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster') });
  const open = useMutation({ mutationFn: () => api.post(`/api/candidates/${id}/open`), onSuccess: () => qc.invalidateQueries({ queryKey: ['candidate', id] }) });
  const reinterpret = useMutation({ mutationFn: () => api.post(`/api/candidates/${id}/reinterpret`), onSuccess: () => { toast.success('Re-running the interpretation.'); qc.invalidateQueries({ queryKey: ['candidate', id] }); } });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('not_accurate');
  const [target, setTarget] = useState({ signalType: 'assignment_grade', additionalObservations: 6 });
  const [seedKind, setSeedKind] = useState<'none' | 'goal' | 'strategy'>('strategy');
  const [seedText, setSeedText] = useState('');
  const [seedRationale, setSeedRationale] = useState('');
  const [goalDef, setGoalDef] = useState('');

  const adjudicate = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { decision, note: note || null };
      if (decision === 'dismissed') body.dismissalReason = reason;
      if (decision === 'needs_more_data') body.collectionTarget = target;
      if (decision === 'confirmed' && seedKind !== 'none' && seedText.trim()) {
        body.seed =
          seedKind === 'goal'
            ? { kind: 'goal', content: { targetBehavior: seedText.trim(), observableDefinition: goalDef.trim() || seedText.trim(), baseline: { status: 'unavailable', reason: 'Not yet counted for this new goal.' }, measurementMethod: 'frequency_count', direction: 'increase', target: { status: 'blocked_on_baseline', note: 'Count for at least five observed periods before setting a target.' }, reviewPeriodDays: 14 } }
            : { kind: 'strategy', strategyKind: 'preventive', content: { description: seedText.trim(), rationale: seedRationale.trim() || 'Seeded from a confirmed pattern.', usesStrengths: [], effortLevel: 'low' } };
      }
      return api.post(`/api/candidates/${id}/adjudicate`, body);
    },
    onSuccess: () => {
      toast.success(`Recorded: ${humanize(decision ?? '')}.`);
      qc.invalidateQueries();
      nav(`${base}/patterns`);
    },
  });

  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <Callout tone="danger">Candidate not found.</Callout>;
  const c = q.data;
  const p = c.proposal;
  const decided = ['confirmed', 'dismissed', 'escalated'].includes(c.status);
  const err = adjudicate.error as ApiError | null;
  const student = roster.data?.find((s) => s.caseKeys.includes(c.caseKey))?.displayName ?? 'Student';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ to: `${base}/patterns`, label: 'Pattern queue' }}
        eyebrow={`${student} · rule ${c.definitionId} v${c.definitionVersion} · detected ${fmtDate(c.detectedAt)}`}
        title={c.title}
        actions={
          <>
            <Badge tone="evidence" className="px-3 py-1 text-xs">
              strength {Math.round(c.strength * 100)}%
            </Badge>
            <Badge tone={decided ? (c.status === 'confirmed' ? 'success' : 'neutral') : 'warning'} className="px-3 py-1 text-xs">
              {humanize(c.status)}
            </Badge>
            <Link to={`${base}/cases/${c.caseKey}`} className="text-sm font-medium text-primary hover:underline">
              Open case
            </Link>
          </>
        }
      />

      <Stagger className="space-y-4">
        {/* 1. EVIDENCE */}
        <StaggerItem>
          <Card tone="evidence">
            <CardBody className="pt-5">
              <Step n={1} label="Evidence" icon={<Scale />} tone="evidence" title="What the data shows" />
              <p className="mt-3 text-sm">{c.plainLanguage}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(c.evidence ?? []).map((e) => (
                  <div key={e.signalType} className="rounded-md border border-border bg-sunken/40 p-3 text-sm">
                    <div className="font-medium">{humanize(e.signalType)}</div>
                    <div className="text-xs text-muted">
                      {e.count} entries · {e.distinctDays} days · {e.spanDays}-day span{e.mean !== null ? ` · mean ${e.mean}` : ''}
                    </div>
                    {e.byContext.length > 0 && (
                      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                        {e.byContext.map((b) => (
                          <li key={b.tag} className="flex justify-between">
                            <span className="text-muted">{humanize(b.tag)}</span>
                            <span className="font-mono">
                              {b.count}
                              {b.mean !== null ? ` · ${b.mean}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(c.measures).map(([k, v]) => (
                  <Badge key={k}>
                    {humanize(k)}: {Number.isInteger(v) ? v : v.toFixed(2)}
                  </Badge>
                ))}
              </div>
              {p && <p className="mt-3 text-sm text-evidence">{p.evidenceRestatement}</p>}
              <p className="mt-3 text-xs text-subtle">Thresholds are set in the catalog and reviewable by an administrator. The model did not decide this fired.</p>
            </CardBody>
          </Card>
        </StaggerItem>

        {/* 2. HYPOTHESIS */}
        <StaggerItem>
          <Card tone="hypothesis">
            <CardBody className="pt-5">
              <Step n={2} label="Hypothesis" icon={<Lightbulb />} tone="hypothesis" title="One possibility to test — not a finding" />
              {c.proposalStatus === 'pending' && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <span className="size-2 animate-ping rounded-full bg-hypothesis" /> Drafting the interpretation…
                </div>
              )}
              {c.proposalStatus === 'none' && <Callout tone="info" className="mt-3">No interpretation is drafted for {humanize(c.routing)} candidates. Follow the established procedure.</Callout>}
              {(c.proposalStatus === 'failed' || c.proposalStatus === 'needs_attention') && (
                <Callout tone={c.proposalStatus === 'failed' ? 'danger' : 'warning'} className="mt-3" action={!decided && <Button size="sm" variant="secondary" loading={reinterpret.isPending} onClick={() => reinterpret.mutate()}><RefreshCw /> {c.proposalStatus === 'failed' ? 'Retry' : 'Regenerate'}</Button>}>
                  {c.proposalStatus === 'failed' ? 'Interpretation failed; the evidence above stands on its own.' : 'The interpretation failed a guardrail twice and is shown for your judgement only.'}
                </Callout>
              )}
              {p && (
                <>
                  <p className="mt-3 text-sm">{p.hypothesis}</p>
                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-subtle">Alternative explanations the rule requires us to weigh</div>
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {p.alternativeExplanations.map((a, i) => (
                      <li key={i} className="rounded-md bg-sunken/60 p-2.5">
                        <span className="font-medium">{a.confounder}:</span> <span className="text-muted">{a.assessment}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>
        </StaggerItem>

        {/* 3. PROPOSALS */}
        <StaggerItem>
          <Card tone="proposal">
            <CardBody className="pt-5">
              <Step n={3} label="Proposals" icon={<FlaskConical />} tone="proposal" title="Things you might try, each with what would confirm it" />
              {p && p.proposedInterventions.length === 0 && <p className="mt-3 text-sm text-muted">No interventions proposed for this routing.</p>}
              {p && (
                <ol className="mt-3 space-y-2 text-sm">
                  {p.proposedInterventions.map((x, i) => (
                    <li key={i} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{x.description}</span>
                        <Badge tone={x.effortLevel === 'high' ? 'warning' : 'neutral'}>{x.effortLevel} effort</Badge>
                      </div>
                      <div className="mt-1 text-muted">{x.rationale}</div>
                      <div className="mt-2 rounded-md bg-proposal-soft p-2 text-xs text-proposal">
                        <span className="font-semibold">What would confirm it: </span>
                        {x.whatWouldConfirm}
                      </div>
                      {x.workloadJustification && <div className="mt-1 text-xs text-warning-fg">Workload: {x.workloadJustification}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {p && p.dataToCollect.length > 0 && (
                <div className="mt-4 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Data to collect</div>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {p.dataToCollect.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {p && <p className="mt-3 rounded-md bg-sunken/60 p-2.5 text-xs text-muted">{p.humanReviewNotes}</p>}
            </CardBody>
          </Card>
        </StaggerItem>

        {/* ADJUDICATION */}
        <StaggerItem>
          <Card>
            <CardBody className="pt-5">
              <h2 className="text-[15px] font-semibold">Your decision</h2>
              {decided ? (
                <div className="mt-2 text-sm">
                  <Badge tone={c.status === 'confirmed' ? 'success' : 'neutral'}>{humanize(c.status)}</Badge> {c.adjudicatedAt && <span className="text-muted">on {fmtDate(c.adjudicatedAt)}</span>}
                  {c.dismissalReason && <span className="text-muted"> · reason: {humanize(c.dismissalReason)}</span>}
                  {c.adjudicationNote && <p className="mt-2 text-muted">{c.adjudicationNote}</p>}
                </div>
              ) : c.status === 'detected' ? (
                <div className="mt-3">
                  <Button loading={open.isPending} onClick={() => open.mutate()} data-testid="start-review">
                    <Sparkles /> Start review
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  <div className="grid gap-2 sm:grid-cols-4">
                    {(['confirmed', 'dismissed', 'needs_more_data', 'escalated'] as Decision[]).filter((d) => !(d === 'escalated' && c.routing !== 'teacher_review')).map((d) => (
                      <button key={d} onClick={() => setDecision(d)} aria-pressed={decision === d} className={cn('rounded-lg border-2 px-3 py-3 text-left text-sm font-medium transition-all', decision === d ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-elevated hover:border-border-strong')} data-testid={`decision-${d}`}>
                        {humanize(d)}
                        <div className="mt-0.5 text-xs font-normal text-muted">{{ confirmed: 'Matches what you see', dismissed: 'Not accurate or not useful', needs_more_data: 'Re-evaluate at a target', escalated: 'Send to support team' }[d]}</div>
                      </button>
                    ))}
                  </div>
                  {decision === 'dismissed' && (
                    <Field label="Reason (required — it tunes the rule)">
                      <Select value={reason} onChange={setReason} options={DISMISSAL_REASONS.map((r) => ({ value: r, label: humanize(r) }))} />
                    </Field>
                  )}
                  {decision === 'needs_more_data' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Collect">
                        <Select value={target.signalType} onChange={(v) => setTarget({ ...target, signalType: v })} options={['assignment_grade', 'assessment_score', 'behavior_event', 'attendance', 'strategy_use', 'interval_observation'].map((t) => ({ value: t, label: humanize(t) }))} />
                      </Field>
                      <Field label="More observations before re-evaluating">
                        <Input type="number" min={1} value={target.additionalObservations} onChange={(e) => setTarget({ ...target, additionalObservations: Number(e.target.value) })} />
                      </Field>
                    </div>
                  )}
                  {decision === 'confirmed' && (
                    <div className="space-y-3 rounded-lg border border-border bg-sunken/40 p-4">
                      <div className="text-sm font-medium">Seed the plan <span className="font-normal text-muted">(you edit before it lands; the diff is stored)</span></div>
                      <div className="flex gap-2">
                        {(['strategy', 'goal', 'none'] as const).map((k) => (
                          <Button key={k} size="sm" variant={seedKind === k ? 'primary' : 'secondary'} onClick={() => setSeedKind(k)}>
                            {k === 'none' ? 'Nothing' : `New ${k}`}
                          </Button>
                        ))}
                      </div>
                      {seedKind !== 'none' && (
                        <>
                          <Field label={seedKind === 'goal' ? 'Target behavior' : 'Strategy description'}>
                            <Textarea rows={2} value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder={p?.proposedInterventions[0]?.description ?? ''} data-testid="seed-text" />
                          </Field>
                          {seedKind === 'goal' ? (
                            <Field label="Observable definition" hint="no vague terms">
                              <Textarea rows={2} value={goalDef} onChange={(e) => setGoalDef(e.target.value)} />
                            </Field>
                          ) : (
                            <Field label="Rationale">
                              <Input value={seedRationale} onChange={(e) => setSeedRationale(e.target.value)} />
                            </Field>
                          )}
                          {p?.proposedInterventions[0] && (
                            <Button size="sm" variant="ghost" onClick={() => { setSeedText(p.proposedInterventions[0]!.description); setSeedRationale(p.proposedInterventions[0]!.rationale); }}>
                              Use proposal 1 as a starting point
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <Field label="Note">
                    <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you observed that supports or undercuts this." />
                  </Field>
                  {err && <Callout tone="danger">{err.message}</Callout>}
                  <Button size="lg" disabled={!decision} loading={adjudicate.isPending} onClick={() => adjudicate.mutate()} data-testid="record-decision">
                    <Check /> Record decision
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function Step({ n, label, icon, tone, title }: { n: number; label: string; icon: React.ReactNode; tone: 'evidence' | 'hypothesis' | 'proposal'; title: string }) {
  const t = { evidence: 'bg-evidence-soft text-evidence', hypothesis: 'bg-hypothesis-soft text-hypothesis', proposal: 'bg-proposal-soft text-proposal' }[tone];
  return (
    <div className="flex items-center gap-3">
      <span className={cn('flex size-9 items-center justify-center rounded-md [&_svg]:size-4', t)}>{icon}</span>
      <div>
        <div className={cn('text-[11px] font-semibold uppercase tracking-wider', t.split(' ')[1])}>
          {n} · {label}
        </div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
    </div>
  );
}
