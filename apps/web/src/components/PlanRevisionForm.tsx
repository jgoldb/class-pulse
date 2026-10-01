import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { PlanRevisionSource, RequestPlanRevision } from '@class-pulse/domain';
import type { CaseListItem } from '../lib/types';
import { api, humanize } from '../lib/api';
import { Button, Card, CardBody, Textarea } from './ui';

export function PlanRevisionForm({ caseKeys, sources }: { caseKeys: string[]; sources: Array<PlanRevisionSource & { label: string }> }) {
  const q = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases') });
  const [caseKey, setCaseKey] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const [section, setSection] = useState<RequestPlanRevision['strategySection']>('preventiveStrategies'); const [description, setDescription] = useState(''); const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [draftId, setDraftId] = useState(''); const request = useRef<{ key: string; id: string } | null>(null);
  const active = q.data?.filter((c) => caseKeys.includes(c.caseKey) && c.plan?.status === 'active') ?? [];
  const target = active.find((c) => c.caseKey === caseKey) ?? active[0];
  if (!active.length || !sources.length) return null;
  return <Card><CardBody className="pt-5"><details><summary className="cursor-pointer font-semibold">Draft a support-plan revision from this history</summary><p className="my-2 text-sm text-muted">Choose current evidence and propose one strategy change. The draft keeps the existing plan and baseline measures, shows your sources, and requires the usual full plan review before it applies.</p><form className="space-y-3" onSubmit={async (e) => {
    e.preventDefault(); if (!target?.plan || busy) return; setBusy(true); setError(''); setDraftId('');
    const body = { caseKey: target.caseKey, basePlanId: target.plan.id, sources: sources.filter((s) => selected.includes(`${s.kind}:${s.id}`)).map(({ label: _label, ...s }) => s), strategySection: section, description, rationale };
    const key = JSON.stringify(body); if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try { const result = await api.post<{ draftId: string }>('/api/pulse/plan-revisions', { ...body, requestId: request.current.id }); setDraftId(result.draftId); } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare revision'); } finally { setBusy(false); }
  }}>
    {active.length > 1 && <label className="block text-sm">Active plan<select className="ml-2 min-h-10 rounded border border-border bg-elevated" value={target?.caseKey} onChange={(e) => setCaseKey(e.target.value)}>{active.map((c, i) => <option key={c.caseKey} value={c.caseKey}>Plan {i + 1}</option>)}</select></label>}
    <fieldset className="max-h-64 space-y-2 overflow-y-auto rounded border border-border p-3"><legend className="text-sm font-medium">Evidence for this revision (up to 30)</legend>{sources.map((s) => { const key = `${s.kind}:${s.id}`; return <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(key)} disabled={!selected.includes(key) && selected.length >= 30} onChange={(e) => setSelected((v) => e.target.checked ? [...v, key] : v.filter((id) => id !== key))} />{s.label} · version {s.revision}</label>; })}</fieldset>
    <label className="block text-sm">Strategy section<select className="ml-2 min-h-10 max-w-full rounded border border-border bg-elevated" value={section} onChange={(e) => setSection(e.target.value as RequestPlanRevision['strategySection'])}>{['preventiveStrategies', 'teacherResponseStrategies', 'studentSelfMonitoring', 'parentGuardianSupport'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></label>
    <label className="block text-sm">Proposed strategy<Textarea required maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label><label className="block text-sm">Why this change is proposed<Textarea required maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
    <Button type="submit" loading={busy} disabled={!selected.length}>Prepare revision draft</Button>{error && <p role="alert">{error}</p>}{draftId && <Link className="ml-3 text-sm text-primary underline" to={`/teacher/drafts/${draftId}`}>Review proposed plan revision</Link>}
  </form></details></CardBody></Card>;
}
export function PlanSourceReview({ planId, updatedAt }: { planId: string; updatedAt: string }) {
  const qc = useQueryClient(); const [rationale, setRationale] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Card className="mb-4"><CardBody className="space-y-3 pt-5"><h2 className="font-semibold">A source for this plan changed</h2><p className="text-sm">Review the corrected classroom evidence with the team. The existing plan remains active until an authorized educator changes it. Record why it can remain active, then prepare a revision if needed.</p><form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await api.post(`/api/plans/${planId}/source-review`, { expectedUpdatedAt: updatedAt, rationale }); await qc.invalidateQueries(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not record review'); } finally { setBusy(false); } }}><label className="block text-sm">Source-review rationale<Textarea required minLength={5} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label><Button type="submit" loading={busy}>Record review and keep current plan active</Button>{error && <p role="alert">{error}</p>}</form></CardBody></Card>;
}
