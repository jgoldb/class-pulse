# 04 — Privacy and access control

The source assignment is explicit: *"Information submitted to the LLM should be de-identified and
minimized whenever possible"* and *"Do not assume that the LLM itself provides those controls."*
That second sentence is the design instruction. The prompt asks for de-identification; the
architecture has to guarantee it.

## Two data planes

```
┌─ IDENTIFIED plane ─────────┐        ┌─ WORKING plane ──────────────────┐
│ Students, roster,          │ ←────→ │ Cases, intakes, plans, signals,  │
│ names, IDs, guardians,     │  link  │ patterns — keyed only by          │
│ demographics               │  table │ pseudonymous caseKey              │
│ Narrow access, fully       │        │                                   │
│ audited                    │        └──────────────┬────────────────────┘
└────────────────────────────┘                       │
                                              EGRESS GATE
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │  LLM provider   │
                                            └─────────────────┘
```

Identifying data and case content never live in the same row. Joining them requires the link
table, which is itself access-controlled and audited. Most of the application — including the
entire pattern engine — operates only on the working plane and never needs a name.

Demographic attributes live exclusively in the identified plane and are unreachable from
detection rules and prompt construction. That is simultaneously a privacy control and the equity
guardrail from [02](02-pattern-engine.md).

## The egress gate

**One function.** Every outbound model call goes through it, and that is enforced by making it
the only module in the codebase permitted to import the provider SDK (lint rule + code review).

It does four things:

1. **Allowlist serialization.** Only named fields are serialized into a request. A schema-driven
   builder, never `JSON.stringify(entity)` — so a field added to a table later cannot silently
   ride along on the next deploy.
2. **PII scan** of free-text fields: names, student IDs, dates of birth, addresses, contact
   details. On a hit, block and return the span to the caller.
3. **Provider posture**: zero retention, no training on inputs, region pinned. A DPA covering the
   subprocessor before any real student data exists.
4. **Egress log**, written to the working plane: exact payload, prompt version, model, timestamp.
   So you can *prove* what left, rather than assert it.

### Catch PII at the keyboard, not at the gate

The gate is a backstop; it produces a frustrating dead end if it is the first time a teacher hears
about the problem. Run the same detector live in the intake form and the quick-entry field, and
offer an inline fix: *"This looks like a student name. Remove it? Class Pulse works without it."*

Teachers type names out of habit, from every other tool they use. Design for that instead of
punishing it.

## Access control: three enforced layers

Model output is advice. Authorization is code. Section 13 of the generated plan ("Information
That Should Not Be Displayed") informs the policy at design time and never gates a request at
runtime.

**1. Row scope.** Which students can this user touch at all? Postgres row-level security, or a
single policy layer the ORM cannot bypass. Roles are *scoped*, never global — a teacher's role is
per-section, a parent's is per-child, a support professional's is per-assigned-student.

**2. Field visibility.** A declarative map, `field × role → visible | redacted | aggregate_only`,
living in the `policy` package as pure functions with exhaustive unit tests. Derived from the
source document's section 13:

| Surface | Must never receive |
|---|---|
| Teacher | Students outside their assignment |
| Student | Other students; confidential teacher notes; administrative content; raw pattern candidates |
| Parent/Guardian | Other students; unnecessary confidential classroom detail |
| Administration | Individual student records where aggregate suffices, or where individual access is neither authorized nor necessary |

**3. Serialization.** Each dashboard reads from a role-specific view model, so a parent endpoint
is structurally incapable of returning a hidden field. Never ship the full object to the client
and hide fields in CSS.

Privacy bugs are the expensive ones, so the policy layer is pure, dependency-free, and tested
without a database.

## Aggregation safety

Administrative views are aggregate by default. Apply a minimum cell size (start at n=10) with
suppression below it, and suppress complementary cells so totals cannot be differenced back to an
individual. In a small school, "3 students in 7th grade flagged for attendance" identifies
someone.

Individual access by an administrator requires an explicit `AuthorizationRecord` — who authorized
it, for which student, why, and for how long — and writes an audit event.

## Who may grant access

Two people can widen someone's access, and the difference between them is the point.

An **administrator** invites into any scope in their school: teachers onto sections, support
professionals onto students, other administrators, and families. Those are the roles that cost an
educator seat or carry school-wide reach, so they belong where a school's own authority sits.

A **teacher** shapes their own class: the sections they teach, the students on those rosters, and
the guardian and student accounts for those children. Nothing wider — no staff role, no second
section that isn't theirs, no student in someone else's room. A teacher who signs up alone is
therefore a working product on their own, without waiting for a central office to build a roster
they already know by heart.

Family and student accounts are free and always have been: plans sell educator seats, and a
parent or a child is never one. Treating the family's dashboard as a purchase would be the wrong
incentive on the one surface where transparency is the product.

Both paths issue the same scoped `invitations` row and both write the same `authorization.grant`
audit event; the actor's role on that event is what distinguishes them afterwards.

## Audit

Append-only. Every read of individual student data, every plane join, every egress call, every
authorization grant, every approval transition. Immutable storage, retained per policy, reviewable
in the admin surface.

If you cannot answer "who looked at this student's record, and when," you do not have a system a
district can adopt.

## Student and family transparency

Beyond the legal minimum, and worth building deliberately:

- A parent can see that a plan was AI-drafted and who approved it
- A parent can see which pattern candidates were confirmed for their child, in plain language
- An accessible correction path when a family disputes recorded information
- Plain-language explanation of what data is collected and why

This is also good product design: the fastest way to lose a school is a family that feels
something happened to their child behind a screen they were never shown.

## Deferred, but on the map

Retention and deletion policy per record type. Data-portability export. Incident-response
runbook. Subprocessor inventory. Annual access review. Required for the operational posture in
[00](00-overview.md); explicitly deferred for the demonstration posture.
# Pulsera development decisions (2026-09-30)

The requesting owner approved the plan's Q1–Q3 defaults for synthetic development. Pending
classroom text is restricted to the author with a current teaching assignment in its section.
Co-teaching, case access, and a shared learner key do not expose another educator's private
classroom records. Families, students, and administrators do not receive classroom drafts.
Roster and learner identity joins are audited. Confirmation and correction audit entries contain
IDs, versions and actor metadata rather than copies of observation/draft text.

Workspace rollout is disabled by default. An administrator responsible for every school in the
workspace may enable it only in demonstration posture with synthetic learners. Disabling removes
entry points and blocks capture while preserving records. School timezone is explicit and is
snapshotted into each session.

Synthetic development uses a 30-day expiry for unapproved event and artifact text and a 120-day
window for evidence used in classroom drafting. The cleanup service removes expired unapproved
content and removes associated expiring provider-payload text, while preserving approval and audit metadata.
New classroom egress metadata remains append-only and contains a hash/reference; the exact
payload is retained separately for 30 days. Existing egress and audit immutability are unchanged.
Previously published records remain subject to the future school retention decision. These are
engineering defaults, not approved school retention rules. No persistent browser storage or raw
audio storage is used. External transcription remains unavailable until Q4 is approved.

No school, teacher champion, approved audio provider, or school-policy sign-offs have been
supplied. Operational privacy review, backup/restore evidence, approved-record deletion/export,
and school retention decisions are still real-student pilot gates.

Contributions are private to their author and selected currently assigned teacher. Authors need
a current student/guardian relationship; teachers need the section assignment and current learner
enrollment. Acceptance admits the exact version into that teacher's memory, with the reporter
role retained. Corrections, withdrawal, expiry and revoked relationships remove eligibility.
Pending contributions expire after 30 days; accepted contribution content expires 120 days after
acceptance, and memory additionally limits retrieval to submissions from the last 120 days.
Sensitive sleep/mood collection is unavailable pending a school's collection policy.

Families and students see only current approved communications explicitly shared to their
audience, plus their existing role-filtered support information. Portal sharing is reversible and
does not imply external delivery or receipt. Help requests are routed separately without approval
or AI; their acknowledged status is not a guarantee of emergency monitoring. Their eventual
retention belongs in the school's approved-record policy.

Cleanup includes withdrawn/superseded unconfirmed event revisions, unapproved artifact revisions
even when a prior version was published, and pending classroom-informed plan revisions. Approved
versions and audit metadata remain preserved. Content-free retry receipts prevent old requests
from resurrecting expired submissions. Source retirement invalidates dependent drafts, projected
signals, candidate interpretations and review narratives; approved actions are flagged for human
review rather than silently rewritten. Approved artifact exports include protected display names
and source times only after authorized reads; classroom provider payloads never include those joins.

Insights return fixed aggregate categories only, with small-cell and complementary suppression;
there are no learner names, free-text dimensions or individual drilldowns in the new endpoint.
See [10 - Pilot runbook](10-pulsera-pilot-runbook.md) for the operational evidence still required.
