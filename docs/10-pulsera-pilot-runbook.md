# Pulsera pilot runbook

Status: synthetic development only, updated 2026-10-01. This is an engineering procedure and evidence
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
| Audio boundary Q4 | Voice implemented behind a recorded school approval (Administration → School structure → Voice capture); off until recorded. Audio is never stored; egress log keeps size and hash only. Live end-to-end transcription verified 2026-10-01 with a synthetic recording, approval withdrawn afterwards | The school's named official approves the provider and policy; that approval is recorded in the app |
| Automated regression | 189 tests (16 files) including the incident drill and backup round trip; six workspace typechecks; lint | Re-run against the release commit; resolve material regressions |
| UI walkthrough | Twelve isolated walkthroughs at desktop, tablet and phone, each with an axe WCAG 2 A/AA scan (no serious or critical findings); live navigation and classroom-to-family-to-plan flow on a fresh seed | Representative device and screen-reader sessions with real users |
| Classroom model quality | V4 passed 17/17 live on suite classroom.v3 (an earlier run 16/17); reports in `docs/evidence/`. The registry activates it on boot where no administrator-chosen version is active | Teacher usefulness review |
| Records lifecycle | Per-school retention windows (pending text, memory window); learner record export (JSON) and erasure on request, with derived drafts removed and counts-only audit; tested | School data lead sets the windows and approves the erasure procedure |
| Access review | Automated role/section/learner and revoked-access tests | Named school reviewer signs actual membership/guardian links and approval roles |
| Recovery | Logical backup/restore (`npm run db:backup` / `db:restore`) with a tested round trip; restore drill 2026-10-01 (local → emptied e2e branch, 855 rows, spot counts identical) | Agreed RPO/RTO and a drill against the production provider's point-in-time recovery |
| Incident response | Procedure below; automated drill (`apps/api/src/incident-drill.test.ts`) rehearses containment, evidence preservation and reconstruction | Named incident owner, school contacts and a tabletop exercise with them |
| Provider review | Text and audio both pass the egress gate and log; audio approval names provider and policy | School-approved subprocessor inventory and account configuration evidence |
| Educator validation | In-app template validation per school by a support professional or administrator; reports show the status | The school's qualified reviewer validates each template and pattern threshold |
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
4. The evaluated classroom prompt (`classroom_draft.v4`) is activated by the registry on boot. To
   change it, add a new version, run `npm run evals:classroom` with `EVAL_PROMPT_VERSION`, check
   in the passing report, then mark it active in the registry or promote it in Administration.
   Never edit immutable released prompt bodies; introduce a new version instead.
5. Reconcile migration counts and identity links before/after: student IDs, case IDs, authors,
   timestamps and legacy approval counts must be preserved. Existing learners must not acquire
   synthetic historical approvals. Confirm a second backfill creates no duplicate learner links.
6. Class Pulse is on for synthetic workspaces; set the school timezone in School structure.
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

### Logical backup and restore (2026-10-01 drill)

`npm run db:backup -- --target <local|e2e>` writes every application table to `backups/` as JSON
(gitignored: it contains learner data). `npm run db:restore -- --target <local|e2e> --in <file> --yes`
loads it into an empty, migrated database in foreign-key order and refuses a non-empty one. The
round trip is covered by `apps/api/src/backup.test.ts`. Drill on 2026-10-01: backed up the local
database (53 tables, 855 rows), emptied the e2e branch, restored, and compared students, events,
drafts, plans and audit rows directly on both branches; all matched. The production deployment's
provider point-in-time recovery remains the primary backup; drill it separately with agreed
recovery objectives.

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

### Automated incident drill

`apps/api/src/incident-drill.test.ts` rehearses three steps on every test run: containment (model
switched off: no egress, capture continues, refused attempts still logged — including voice),
preservation (audit and egress rows reject UPDATE and DELETE at the database), and
reconstruction (an administrator retrieves the incident window from the audit trail, which holds
identifiers and counts, not classroom content). A tabletop with the school's incident lead is
still required before pilot use.

### Voice capture approval

Voice stays off until an administrator records the school official's approval: provider, the
official's name and role, and the policy reference. The record and its withdrawal are audited.
While approved, a teacher records at most a minute by deliberate push-to-talk with a visible
recording state and cancel; audio is held only in memory for the transcription call; the egress
log stores the audio size, type and hash, never the audio; the transcript returns for editing, the
teacher selects the student, and saving uses the normal observation path (source: reviewed
transcript). Names in transcripts are flagged and rejected on save. No speaker identification.

## School record policy worksheet

Before implementing operational deletion/portability, the school data lead must specify for each
record class: purpose, permitted readers, retention trigger/duration, correction process,
deletion/hold rules, export audience/format, audit treatment, backup expiry and provider handling.
Cover identified roster/links; sessions and seating snapshots; confirmed and pending observations;
artifact revisions/publications/shares; contributions/responses; help requests; follow-ups;
support plans/goals/strategies; projections/candidates/reviews; provider payloads; and audit/jobs.

Each school sets two windows in School structure: how long unapproved text is kept (default 30
days; drafts, pending observations and contributions expire at it) and the classroom-memory window
(default 120 days; older approved history is not retrieved for drafts, evidence or profiles).
Provider payloads are kept 30 days. Learner records → Export produces a JSON record of one
learner's confirmed observations, attributed contributions and approved artifacts; Erase removes
that learner's classroom observations, contributions, help requests, seat positions and drafts
derived from their observations (including shared group drafts), retires projected case signals
and keeps a counts-only audit entry. Support-plan records and backups follow their own
retention; a restore must re-apply erasures recorded after the backup's cutoff. The school data
lead approves these settings and procedures before operational use.

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
multiple sections/children, AI-off and interrupted-network scenarios. The isolated browser suite
runs axe WCAG 2 A/AA scans on Class Pulse, Drafts, Tomorrow, Students, My Pulse and Family Pulse at
desktop, tablet and phone sizes and fails on serious or critical findings; Class Pulse supports
keyboard capture (letters, arrows, Esc, ?). Automated scans do not replace sessions with
screen-reader users.

Record teacher willingness to continue and review burden from contributions/help separately.
Have a qualified educator validate each report template and each pattern threshold. Choose the
additional import from an actual school need, documenting source fields/units, stable IDs,
duplicate/update semantics, permissions, previews and reconciliation before implementing it.
