# 05 — Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Matches existing in-house React work |
| Data fetching | TanStack Query | Cache invalidation around async generation jobs |
| UI | Tailwind + shadcn/ui | Four distinct role surfaces from one primitive set |
| Charts | Recharts | Progress views with baseline bands and goal lines |
| Backend | TypeScript — Fastify or NestJS | Shared types and Zod schemas across the wire |
| Database | Postgres | Row-level security; JSONB for structured plan and pattern payloads |
| ORM | Drizzle (or Prisma) | Drizzle keeps RLS and raw SQL accessible |
| Jobs | BullMQ + Redis | Generation calls and the nightly pattern sweep |
| Auth | Clerk / Auth0 / Entra ID | SAML and Google Workspace matter for school adoption |
| AI | Claude API, server-side only | `claude-opus-5` for plan generation and pattern interpretation; `claude-haiku-4-5` for guardrail classification |

Shared Zod schemas across client and server are load-bearing here: the plan schema, the pattern
proposal schema, and the model's structured output are the *same* definitions, so a schema change
cannot pass type-check in only half the system.

## Repo layout

```
apps/
  web/                    # React app; one route group per role surface
  api/                    # HTTP handlers + job workers
packages/
  domain/                 # entities, Zod schemas, Baseline union, state machines
  policy/                 # role + field-visibility rules — pure, exhaustively tested
  ai/
    egress/               # THE gate — only module allowed to import the provider SDK
    prompts/              # versioned prompt files, one per version, never edited in place
    schema/               # structured output schemas
    guardrails/           # deterministic + classifier post-checks
    evals/                # cases/ + rubric + runner
  patterns/
    definitions/          # the rule catalog, as data
    engine/               # detection runner, windowing, suppression
    evals/                # labeled synthetic histories, precision/recall suite
  ui/                     # shared components
```

Four packages earn their separation:

- **`policy`** — pure functions, no database, exhaustive tests. Privacy bugs are the expensive
  ones; this is the code that must be provably correct.
- **`ai/egress`** — a single enforced chokepoint. A lint rule forbids importing the provider SDK
  anywhere else, which turns "we de-identify model inputs" from a practice into an invariant.
- **`ai`** generally — prompts and evals version alongside code, not in someone's notes.
- **`patterns`** — definitions are data, reviewable by non-engineers, and independently testable
  against labeled histories with no app running.

## Services

**Generation service.** Enqueue → build de-identified payload via the egress gate → call model →
validate against schema → run guardrails → persist `PlanDraft` or `InterventionProposal` with
full run metadata → notify. Never called synchronously from a request handler; generation is
seconds-to-tens-of-seconds and must not hold a connection or block a page.

**Pattern sweep.** Nightly job per active case: load the signal window, run every `active` and
`piloting` definition, apply suppression and per-teacher caps, create candidates, and enqueue
interpretation only for those that fired and route to a human queue. `piloting` definitions
detect and record but surface to no one.

**Review-cycle engine.** The same machinery over the same signal store. A review cycle coming due
runs the relevant definitions, computes the recommendation (continue / modify / collect more /
seek support / fade) from actual logged data, and hands the model a computed result to narrate.

**Policy service.** Wraps every data read. Row scope, then field visibility, then role view-model
serialization.

## Frontend structure

Route groups by role, not by entity — the four surfaces differ in information architecture, not
just permissions. A student's goal view and a teacher's goal view share a data source and almost
no layout.

Two screens deserve disproportionate design effort:

- **Quick entry** — the ~15-second interaction that determines whether the product survives
  contact with a real classroom. Mobile-first, tap counters, context chips pre-filled from the
  current period and the last entry, no free text required. Build it early and test it on a
  phone, standing up.
- **The pattern card** — evidence, then hypothesis, then proposals, visually distinct and in that
  order. See [02](02-pattern-engine.md).

Everywhere data is charted, render confidence alongside it: observation counts next to every
figure, visually distinct styling for pre-baseline states, explicit "proposed" vs. "established"
target markers. Three observations will otherwise look exactly like a trend, and a chart makes
weak data look authoritative in a way prose does not.

## Testing posture

| Layer | Approach |
|---|---|
| `policy` | Exhaustive unit tests across the role × field matrix. Highest coverage bar in the repo. |
| `patterns/engine` | Labeled synthetic histories; precision/recall per definition; assert non-firing on noise |
| `ai` | Eval suite as a release gate ([03](03-ai-layer.md)); guardrail checks unit-tested directly |
| `ai/egress` | Adversarial fixtures — PII in every field, in every format, plus a test asserting no other module imports the SDK |
| API | Integration tests per role, asserting hidden fields are absent from the payload, not merely unrendered |
| E2E | The core loop: intake → draft → approve → log → pattern fires → adjudicate |

## Observability

Structured logs with PII redaction at the logger, not at the call site. Per-generation cost and
latency tracking. Dashboards for: generation failure rate, guardrail rejection rate by check,
pattern fire and confirmation rates by definition, time-to-adjudication, and quick-entry
completion time — that last one is the product's real health metric.
