# 01 — Domain model

## Entity map

```
Organization ─→ School ─→ ClassSection
User ─┬─ RoleAssignment          (scoped to school / section / student — never global)
      └─ AuditEvent

Student                          (IDENTIFIED plane — see 04-privacy-and-access.md)
  └─ CaseKey                     (pseudonymous link into the working plane)

Case                             (WORKING plane — keyed only by CaseKey)
  ├─ Intake                      (the 7 educator fields, versioned)
  ├─ PlanDraft                   (LLM output + prompt version + run metadata)
  ├─ Plan                        (approved; the active object)
  │    ├─ Goal
  │    ├─ Strategy               (preventive | response | replacement | self-monitor | family)
  │    └─ ReviewCycle            (due date, decision, rationale, reviewer)
  ├─ Signal[]                    (unified event stream — see below)
  ├─ PatternCandidate[]          (see 02-pattern-engine.md)
  └─ SafetyFlag[]                (escalation, separate pathway)

Supporting: PromptVersion, GenerationRun, PatternDefinition, EvalCase, EvalRun,
            AuthorizationRecord, DashboardPolicy
```

## The signal layer

The pattern engine needs more than behavior events. The motivating example — low grades *and*
behavior during group work *and* excessive absence *but* strong independent assessment — spans
four data types and only becomes a pattern when they are comparable. So everything measurable
normalizes into one shape:

```ts
type Signal = {
  id: string
  caseKey: string
  type: 'behavior_event' | 'assignment_grade' | 'assessment_score'
      | 'attendance' | 'strategy_use' | 'self_check' | 'interval_observation'
  value: number | string          // coded per type
  unit?: string
  contextTags: string[]           // see below — this is the important part
  observedAt: Date
  source: 'teacher_entry' | 'student_entry' | 'sis_import' | 'system'
  sourceConfidence: 'high' | 'medium' | 'low'
  enteredBy?: UserId
}
```

### Context tags are the crux

The example pattern is not "low grades." It is **a contrast across a context dimension** —
performance differs between group and independent settings. Without context tagging that pattern
is inexpressible, no matter how good the model is.

Seed dimensions:

| Dimension | Example tags |
|---|---|
| Work arrangement | `group_work`, `independent`, `paired`, `whole_class` |
| Task length | `short_task`, `long_assignment`, `multi_day` |
| Structure | `structured`, `transition`, `unstructured_time` |
| Assessment type | `formative`, `summative`, `performance_task` |
| Schedule | `period_1`…`period_8`, `morning`, `afternoon` |

Two consequences for the build:

- **Quick-entry UI must capture context in one tap.** A chip row, defaulted from the current
  period and the teacher's last entry. If tagging costs typing, it won't happen, and the pattern
  engine starves.
- **Imports need a mapping layer.** SIS assignment categories → context tags, configured once per
  school, reviewed by the teacher.

Tags are a controlled vocabulary with an org-level extension list — free-text tags would fragment
and break detection.

## Key type decisions

### Baseline is a discriminated union, not a nullable number

The central win of the source prompt's revision arc was the model correctly *refusing* to treat
"3–5 times per period" as a baseline for either behavior. Storing `baseline: number | null`
discards that reasoning at the persistence layer.

```ts
type Baseline =
  | { status: 'available';   value: number; unit: string; observations: number; spanDays: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'ambiguous';   rawInput: string; whyAmbiguous: string; candidateBehaviors: string[] }
```

The UI renders each state differently, and `ambiguous` gets a "start behavior-specific
collection" action. Same treatment for `Goal.target`: a *proposed* target must be visually and
structurally distinct from an *established* one.

### Goal

```ts
type Goal = {
  id, planId
  targetBehavior: string           // observable definition required
  observableDefinition: string     // no "focused" / "engaged" / "on task"
  baseline: Baseline
  measurementMethod: 'frequency_count' | 'interval_observation' | 'duration' | 'permanent_product'
  target: { status: 'proposed' | 'established' | 'blocked_on_baseline'; value?: number; unit?: string }
  reviewPeriodDays: number
  status: 'draft' | 'active' | 'met' | 'modified' | 'faded' | 'discontinued'
}
```

### Plan lifecycle

`draft → in_review → active → under_review → (continued | modified | faded | discontinued)`

Only a named human with an approval-capable role moves `in_review → active`. The transition
record carries reviewer, timestamp, and the diff between AI draft and approved text.

### Store the draft/approved diff

When an educator edits the AI draft before approving, keep both versions and the diff. This is
the highest-value feedback signal in the system: where educators consistently rewrite is exactly
where the prompt is weak. It feeds prompt revision (03) and pattern-definition tuning (02).

## Scope note

Adding grades, assessments, and attendance meaningfully widens the compliance surface — these are
education records in their own right, and attendance in particular carries mandated-reporting
pathways in many jurisdictions. See [04](04-privacy-and-access.md) and
[07 — Open questions](07-open-questions.md).
