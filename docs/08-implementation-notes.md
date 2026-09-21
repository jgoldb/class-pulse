# 08 — Implementation notes

What was built, where the build deviated from docs 00–07 and why, and what the evals found.
Written alongside the first full implementation (September 2026).

## Status

Phases 0–7 of the [roadmap](06-roadmap.md) are implemented and demonstrable on synthetic data.
The repository runs with no external services (embedded Postgres, in-process job queue, mock
model provider) and switches to real Postgres, Redis and the OpenAI API by environment variable.

| Phase | Exit criterion | Where it is proven |
|---|---|---|
| 0 Core loop | Draft refuses to invent a baseline from the grade-6 case | `apps/api/src/api.test.ts` "accepts the grade-6 intake…"; eval case 001 on gpt-5.6-terra |
| 1 Evals & guardrails | A V1-style regression fails and cannot be promoted | `packages/ai/src/services.test.ts` "fails when a prompt/model reintroduces the V1 failure"; `promotePrompt` requires a passing `eval_runs` row |
| 2 Approval | Only a named reviewer activates a plan; the diff is queryable | `approveDraft` stores `plans.draft_diff`; admin "draft-diffs" aggregate |
| 3 Logging | Quick entry under 15 s on a phone | `QuickEntry.tsx` measures and reports its own completion time; unverified by a real teacher (open question #2) |
| 4 Pattern engine | Motivating example → evidence-first card → confirmed into a goal | `api.test.ts` "reproduces the motivating example…"; detection evals in `packages/patterns` |
| 5 Auth & access | Role payloads exclude hidden fields; every individual read is audited | `api.test.ts` "role payloads exclude hidden fields entirely"; append-only trigger test |
| 6 Student & family | A sixth grader can find goals and self-check | `StudentHome.tsx`; unverified with a real student |
| 7 Administration | Below-floor or disproportionate rules are visible and retirable | `/api/admin/catalog`, `/api/admin/equity`, definition status route |

## Decisions taken on the open questions

| # | Decision | Rationale |
|---|---|---|
| 1 Posture | **Demonstration.** `DEPLOYMENT_POSTURE=demonstration`, every seeded student is `synthetic=true`. | The plane split, egress gate, audit log and authorization records are built anyway, so the operational posture is a configuration and compliance exercise, not a rewrite. |
| 3 Data sources | Manual entry, plus `sis_import` as a signal source. No SIS integration. | Open question #3 stays the largest unscoped item. The signal shape and the `source` field are ready for an import mapping layer. |
| 5 Thresholds | Provisional numbers live in each definition's `thresholds` and are shown on the admin catalog. | They were set by an engineer and must be reviewed by someone with behavioral-assessment expertise before any rule leaves `piloting` in a real school. |
| 7 Approvers | Configurable: `PLAN_APPROVER_ROLES` (default teacher and support professional). Authorized administrators can read but never approve. | District policy varies. |
| 8 Student role | Students see their goals, self-monitoring and replacement strategies, progress, positive feedback, and can self-check and raise a help flag. They do not see hypotheses, teacher strategies, notes or candidates. | Voice without exposure to speculation. |
| 9 Family visibility | Confirmed patterns only, in plain language, with evidence counts. | As recommended in 07. |
| 10 Catalog ownership | A definition cannot be activated without a named reviewer; each carries a written proxy review. | Enforced in `setDefinitionStatus`. |

## Deviations from the architecture doc

- **AI provider is OpenAI, not Claude.** The egress gate targets the OpenAI Responses API with
  strict structured output. Defaults: `gpt-5.6-terra` at `medium` reasoning effort for plan
  generation, pattern interpretation and review narration; the classifier and judge default to
  the same model at `low` effort and can be pointed at a cheaper model with
  `OPENAI_CLASSIFIER_MODEL`. Every call is sent with `store: false`. All of this is environment
  configuration (see `.env.example`); `PromptVersion.model` may pin a model per version.
- **Auth is Clerk**, not a self-hosted OIDC client. Identity (sign-in, sessions, invitation
  email delivery, verification) is Clerk's; authorization is ours: every person joins through an
  `invitations` row that fixes their role and scope before they sign in, or by creating a
  workspace through the paid sign-up flow. The API verifies Clerk session JWTs; nothing else
  grants access. Row scope is enforced by a single policy layer in code rather than Postgres
  RLS; the doc allowed either.
- **A teacher owns their own class, and invites the family themselves.** The first version made
  the workspace creator an administrator and put every roster row and every invitation behind
  that role, which meant a teacher signing up alone had to become an administrator, build the
  roster in the administration surface, and invite themselves back in as a teacher. That is not
  how a school works: the person who knows who is in the room is the teacher. So sign-up now
  asks which you are, a teacher creating their own class gets a `teacher` assignment on their
  first section and no administrator role at all, and `/api/classroom` lets them add sections
  and students of their own and open the family and student dashboards onto those children.
  Everything that costs an educator seat or reaches across a school — teacher, support
  professional and administrator invitations, equity monitoring, the audit viewer, the prompt
  registry — stays with an administrator. See [04 — who may grant access](04-privacy-and-access.md).
  Guardian and student accounts have never been seats and still are not; the pricing page said
  so before the product could act on it.
- **Postgres is Neon.** One branch per environment; the e2e harness owns a branch it wipes on
  every run. Migrations run at API boot.
- **Jobs use a durable Postgres-backed queue** polled by the API. Redis/BullMQ was dropped; one
  API instance is the deployment shape for now, and the queue survives restarts.
- **The payment page is a stand-in for Stripe.** It is the only simulated component in the
  product, says so on screen, and records `processor: 'simulated'` on the subscription it
  creates. Everything else — auth, database, model, email delivery for invitations — is real.
- **A mock model provider exists for unit and integration tests only.** It is honoured solely
  under `NODE_ENV=test`; every other environment uses OpenAI, including the seed and the browser
  harness.
- **`AI_PROVIDER=off` is a deployment kill switch for the model**, added so the model can be cut
  off without a code change or a redeploy of new code — set it and restart. It is honoured in
  every environment, unlike the mock, and the distinction that makes that safe is that it
  fabricates nothing: it only refuses, so there is no state in which it can be mistaken for a
  real generation. The app boots without `OPENAI_API_KEY`; `/health` reports
  `provider: "disabled"`. Refusals travel the full egress path, so every attempt still writes an
  `egress_log` row with the payload that would have been sent, its hash, the prompt version and
  the surface — turning the model off leaves a record of what was asked of it rather than a blind
  spot. The error is non-retryable, so a generation gives up after one attempt instead of
  spending a second call. `npm run seed` and `npm run evals` refuse to start, and so does the
  admin page's eval runner (`POST /api/admin/prompts/:id/evals` returns 409): with the model off
  every case fails for the same uninteresting reason while the two `blocked_by_gate` cases still
  pass, because the gate blocks them before the provider is reached — a 2/20 score that says
  nothing about the prompt. Prompt promotion is therefore impossible while the switch is on.
  `/auth/me` carries `modelEnabled`, and `AppShell` renders a banner on every surface naming what
  will not run and what is unaffected, so the off state is not mistaken for a broken deployment.
- **Two prompts were needed for `review_narration` and `guardrail_classifier`** on top of the
  two surfaces named in doc 03; the registry has five surfaces.

## The browser harness

`npm run e2e` runs Playwright against the real stack: a launcher script resets and seeds the
e2e Neon branch through the real model, then starts the API; Clerk testing tokens bypass bot
detection; each spec signs in as a seeded Clerk account with a password. The specs cover the
public sign-up (plan → simulated checkout → Clerk sign-up with a test address → onboarding),
the teacher core loop (intake with a live PII catch → real draft → section-by-section approval
→ quick entry), the pattern card and adjudication, the review cycle, every role surface with
its redactions, the second teacher's scope, administration (structure, invitations, catalog,
equity), and a screenshot sweep of every screen at desktop and phone widths. Screenshots are
written to `e2e/screenshots/` so the product can be looked at, not inferred.

## What the eval harness found (gpt-5.6-terra, medium effort)

Case 001 alone passed first time: the model declined to set a target, called the baseline
ambiguous, and the judge scored it 5 on ten of eleven criteria.

The full 20-case suite on `plan_generation.v1` passed **11/20**. Three distinct causes:

1. **A guardrail was wrong.** `studentStrengths` and `documentedPatterns` were required to be
   non-empty. When the intake documented none, the model correctly returned empty lists (the
   prompt says "do not invent information") and the guardrail rejected it. Fixed: empty is
   allowed when `missingInformation` asks for the data; the check is `empty_optional_section`.
2. **Thin baselines were accepted.** Three cases set a numeric target from a single observation,
   "twice this week", or "roughly 4-6 times, estimated", by labelling the baseline `available`.
   Fixed twice: a deterministic check `baseline_too_thin` rejects a target on fewer than three
   observations, and `plan_generation.v2` defines what an available baseline is.
3. **One case expectation was inconsistent** with the guardrail's own rule about where a
   diagnostic term may be echoed. The expectation was corrected and v2 confines echoes to
   `outOfScopeRequestNoted`.

`plan_generation.v2` scored **19/20** on the same model. Rubric means rose on every criterion
(accurate 4.22 → 4.61, observable-and-measurable 4.11 → 4.39, privacy-conscious 4.83 → 5.0).
The one failure was case 009 (two behaviors with four counts each): the model blocked a target
for a behavior that had its own baseline, and — following v2's "name an alternative explanation"
instruction too literally — invented a contextual alternative where the intake documented no
patterns. Both are wording problems; `plan_generation.v3` addresses them (judge each goal's
baseline independently; never invent an alternative).

`plan_generation.v3` scored **20/20** and is the active version in the registry seeds. Three
prompt versions, each driven by an observed failure in the prior one — the same methodology the
source assignment applied by hand, now automated.

| Version | Cases passed | Notable rubric means (1–5) |
|---|---|---|
| v1 | 11/20 | accurate 4.22 · observable 4.11 · transparent about uncertainty 4.72 |
| v2 | 19/20 | accurate 4.61 · observable 4.39 · transparent 4.89 |
| v3 | 20/20 | accurate 4.50 · observable 4.33 · transparent 4.94 · privacy 5.0 · human review 5.0 |

The judge is itself a model (same model, medium effort), so single-case differences of a few tenths
are noise; the pass/fail assertions are deterministic and are what the gate uses.

Full runs cost roughly 17 minutes and about sixty model calls (generation, classifier and judge
per case) at medium reasoning effort. Reports for every run are in `packages/ai/eval-reports/`.

Promotion of any version goes through the gated path (admin → Prompts → Run evals → Promote);
the registry seeds mark the version that passed at the time of writing as `active`.

## Things a real deployment still needs

Unchanged from [04 — deferred](04-privacy-and-access.md): retention and deletion policy, data
portability, incident-response runbook, subprocessor inventory (OpenAI DPA, zero-retention
confirmation), annual access review. Plus: a real teacher for the 15-second measurement, a
behavioral-assessment reviewer for every threshold, and an SIS mapping layer for grades and
attendance.
