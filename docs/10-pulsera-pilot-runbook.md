# Pulsera pilot runbook

Status: synthetic development only, 2026-09-30. This is an engineering procedure and evidence
register, not school approval. No teacher champion, school, audio provider or school-policy
sign-offs have been supplied. Plan 09 remains incomplete until its delivery and evidence gates
are satisfied. Nothing in this document authorizes entering real student data.

## Release evidence register

For every gate record the named owner, date, environment/build, evidence location, result and
reviewer. Keep student records and credentials out of this repository. Use restricted references
for school documents; do not paste their contents into audit metadata or model prompts.

| Gate | Current evidence | Needed before operational enablement |
|---|---|---|
| Engineering defaults Q1–Q3 | Product owner authorized synthetic defaults on 2026-09-30 | School data lead approves record classes, scopes, retention, deletion and portability |
| Pilot scope Q5 | No school/teacher supplied | Teacher champion, school owner, grades/class, devices, dates and support contact |
| Audio boundary Q4 | Disabled; no raw audio stored or uploaded | Named provider, approved processing boundary/retention, then voice implementation and failure/access tests |
| Automated regression | 172 tests; six workspace typechecks; lint; production web build | Re-run against the release commit; resolve material regressions |
| UI walkthrough | Six isolated walkthroughs; live desktop/phone screens, existing teacher loop, and classroom-to-family-to-plan flow passed across focused reruns in the designated synthetic environment | Clean release-build regression; representative browser/device and assistive-technology checks |
| Classroom model quality | V3 passed 15/15 live cases and UI evaluation/promotion; reports in `docs/evidence/`; new deployments start as draft | Selected deployment's passing evaluation/promotion and teacher usefulness review |
| Records lifecycle | Pending content expiry, correction lineage and artifact export implemented | Approved-record deletion/portability implementation after school policy; test effects on derivatives/backups |
| Access review | Automated role/section/learner and revoked-access tests | Named school reviewer signs actual membership/guardian links and approval roles |
| Recovery | Durable queue tests and additive migration tests | Restore drill and recovery timing in a separate synthetic database |
| Incident response | Procedure below | Named incident owner, school contacts and completed tabletop exercise |
| Provider review | Existing text gate; audio unavailable | School-approved service/subprocessor inventory and account configuration evidence |
| Educator validation | Synthetic templates and deterministic rules | Qualified reviewer signs each report template, pattern threshold and ongoing catalog owner |
| Roster/integration | CSV preview/confirmation and identity-preservation tests | Pilot roster reconciliation; school chooses and validates one further integration |
| Pilot value | No measured results | Baseline and post-use workload, correction burden, usefulness, cost and teacher willingness |

A checked box or a demonstration configuration change is not evidence. The application currently
rejects operational Pulsera enablement even if the workspace flag is set. Enabling operational
use requires a separate reviewed release after the outstanding policies and implementations.

## Synthetic release verification

1. Use an isolated synthetic workspace. Confirm its database and Clerk development instance;
   never point the E2E harness at the main database. The existing full browser harness resets
   its configured E2E database. Record the destination before starting it.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run e2e:pulse`.
   The isolated Pulse suite uses intercepted API responses and needs no credentials. Record
   the commit/build and outputs, not merely the commands.
3. In the designated live synthetic environment, run the existing full browser suite. Walk the
   new teacher, student and family workflows with real authentication and API responses too;
   isolated component passes do not establish this integration.
4. Run `classroom_draft.v3` evals through Administration → Prompts with the intended provider/model.
   Inspect failed cases, re-run after fixes, then promote the version through the gated action.
   Never edit immutable released prompt bodies; introduce a new version instead.
5. Reconcile migration counts and identity links before/after: student IDs, case IDs, authors,
   timestamps and legacy approval counts must be preserved. Existing learners must not acquire
   synthetic historical approvals. Confirm a second backfill creates no duplicate learner links.
6. Enable Class Pulse in School structure for the synthetic workspace and set the school timezone.
   Capture without a case; confirm and correct attribution; approve, explicitly share, then remove
   a communication from a portal; prepare Tomorrow; contribute from two linked children; approve
   a sourced plan revision; withdraw the source and verify its dependent review is blocked.
7. Disable the workspace feature. Verify new entry is blocked and records remain in the database.
   Re-enable in the same synthetic environment and verify current eligible records remain usable.

## Access review

The school reviewer and application administrator review People & access, section assignments,
family/student links, pending invitations and time-limited individual access grants. Confirm each
assignment has a current school purpose and a named owner. Revoke obsolete assignments through
the supported UI, then verify with the revoked user's session: no former section history,
contributions, portal shares, drafts or protected learner joins remain accessible. Review
`PLAN_APPROVER_ROLES` with the school; a teacher's classroom authorship does not imply authority
to make every support-plan decision. Repeat at staff changes and the school-agreed interval.

## Recovery drill

Use a separate synthetic database and deployment. Do not restore over a running school database.
The deployment owner first records the approved recovery-point and recovery-time objectives,
backup source and restore destination. Provider-specific restore steps must be verified against
the chosen service and account settings when executing the drill.

1. Create synthetic fixtures containing an existing plan, confirmed/pending events, an approved
   shared artifact, an unapproved edit, accepted/pending contributions, a follow-up and queued job.
   Record content-free IDs, counts, versions and expected access results.
2. Take the approved backup, record its cutoff, and restore to the isolated destination. Keep
   outbound model processing disabled and prevent schedulers/workers from contacting users or
   providers until verification. This product currently has no external message delivery.
3. Apply only the release's additive migrations. Verify identity links, approval versions,
   immutable audit records, source references, expiry and role isolation against the fixture.
   Apply the school's deletion/expiry replay procedure before any restored records are accessible.
   That school procedure is still outstanding; a backup must not resurrect deleted records.
4. Start one test worker. Verify queued work completes once, retries do not duplicate publication,
   and failed/disabled generation leaves capture usable. Queue claims have a 15-minute lease
   renewed every minute by the owning handler, with ownership tokens fencing old completion writes.
   Stop old worker binaries before deploying migration 0015. Observe abandoned-work recovery and
   idempotent effects after a database outage longer than the lease; do not reset all running jobs.
5. Record actual restored cutoff, recovery duration, mismatches and reviewer decision. Do not
   declare backup readiness from a successful connection or application startup alone.

## Failure and incident response

Assign a deployment operator, school incident lead and backup contact before pilot use. Store
contact details and any school notification rules outside this public repository.

For failed generation, teachers can keep capturing and see the failed/disabled draft state.
The operator inspects Administration model diagnostics/jobs by ID, confirms provider availability
and prompt promotion, then uses the supported retry. Repeated failure requires investigation;
never bulk approve drafts or disable evidence checks. Record latency, attempts and failure type
without copying student text into general logs.

For a suspected access or processing incident, the operator records discovery time and affected
workspace/build, disables Pulsera for that workspace, and disables outbound AI if the provider
boundary is implicated. Preserve access/audit and egress metadata; do not erase evidence or paste
payloads into tickets. The school incident lead determines scope, contacts and required action
using the school's approved response policy. Revoke affected access, rotate compromised keys
through their owning service, fix the defect and run scoped regression tests. Reopening requires
documented school/engineering review. No automatic family notification is implemented.

For mistaken attribution, the teacher corrects or withdraws the source in Class Pulse. Verify
drafts, projections, pattern interpretations, follow-ups, shared communications and reviews no
longer use the old version. Approved plans require a named educator's source review. Exported
files cannot be recalled by the application; the school must define external correction handling
before relying on exported records. Urgent help uses the separate help inbox and school urgent
procedures; it is not a continuously monitored emergency service.

## School record policy worksheet

Before implementing operational deletion/portability, the school data lead must specify for each
record class: purpose, permitted readers, retention trigger/duration, correction process,
deletion/hold rules, export audience/format, audit treatment, backup expiry and provider handling.
Cover identified roster/links; sessions and seating snapshots; confirmed and pending observations;
artifact revisions/publications/shares; contributions/responses; help requests; follow-ups;
support plans/goals/strategies; projections/candidates/reviews; provider payloads; and audit/jobs.

Current engineering defaults erase unapproved classroom text after 30 days, retain exact new
classroom provider payloads separately for 30 days, and retrieve current confirmed history for
120 days. Contribution acceptance extends content expiry by 120 days, while memory still limits
submission age to 120 days. Approved records, help content and content-free lineage await the
school policy. Artifact export is not a complete learner portability export. Do not advertise
complete deletion, portability or approved operational retention from the current cleanup job.

## Pilot measurement and usability worksheet

The teacher and product owner first agree which class/workflow is being measured. Record the
baseline class duration, manual capture/documentation/preparation time and observation coverage.
For the pilot record routine capture time, review time, preparation time, drafts reviewed/used,
corrections, failed saves/retries, end-to-end latency and model calls/cost per class. Net time saved
equals baseline work time minus capture, review, correction and preparation time using Pulsera.
Report missing measurements and sample size. Do not equate more logged events with teacher quality.

Proposed targets from plan 09 are approximately three seconds for a routine tap and two minutes
of ordinary draft review per class; these are not measured outcomes. Agree usefulness, cost and
time-saved thresholds before evaluation. Include keyboard-only and screen-reader users, focus
order/dialog dismissal/error announcements, phone touch targets, browser zoom, high contrast,
multiple sections/children, AI-off and interrupted-network scenarios. The current browser suite
checks keyboard selection and layout; it does not establish assistive-technology conformance.

Record teacher willingness to continue and review burden from contributions/help separately.
Have a qualified educator validate each report template and each pattern threshold. Choose the
additional import from an actual school need, documenting source fields/units, stable IDs,
duplicate/update semantics, permissions, previews and reconciliation before implementing it.
