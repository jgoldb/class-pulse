import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, Check, CheckCheck, Pencil, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { PLAN_SECTIONS, type PlanContent } from '@class-pulse/domain';
import { PageHeader } from '../../components/AppShell';
import { Badge, Button, Callout, Card, CardBody, PageSkeleton, ProgressBar, Textarea, cn, motion } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Draft } from '../../lib/types';
import { SectionBody } from '../../components/PlanSections';

type Decision = 'accept' | 'edit' | 'reject';

/**
 * Section-by-section accept / edit / reject (docs/06 Phase 2). Edits are made to the structured
 * JSON of the section; the API re-runs guardrails on the edited plan and stores the diff.
 */
export function DraftReview() {
  const { draftId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { primaryRole, me } = useAuth();
  const base = primaryRole === 'support_professional' ? '/support' : '/teacher';
  const draft = useQuery({ queryKey: ['draft', draftId], queryFn: () => api.get<Draft>(`/api/drafts/${draftId}`), refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.status ?? '') ? 2000 : false) });
  const [content, setContent] = useState<PlanContent | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState('');
  const [active, setActive] = useState<string>(PLAN_SECTIONS[0]!.key);

  useEffect(() => {
    if (draft.data?.content && !content) setContent(structuredClone(draft.data.content));
  }, [draft.data, content]);

  const approve = useMutation({
    mutationFn: () => api.post<{ planId: string }>(`/api/drafts/${draftId}/approve`, { content, rationale: rationale || null }),
    onSuccess: () => {
      toast.success('Plan approved and active. Quick entry is ready.');
      qc.invalidateQueries();
      nav(`${base}/cases/${draft.data!.caseKey}`);
    },
  });
  const regenerate = useMutation({ mutationFn: () => api.post<{ draftId: string }>(`/api/drafts/${draftId}/regenerate`), onSuccess: (r) => nav(`${base}/drafts/${r.draftId}`) });
  const discard = useMutation({ mutationFn: () => api.post(`/api/drafts/${draftId}/discard`), onSuccess: () => nav(base) });

  const decided = useMemo(() => PLAN_SECTIONS.filter((s) => decisions[s.key]).length, [decisions]);
  if (draft.isLoading) return <PageSkeleton />;
  if (!draft.data) return <Callout tone="danger">Draft not found.</Callout>;
  const d = draft.data;
  const canApprove = me?.approverRoles?.some((r) => me.roles?.includes(r));

  if (['queued', 'running'].includes(d.status)) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Drafting your plan" description="The intake was de-identified and checked for identifying information before it left. This page updates automatically." />
        <Card>
          <CardBody className="pt-5">
            <div className="flex items-center gap-3 text-sm">
              <span className="size-3 animate-ping rounded-full bg-primary" />
              Generating with guardrails — usually under a minute.
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
              <div className="h-full w-1/3 animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,var(--primary),transparent)] bg-[length:200%_100%]" />
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }
  if (d.status === 'blocked_pii' || d.status === 'failed') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={d.status === 'blocked_pii' ? 'Blocked at the egress gate' : 'Generation failed'} />
        <Card>
          <CardBody className="pt-5 space-y-3">
            <Callout tone="danger">{d.error}</Callout>
            {d.piiSpans && (
              <ul className="list-disc pl-5 text-sm">
                {d.piiSpans.map((s, i) => (
                  <li key={i}>
                    {s.kind}: "{s.text}" — {s.hint}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                <RotateCcw /> Try again
              </Button>
              <Button variant="secondary" onClick={() => discard.mutate()}>
                Discard
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }
  if (!content) return <PageSkeleton />;
  const rejectFindings = d.guardrails?.findings.filter((f) => f.severity === 'reject') ?? [];
  const flagFindings = d.guardrails?.findings.filter((f) => f.severity === 'flag') ?? [];
  const approveErr = approve.error as ApiError | null;
  const allDecided = decided === PLAN_SECTIONS.length;
  const activeSection = PLAN_SECTIONS.find((s) => s.key === active)!;
  const activeDecision = decisions[active];
  const flaggedKeys = new Set((d.guardrails?.findings ?? []).map((f) => f.path.split('.')[0]));

  const decide = (key: keyof PlanContent, dec: Decision) => {
    setDecisions((x) => ({ ...x, [key]: dec }));
    if (dec === 'edit') setEditing((x) => ({ ...x, [key]: x[key] ?? JSON.stringify(content[key], null, 2) }));
    if (dec !== 'edit') {
      const idx = PLAN_SECTIONS.findIndex((s) => s.key === key);
      const next = PLAN_SECTIONS.slice(idx + 1).find((s) => !decisions[s.key] || s.key === key);
      if (next && next.key !== key) setActive(next.key);
    }
  };
  const applyEdit = (key: keyof PlanContent) => {
    try {
      const parsed = JSON.parse(editing[key] ?? '');
      setContent({ ...content, [key]: parsed });
      setJsonErrors((x) => ({ ...x, [key]: '' }));
      toast.success('Edit applied to this section.');
    } catch (e) {
      setJsonErrors((x) => ({ ...x, [key]: (e as Error).message }));
    }
  };
  const acceptAllRemaining = () => {
    const next = { ...decisions };
    for (const s of PLAN_SECTIONS) if (!next[s.key]) next[s.key] = 'accept';
    setDecisions(next);
  };

  return (
    <div>
      <PageHeader
        back={{ to: `${base}/cases/${d.caseKey}`, label: 'Case' }}
        title="Review draft plan"
        description="Nothing here is active until you approve it. Decide on each section: accept as generated, edit, or reject."
        actions={
          <Badge tone={d.status === 'ready' ? 'success' : 'danger'} className="px-3 py-1 text-xs">
            {d.status === 'ready' ? <ShieldCheck /> : <AlertTriangle />} {d.status === 'ready' ? 'Passed guardrails' : 'Needs attention'}
          </Badge>
        }
      />

      {rejectFindings.length > 0 && (
        <Callout tone="danger" title="Guardrail rejections (the model regenerated once and still failed)" className="mb-4">
          <ul className="list-disc pl-4">
            {rejectFindings.map((f, i) => (
              <li key={i}>
                <code className="font-mono text-xs">{f.path}</code>: {f.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {flagFindings.length > 0 && (
        <Callout tone="warning" title="Flags for your attention" className="mb-4">
          <ul className="list-disc pl-4">
            {flagFindings.map((f, i) => (
              <li key={i}>
                <code className="font-mono text-xs">{f.path}</code>: {f.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardBody className="pt-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold">{decided}/{PLAN_SECTIONS.length} decided</span>
                <button className="text-primary hover:underline" onClick={acceptAllRemaining}>
                  Accept remaining
                </button>
              </div>
              <ProgressBar value={(decided / PLAN_SECTIONS.length) * 100} className="mb-3" />
              <ol className="space-y-0.5">
                {PLAN_SECTIONS.map((s) => {
                  const dec = decisions[s.key];
                  return (
                    <li key={s.key}>
                      <button onClick={() => setActive(s.key)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors', active === s.key ? 'bg-primary-soft text-primary-soft-fg' : 'hover:bg-sunken')}>
                        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', dec === 'accept' ? 'bg-success text-white' : dec === 'edit' ? 'bg-info text-white' : dec === 'reject' ? 'bg-danger text-white' : 'bg-sunken text-muted')}>{dec === 'accept' ? <Check className="size-3" /> : dec === 'edit' ? <Pencil className="size-3" /> : dec === 'reject' ? <X className="size-3" /> : s.number}</span>
                        <span className="flex-1 truncate">{s.title}</span>
                        {flaggedKeys.has(s.key) && <AlertTriangle className="size-3 text-warning" />}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>
        </aside>

        <div className="space-y-4">
          <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <Card className={cn(flaggedKeys.has(active) && 'ring-1 ring-warning/50')}>
              <CardBody className="pt-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Section {activeSection.number} of 16</div>
                    <h2 className="text-lg font-semibold">{activeSection.title}</h2>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant={activeDecision === 'accept' ? 'primary' : 'secondary'} onClick={() => decide(active as keyof PlanContent, 'accept')} data-testid="accept-section">
                      <Check /> Accept
                    </Button>
                    <Button size="sm" variant={activeDecision === 'edit' ? 'primary' : 'secondary'} onClick={() => decide(active as keyof PlanContent, 'edit')}>
                      <Pencil /> Edit
                    </Button>
                    <Button size="sm" variant={activeDecision === 'reject' ? 'danger' : 'secondary'} onClick={() => decide(active as keyof PlanContent, 'reject')}>
                      <X /> Reject
                    </Button>
                  </div>
                </div>
                {activeDecision === 'edit' ? (
                  <div>
                    <Textarea rows={Math.min(24, Math.max(6, (editing[active] ?? '').split('\n').length))} className="font-mono text-xs" value={editing[active] ?? ''} onChange={(e) => setEditing((x) => ({ ...x, [active]: e.target.value }))} />
                    {jsonErrors[active] && <div className="mt-1 text-xs text-danger-fg">{jsonErrors[active]}</div>}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => applyEdit(active as keyof PlanContent)}>
                        Apply edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(active as keyof PlanContent, 'accept')}>
                        Keep as generated
                      </Button>
                    </div>
                    <div className="mt-4 border-t border-border pt-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Preview</div>
                      <SectionBody section={activeSection} content={content} />
                    </div>
                  </div>
                ) : (
                  <div className={cn(activeDecision === 'reject' && 'opacity-50')}>
                    <SectionBody section={activeSection} content={content} />
                  </div>
                )}
              </CardBody>
            </Card>
          </motion.div>

          <Card>
            <CardBody className="pt-5">
              <h2 className="text-[15px] font-semibold">Approve as the active plan</h2>
              {!canApprove && (
                <Callout tone="warning" className="mt-2">
                  Your role cannot approve plans in this school (approver roles: {me?.approverRoles?.join(', ')}).
                </Callout>
              )}
              {Object.values(decisions).includes('reject') && (
                <Callout tone="warning" className="mt-2">
                  Rejected sections still ship as generated unless you edit them; the rejection is recorded in the diff. To remove content, edit the section to an empty list.
                </Callout>
              )}
              <div className="mt-3">
                <label className="mb-1.5 block text-sm font-medium">
                  Reviewer note {content.privacyAndHumanReviewNotes.safetyConcern && <span className="text-danger-fg">(required: confirm safety procedures were followed)</span>}
                </label>
                <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What you changed and why; anything the next reviewer should know." data-testid="rationale" />
              </div>
              {approveErr && (
                <Callout tone="danger" title={approveErr.message} className="mt-3">
                  {Array.isArray((approveErr.details as { findings?: unknown[] })?.findings) && (
                    <ul className="list-disc pl-4">
                      {((approveErr.details as { findings: Array<{ path: string; message: string }> }).findings ?? []).map((f, i) => (
                        <li key={i}>
                          <code className="font-mono text-xs">{f.path}</code>: {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </Callout>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="lg" disabled={!canApprove || !allDecided} loading={approve.isPending} onClick={() => approve.mutate()} data-testid="approve-plan">
                  <CheckCheck /> Approve plan
                </Button>
                {!allDecided && <span className="text-sm text-muted">Decide on every section first.</span>}
                <span className="flex-1" />
                <Button variant="secondary" loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                  <RotateCcw /> Regenerate
                </Button>
                <Button variant="ghost" onClick={() => discard.mutate()}>
                  <Trash2 /> Discard
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
      {d.guardrails?.classifier && (
        <p className="mt-4 text-[11px] text-subtle">
          Second-model check ({d.guardrails.classifier.model}) · causal claims {d.guardrails.classifier.unsupportedCausalClaims.toFixed(2)} · hypotheses-as-fact {d.guardrails.classifier.hypothesesStatedAsFact.toFixed(2)} · stigmatizing {d.guardrails.classifier.stigmatizingLanguage.toFixed(2)} · out of scope {d.guardrails.classifier.outsideEducationalScope.toFixed(2)} · confidence {d.guardrails.classifier.confidence.toFixed(2)}
        </p>
      )}
    </div>
  );
}
