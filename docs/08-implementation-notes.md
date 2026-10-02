# 08 — Implementation notes

What was built, where the build deviated from docs 00–07 and why, and what the evals found.
Written alongside the first full implementation (September 2026).

## Installable app and release updates (October 2026)

- Pulsera has a scoped standalone manifest, desktop/phone icons, Apple web-app metadata,
  and an Install app control on the landing page and every role's sidebar/mobile menu.
- Service workers are explicitly deployment-only: the Docker build sets `PWA_DEPLOYMENT=true`.
  Local builds do not emit a worker; runtime also requires HTTPS and rejects localhost.
  Earlier local Pulsera registrations and offline caches are removed on startup.
- Each build stamps the client, `version.json`, and deployed worker with one release ID.
  Startup checks the server before mounting editable screens, with a three-second limit.
  A changed release reloads through a versioned URL; session and URL guards prevent loops.
  Failed release checks do not prevent startup. The worker updates independently and caches
  only the public offline page, never classroom data, auth, HTML app shells, or bundles.
- Check for updates is next to Install app. Five-minute polling runs while visible and online;
  foreground/reconnection checks are throttled to once a minute. Updates discovered during
  use show a reload button and save-changes reminder, including a visible phone notice.
  Background checks never reload the user's active session automatically.
- Production-browser verification exposed a Clerk/React circular chunk that blanked startup.
  Keeping their shared runtime in the vendor chunk fixes that failure.

Verification: web typecheck, targeted lint, local and deployment-enabled builds, and 16 PWA
checks pass. These cover install guidance, local worker exclusion, startup/polling behavior,
manual reloads, loop guards, and offline cache isolation. Deployment build inspection confirms
that client, release marker, and worker share an ID; local output contains no worker script.

## Status

Phases 0–7 of the [roadmap](06-roadmap.md) are implemented and demonstrable on synthetic data.
The repository runs with no external services (embedded Postgres, in-process job queue, mock
model provider) and switches to real Postgres and the OpenAI API by environment variable.

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

One thing the sweep did not catch, because it loads every page with `page.goto`: client-side
navigation through the sidenav could leave the new page blank until a reload. The route
transition was an `AnimatePresence mode="wait"` cross-fade around the router's `<Outlet />`, and
the outlet follows the router, so the wrapper that was animating out was already rendering the
new page. A `layoutId` element in that page (the segmented filter on Cases, the tabs on a case)
registered with the exiting presence context, and framer-motion's layout tracker only reports
itself finished on a later re-render, never on mount. The exit therefore never completed and the
new wrapper never mounted. Whether some unrelated re-render came along in time decided whether
it showed, which is why it reproduced on the deployment and rarely against a local server. The
transition is now enter-only (`PageTransition` in `components/ui/motion.tsx`), so there is
nothing to wait on, and `e2e/navigation.spec.ts` clicks through both sidenavs and reads the
wrapper's computed opacity, since Playwright's `toBeVisible` counts an opacity-0 element as
visible.

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
# Pulsera expansion progress — 2026-09-30

This section records the ongoing implementation of plan 09; it does not mark that plan complete.
The user approved Q1–Q3 defaults for synthetic development and confirmed there are no pilot or
provider sign-offs. Existing user changes to the roadmap and question register are preserved.

Implemented so far: additive learner/session/seating/event migrations; author-and-section-scoped
no-case capture; versioned confirmation/correction/undo; CSV preview and atomic import preserving
existing identity/family links; feature rollback; classroom draft generation through the egress
gate; classroom-specific prompt eval/promotion; versioned editing and atomic approval/publication;
export-only communication; teacher-local Tomorrow schedules with school timezones, closures and
DST handling; source invalidation and unapproved-content expiry. The teacher navigation introduces
Class Pulse, Students, Drafts, Tomorrow and Support while keeping existing deep links.

Additional implementation: reviewed small groups; typed SST/MTSS/FBA-support packets; contextual
Guide actions; approved owner/due-date follow-ups; no-case student/family profiles and multiple
children; explicit portal sharing; attributed contributions, correction and educator responses;
separate help routing; relational Classroom Memory; educator-proposed plan revisions with source
attribution and unchanged baselines; aggregate participation, instruction, follow-up and
documentation Insights with complementary suppression. Public branding now uses Pulsera.

Corrections retire projected signals and candidate interpretations, flag applied plans for source
review and invalidate dependent review recommendations/narratives. Review refresh increments the
evidence version; stale decisions and narration writes cannot apply. Expiry removes pending text,
including superseded/withdrawn revisions and pending plan proposals; content-free receipts reject
old retries. Plan revisions snapshot current goals and strategies, including actions added after
initial approval, and reject base changes before publication. Pending snapshots expire with their
proposal. Additive migrations 0004–0015 preserve original approvals and provenance.

Verification checkpoint (2026-09-30): **172 tests across 14 Vitest files passed**, including the
15-case classroom prompt suite against the test provider. All six workspace typechecks and lint
passed. Production web build passed, with existing bundle-size/circular-chunk and dependency
annotation warnings. Six isolated browser walkthroughs passed: capture/retry/correction,
draft edit/approve/share/export, and family contribution/teacher response/correction, each at
desktop and phone sizes. Screenshots were inspected; no horizontal overflow was observed.
The browser harness intercepts API responses and does not verify live Clerk/Neon/model access.
The retention-focused API suite also passed after the final cleanup adjustments.

Queue recovery now renews live handlers' 15-minute leases every minute. A unique token per claim
prevents an old handler's heartbeat, completion or failure from overwriting reclaimed or explicitly
re-enqueued work; queue timestamps use the database clock. Ten queue tests cover competing workers,
renewal, abandoned-job recovery, replaced jobs and fencing of a previous owner after reclamation.
This is at-least-once processing: handlers retain idempotent effects because a database outage
longer than the lease can still allow another worker to claim the job. Stop old workers before
deploying the lease-token migration; an older binary cannot honor the new ownership token.

Live verification used the dedicated E2E database after verifying that it was separate from the
main database and contained only synthetic learners, with Clerk development keys. The full suite
was exercised, followed by focused repairs and reruns: 56 selected checks passed together, then
the student check-in and classroom workflow passed separately. Earlier review, navigation and
quick-entry checks passed. This is evidence across runs, not a claim of a clean full-suite run
from one final reset. Desktop and phone screen sweeps passed. The classroom flow verified UI
evaluation/promotion, capture/correction, generation/approval, separate family sharing, attributed
family input and educator approval of a plan revision. Test cleanup restores the feature flag.
The browser fixes included explicit waits after asynchronous saves/signup, selecting the intended
learner/contribution, and selecting a goal without depending on generated wording.

Outstanding delivery: school-approved voice implementation, school-specific retention/deletion and
portability, backup/restore and incident exercises, representative assistive-technology/device
checks, educator template/threshold review, the school-selected additional integration and measured
pilot workload/value. [10 - Pilot runbook](10-pulsera-pilot-runbook.md) gives procedures and an
evidence register. These require inputs or environments not established by local automation.
Neither plan 09 nor real-student pilot readiness is complete.

Live classroom prompt evaluation found v2 passed 13/15. V3 adds service-formatted evidence and
clearer wording constraints without weakening guardrails, and passed 15/15 on `gpt-5.6-terra`.
Reports are in `docs/evidence/`. The live browser sweep also led to a persistent classroom-settings
confirmation, accessible family correction labels, a single top-level profile heading, and
classroom prompt evaluation controls in administration. V3 also passed its 15-case evaluation
through administration and was promoted in the synthetic E2E database. New deployments still
require their own passing evaluation and explicit promotion.

# Pulsera guide alignment — 2026-10-01

The owner supplied `Pulsera_GitHub_to_Vision_Implementation_Guide.docx`, a checklist (sections
A–U) for moving the product's front door from case management to the classroom. Most of its
infrastructure already existed from plan 09; the gaps were in the teacher experience. Status per
section is in [11 — Pulsera guide alignment](11-pulsera-guide-alignment.md).

Changes in this pass:

- **Class Pulse home rebuilt** (`pages/teacher/ClassPulse.tsx` plus `pages/teacher/pulse/*`).
  The class is the primary object: the class switcher sits in the header (`?class=` keeps the
  choice across refreshes without browser storage), today's session reopens automatically, and
  the session bar carries date, period, topic and objective onto every capture. The seating chart
  shows per-student counts by observation type, a pending marker and the last interaction; "not
  yet observed" is a highlight, never a score. Seats are arranged in place (click a student, then a
  seat; columns adjustable) and still apply from the next session.
- **One-tap capture dock** with the guide's seven actions. Participation is one tap; Praise and
  Check-in offer neutral presets (to be refined with the pilot teacher, Q6) or free text;
  Understanding defaults the concept to the session topic; Behavior opens the ABC form; Note is a
  new observation kind; Voice is visibly disabled until a school approves an audio provider (Q4).
  Late/absent and exit tickets live under More. Every quick save shows a toast with Undo. On phones
  the dock sticks above the tab bar and collapses until a student is selected.
- **`note` observation kind** in `packages/domain/src/classroom.ts`: the note text is required and
  goes through the same roster/PII check as every other field. No migration (observations are
  typed JSON). The classroom prompt formats evidence generically, so prompt v3 is unchanged; its
  eval suite has no note case yet.
- **Live-to-Draft from the activity feed**: each confirmed observation offers the drafts the guide
  maps to it (praise → positive note / family message, behavior → ABC, needs-practice → reteach /
  Do Now, check-in or note → next step) and shows any drafts already made from that exact version
  with their Teacher Confirm state. Multi-source drafts (groups, reports) use an explicit selection.
- **Teacher Confirm made visible** (`components/TeacherConfirm.tsx`): Suggested → Confirmed →
  Logged for drafts; observations show Suggested (saved for review) or Confirmed. Off-path states
  (preparing, failed, AI off, source changed, discarded) are labelled instead of raw enums.
- **Draft Inbox** (`pages/teacher/ClassroomDrafts.tsx`): grouped into Documentation, Instruction,
  Family, Positive notes, Tomorrow and Intervention reviews, with To review / Approved / Deferred
  filters. Each draft shows **What happened** (teacher observations), **What Pulsera drafted** (AI
  suggestion, dashed and violet) or **Approved record** (green), then the approval step. `GET
  /api/pulse/drafts` now returns `students`, `evidenceKinds`, `session`, `title` and
  `approvedAudience`; stale rows stay content-free, title included (tested).
- The teacher shell no longer offers "New intake" as its primary action; intake stays on Support.
- **No manual setup after a deploy.** Two defaults from the 2026-09-30 pass left the main
  features broken on any new or existing database until someone found the right admin pages:
  - Class Pulse was off per workspace (`pulsera_enabled` default false), a pilot-rollout
    precaution that duplicated the real gates. Migration `0016` makes it default on and turns it
    on for existing workspaces whose learners are all synthetic; a workspace with any
    non-synthetic learner stays off. Demonstration posture and synthetic-only capture are still
    enforced at runtime, and administrators can still switch it off.
  - No classroom prompt was active anywhere, although `classroom_draft.v3` had passed 15/15 live
    (`docs/evidence/classroom-v3-live-2026-09-30.json`). It is now marked `active` in the registry,
    like `plan_generation.v3`, and `seedPrompts` activates a surface's evaluated seed version on
    boot when that surface has no active version. It never replaces a version an administrator
    promoted; promoting a new version still requires a passing eval run (tested).

Verification: 176 Vitest tests (new: the note kind, inbox context including the stale case,
the 0016 backfill, and boot-time prompt activation), typecheck and lint pass. The isolated browser walkthroughs (`npm run e2e:pulse`) pass at
desktop and phone width; the harness gained the `TooltipProvider` and `Toaster` the app shell
supplies. Class Pulse capture, Live-to-Draft (positive note and ABC through the real model), the
inbox, and approval for a family audience were driven by hand in the browser pane as the seeded
teacher at desktop and phone sizes.

## Guide completion pass — 2026-10-01 (afternoon)

Closed every remaining row of [docs/11](11-pulsera-guide-alignment.md):

- **Brand:** blue → teal → violet tokens (`--brand-*`, `.bg-brand`, `.text-brand`), a new mark
  and favicon, a classroom-OS landing page, and Clerk localization so sign-in says Pulsera
  without a dashboard change. Contrast raised to WCAG AA after axe flagged `text-subtle` and the
  primary link colour.
- **Capture:** keyboard shortcuts and seat navigation; per-teacher quick-pick wording
  (`teacher_preferences`, migration 0017), roster-checked like observation text.
- **Tomorrow Ready:** `GET /api/pulse/tomorrow/:section/bundle` and `POST …/prepare`. Preparation
  (shared with the scheduled job) requests a Do Now, a reteach from needs-practice evidence and a
  practice group per concept with 2–8 students; family notes stay opt-in per student.
- **My Pulse / Family Pulse:** `pages/MyPulse.tsx`. Goal rings use the learner's last seven
  check-ins on that goal and show "n/3 check-ins" below three. Family contributions gain sleep and
  mood (school setting `family_wellbeing_collection`, default on) and per-item visibility; a
  student sees family items shared with them, read-only (migration 0018).
- **Guide and reports:** `support_recommendation` artifact and prompt `classroom_draft.v4`
  (17/17 live; an earlier run 16/17, both in `docs/evidence/`). Guide, support and report kinds may
  cite any confirmed session of the same class. Boot activation now also upgrades from a system
  version the registry marks retired, so v4 reaches Fly on deploy; administrator-created versions
  are never replaced. Report template validation per school (migration 0019) and a print/PDF view.
- **Interventions and Insights:** intervention history on the teacher's student profile;
  `/admin/insights` with check-in coverage and a weekly participation trend, still suppressed.
- **Bulk review:** `POST /api/pulse/drafts/bulk` runs each exact version through the single-item
  path; bulk approval is teacher-only.
- **Privacy operations:** per-school retention windows (migration 0020) feed expiry, evidence
  eligibility and profiles; learner export/erasure; `db:backup`/`db:restore` with a round-trip test
  and a drill; an automated incident drill; axe scans in the isolated browser suite (now three
  sizes, twelve walkthroughs).
- **Voice:** `transcribe` on the provider interface (only `openai.ts` touches the SDK), a gate
  method that logs size and hash only, school approvals (migration 0021), and the push-to-talk
  review dialog. Verified live with a Windows-synthesized recording fed to Chromium as the
  microphone; the test approval was withdrawn afterwards.

E2E: `ensureActivePlan` lets `pulsera-live.spec.ts` settle the seeded review itself, so it no
longer depends on `patterns-reviews.spec.ts` running first.

Verification for this pass: 189 Vitest tests (16 files), six workspace typechecks, lint and the
production web build pass. Isolated walkthroughs: 12 passed (desktop, tablet, phone) with axe
WCAG 2 A/AA scans. Full live e2e on a fresh seed: 77 passed; the two failures (a duplicate
"approved by" match in `roles.spec.ts`, and the request test that depends on it) were fixed and
the spec re-passed 6/6 against the same database state. `pulsera-live.spec.ts` passes on its own
on a fresh seed. Live model checks: Tomorrow preparation, positive note and ABC drafts, v4 evals,
and voice transcription of a synthetic recording.

## Visual, UX and class-editing pass — 2026-10-02

Implements `Pulsera_Visual_Aesthetic_and_User_Experience_Implementation_Spec.docx`; section by
section in `docs/12-pulsera-visual-ux-alignment.md`. Decisions worth keeping:

- **Colour has a job.** Primary is blue (it was teal), success is teal, and AI gets its own violet
  `ai` token (`proposal` now aliases it). Amber means "needs the teacher"; red is destructive only.
  Behavior observations are neutral and lost the warning-triangle icon; praise is teal, not amber.
- **One current class across the teacher surface.** `lib/classes.ts` keeps it in a small
  localStorage-backed store so the top-bar selector, Class Pulse and Tomorrow agree; a `?class=`
  link wins. Without a timetable the default is period order. A pending, unconfirmed save blocks
  switching class from the selector, as the link guard already blocked navigation.
- **Sections are edited in place** (migration 0022, `PATCH /api/classroom/sections/:id`). The id
  never changes and sessions keep the context tags they were opened with, so a renamed or
  re-perioded class keeps its whole history. Period is validated against the schedule vocabulary on
  every create path (teacher, onboarding, admin) because it becomes a pattern-engine context tag.
  `expectedUpdatedAt` gives a 409 instead of a silent overwrite from a second tab.
- **Roster removal removes the enrollment only.** Class views join through enrollment, so a removed
  student's events leave the live views and come back if they are re-added; nothing is deleted.
- **Archive is a soft state.** Reads keep working; new sessions and captures get a 409; the
  Tomorrow scheduler skips archived classes.
- **Session end is a status.** `ended_at` drives "Session complete"; the API still accepts
  confirmation, correction, drafting and late capture after the bell.
- **Approval became two steps** (Approve version N → Confirm approval, naming the audience). The
  spec asks that approval feel deliberate; the server contract is unchanged.
- **API errors speak plainly.** Zod failures return "Check <field>: <message>." and 500s say what
  to do next, instead of "Validation failed" / "Internal error".
- **The isolated harness renders the real shell.** `e2e/pulse-vite.config.ts` aliases
  `@clerk/react` to `e2e/clerk-stub.tsx`; production code has no seam. Its helpers wait for finite
  animations before axe and screenshots, because a control that has just become enabled is still
  fading in and axe measures the half-faded colour.
- **Favicon set.** `favicon.svg` already existed; PNG fallbacks, an apple-touch-icon, 192/512 icons
  and `site.webmanifest` are rendered from it by `node scripts/icons.mjs`, and `theme-color` moved
  to the new blue.

Verification for this pass: 195 Vitest tests (16 files; six new for editable sections), six
workspace typechecks, lint and the production web build pass. Isolated walkthroughs: 25 passed at
desktop, tablet and phone (dark mode on desktop), with axe WCAG 2 A/AA and no horizontal page
scroll. Full live e2e on a fresh seed: 87 of 87 passed, including the rewritten `my-class.spec.ts`
(create with a student → edit in place → add/remove students → family access → isolation →
archive) and the classroom-plan onboarding that now lands on My Classes.

## Migrations squashed — 2026-10-02

With every database due for a reseed (no data to keep), the 23 migrations (0000–0022) became one
baseline, `apps/api/drizzle/0000_init.sql`: drizzle-kit's output for `src/db/schema.ts`, with the
hand-written triggers from the old 0001 appended (audit and egress logs append-only, prompt
versions immutable except status). Applied to an empty Postgres, the old chain and the baseline
produce byte-identical catalogs — tables, columns, defaults, constraints, indexes, triggers and
functions — checked by introspecting both in PGlite. `drizzle-kit generate` reports no drift.

Retired with the old chain: two data backfills that only mattered to databases created before
them (learner identity links for legacy cases, 0004 — learner links are also created on demand at
capture; Pulsera on for synthetic workspaces, 0016 — now the column default), and the two tests
that executed those files.

Databases migrated by the old chain cannot be upgraded in place. `db/client.ts` compares the
database's first recorded migration hash with the baseline's and refuses to boot with an
explanation instead of failing halfway through `CREATE SCHEMA`. `seed --reset` and `db:empty` now
drop the schemas through `dropAppSchemas` *before* opening (and so migrating) the database, so
both work on an old-history database. `.gitattributes` pins `apps/api/drizzle/**` to LF: drizzle
hashes each file's bytes, and an autocrlf checkout would otherwise change the hash.

**Fly order of operations.** A new image refuses to boot on the old-history `fly` branch, and
`npm run db:reseed -- --target fly` runs inside the machine, so empty the branch first:
1. Delete the Clerk users and pending invitations (shared dev instance).
2. Drop the schemas on the Neon `fly` branch (SQL editor):
   `DROP SCHEMA IF EXISTS working, identified, drizzle CASCADE;` — the running old app errors
   until step 3.
3. `npm run deploy` — boots on the empty branch and applies the baseline.
4. `npm run db:reseed -- --target fly` — seeds the demo workspace and recreates the Clerk accounts.
5. `npm run db:reseed -- --target local`; the e2e branch reseeds itself on `npm run e2e`.
