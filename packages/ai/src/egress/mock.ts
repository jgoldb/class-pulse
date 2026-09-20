/**
 * Mock provider: a deterministic, rule-based stand-in for the model so the entire loop — intake
 * → draft → guardrails → approval → logging → pattern → adjudication — runs with no API key.
 * Used by tests, CI, and the demo seed. It is intentionally cautious (it never sets a numeric
 * target without a behavior-specific baseline) so the eval suite has a passing reference.
 *
 * It is NOT a substitute for the model in production: AI_PROVIDER=openai.
 */
import type { IntakeFields, InterventionProposal, PlanContent, ReviewNarrative, Baseline, GoalContent, StrategyContent } from '@class-pulse/domain';
import type { ModelProvider, StructuredRequest, StructuredResponse } from './provider';
import type { PatternInterpretationPayload, ReviewNarrationPayload, ClassifierOutput, JudgeOutput, JudgePayload } from '../schema';
import { CAUSAL_PHRASES, DIAGNOSTIC_TERMS, STIGMATIZING_TERMS, findTerms, strings } from '../guardrails/lexicon';
import { checkPlanDeterministic } from '../guardrails/plan';
import { RUBRIC_CRITERIA } from '../schema';

export type MockScenario = 'default' | 'v1_failure' | 'provider_error' | 'invalid_json';

export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  constructor(private readonly scenario: MockScenario = 'default') {}

  async complete(req: StructuredRequest): Promise<StructuredResponse> {
    if (this.scenario === 'provider_error') throw new Error('mock provider error');
    if (this.scenario === 'invalid_json') return wrap({ nonsense: true }, req);
    const input = JSON.parse(req.input) as Record<string, unknown>;
    switch (req.surface) {
      case 'plan_generation':
        return wrap(mockPlan(input.intake as IntakeFields, this.scenario), req);
      case 'pattern_interpretation':
        return wrap(mockProposal(input as unknown as PatternInterpretationPayload), req);
      case 'review_narration':
        return wrap(mockNarrative(input as unknown as ReviewNarrationPayload), req);
      case 'guardrail_classifier':
        return wrap(mockClassifier(String(input.draft ?? '')), req);
      case 'eval_judge':
        return wrap(mockJudge(input as unknown as JudgePayload), req);
    }
  }
}

function wrap(json: unknown, req: StructuredRequest): StructuredResponse {
  const rawText = JSON.stringify(json);
  return {
    outputJson: json,
    rawText,
    usage: { input: Math.ceil(req.input.length / 4), output: Math.ceil(rawText.length / 4), reasoning: 0 },
    model: `mock:${req.model}`,
    providerRequestId: null,
  };
}

// ---- Plan generation ------------------------------------------------------------------------

const SAFETY_RE = /\b(hurt|harm|weapon|knife|gun|suicid|kill|abuse|bruis|threat|self-harm|cutting|choke|overdose|unsafe)\b/i;
const OUT_OF_SCOPE_RE = /\b(does (this|the) student have|diagnos|adhd|autis|disorder|is (he|she|they) (adhd|autistic|depressed)|should (he|she|they|this student|the student) be (tested|evaluated|medicated|suspended|expelled|removed|retained)|what condition)\b/i;
const BEHAVIOR_VERBS = /\b(talk|talks|talking|leave|leaves|leaving|call|calls|calling out|shout|shouts|yell|yells|throw|throws|refuse|refuses|argue|argues|walk|walks|wander|wanders|interrupt|interrupts|tap|taps|hum|hums|blurt|blurts|push|pushes|hit|hits|kick|kicks|put(s)? (his|her|their) head down|sleep|sleeps|draw|draws|use(s)? (a |the )?phone|cry|cries|tear|tears)\b/i;
const VAGUE_REWRITE: Array<[RegExp, string]> = [
  [/\bon[- ]task\b/gi, 'working on the assigned materials'],
  [/\bfocused\b/gi, 'looking at and working on the assigned materials'],
  [/\bengaged\b/gi, 'working on the assigned materials'],
  [/\bappropriate\b/gi, 'as instructed'],
  [/\brespectful\b/gi, 'using a conversational voice and instructed language'],
  [/\bdisruptive\b/gi, 'interrupting instruction'],
  [/\battentive\b/gi, 'looking toward the speaker or materials'],
];

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]|\band\b/i)
    .map((x) => x.replace(/^(the student|student|they|he|she)?\s*(enjoys?|likes?|responds? well to|is|are|works? well when)?\s*/i, '').replace(/[.]+$/, '').trim())
    .filter((x) => x.length > 2);
}

function observable(s: string): string {
  let out = s;
  for (const [re, rep] of VAGUE_REWRITE) out = out.replace(re, rep);
  return out;
}

function extractBehaviors(observableBehavior: string, desired: string): Array<{ label: string; verb: string; direction: 'decrease' | 'increase' }> {
  const clauses = observableBehavior
    .split(/[.;\n]/)
    .flatMap((sent) => sent.split(/,|\band\b|\bsometimes\b|\balso\b|\bor\b/i))
    .map((c) => c.trim())
    .filter((c) => BEHAVIOR_VERBS.test(c) && !/\b(approximately|times|per|occurs|more common)\b/i.test(c));
  const out: Array<{ label: string; verb: string; direction: 'decrease' | 'increase' }> = [];
  for (const c of clauses) {
    const cleaned = c.replace(/^(the student|student|they|he|she)\s+(frequently|often|sometimes|occasionally|repeatedly|regularly)?\s*/i, '').trim();
    if (cleaned.length < 6) continue;
    if (out.some((o) => o.label.toLowerCase() === cleaned.toLowerCase())) continue;
    out.push({ label: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), verb: cleaned, direction: 'decrease' });
    if (out.length === 3) break;
  }
  if (out.length === 0) {
    for (const d of splitList(desired).slice(0, 2)) {
      const cleaned = d.replace(/^(the student )?will\s+/i, '');
      out.push({ label: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), verb: cleaned, direction: 'increase' });
    }
  }
  return out;
}

function parseNumbers(text: string): number[] {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const nums: number[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) nums.push(Number(m[1]));
  for (const m of text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)) nums.push(words[m[1]!.toLowerCase()]!);
  return nums;
}

function baselineFor(intake: IntakeFields, behaviors: ReturnType<typeof extractBehaviors>, index: number): Baseline {
  const text = `${intake.baselineInformation} ${intake.observableBehavior}`;
  const baselineText = intake.baselineInformation.trim();
  const groups = baselineText.split(/;|\n/).map((g) => g.trim()).filter(Boolean);
  const perBehavior = groups.length >= behaviors.length && behaviors.length > 1 && groups.every((g) => parseNumbers(g.replace(/\b\d+\s*[-–]\s*minute\b/gi, '')).length >= 3);
  if (perBehavior) {
    const g = groups[index] ?? groups[0]!;
    const nums = parseNumbers(g.replace(/\b\d+\s*[-–]\s*minute\b/gi, '').replace(/\b\d+\s*(minute|min)\b/gi, ''));
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { status: 'available', value: Math.round(mean * 10) / 10, unit: 'events per period', observations: nums.length, spanDays: nums.length };
  }
  const list = parseNumbers(baselineText.replace(/\b\d+\s*[-–]?\s*(minute|min|day|week|grade)s?\b/gi, ''));
  const hasRange = /\b\d+\s*(?:-|–|to)\s*\d+\s*times?\b/i.test(text);
  const hasAny = list.length > 0 || hasRange || /\btimes\b/i.test(text);
  if (!hasAny) {
    return { status: 'unavailable', reason: 'No baseline or frequency information was provided. Collect behavior-specific counts for at least 3 to 5 periods before setting a target.' };
  }
  if (behaviors.length > 1) {
    const raw = (text.match(/[^.]*\b\d+\s*(?:-|–|to)\s*\d+\s*times?[^.]*\./i) ?? [baselineText || text])[0]!.trim();
    return {
      status: 'ambiguous',
      rawInput: raw,
      whyAmbiguous: 'The reported frequency combines more than one behavior, so it cannot be assigned to any single behavior without behavior-specific counts.',
      candidateBehaviors: behaviors.map((b) => b.label),
    };
  }
  if (list.length >= 3) {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return { status: 'available', value: Math.round(mean * 10) / 10, unit: 'events per period', observations: list.length, spanDays: list.length };
  }
  return {
    status: 'ambiguous',
    rawInput: baselineText || text.trim(),
    whyAmbiguous: 'The frequency is an estimate or a range rather than a set of behavior-specific observations.',
    candidateBehaviors: behaviors.map((b) => b.label),
  };
}

function strengthMatch(strengths: string[], ...keywords: string[]): string[] {
  return strengths.filter((s) => keywords.some((k) => s.toLowerCase().includes(k)));
}

function mockPlan(intake: IntakeFields, scenario: MockScenario): PlanContent {
  const strengths = splitList(intake.strengthsInterests);
  const behaviors = extractBehaviors(intake.observableBehavior, intake.desiredBehavior);
  const safety = SAFETY_RE.test(`${intake.observableBehavior} ${intake.documentedPatterns}`);
  const allText = Object.values(intake).join(' ');
  const outOfScope = OUT_OF_SCOPE_RE.exec(allText);
  const longer = /longer|long assignment|extended/i.test(allText);
  const patterns = [
    ...intake.documentedPatterns.split(/[.\n]/).map((s) => s.trim()).filter((s) => s.length > 5),
    ...intake.observableBehavior.split(/[.\n]/).map((s) => s.trim()).filter((s) => /more common|during|when|after|before/i.test(s) && s.length > 5),
  ];
  const uniquePatterns = [...new Set(patterns)];

  const goals: GoalContent[] = behaviors.map((b, i) => {
    const baseline = baselineFor(intake, behaviors, i);
    const definition = observable(
      b.direction === 'decrease'
        ? `Counted as one occurrence each time the observer sees the student ${b.verb.replace(/^(the student )?(frequently |often |sometimes )?/i, '')} during the observed period, without prior teacher permission.`
        : `Counted as one occurrence each time the observer sees the student ${b.verb} during the observed period.`,
    );
    let target: GoalContent['target'];
    if (scenario === 'v1_failure') {
      target = { status: 'proposed', value: 2, unit: 'events per period', rationale: 'Reduce from 3-5 to 2 per period.' };
    } else if (baseline.status === 'available') {
      const v = b.direction === 'decrease' ? Math.max(0, Math.round(baseline.value * 0.6)) : Math.round(baseline.value * 1.3);
      target = { status: 'proposed', value: v, unit: baseline.unit, rationale: `About a ${b.direction === 'decrease' ? '40% reduction' : '30% increase'} from the ${baseline.observations}-observation baseline, to be confirmed by the reviewer.` };
    } else {
      target = { status: 'blocked_on_baseline', note: 'Collect behavior-specific baseline data for this behavior (3–5 periods) before setting a numerical target.' };
    }
    return {
      targetBehavior: observable(b.label),
      observableDefinition: definition,
      baseline,
      measurementMethod: b.direction === 'decrease' ? 'frequency_count' : /complete|finish|turn in|submit/i.test(b.verb) ? 'permanent_product' : 'interval_observation',
      direction: b.direction,
      target,
      reviewPeriodDays: 14,
    };
  });

  const tech = strengthMatch(strengths, 'technolog', 'computer', 'digital', 'app');
  const feedback = strengthMatch(strengths, 'feedback', 'praise', 'recognition');
  const chunk = strengthMatch(strengths, 'smaller', 'parts', 'chunk', 'short');
  const interest = strengthMatch(strengths, 'interest', 'topic', 'when interested');

  const preventive: StrategyContent[] = [
    {
      description: `Divide independent assignments into 2–3 labelled parts with a visible checkpoint after each part${longer ? ', especially for longer assignments' : ''}.`,
      rationale: 'Shorter segments create frequent natural completion points and reduce the length of time between check-ins.',
      usesStrengths: chunk,
      effortLevel: 'low',
    },
    {
      description: 'State the expectation for the period in one sentence at the start of independent work (where to be, voice level, what to do when finished).',
      rationale: 'A brief pre-correction makes the expected behavior explicit before the work begins.',
      usesStrengths: [],
      effortLevel: 'low',
    },
  ];
  if (tech.length) {
    preventive.push({
      description: 'Where the task allows, offer a digital version of the assignment or a short technology-based extension that unlocks when a checkpoint is reached.',
      rationale: 'Builds on a documented interest to make independent work more approachable.',
      usesStrengths: tech,
      effortLevel: 'medium',
    });
  }
  if (interest.length) {
    preventive.push({
      description: 'Offer a choice between two equivalent task versions or topics when possible.',
      rationale: 'The student participates well when interested; choice increases the chance the task connects to an interest.',
      usesStrengths: interest,
      effortLevel: 'low',
    });
  }
  if (strengths.length && !tech.length && !interest.length) {
    preventive.push({
      description: `Connect one task or classroom role each week to a documented strength (${strengths[0]}), for example as the theme of a practice item or as a helper role that follows a completed checkpoint.`,
      rationale: 'Builds on a documented strength so the student has a reason to reach the next checkpoint.',
      usesStrengths: [strengths[0]!],
      effortLevel: 'low',
    });
  }

  const response: StrategyContent[] = [
    {
      description: 'Give specific positive feedback within about one minute of seeing the desired behavior (for example, "You stayed at your desk for the whole first section").',
      rationale: 'Documented responsiveness to positive feedback; specific feedback tells the student exactly what to repeat.',
      usesStrengths: feedback,
      effortLevel: 'low',
    },
    {
      description: 'When the behavior occurs, move closer and give a brief, private, non-verbal or one-phrase redirect that names the replacement behavior, then step away.',
      rationale: 'A calm private redirect keeps instruction moving and avoids public attention to the behavior.',
      usesStrengths: [],
      effortLevel: 'low',
    },
  ];

  const replacement = behaviors.map((b) => {
    const v = b.verb.toLowerCase();
    if (/seat|area|leave|leaves|walk|wander/.test(v)) {
      return { behavior: 'Use a hand signal or a "break/help" card to request permission before leaving the assigned area.', howToTeach: 'Model the signal once, practise it twice in a calm moment, and honour it promptly the first several times it is used.', replaces: b.label };
    }
    if (/talk|conversation|call|shout|blurt|interrupt/.test(v)) {
      return { behavior: 'Write a question or comment on a sticky note or a shared digital note to raise at the next scheduled check-in.', howToTeach: 'Provide the notes at the start of independent work and check them at each checkpoint.', replaces: b.label };
    }
    return { behavior: `Complete the next labelled part of the assignment and signal for a check-in instead of ${v}.`, howToTeach: 'Rehearse the routine once and give feedback the first few times it happens.', replaces: b.label };
  });

  const self: StrategyContent[] = [
    {
      description: 'At the end of each independent-work period, the student marks a 3-point self-check (1 = not yet, 2 = partly, 3 = yes) for each goal on a card or the app.',
      rationale: 'Brief, age-appropriate, and gives the student ownership of progress.',
      usesStrengths: tech,
      effortLevel: 'low',
    },
  ];
  const family: StrategyContent[] = [
    {
      description: 'Share one specific positive example from the week with the family and invite them to acknowledge it at home.',
      rationale: 'Keeps the home conversation strengths-based and consistent with school feedback.',
      usesStrengths: feedback,
      effortLevel: 'low',
    },
  ];

  const missing: string[] = [];
  if (goals.some((g) => g.baseline.status !== 'available')) missing.push('Behavior-specific baseline counts for each goal (3–5 observed periods).');
  if (!/period|morning|afternoon|time of day/i.test(allText)) missing.push('Time of day or class period when the behavior is most and least likely.');
  if (!/group|independent|paired|whole class/i.test(allText)) missing.push('Whether the behavior differs between independent, paired, and group work.');
  missing.push('What typically happens immediately after the behavior (teacher response, peer response, task outcome).');
  if (!intake.currentStrategies.trim()) missing.push('Strategies already tried and how the student responded.');
  else missing.push('How the student has responded to the current strategy over time.');
  if (!intake.documentedPatterns.trim()) missing.push('Documented situations in which the behavior is least likely.');

  const hypotheses = [
    ...(longer ? [{ hypothesis: 'One possibility to monitor is that the behavior is associated with assignment length; the pattern would be consistent with the task becoming harder to sustain over longer stretches.', whatToObserve: 'Compare counts on assignments under 15 minutes with those over 30 minutes across at least five periods each.' }] : []),
    { hypothesis: 'The behavior may be more likely when a task does not connect to a documented interest; this is a hypothesis, not a finding.', whatToObserve: 'Record whether each independent-work task offered a choice or connected to an interest, alongside the count.' },
    { hypothesis: 'Peer conversation may be serving as a way to get help or a break; this remains to be observed.', whatToObserve: 'Note whether the behavior follows a point where the student appears stuck or has finished a section.' },
  ];

  const plan: PlanContent = {
    behavioralConcern: observable(
      behaviors.length
        ? `During ${/independent/i.test(allText) ? 'independent work' : 'class'}, the student ${behaviors.map((b) => b.verb.replace(/^(the student )?(frequently |often |sometimes )?/i, '')).join(' and ')}. ${goals[0]?.baseline.status === 'ambiguous' ? 'A combined frequency estimate was reported; behavior-specific counts are not yet available.' : ''}`.trim()
        : `The educator reports: ${intake.observableBehavior}`,
    ),
    studentStrengths: strengths.length ? strengths : ['Strengths not yet documented; capture two or three during the next week of observation.'],
    documentedPatterns: uniquePatterns.length ? uniquePatterns : ['No situational patterns documented yet.'],
    hypothesesToMonitor: hypotheses,
    measurableGoals: goals,
    replacementBehaviors: replacement,
    preventiveStrategies: preventive,
    teacherResponseStrategies: response,
    studentSelfMonitoring: self,
    parentGuardianSupport: family,
    progressMonitoring: [
      { what: 'Frequency count per goal', method: 'Tally on a card or a one-tap entry in the app during independent work', frequency: 'Each independent-work period', estimatedMinutesPerDay: 2 },
      { what: 'Student self-check', method: '3-point rating at the end of the period', frequency: 'Daily', estimatedMinutesPerDay: 1 },
      { what: 'Weekly review of counts against baseline', method: 'Glance at the progress view; note whether strategies were used', frequency: 'Weekly', estimatedMinutesPerDay: 1 },
    ],
    dashboardRecommendations: [
      { audience: 'teacher', include: ['Goals with baseline status', 'Daily counts with observation totals', 'Strategy use log', 'Review-cycle due dates'] },
      { audience: 'student', include: ['Own goals in student-friendly wording', 'Own progress with positive feedback', 'Self-check entry'] },
      { audience: 'parent_guardian', include: ['Own child\'s goals', 'Weekly progress summary', 'Accomplishments', 'Home support suggestions'] },
      { audience: 'administration', include: ['Aggregated counts of active plans and review outcomes', 'Intervention effectiveness across plans'] },
    ],
    informationNotToDisplay: [
      { audience: 'student', exclude: ['Hypotheses about the behavior', 'Teacher notes', 'Comparisons with other students'] },
      { audience: 'parent_guardian', exclude: ['Other students', 'Unnecessary classroom detail', 'Unconfirmed hypotheses'] },
      { audience: 'administration', exclude: ['Individual student records unless specifically authorized and necessary'] },
      { audience: 'teacher', exclude: ['Students outside their assignment'] },
    ],
    reviewCriteria: [
      ...goals.flatMap((g, i) => [
        { goalIndex: i, description: `Goal ${i + 1}: counts fall by at least 30% from baseline over 2 weeks with 6+ observations`, metric: 'events_per_day' as const, comparator: 'change_pct_lte' as const, value: -30, windowDays: 14, minObservations: 6, decision: 'continue' as const },
        { goalIndex: i, description: `Goal ${i + 1}: counts are unchanged or higher after 2 weeks of consistent strategy use`, metric: 'events_per_day' as const, comparator: 'change_pct_gte' as const, value: 0, windowDays: 14, minObservations: 6, decision: 'modify' as const },
        { goalIndex: i, description: `Goal ${i + 1}: fewer than 6 observations in the window`, metric: 'events_per_day' as const, comparator: 'insufficient_data' as const, value: null, windowDays: 14, minObservations: 6, decision: 'collect_more' as const },
      ]),
      { goalIndex: null, description: 'Counts rise by 25% or more across 4 weeks despite consistent strategy use', metric: 'events_per_day' as const, comparator: 'change_pct_gte' as const, value: 25, windowDays: 28, minObservations: 10, decision: 'seek_support' as const },
    ],
    missingInformation: missing,
    privacyAndHumanReviewNotes: {
      privacyNotes: [
        'This draft was produced from de-identified input and contains no names or identifiers; keep it that way in any copy.',
        'If this plan is connected to an identifiable student in an operational system, appropriate authorization, access controls, and data-governance procedures are required; this tool does not provide them.',
      ],
      humanReviewRequired: [
        'An educator must review and approve every section before use.',
        'Targets must be set by the educator once a behavior-specific baseline exists.',
        ...(safety ? ['A possible safety concern is noted; follow established school safety procedures and involve appropriate personnel before any other step.'] : []),
        ...(outOfScope ? ['An out-of-scope question was noted and not answered.'] : []),
      ],
      outOfScopeRequestNoted: outOfScope ? `The request "${outOfScope[0]}" asks for a determination outside this tool's scope; it was not answered. Redirect toward observable educational information.` : null,
      safetyConcern: safety,
      safetyNote: safety ? 'The input describes something that may be a safety concern. Follow established school safety procedures and involve appropriate personnel; this plan does not address the safety concern itself.' : null,
    },
  };
  return plan;
}

// ---- Pattern interpretation -----------------------------------------------------------------

function mockProposal(p: PatternInterpretationPayload): InterventionProposal {
  const ev = p.evidence
    .map((e) => {
      const ctx = e.byContext.map((c) => `${c.tag}: ${c.count} ${e.mean === null ? 'entries' : `entries, mean ${c.mean?.toFixed(0) ?? 'n/a'}`}`).join('; ');
      return `${e.count} ${e.signalType.replace('_', ' ')} entries over ${e.distinctDays} days spanning ${e.spanDays} days${ctx ? ` (${ctx})` : ''}`;
    })
    .join('. ');
  const measures = Object.entries(p.measures)
    .map(([k, v]) => `${k} = ${Number.isInteger(v) ? v : v.toFixed(2)}`)
    .join(', ');
  const strengths = p.strengths.slice(0, 2);
  const escalation = p.routing === 'safety_escalation';
  const support = p.routing === 'support_team';
  return {
    evidenceRestatement: `${p.definition.title}: ${ev}. Computed measures: ${measures}.`,
    hypothesis: `One possibility to monitor is that ${p.definition.plainLanguage.replace(/\.$/, '').toLowerCase()}; the logged data would be consistent with this, and it remains a hypothesis to test rather than a finding.`,
    alternativeExplanations: p.confounders.map((c) => ({
      confounder: c,
      assessment: `Not ruled out by the current data. The evidence summary does not separate this from the pattern; the data listed under dataToCollect would help distinguish it.`,
    })),
    proposedInterventions: escalation
      ? []
      : [
          {
            description: support
              ? `Raise the pattern with the support team and agree on one low-workload adjustment to trial for two weeks (for example, a brief check-in at the start of the affected block).`
              : `Trial one adjustment in the affected context for two weeks (for example, offering the affected task in the format where performance is stronger)${strengths.length ? `, connected to the student's interest in ${strengths[0]}` : ''}.`,
            rationale: 'A single, reversible change makes any effect easier to see in the next detection window.',
            effortLevel: 'low',
            workloadJustification: null,
            whatWouldConfirm: 'A visible shift in the same measure over the next two to three weeks of logged entries, compared with the current window, would support the hypothesis; no shift would undercut it.',
          },
          {
            description: `Add a one-tap context tag to every entry in the affected block so the next window has balanced data across contexts${strengths.length > 1 ? `, and use ${strengths[1]} as a reinforcer when the desired behavior is observed there` : ''}.`,
            rationale: 'Most listed alternative explanations can be checked with better-tagged data rather than a new strategy.',
            effortLevel: 'low',
            workloadJustification: null,
            whatWouldConfirm: 'If the pattern persists once the confounding contexts are separated in the data, that supports the hypothesis; if it disappears, an alternative explanation is more likely.',
          },
        ],
    dataToCollect: [
      'Context tags on every entry in the affected block (work arrangement, task length, period).',
      'Attendance alongside grades so absence can be separated from performance.',
      'Whether group grades reflect individual or shared scores.',
    ],
    humanReviewNotes: escalation
      ? 'Routing is safety escalation: follow established school safety procedures and involve appropriate personnel. No classroom interventions are proposed.'
      : `This is a computed candidate from rule ${p.definition.id} v${p.definition.version}. Confirm only if the evidence matches your own observation; dismiss with a reason if not. ${support ? 'Discuss with the support team before acting.' : ''}`.trim(),
  };
}

// ---- Review narration -----------------------------------------------------------------------

function mockNarrative(p: ReviewNarrationPayload): ReviewNarrative {
  const c = p.computed;
  const goalLines = c.goalSummaries.map((g) => {
    const trend = g.trend === 'insufficient_data' ? `only ${g.observations} observations in ${g.windowDays} days` : `${g.trend} (${g.observations} observations, current ${g.currentValue?.toFixed(1) ?? 'n/a'} vs baseline ${g.baselineValue?.toFixed(1) ?? 'n/a'})`;
    return `${g.targetBehavior}: ${trend}.`;
  });
  const decisionText: Record<string, string> = {
    continue: 'continue the plan as written',
    modify: 'modify the plan',
    collect_more: 'collect more data before deciding',
    seek_support: 'seek support from the team',
    fade: 'begin fading the plan',
  };
  const improved = c.goalSummaries.filter((g) => g.trend === 'improving');
  return {
    decision: c.decision,
    summaryForTeacher: `${goalLines.join(' ')} Strategies were logged in ${c.implementationConsistency.weeksWithStrategyUse} of ${c.implementationConsistency.weeksInWindow} weeks. The computed recommendation is to ${decisionText[c.decision]}. ${c.rationale.join(' ')}`.trim(),
    summaryForStudent: improved.length
      ? `You have been working on ${improved[0]!.targetBehavior.toLowerCase()} and the numbers are moving the right way. Keep using your check-in card, and keep going.`
      : `You have been working on ${c.goalSummaries[0]?.targetBehavior.toLowerCase() ?? 'your goals'}. Your teacher is looking at what is working and will talk with you about the next step.`,
    summaryForFamily: `The team reviewed your child's plan using the last ${c.goalSummaries[0]?.windowDays ?? 14} days of classroom records. ${improved.length ? 'Progress is visible on at least one goal.' : 'It is too early to see a clear change on the goals.'} The next step is to ${decisionText[c.decision]}, and the teacher will confirm this decision.`,
    suggestedAdjustments:
      c.decision === 'modify' || c.decision === 'seek_support'
        ? ['Shorten the checkpoint interval during the affected block.', 'Re-teach the replacement behavior with a brief practice.', 'Add context tags to entries so the next review can compare settings.']
        : [],
    humanReviewNotes: 'This recommendation is computed from logged data by fixed rules and narrated automatically. A named reviewer must confirm or change the decision.',
  };
}

// ---- Classifier and judge -------------------------------------------------------------------

function mockClassifier(draft: string): ClassifierOutput {
  const causal = findTerms(draft, CAUSAL_PHRASES).length;
  const diag = findTerms(draft, DIAGNOSTIC_TERMS).length;
  const stig = findTerms(draft, STIGMATIZING_TERMS).length;
  const factual = (draft.match(/\b(the student (works|does) better|is (clearly|definitely)|this proves|this shows that)\b/gi) ?? []).length;
  return {
    unsupportedCausalClaims: Math.min(1, causal * 0.35),
    hypothesesStatedAsFact: Math.min(1, factual * 0.5),
    stigmatizingLanguage: Math.min(1, stig * 0.6 + diag * 0.4),
    outsideEducationalScope: Math.min(1, diag * 0.5),
    confidence: 0.75,
    notes: causal || diag || stig || factual ? `Flagged phrases: ${[...findTerms(draft, CAUSAL_PHRASES), ...findTerms(draft, DIAGNOSTIC_TERMS), ...findTerms(draft, STIGMATIZING_TERMS)].join(', ')}` : 'No concerning phrases found.',
  };
}

function mockJudge(p: JudgePayload): JudgeOutput {
  const findings = checkPlanDeterministic(p.plan);
  const has = (check: string) => findings.some((f) => f.check === check);
  const base: Record<string, number> = Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c, 4]));
  if (has('target_without_baseline')) {
    base.observableAndMeasurable = 1;
    base.transparentAboutUncertainty = 1;
  }
  if (has('vague_term')) base.observableAndMeasurable = Math.min(base.observableAndMeasurable!, 3);
  if (has('diagnostic_vocabulary') || has('stigmatizing_language')) {
    base.supportiveNotPunitive = 1;
    base.personalizedWithoutAssumptions = 2;
  }
  if (has('causal_language_in_hypothesis')) base.transparentAboutUncertainty = Math.min(base.transparentAboutUncertainty!, 2);
  if (has('monitoring_workload')) base.workloadReducing = 2;
  const text = [...strings(p.plan)].map((s) => s.text).join(' ');
  for (const e of p.expectations) {
    const lower = e.toLowerCase();
    if (lower.includes('blocked_on_baseline') && p.plan.measurableGoals.some((g) => g.target.status !== 'blocked_on_baseline')) base.transparentAboutUncertainty = 1;
    if (lower.includes('safetyconcern') && !p.plan.privacyAndHumanReviewNotes.safetyConcern) base.appropriateForHumanReview = 1;
    if (lower.includes('outofscope') && !p.plan.privacyAndHumanReviewNotes.outOfScopeRequestNoted) base.appropriateForHumanReview = 1;
    if (lower.includes('proposed') && lower.includes('target') && !lower.includes('no numeric target') && !p.plan.measurableGoals.some((g) => g.target.status === 'proposed')) base.practical = 2;
  }
  if (!/human review|educator must review|reviewer/i.test(text)) base.appropriateForHumanReview = Math.min(base.appropriateForHumanReview!, 2);
  const scores = RUBRIC_CRITERIA.map((criterion) => ({ criterion, score: base[criterion]!, justification: `Mock judge: deterministic heuristics gave ${criterion} a ${base[criterion]}.` }));
  const overallPass = scores.every((s) => s.score >= 3);
  return { scores, overallPass, summary: overallPass ? 'Mock judge: no rubric criterion below 3.' : `Mock judge: failing criteria ${scores.filter((s) => s.score < 3).map((s) => s.criterion).join(', ')}.` };
}
