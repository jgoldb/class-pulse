# 02 — Pattern engine

## The idea

A teacher logs data over weeks. Individually, no entry means much. In combination — low grades on
group assignments, behavior events clustered in those same blocks, frequent absence, strong
independent assessment scores — a shape appears that suggests a student who may work better
individually. The system's job is to notice that shape, show the evidence, propose what might
help, and hand the whole thing to a human to judge.

## Architecture: detect deterministically, interpret generatively

```
Signals ──→ [1] Detection ──→ PatternCandidate ──→ [2] LLM interpretation
            deterministic     + evidence refs      constrained, evidence-only
            rule catalog      + strength                    │
                                                            ▼
                                                  [3] Human adjudication
                                                  confirm / dismiss / more data / escalate
                                                            │
                                                            ▼
                                            new Goal, new Strategy, or nothing
```

This split is the safety property of the whole feature. Reasons it is not negotiable:

- **Auditability.** A parent or administrator will ask why a student was flagged. "Rule
  `context-performance-divergence` fired on these 14 data points spanning 5 weeks" is an answer.
  "The model noticed something" is not.
- **Tunability.** Thresholds are dials you can turn based on measured confirmation rates. You
  cannot tune a vibe.
- **Reproducibility.** Same data, same detection, every time. Required for testing and for trust.
- **Bias monitoring.** You can measure a rule's firing rate across subgroups. Free-form model
  detection gives you nothing to measure.
- **Cost.** Running a model over every student's full history nightly is expensive and noisy.
  Rules are cheap; the model runs only on the few candidates that actually fire.

An LLM given raw history and asked "find patterns" will find one every time, because that is what
it was asked to do. Detection has to be able to return *nothing*, reliably.

## [1] Detection

### PatternDefinition — declarative, versioned, reviewable

```ts
type PatternDefinition = {
  id: string
  version: number
  title: string                  // "Context Performance Divergence"
  plainLanguage: string          // shown verbatim to educators; no jargon
  requiredSignals: {
    types: SignalType[]
    minObservations: number
    minDistinctDays: number
    minSpanDays: number
  }
  detect: (window: SignalWindow) => {
    fired: boolean
    strength: number             // 0-1, evidence weight — NOT a probability of truth
    evidenceRefs: SignalId[]
    measures: Record<string, number>
  }
  confounders: string[]          // alternative explanations the LLM MUST address
  routing: 'teacher_review' | 'support_team' | 'safety_escalation'
  suppression: { cooldownDays: number; maxActivePerStudent: number }
  status: 'piloting' | 'active' | 'retired'
}
```

Definitions live in version control as data, are reviewable by non-engineers, and carry a
plain-language description shown to educators exactly as written. No rule fires text a teacher
hasn't been able to read in advance.

**`confounders` is a first-class field, not a comment.** For the motivating example: chronic
absence independently depresses grades; group grades may be shared scores rather than individual
performance; group work may coincide with one particular period or subject; and there are usually
far fewer group assessments than independent ones, so the sample is small. The interpretation
stage is *required* to address every listed confounder, and output that skips one fails
validation.

**Sufficiency gate.** Below `requiredSignals` thresholds a definition does not fire a weak
candidate — it emits an `insufficient_data` note visible only on the teacher's own data-quality
panel, saying what is missing. Same discipline as the `Baseline` union: not-enough-evidence is a
state, not a quiet zero.

### Seed catalog (v1)

| id | Fires when | Routes to |
|---|---|---|
| `context-performance-divergence` | Performance in one context materially exceeds another across ≥N assessments spanning ≥3 weeks | Teacher review |
| `task-length-sensitivity` | Behavior-event rate rises with assignment duration | Teacher review |
| `time-of-day-clustering` | Events concentrate in specific periods beyond chance | Teacher review |
| `unstructured-time-clustering` | Events cluster in transitions and unstructured blocks | Teacher review |
| `attendance-performance-coupling` | Absence rate and grade trend move together | Support team |
| `strategy-effectiveness-signal` | A logged strategy associates with improved immediate outcomes | Teacher review |
| `non-response-trajectory` | Consistent implementation across ≥2 review cycles with no movement or worsening | Support team |
| `strength-underutilization` | A documented strength or interest appears in no active strategy | Teacher review |

Two notes on this catalog:

- `strength-underutilization` is cheap, positive in framing, immediately actionable, and pulls the
  plan's own "Student Strengths" section into the live loop. Good first rule to build.
- `non-response-trajectory` **is** the review cycle's "modify" decision. The review-cycle rules
  engine and the pattern engine are the same machinery over the same signal store — build one.

### Routing is not cosmetic

`attendance-performance-coupling` must not surface as "here is a seating strategy." Chronic
absence has mandated pathways in many jurisdictions and is a wellbeing signal before it is an
instructional one. Routing determines which queue a candidate enters, who can adjudicate it, and
which interpretation prompt runs — `safety_escalation` candidates get no intervention proposals
at all, only the established escalation procedure.

### Where it runs

Nightly batch per active case, plus on-demand re-evaluation when a review cycle opens or a
teacher requests it. Not on every write.

## [2] LLM interpretation

The model receives **only**: the definition's plain language, the computed `measures`, a
de-identified summary of the evidence signals, the `confounders` list, the student's documented
strengths, and currently active strategies. It does not receive the raw record, identifiers,
other students, demographic attributes, or its own prior speculation.

Output schema:

```ts
type InterventionProposal = {
  evidenceRestatement: string          // neutral, observable, no inference
  hypothesis: string                   // explicitly labeled; non-causal language required
  alternativeExplanations: Array<{ confounder: string; assessment: string }>
  proposedInterventions: Array<{
    description: string
    rationale: string
    effortLevel: 'low' | 'medium' | 'high'
    whatWouldConfirm: string           // the observation that would support or undercut it
  }>
  dataToCollect: string[]
  humanReviewNotes: string
}
```

`whatWouldConfirm` earns its place: it turns each suggestion into a testable step rather than a
guess, and what it names flows back into the signal store as the next detection window's input.
The loop closes.

Guardrails, run before any human sees the proposal (mechanics in [03](03-ai-layer.md)):

- Every listed confounder appears in `alternativeExplanations` — a structural check, not a judgment call
- No causal verbs in `hypothesis` ("because", "due to", "caused by")
- No diagnostic, disability, medical, or placement language anywhere
- No intervention implying a determination reserved for a team or a formal process
- `effortLevel: 'high'` requires an explicit workload justification

## [3] Human adjudication

`detected → in_review → confirmed | dismissed | needs_more_data | escalated`

- **Confirmed** → seeds a new Goal or Strategy on the active plan, or opens a new case. The
  educator edits before it lands; the diff is stored.
- **Dismissed** → requires a reason code (`not accurate` / `already known` / `not actionable` /
  `wrong framing` / `other`). Starts the suppression cooldown. Feeds definition tuning.
- **Needs more data** → sets a collection target; re-evaluates automatically at threshold.
- **Escalated** → leaves the teacher queue for the support-team queue.

### Presentation order matters

The pattern card renders **evidence first, hypothesis second, proposals third** — visually
distinct, in that order, always. A card that leads with "this student works better alone" invites
the reader to treat a hypothesis as a finding, which is precisely the failure mode the source
prompt's V1→V2 revision was written to prevent. The UI can undo that work as easily as a bad
prompt can.

### Alert fatigue is a real failure mode

Cap active candidates per teacher (start at 3). Rank by evidence strength. Deliver as a weekly
digest, not realtime notifications. A flood of flags is the fastest way to lose teacher trust,
and teacher trust is the whole product.

## Tuning loop

Per definition, per term:

| Metric | Use |
|---|---|
| Fire rate | Is it too loose, or effectively dead? |
| **Confirmation rate** (confirmed / adjudicated) | The headline quality metric |
| Dismissal reason distribution | *Why* it's wrong — tells you whether to re-threshold or retire |
| Time to adjudication | Is the card legible and actionable? |
| Disproportionality index | Equity monitoring — see below |

Definitions below a confirmation-rate floor get re-thresholded or retired. New definitions enter
at `status: 'piloting'` — detected and measured, shown to no one — until they clear the floor on
real data.

## Equity guardrails

Behavior-referral systems have a well-documented history of disproportionate impact across
racial, disability, and socioeconomic lines. A pattern engine can launder that bias into
something that looks objective, which makes it worse rather than better. Concretely:

- **Detection rules have no access to demographic attributes.** Not as features, not as filters.
  Enforced at the query layer, not by convention.
- **The interpretation prompt never receives demographic attributes.**
- **Monitor firing and confirmation rates by subgroup** at the aggregate level, admin-only, with
  minimum cell sizes. Alert on disproportionality.
- **Proxy awareness.** Attendance, discipline history, and free/reduced-lunch status correlate
  with protected characteristics. A rule keyed on them is a demographic rule in disguise. Review
  every definition for proxies before it leaves `piloting`.
- **Retire on disproportionality**, not only on low confirmation rate.

## Evaluation

The pattern engine needs its own test suite, distinct from the plan-generation evals:

- **Detection**: labeled synthetic case histories with known ground truth; assert precision and
  recall per definition; assert non-firing on noise-only histories. Deterministic, fast, runs in CI.
- **Interpretation**: fixture candidates scored against the rubric in [03](03-ai-layer.md), plus
  the confounder-coverage and causal-language checks above.
- **Production signal**: confirmation rate is the real long-run metric. The synthetic suite keeps
  you honest until you have enough real adjudications to trust.
