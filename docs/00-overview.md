# 00 — Overview

## What it is

A role-scoped web app where a teacher submits de-identified behavior observations, an LLM drafts
a structured behavior-support plan, a human approves it, and the plan becomes a live tracked
object with goals, logged data, progress views, and scheduled review decisions.

A pattern engine runs alongside: deterministic rules over accumulated student signals surface
combinations worth human attention, and an LLM proposes candidate interventions for what fires.

## Users and surfaces

| Role | Gets |
|---|---|
| **Teacher** | Intake, plan review/approval, quick data entry, progress views, pattern queue, review reminders |
| **Student** | Own goals, strategies, progress, positive feedback, self-reflection check-in |
| **Parent/Guardian** | Own child's goals, progress summaries, accomplishments, home support suggestions |
| **Support professional** | Teacher surface plus cross-case view for students they are assigned |
| **Administrator** | Aggregated trends, intervention effectiveness, pattern-catalog health, equity monitoring |

The student surface is for actual adolescents. A sixth grader is a real user with real UI needs,
not a read-only view of the teacher screen.

## The core loop

```
Intake  →  LLM draft  →  Human review & approval  →  Active plan
                                                        │
                        ┌───────────────────────────────┤
                        ▼                               ▼
                  Daily logging                   Review cycle
                        │                               │
                        ▼                               ▼
                  Signal store  →  Pattern engine  →  Pattern queue
                                                        │
                                                        ▼
                                          Human adjudication → new goals/strategies
```

Every arrow into a durable state change passes through a human. The model drafts, proposes, and
narrates; it never approves, decides, or authorizes.

## Guiding principles

1. **The LLM is a step in a workflow, not the product.** Everything it emits lands in a `draft`
   or `candidate` state that a named human must promote.
2. **Detection is deterministic; interpretation is generative.** If a teacher asks "why was my
   student flagged?", the answer is "rule X fired on these 14 data points" — never "the model
   noticed something."
3. **Uncertainty is a first-class state, not a missing value.** An unavailable baseline renders
   as an unavailable baseline with its own affordance, not an empty field.
4. **Access control is code, not model output.** The model may *recommend* what a dashboard
   shows; a policy layer *enforces* it.
5. **Teacher time is the binding constraint.** If logging takes more than ~15 seconds, the app
   gets abandoned regardless of plan quality.
6. **Privacy lives in infrastructure, not in the prompt.** The prompt asks for de-identification;
   the egress gate guarantees it.

## In scope (v1)

Intake, plan generation, approval workflow, structured goals/strategies, behavior logging,
progress visualization, review cycles, the pattern engine, four role surfaces, prompt registry
and eval harness.

## Out of scope (v1)

Formal IEP/504 documents, disciplinary records, SIS write-back, messaging between roles,
district-level rollup across schools, mobile native apps, offline mode.

## Non-goals, permanently

Diagnosis. Disability determination. Disciplinary recommendation. Placement decisions. Anything
that would constitute an educational, medical, or legal determination. These are explicit
constraints from the source prompt and they shape features, not just wording — where a pattern
or plan edges toward one of them, the system routes to a human pathway rather than answering.

## Two deployment postures

The architecture supports both; decide which you are building for (see
[07 — Open questions](07-open-questions.md)):

- **Demonstration posture** — synthetic students only, no real education records. The identified
  data plane exists in schema but stays empty. Compliance surface is near zero.
- **Operational posture** — real students in real schools. Adds FERPA and state student-privacy
  obligations, SSO, DPAs with subprocessors, audit review, retention policy, incident response,
  and a district procurement story. This body of work is comparable in size to the app itself.

Building demonstration-first is reasonable. Building demonstration-first *while pretending the
operational requirements don't exist* is what forces a rewrite later — hence the plane split and
the egress gate from day one, which cost little now and cannot be retrofitted cheaply.
