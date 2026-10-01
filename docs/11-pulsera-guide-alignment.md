# 11 — Pulsera guide alignment

Tracks `Pulsera_GitHub_to_Vision_Implementation_Guide.docx` (sections A–U) against the
repository. Updated 2026-10-01. Every section is implemented; "verified" names the automated test
or the live/browser check that covers it. Steps that only people can take (a pilot teacher's
judgement, a school's sign-off) are listed separately at the end — the product now has the
mechanism for each of them, but recording the decision is theirs.

| Guide section | Status | Where | Verified |
|---|---|---|---|
| A. Teacher experience | **Done** | `/teacher` opens Class Pulse: live seating chart with per-student indicators, seven-action dock, keyboard capture (P S U C B N V, arrows, Esc, ?), session context carried automatically, editable quick-pick wording per teacher | Isolated walkthroughs (3 sizes); live e2e; vocabulary API tests |
| B. Live-to-Draft | **Done** | Feed offers the guide's action → draft mapping, including a dedicated support recommendation for check-ins and notes | Live model drafts (positive note, ABC); pulse tests |
| C. Teacher Confirm | **Done** | `TeacherConfirm` stepper everywhere; exact-version approval; audit trail | Pulse tests; walkthroughs |
| D. Draft Inbox | **Done** | Six categories; what happened / what Pulsera drafted / approved record; Edit, Approve, Defer, Discard; bulk review that approves each exact version, teacher-only | Bulk-decision test; walkthroughs |
| E. Voice capture | **Done (approval-gated)** | Push-to-talk ≤ 60 s, visible recording and cancel, transcription through the egress gate (audio never stored), transcript review, explicit student choice, source "reviewed transcript"; off until a school approval is recorded | Voice API tests; live end-to-end transcription with a synthetic recording |
| F. Tomorrow Ready | **Done** | `/teacher/tomorrow` bundle: Do Now, reteach, small groups, family drafts, reminders, intervention reviews; on-demand and scheduled preparation in the school's timezone | Bundle test; live preparation through the model; walkthrough + axe |
| G. My Pulse | **Done** | Strengths first, goals with progress rings over the learner's own check-ins (explicit insufficient-data state), strategies the student can choose, reflections, attributed contribution history | Screenshot review; walkthrough + axe |
| H. Family Pulse | **Done** | Goals, growth and "coming up"; home observations incl. sleep and mood under a school collection setting; attribution; multiple children; per-item visibility (teacher only / teacher and student); educator responses | Family policy/visibility tests; walkthrough + axe |
| I. Collaborative Support Plan | **Done** | Teacher, student and family input drafted into educator-approved plan revisions with provenance | Plan-revision tests; live e2e |
| J. Behavior & intervention intelligence | **Done** | ABC/SST/MTSS/FBA-support, deterministic patterns with adjudication and insufficient-data/confounder display, support recommendations, intervention history on the student profile | Pulse tests; pattern suite |
| K. Pulsera Reports | **Done** | Generate → Review → Edit → Approve → Export (text and print/PDF with source history) from a learner's history across sessions; per-school template validation shown on every report | Template-validation and cross-session tests |
| L. Pulsera Guide | **Done** | Contextual from a draft, a student (explain, adjust, next step, support options) and the class (small groups, prepare Tomorrow); never bypasses approval | Cross-session test; screenshots |
| M. Insights | **Done** | `/admin/insights`: participation patterns with weekly trend, check-in coverage, follow-up needs, documentation completion, instructional checks; suppressed, no drill-down | Insights suppression test |
| N. Brand & navigation | **Done** | Pulsera mark and blue → teal → violet palette; classroom-OS landing page; Clerk screens say Pulsera; product names on surfaces | Screenshots; contrast scans |
| O. Data & architecture | **Kept** | Additive migrations 0016–0021; no new services or frameworks | — |
| P. Privacy, safety, trust | **Done** | Approval gates, provenance, audit, visibility; per-school retention; learner export and erasure; logical backup/restore; incident drill; accessibility scans; voice gated | Retention/erasure tests; backup round trip + drill; incident drill; axe |
| Q. Do not rebuild | **Respected** | — | — |
| R. File checklist | **Done** | Every listed area changed as described; `QuickEntry.tsx` stays the case-bound counter reached from a case | — |
| S. Acceptance criteria | **1–14 met** | See rows above; 14 is met by the approval gate (voice cannot run without a recorded approval) | — |
| T. Build order | **Phases 1–6 implemented** | Phase 6's external items are listed below | — |
| U. Definition of done | **Met in the product** | A teacher can keep Class Pulse open, capture with taps, keys or voice, review drafts, approve only what is accurate, and leave with documentation, next steps, family drafts and Tomorrow materials | Live e2e; screenshots |

## Steps only people can take

These are decisions, not features. Each one has a place in the product where it is recorded.

| Step | Who | Where it is recorded |
|---|---|---|
| Approve an audio transcription provider | School official (recorded by an administrator) | School structure → Voice capture |
| Validate each report template | Support professional or administrator at the school | Report templates |
| Set retention windows and approve erasure | School data lead | School structure → Retention policy; Learner records |
| Refine quick-pick wording | Pilot teacher | Class Pulse → More → Edit quick-pick wording |
| Allow or disallow sleep/mood collection | School | School structure → Collect family sleep and mood observations |
| Run a tabletop incident exercise and a production restore drill | School incident lead, deployment operator | docs/10 evidence register |
| Measure net time saved in a real class period | Pilot teacher, product owner | docs/10 pilot measurement worksheet |
