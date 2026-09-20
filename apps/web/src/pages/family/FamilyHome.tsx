import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeartHandshake, Info, MessageSquareWarning, ShieldCheck, Sparkles } from 'lucide-react';
import { Avatar, Badge, Button, Callout, Card, CardBody, CardHeader, Empty, Field, Input, PageSkeleton, Stagger, StaggerItem, Textarea } from '../../components/ui';
import { api, fmtDate, fmtDateTime, humanize } from '../../lib/api';
import type { CaseListItem, CaseView } from '../../lib/types';
import { TargetBadge } from '../../components/GoalCard';

/**
 * Parent/guardian surface (docs/00, docs/04 transparency): own child's goals, progress
 * summaries, accomplishments, home support, plan provenance, confirmed patterns in plain
 * language, what data is collected and why, and a correction pathway.
 */
export function FamilyHome() {
  const qc = useQueryClient();
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const caseKey = cases.data?.find((c) => c.plan?.status === 'active')?.caseKey ?? cases.data?.[0]?.caseKey;
  const view = useQuery({ queryKey: ['case', caseKey], queryFn: () => api.get<CaseView>(`/api/cases/${caseKey}`), enabled: !!caseKey });
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const correction = useMutation({
    mutationFn: () => api.post(`/api/cases/${caseKey}/corrections`, { subject, detail }),
    onSuccess: () => {
      toast.success('Request sent. The teacher will respond here.');
      setSubject('');
      setDetail('');
      qc.invalidateQueries({ queryKey: ['case', caseKey] });
    },
  });

  if (cases.isLoading || view.isLoading) return <PageSkeleton />;
  if (!caseKey || !view.data) return <Empty icon={<HeartHandshake />} title="No plan is shared with you yet" description="Once a teacher approves a plan for your child, it appears here." />;
  const v = view.data;
  const goals = v.goals ?? [];
  const home = (v.strategies ?? []).filter((s) => s.kind === 'family');
  const decided = (v.reviewCycles ?? []).filter((r) => r.narrativeFamily);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-4">
        <Avatar name={v.student?.displayName ?? 'Your child'} size="xl" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{v.student?.displayName ?? 'Your child'}</h1>
          <p className="text-sm text-muted">Grade {v.case_gradeLevel} · plan {humanize(v.plan_status) || '—'}</p>
        </div>
      </div>

      <Callout tone="primary" icon={<ShieldCheck />} title="About this plan">
        Drafted with AI assistance from de-identified teacher observations, then reviewed and approved by <span className="font-medium">{v.plan_provenance?.approvedBy ?? '—'}</span> on {fmtDateTime(v.plan_provenance?.approvedAt)}. Nothing applies to your child without an educator's approval.
      </Callout>

      <Stagger className="space-y-4">
        <StaggerItem>
          <Card>
            <CardHeader title="Goals" />
            <CardBody className="space-y-3">
              {goals.length === 0 && <Empty compact title="No goals yet" />}
              {goals.map((g) => (
                <div key={g.id} className="rounded-md border border-border p-3">
                  <div className="font-medium">{g.targetBehavior}</div>
                  <div className="mt-0.5 text-sm text-muted">{g.observableDefinition}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <TargetBadge target={g.target} />
                    {g.progressSummary && <Badge>{g.progressSummary.totalObservations} entries{g.progressSummary.lastEntry ? ` · last ${fmtDate(g.progressSummary.lastEntry)}` : ''}</Badge>}
                    {g.progressSummary?.preBaseline && <Badge tone="warning">Still establishing a starting point</Badge>}
                  </div>
                  {g.accomplishments && g.accomplishments.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-sm text-success-fg">
                      {g.accomplishments.map((a, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <Sparkles className="size-3.5" /> {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </StaggerItem>

        {decided.length > 0 && (
          <StaggerItem>
            <Card>
              <CardHeader title="Progress summaries" />
              <CardBody className="space-y-3 text-sm">
                {decided.map((r) => (
                  <div key={r.id}>
                    <div className="text-xs text-subtle">
                      {fmtDate(r.decidedAt)} · decision: {humanize(r.decision ?? '')}
                    </div>
                    <p className="mt-0.5">{r.narrativeFamily}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          </StaggerItem>
        )}

        {home.length > 0 && (
          <StaggerItem>
            <Card>
              <CardHeader title="How you can help at home" />
              <CardBody className="space-y-2 text-sm">
                {home.map((s) => (
                  <div key={s.id} className="rounded-md bg-sunken/60 p-3">
                    <div>{s.description}</div>
                    <div className="mt-0.5 text-xs text-muted">{s.rationale}</div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <Card>
            <CardHeader title="Patterns the teacher confirmed" description="Only patterns a teacher reviewed and confirmed appear here, in plain language, with the evidence that was used." />
            <CardBody className="space-y-2 text-sm">
              {(v.pattern_confirmedPlainLanguage ?? []).length === 0 && <span className="text-muted">None so far.</span>}
              {(v.pattern_confirmedPlainLanguage ?? []).map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="font-medium">{p.title}</div>
                  <div className="mt-0.5">{p.plainLanguage}</div>
                  {p.evidence && (
                    <div className="mt-1 text-xs text-muted">
                      Based on {p.evidence.observations} logged entries · confirmed {fmtDate(p.confirmedAt)}
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </StaggerItem>

        {v.dataCollectedExplanation && (
          <StaggerItem>
            <Card>
              <CardHeader title="What is collected, and why" />
              <CardBody className="space-y-3 text-sm">
                <ul className="list-disc pl-5">
                  {v.dataCollectedExplanation.whatIsCollected.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <p>
                  <span className="font-medium">Why:</span> {v.dataCollectedExplanation.why}
                </p>
                <ul className="list-disc pl-5 text-muted">
                  {v.dataCollectedExplanation.whatIsNotCollected.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <p className="flex items-start gap-2 text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" /> {v.dataCollectedExplanation.aiRole}
                </p>
              </CardBody>
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <Card>
            <CardHeader title="Something look wrong?" description="Ask for a correction. The teacher will respond here and every request is recorded." />
            <CardBody className="space-y-3">
              {(v.correctionRequests ?? []).map((c) => (
                <div key={c.id} className="rounded-md bg-sunken/60 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.subject}</span>
                    <Badge tone={c.status === 'open' ? 'warning' : 'success'}>{c.status}</Badge>
                  </div>
                  <div className="mt-0.5 text-muted">{c.detail}</div>
                  {c.resolutionNote && (
                    <div className="mt-2 rounded-md bg-elevated p-2">
                      <span className="font-medium">Response:</span> {c.resolutionNote}
                    </div>
                  )}
                </div>
              ))}
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="What should be corrected?">
                <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </Field>
              {correction.isError && <Callout tone="danger">Could not send the request.</Callout>}
              <Button size="sm" disabled={!subject.trim() || !detail.trim()} loading={correction.isPending} onClick={() => correction.mutate()}>
                <MessageSquareWarning /> Send request
              </Button>
            </CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
