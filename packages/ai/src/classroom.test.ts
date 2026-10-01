import { describe, expect, it } from 'vitest';
import { ArtifactPayload, classroomEvidenceText } from '@class-pulse/domain';
import { checkClassroomArtifact, generateClassroomArtifact } from './classroom';
import { EgressGate } from './egress/gate';
import { runClassroomEvals } from './evals/classroom';
import { MockProvider } from './egress/mock';
import { seedPromptFor } from './prompts';

describe('classroom AI boundary', () => {
  it('drops identifiers from allowlisted generation input', () => {
    const payload = ArtifactPayload.parse({ kind: 'positive_note', topic: '', objective: '', learnerKey: 'private', studentName: 'Hidden', evidence: [{ number: 1, eventId: 'persistent', observation: { kind: 'participation', action: 'contributed', note: '' } }] });
    expect(JSON.stringify(payload)).not.toContain('private'); expect(JSON.stringify(payload)).not.toContain('persistent');
  });
  it('rejects fabricated ABC components, citations, and diagnoses', () => {
    const payload = { kind: 'abc' as const, topic: '', objective: '', evidence: [{ number: 1, observation: { kind: 'behavior' as const, action: 'Left seat', antecedent: null, consequence: null, measuredCount: null, note: '' } }] };
    const output = { kind: 'abc' as const, title: 'Observation', sourceNumbers: [1], behavior: 'Left seat', antecedent: null, consequence: null, measuredCount: null, limitations: 'One observation.' };
    expect(checkClassroomArtifact(payload, output)).toEqual([]);
    expect(checkClassroomArtifact(payload, { ...output, measuredCount: 1 })).not.toEqual([]);
    expect(checkClassroomArtifact(payload, { ...output, sourceNumbers: [7] })).not.toEqual([]);
    expect(checkClassroomArtifact(payload, { ...output, limitations: 'The student has ADHD.' })).not.toEqual([]);
  });
  it('formats evidence only after stripping fields outside the allowlist', async () => {
    const mock = new MockProvider();
    let sent = '';
    const gate = new EgressGate({ provider: { name: 'mock', complete: async (req) => { if (req.surface === 'classroom_draft') sent = req.input; return mock.complete(req); } }, resolveModel: () => ({ model: 'mock', reasoningEffort: null, maxTokens: 3000 }), posture: { zeroRetention: true, region: 'test' }, writeLog: () => {}, newRunId: () => crypto.randomUUID() });
    const payload = { kind: 'positive_note' as const, topic: '', objective: '', evidenceText: ['SECRET'], evidence: [{ number: 1, eventId: 'SECRET', observation: { kind: 'participation' as const, action: 'contributed' as const, note: '' } }] };
    const result = await generateClassroomArtifact(gate, { ...seedPromptFor('classroom_draft'), createdAt: new Date(0) }, { ...seedPromptFor('guardrail_classifier'), createdAt: new Date(0) }, payload, []);
    expect(result.ok).toBe(true);
    expect(sent).not.toContain('SECRET');
    expect(JSON.parse(sent).evidenceText).toEqual(['action: contributed; kind: participation; note: Not recorded']);
    sent = '';
    const bad = { ...payload, evidence: [{ number: 1, observation: { ...payload.evidence[0]!.observation, studentName: 'SECRET' } }] };
    await expect(generateClassroomArtifact(gate, { ...seedPromptFor('classroom_draft'), createdAt: new Date(0) }, { ...seedPromptFor('guardrail_classifier'), createdAt: new Date(0) }, bad, [])).rejects.toThrow();
    expect(sent).toBe('');
  });
  it('passes the synthetic classroom evaluation contract', async () => {
    const report = await runClassroomEvals({ provider: new MockProvider(), resolveModel: () => ({ model: 'mock', reasoningEffort: null, maxTokens: 3000 }), posture: { zeroRetention: true, region: 'test' }, prompt: { ...seedPromptFor('classroom_draft'), createdAt: new Date(0) } });
    expect(report.cases.filter((c) => !c.passed)).toEqual([]);
    expect(report.passedCases).toBe(15);
  });
  it('rejects evidence packet paraphrases, omissions, and invented counts', () => {
    const observation = { kind: 'behavior' as const, action: 'Left seat', antecedent: null, consequence: null, measuredCount: 0, note: '' };
    const payload = { kind: 'sst_report' as const, topic: '', objective: '', evidence: [{ number: 1, observation }] };
    const output = { kind: 'sst_report' as const, title: 'Evidence', sourceNumbers: [1], purpose: 'Team discussion', observations: [classroomEvidenceText(observation)], questionsForTeam: ['What other context should be collected?'], limitations: 'One observation.' };
    expect(checkClassroomArtifact(payload, output)).toEqual([]);
    expect(checkClassroomArtifact(payload, { ...output, observations: ['Left seat three times'] })).toContain('Evidence summaries must preserve all supplied observations exactly and in order');
    expect(checkClassroomArtifact(payload, { ...output, sourceNumbers: [] })).not.toEqual([]);
  });
});
