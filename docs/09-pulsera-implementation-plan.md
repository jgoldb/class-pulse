# 09 - Pulsera implementation plan

Status: implementation in progress, 2026-09-30. Phases are dependency-ordered, not calendar
commitments. Completion requires both verified product work and the external pilot evidence below.

### Decisions recorded during implementation (2026-09-30)

The requesting product owner authorized the recommended Q1–Q3 defaults **for synthetic
development**: restricted pending drafts, explicit teacher confirmation of the exact observation
or artifact version, and section-scoped classroom history. Engineering owns enforcement and
verification. This is not a school retention or operational-use approval.

For Q4, external audio processing remains disabled until a school-approved provider boundary
is documented. The owner confirmed that no pilot teacher/school, approved audio provider, or
school-policy sign-offs are currently available. Q5, school-specific Q1–Q4 approval, template
validation, additional integration selection, and measured pilot value remain external gates.
Do not mark those gates complete from automated tests or synthetic demonstrations.

Acceptance scenarios to implement and verify:

| Scenario | Observable acceptance condition |
|---|---|
| Normal class / no support plan | Select section, enter lesson context once, capture a typed observation for any enrolled learner without creating a case |
| Behavior observation | Preserve observable action and available ABC context; absent components and unmeasured counts remain null |
| Mistaken attribution | Correct to an enrolled learner with a new revision; withdraw old evidence from current history and invalidate derivatives |
| Absent or late | Record explicit attendance; missing participation never implies absence or lack of engagement |
| AI failure or disabled AI | Capture remains available; generation status is separate and retry does not duplicate capture |
| Network interruption | Keep the unsent request in page memory with the same request ID; show failure and retry explicitly |
| Safety/help | Keep the dedicated help route accessible; ordinary draft approval never delays an urgent request |
| Approval | Reject stale versions and changed/ineligible sources; publish the approved version atomically and only once |
| Scope | Reject other sections/schools and cross-subject references; family/student views omit pending drafts and private notes |

Initial synthetic-development retention proposal: pending event/transcript text and draft
content expire after 30 days; current approved classroom memory has a 120-day retrieval window.
These durations are engineering defaults to validate with the school, not legal retention rules.
No raw audio storage or persistent browser storage is authorized. Audit metadata records IDs,
versions, actions and actors without copying draft/transcript text. Operational enablement
must remain unavailable until school policy and operational evidence are recorded.

### Engineering checkpoint (2026-09-30)

| Phase | Implemented and locally verified | Outstanding |
|---|---|---|
| 0 | Synthetic Q1–Q3 decisions and acceptance scenarios | Named teacher/school, school approvals, measured baseline |
| 1 | Additive migration/backfill; scoped records; versioned approval, projection, correction/retirement, pending expiry | Operational retention/deletion/portability policy and implementation |
| 2 | Text/tap capture, sessions/seating, CSV import, branding/navigation, desktop/phone capture and retry | Approved audio boundary then voice capture/transcription; representative classroom accessibility/usability |
| 3A | Typed drafts, provenance, editing/approval, export and separate portal sharing, on-demand/scheduled Tomorrow; v3 live eval 15/15 and UI promotion | Voice-dependent scenario; teacher usefulness evidence |
| 3B | Reviewed groups/exit tickets, reports, Guide, follow-ups and reminders | Educator template validation and classroom usefulness measurement |
| 4 | No-case/multiple-child profiles, contributions/responses/corrections, plan revisions, scoped memory, help routing | School collection policy and representative student/family usability |
| 5 | Suppressed aggregate Insights and operational runbook | Restore/access/incident/provider evidence, school-selected additional integration, measured net time saved |

Verification: 172 unit/integration tests and six isolated desktop/phone browser walkthroughs;
workspace typechecks, lint and production web build passed. Classroom prompt v3 passed all 15
live model cases; reports are in `docs/evidence/`. Isolated browser tests intercept API responses;
live desktop/phone screens and all previously failing flows passed on focused reruns, including
family contribution through educator-approved plan revision. Results span multiple runs rather
than one final full-suite reset. These checks do not establish voice or
operational readiness. See [08 - Implementation notes](08-implementation-notes.md) and
[10 - Pilot runbook](10-pulsera-pilot-runbook.md) for evidence and remaining work. This checkpoint
does not mark any external acceptance gate complete.

## Purpose and source requirements

Evolve the existing behavior-support application into Pulsera, an application teachers can use
throughout instruction. Preserve the existing support-plan, privacy, and approval infrastructure
while adding a classroom workflow that works for every enrolled student before a case or plan
exists.

This plan translates the following supplied documents into implementation work:

- `Pulsera_AI_Classroom_Operating_System_Proposal.docx`
- `Pulsera_Founder_Vision_and_Product_Blueprint.docx`

The documents establish product direction; they do not specify complete schemas, permissions,
retention rules, or acceptance tests. Recommendations below fill those gaps provisionally.
Open questions identify decisions still needed. The blueprint's 18-month roadmap is a product
horizon, not a validated engineering estimate for this repository.

The intended loop is:

```text
Classroom interaction -> teacher-confirmed observation -> AI drafts
                                                        |
                          teacher edits and approves <--+
                                      |
                   student history, support, tomorrow's materials
                                      |
                         observe outcomes and revise
```

[06 - Roadmap](06-roadmap.md) documents the original build. [08 - Implementation
notes](08-implementation-notes.md) records implementation decisions, including changes from the
original architecture. This document proposes the next build and explicit extensions to the old
scope. Unchanged privacy, access, and educational-support constraints remain in force. Update
the affected specifications alongside implementation rather than silently changing their meaning.

## Current state and reuse

Assessment is based on source inspection and saved browser screenshots, not a new live-service
verification or a fresh test run.

| Capability | Current state | Required extension |
|---|---|---|
| Teacher home | Cases, pending decisions, roster, and plan-linked quick entry | Current class, seating chart, and immediate capture for all students |
| Signal storage | Signals require a case; quick-entry UI requires a plan | Classroom observations independent of support cases |
| Human approval | Plan approval, pattern adjudication, and review decisions | Consistent approval and provenance for each new artifact type |
| AI | Structured output, text egress gate, versioned prompts, guardrails, evals | Observation, instructional, communication, and report drafting; separately governed transcription |
| Student experience | Goals, progress, reflections, self-checks, approved strategies | Strengths first, strategy choices, and proposals that receive a response |
| Family experience | Shared plan information, home strategies, correction requests | Home contributions, collaboration, and multiple-child navigation |
| Documentation | Approved plan printing and review narratives | ABC observations and editable SST/MTSS/FBA-support evidence packets |
| Administration | Aggregate trends, equity, pattern catalog, access, model diagnostics | Participation patterns, instructional needs, and follow-up completion |
| Operations | Clerk, Neon Postgres, durable Postgres jobs, simulated checkout | Pilot controls, practical imports, and eventual real billing |

Keep React/Vite, Fastify, Drizzle, shared Zod schemas, Clerk identity, application-owned
authorization, and the Postgres job queue. Extend the existing packages and services. This plan
does not require a new framework, microservices, vector database, or general chatbot interface.

Useful starting points:

- [Teacher home](../apps/web/src/pages/teacher/Today.tsx),
  [quick entry](../apps/web/src/pages/teacher/QuickEntry.tsx), and
  [navigation](../apps/web/src/components/AppShell.tsx).
- [Database schema](../apps/api/src/db/schema.ts),
  [signal service](../apps/api/src/services/signals.ts), and
  [role-specific views](../apps/api/src/services/views.ts).
- [Approval service](../apps/api/src/services/plans.ts),
  [access policy](../packages/policy/src/scope.ts), and
  [AI egress gate](../packages/ai/src/egress/gate.ts).

## Product rules

1. Everyday classroom use must work without opening an intake or creating a support case.
2. Teachers record observable actions and instructional context. Display recent participation,
   interactions, and check-ins with timestamps and explanations. Do not infer a student's
   character, diagnosis, emotion, or overall engagement from missing observations.
3. AI output remains a suggestion until a named, authorized educator approves its exact version.
   Approving a source observation does not approve the AI's subsequent interpretation.
4. Distinguish observed facts, student or family reports, hypotheses, and approved actions.
   Approval does not change who originally reported something or establish causation.
5. Use only eligible approved history for model-generated memory and instructional insights.
   Apply permission, correction, and retirement rules when retrieving it.
6. Keep the existing baseline sufficiency rule, deterministic detection, demographic exclusion
   from detection, and human decision boundaries. Extend prompt evaluations for new surfaces.
7. Capture remains usable when AI is disabled, slow, or unavailable. Show the actual state of
   capture, saving, generation, approval, and sharing separately.
8. Teacher workload includes review time. Creating more drafts is not a success metric by itself.

### What Teacher Confirm means

Recommended product semantics, subject to Q1 and Q2:

| Input or output | Confirmation behavior |
|---|---|
| Explicit teacher action, such as selecting a student and tapping participation | The labeled action can confirm that exact observation; record actor and time and offer correction/undo |
| Voice transcript or AI-structured observation | Remains pending until the teacher checks wording, context, and student attribution |
| AI note, strategy, report, activity, or message | Suggested -> Confirmed -> Logged; approval applies to a specific content version |
| Student reflection or family observation | Saved as an attributed submission with restricted visibility; teacher acceptance is required before inclusion in approved instructional history or a plan |
| Shared family or student update | Approval and selection of the audience are explicit; delivery is separately tracked |
| Safety/help request | Preserve the dedicated escalation path; do not delay routing behind ordinary draft review |

Pending drafts may need durable storage for recovery, but they are not approved student history.
Define their retention, access, deletion, and audit treatment explicitly. This product distinction
does not itself settle the school's record-retention obligations.

Implement confirmation as an auditable decision and logging as an atomic publication of that
approved version. A failed publication must retry without duplicate records. Editing approved
content creates a new version requiring approval. Rejected or superseded content must not enter
future generation or analytics as a current fact.

## Architecture and migration

### New domain concepts

Names below describe responsibilities; finalize exact schema names during Phase 1.

| Concept | Responsibility |
|---|---|
| Learner key and protected identity link | Pseudonymous student reference independent of a case; identifying joins remain access-controlled and audited |
| Student profile | Role-specific view of approved strengths, observations, goals, strategies, and progress, usable without a plan |
| Class session | Section, teacher, date, school timezone, lesson topic/objective, and reusable context tags |
| Seating layout | Versioned positions and section membership; session snapshots prevent later rearrangements changing event context |
| Classroom event | Typed participation, praise, understanding, check-in, or behavior observation, with subject, session, source, context, confirmation, and revisions |
| Draft artifact | Typed content plus source references, audience, prompt/run provenance, revision, generation state, approval, and publication state |
| Contribution | Attributed student/family submission and educator response or acceptance, distinct from teacher observations |
| Follow-up task | Approved action with owner, due date, status, and links to the originating evidence or artifact |

Use typed schemas per event and draft kind rather than an unrestricted content blob. Separate
generation states such as queued/failed from review states such as suggested/approved/discarded.
Keep existing plan and candidate state machines; share provenance and review affordances without
forcing every workflow into one generic state machine.

Persist stable references internally for lineage. Outbound AI payloads must use an explicit
allowlist and the approved de-identification boundary; adding a learner key is not permission
to send persistent identifiers, names, or full student histories to a provider.

### Compatibility strategy

1. Add the new tables, references, policy functions, and routes through additive migrations.
   Keep existing case, plan, signal, and approval routes working during rollout.
2. Add protected learner links for existing students and link existing cases. Preserve original
   IDs, timestamps, authorship, and provenance. Do not synthesize historical teacher approvals
   for legacy student self-checks or other records that never had them.
3. Store new classroom events canonically in the event layer. Initially retain case-bound signals
   as the compatibility input to the existing pattern/review engine. Project only confirmed,
   eligible events when a teacher explicitly connects relevant history to a case.
4. Make projection idempotent with a unique source-event/revision and destination relationship.
   Define type/unit mappings and correction handling. Never count both an event and its projected
   signal, or convert praise, missing data, or an unmeasured note into a behavior count or zero.
5. Build student profile views over approved classroom events and existing support information.
   A shared learner identity must not automatically grant access to another teacher's private
   notes or another section's history; define this scope explicitly in policy.
6. Roll out per workspace behind a feature flag. Validate migration reconciliation and existing
   workflows on synthetic data. Rollback disables new entry points while preserving newly
   collected records; it must not depend on deleting data or reversing approvals.

If later evidence supports unifying event and signal storage, scope that migration separately.
An initial compatibility layer avoids changing every pattern rule while building classroom use.

## Phased delivery

### Phase 0 - Decisions and acceptance scenarios

Deliverables:

- Resolve Q1-Q4 before committing to record semantics, shared-history scope, or voice processing.
  Identify a teacher champion and initial grades 6-8 class, consistent with the blueprint.
- Write acceptance scenarios for a normal class, a student without a plan, a behavior observation,
  a mistaken student attribution, absent/late students, an AI failure, and a safety/help request.
- Confirm the vocabulary for initial taps and classroom indicators with educators. Prototype
  the seating-chart interaction and measure baseline time spent on current documentation.
- Record the chosen defaults in the domain/privacy specs and identify who signs off on each
  unresolved school-policy decision. Establish scope and staffing before estimating dates.

Exit: the first release scenario, approval semantics, data audience, and voice boundary have named
owners and documented decisions. Independent UI exploration may proceed while a decision is open;
dependent storage or provider work may not silently choose it.

### Phase 1 - Classroom foundation and approval

Primary areas: `packages/domain`, `packages/policy`, `apps/api/src/db`, API services/routes,
and the existing AI/job infrastructure.

Deliverables:

- Implement learner links, sessions, seating versions, typed events, draft provenance, and
  additive migration/compatibility behavior described above.
- Extend section/student permissions and role-specific serializers to work without a case.
  Audit new individual-record reads, identity joins, approvals, corrections, and sharing.
- Implement revision-aware confirmation and idempotent publication. Reject stale approvals,
  duplicate submissions, invalid goal/strategy links, and cross-section or cross-school access.
- Define discard, expiration, correction, and source invalidation behavior. Revalidate source
  eligibility before publication; mark dependent drafts stale after a material source correction.
- Specify draft/transcript retention and deletion behavior alongside append-only audit storage,
  including how audit metadata avoids unnecessarily retaining sensitive draft content.

Exit: a teacher can confirm a typed event for a student with no case; a draft cannot become
approved history without authorization; existing plans, access boundaries, and pattern results
remain intact after migration.

### Phase 2 - Live Class Pulse and voice capture

Depends on Phase 1. Voice processing additionally depends on Q4.

Deliverables:

- Replace the teacher landing experience with current-class selection, a seating chart and
  accessible roster alternative, recent activity, and compact capture controls. Keep a clear
  route to support work and pending decisions.
- Add participation, praise, understanding, check-in, and behavior actions with context defaults.
  Support correction/undo, keyboard and touch operation, multiple sections, and accessible status
  text. Context such as the lesson topic should be entered once per session.
- Add roster CSV import with preview, field validation, duplicate handling, and confirmation.
  Keep manual roster management. Imports must preserve existing student and family links.
- Add deliberate push-to-talk, recording indication, cancellation, transcript review, and explicit
  student attribution. Avoid background classroom recording and automatic speaker identification.
- Integrate an approved transcription path with minimum necessary retention, failure handling,
  access checks, and audit metadata. Text PII scanning happens after transcription and cannot
  protect an earlier audio upload; any external audio processing needs its own approved boundary.
- Introduce Pulsera branding and the proposed teacher destinations: Class Pulse, Students,
  Drafts, Tomorrow, and Support. Retain old deep links. Use blue, teal, and restrained violet
  within the existing component system, with primary capture actions visible on a phone.

Exit: a teacher can capture routine events and review a dictated observation during a class
without creating a case. Capture survives generation failures; retrying a save never duplicates
an observation. Desktop and phone walkthroughs verify the complete interaction.

### Phase 3 - Live-to-Draft and Tomorrow Ready

Depends on Phases 1-2. Deliver in two increments so the complete classroom loop is available early.

**3A - First usable Pulsera release**

- Add structured observation/ABC and positive-note drafts, a parent-message draft, and a
  next-class reteach or Do Now draft. Reuse the current provider gate, immutable prompt versions,
  guardrails, and evaluation/promotion workflow with new typed schemas and cases.
- Build a unified draft inbox with source evidence, version/diff, intended audience, edit,
  approve, discard, and defer. Drafts and pending counts must not expose hidden information.
- Generate from approved observations and teacher-supplied lesson context. Leave missing ABC
  components and unsupported claims missing. Distinguish reteach suggestions from measured mastery.
- Batch related events and deduplicate generation. Keep capture independent of model latency;
  provide meaningful queued, failed, disabled, and retry states.
- Start Tomorrow Ready with on-demand preparation and a teacher-configured schedule. Respect
  school timezone, class dates, weekends/closures, and source updates after a draft was prepared.
- Allow approved artifact copy/export. External message delivery is deferred; approving a
  communication draft does not send it or imply that a family received it.

Exit: open class -> record praise/participation -> dictate and confirm an observation -> inspect
and approve drafts -> receive a usable next-class activity and parent-message draft. Every output
has source provenance and a human approval trail.

**3B - Instructional and documentation breadth**

- Add teacher-entered or reviewed exit-ticket evidence, concept-level understanding, small-group
  suggestions, follow-up tasks, intervention-review reminders, and editable lesson assets.
- Add Pulsera Reports templates for SST/MTSS evidence and FBA-support observations. Preserve
  uncertainty, distinguish reports from determinations, and have an educator validate each
  template before pilot use. Existing approved support plans remain available throughout.
- Make Pulsera Guide contextual to the student, class, or artifact being reviewed. Begin with
  specific actions such as explain evidence, suggest an adjustment, and draft a next step.
- Require approval for new group assignments, support actions, or plan changes. Existing
  deterministic recommendations and sufficient-baseline rules continue to apply.

Exit: teachers can prepare tomorrow's activities, groups, and follow-ups and export approved
documentation without re-entering classroom evidence. No report invents missing observations,
diagnoses a student, or automatically finalizes a school decision.

### Phase 4 - Student and family collaboration

Depends on Phase 1 and the approval/source-lineage work in Phase 3. Existing portals remain usable
during earlier phases.

Deliverables:

- Make student and family profile navigation independent of case existence. Add multiple-child
  selection and define multi-section visibility using the approved policy from Q3.
- Put approved strengths and recent successes before goals in My Pulse. Retain reflections and
  progress, add choices among approved strategies, and let students propose changes or explain
  what helped. Progress rings must represent defined measures and handle insufficient data.
- Add optional, structured Family Pulse observations, including home strategies, homework,
  sleep, and mood where the school's collection policy permits them. Do not require sensitive
  home details or reinterpret them as teacher observations.
- Add educator acknowledgement/response and explicit acceptance into approved history. Keep
  correction requests and urgent help routing distinct from ordinary contributions.
- Draft support-plan revisions from eligible teacher, student, and family contributions. Show
  what changed and whose input informed it; use existing plan approval/versioning to apply it.
- Implement Classroom Memory as permission-scoped retrieval of approved, current history and
  observed strategy outcomes. Apply corrections, expiration, revoked access, and supersession
  before retrieval. Prefer existing relational queries until retrieval needs justify more.

Exit: a student and guardian can contribute, receive a response, and see their input reflected in
a teacher-approved revision. Restricted notes and hypotheses remain absent from their payloads.

### Phase 5 - Insights and pilot readiness

Operational preparation begins in Phase 0 and runs alongside the build. These requirements gate
any real-student pilot, even if that pilot starts before Phases 3B or 4 are complete.

Deliverables:

- Extend Pulsera Insights with participation coverage, instructional needs, outstanding
  follow-ups, and documentation completion. Show observation coverage and uncertainty; preserve
  small-cell and complementary suppression. Do not equate logging frequency with teacher quality.
- Retain intervention outcome tracking without presenting correlation as causal effectiveness.
  Keep model diagnostics and prompt management in administration settings.
- Validate roster import in the pilot. Select one further import/integration from actual school
  needs, with source mapping, duplicate handling, permission checks, and review of imported data.
- Complete retention/deletion/export behavior, access reviews, incident response, backup/restore
  checks, provider/subprocessor review, and school approval of data handling. Resolve how deletion
  affects derived artifacts, audit metadata, backups, and any stored source references.
- Review pattern thresholds and report templates with qualified educators; designate ongoing
  catalog owners. Review role permissions for school-specific support-plan decisions.
- Validate accessibility, browser/device support, intermittent network handling, workload, cost,
  and queue reliability with representative classes. Define support and recovery procedures.
- Add real billing only when paid rollout is in scope; until then the existing checkout remains
  explicitly simulated. Teacher/Team/School/District packaging is a separate product decision.

Exit: the agreed pilot workflow works with the school's access and data policies, produces useful
outputs, and demonstrates measured net teacher time saved. Readiness is not inferred from passing
automated tests or a demonstration-posture configuration change alone.

## Verification and release gates

| Area | Required evidence |
|---|---|
| Migration | Existing records and provenance preserved; no synthetic approvals; repeatable backfill; legacy workflows still work; feature rollback preserves new data |
| Policy | Role/field matrix and section, school, learner, multi-child, and shared-history isolation; draft visibility; revoked access; cross-subject references rejected |
| Confirmation | Exact-version approval, stale edit rejection, atomic publication, retry deduplication, and correction/undo behavior |
| Event semantics | No-plan capture; missing data distinct from zero; source authorship retained; event-to-signal projection does not double count |
| AI and voice | New prompt evals; unsupported-claim, PII, attribution, transcript failure, and source-correction cases; every external processing path covered by its approved boundary |
| Scheduling | School timezone, daylight-saving transitions, holidays, late evidence, concurrent/retried jobs, and AI-disabled behavior |
| UI | Complete teacher classroom scenario; existing support loop; student/family contributions; desktop and phone screenshots; keyboard/screen-reader checks |
| Pilot value | Capture time, end-of-class review time, usable-draft rate, correction burden, net time saved, and teacher willingness to keep using it |

Run the existing test, typecheck, lint, prompt-eval, and browser suites as appropriate to each
implementation change, adding focused coverage for new contracts. Browser tests and live evals
must use the designated synthetic test environment; the existing browser harness resets its
database. Measure usability with educators separately from automation.

Initial usability targets to validate with the pilot teacher: routine tap capture within roughly
three seconds and ordinary draft review within two minutes per class. These are proposed targets,
not measured results. Agree the minimum useful-draft rate and time-saved threshold before pilot
evaluation, and measure them against the Phase 0 baseline.

## Open questions

Recommendations are planning defaults, not settled decisions. Record the final choice, owner,
date, and affected specifications before starting dependent work.

| ID | Question | Recommended starting point | Decision owner / needed before |
|---|---|---|---|
| Q1 | What is a permanent record, and what may be stored before teacher approval? | Separate restricted pending submissions/drafts from approved history; define retention for each, including audit traces | Product owner + school data lead / Phase 1 |
| Q2 | Which actions count as teacher confirmation, and who may approve each artifact? | An explicit typed tap confirms only that observation; AI wording requires review; retain configurable support-plan approvers and separate sharing | Product owner + educator / Phase 1 |
| Q3 | Who can see history across classes, teachers, schools, and family relationships? | Section-scoped classroom evidence, student-scoped family links, explicit sharing of support history; no automatic access to all history for a learner | School lead + engineering / Phase 1 |
| Q4 | Where is audio transcribed, may it contain identifiers, and how long is it retained? | Deliberate short teacher recordings; approved processing boundary; minimum necessary audio retention; editable transcript and attribution | Product owner + school data lead + engineering / voice implementation |
| Q5 | Which teacher, class, devices, and deployment posture define the first pilot? | One grades 6-8 teacher champion; synthetic development and demonstrations until operational gates pass | Product owner + pilot school / Phase 0; posture approval before real data |
| Q6 | What exactly do taps and seating-chart indicators mean? | Observable participation, praise, understanding checks, and recent interactions; show absence of data explicitly | Pilot teacher / Phase 2 |
| Q7 | How much network interruption must capture tolerate? | Retry-safe online capture with visible pending state and recovery; decide whether local persistent drafts are permitted | Pilot school + engineering / Phase 2 |
| Q8 | Where do lesson context, exit tickets, grades, and attendance originate? | Session topic/objective plus reviewed teacher input initially; roster CSV first; choose one further integration from pilot needs | Pilot teacher + school systems lead / Phases 2-3B |
| Q9 | Which report templates and claims are appropriate? | Educator-reviewed ABC/SST/MTSS/FBA-support evidence templates; school-specific formal determinations stay outside automation | Support professional + school lead / Phase 3B |
| Q10 | What happens after an approved source is corrected or withdrawn? | Keep revision lineage; invalidate pending derivatives; queue approved derivatives for review; define external correction policy before delivery | Product owner + school data lead / Phase 1 foundation; Phase 3 outputs |
| Q11 | How much student/family contribution is useful without creating a second inbox burden? | Optional structured inputs, clear acknowledgements, bounded summaries, and separate urgent routing; validate access to sensitive home observations | Pilot teacher + student/family representatives / Phase 4 |
| Q12 | How long is classroom memory useful, and what proves a strategy helped? | Time-bounded approved history, evidence counts, and observed outcomes; educator-reviewed thresholds and explicit uncertainty | Educator + school data lead / Phases 4-5 |
| Q13 | When should Tomorrow Ready run and how much should it generate? | Teacher-selected schedule in school timezone, one next-class bundle, on-demand refresh, visible limits | Pilot teacher + product owner / Phase 3A |
| Q14 | What defines pilot success and affordable operation? | Agree time-saved, draft-usefulness, correction, latency, and per-class cost thresholds against a measured baseline | Product owner + pilot teacher / Phase 0 measurement; Phase 5 gate |
| Q15 | When do real delivery, billing, district hierarchy, and integrations become necessary? | Decide from committed pilot/paid-rollout requirements; maintain clear export-only and simulated-checkout states until implemented | Product owner + school buyer / expansion or paid rollout |

Related earlier questions remain in [07 - Open questions](07-open-questions.md). Consult
[08 - Implementation notes](08-implementation-notes.md) for decisions already made, such as
configurable plan approvers and guardian visibility into confirmed patterns; do not reopen them
without a concrete requirement that changes their applicability.

## Deliberately deferred items

| Item | Deferred until | Reason and boundary |
|---|---|---|
| Additional instructional/report types beyond the first classroom scenario | Phase 3B | Prove draft usefulness and review workload before broadening output volume |
| New student/family collaboration | Phase 4 | Preserve existing portals; build shared approval and source lineage first |
| Broader school analytics | Phase 5 | Needs meaningful classroom evidence and reviewed aggregation semantics |
| External email/SMS delivery and open-ended messaging | After draft/export pilot proves value and delivery policy is agreed | Adds recipient verification, sharing authorization, delivery status, retries, and correction handling |
| Continuous recording, passive surveillance, speaker recognition, and inferred emotion | Outside this plan | Documents call for teacher-confirmed events; these require a different product and privacy decision |
| SIS/LMS write-back, many vendor connectors, and automatic gradebook ingestion | A school-specific integration commitment | Start with practical reviewed imports; avoid unbounded integration work |
| District rollups and cross-school shared histories | A district pilot with explicit scope requirements | Additional identity, permissions, aggregation, and administration work |
| Real billing and expanded plan packaging | Paid rollout | Current checkout is simulated; operational approval remains necessary regardless of payment |
| Native mobile apps and full offline synchronization | Evidence that browser/retry support is insufficient | Local sensitive data, conflict handling, and device lifecycle substantially widen scope |
| Vector retrieval, autonomous agents, and model fine-tuning | Measured retrieval or quality limitations | Start with permission-scoped relational history and evaluated task-specific prompts |
| Autonomous diagnosis, placement, discipline, or formal educational determinations | Not planned | Preserve existing educational-support boundaries; reports provide evidence for human processes |

Privacy controls, accessibility, migration safety, provenance, and teacher approval are not deferred
past the release that introduces the relevant data or workflow. Operational requirements gate real
student use even when later product features remain deferred.

## Implementation handoff

Begin with Phase 0 decisions and a Phase 1 change covering one event type, no-case access policy,
confirmation, and migration compatibility. Then add the Phase 2 classroom interface and Phase 3A
outputs to complete the first usable scenario. Keep changes reviewable by delivering each event
or artifact through schema, API, policy, UI, and verification together.

For each completed phase, update [08 - Implementation notes](08-implementation-notes.md), the
affected domain/privacy/AI specifications, this plan's question register, and the README. Record
actual verification and pilot evidence separately from the proposed exit criteria above.
