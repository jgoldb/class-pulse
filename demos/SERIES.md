# Class Pulse demo series — coverage and plan

The first ten videos (`01`–`10`) are a tour: one pass over the product, ~50 seconds each. They
leave a lot out. This file is the audit of what is missing and the plan for a second tier of
deep-dive videos, 2–5 minutes each, so that every page, every control and every role surface is
demonstrated somewhere.

Audit done against `apps/web/src/App.tsx` (routes), every page component's mutating calls, and
the API route table in `apps/api/src/routes/`.

The rendered videos are not in this repo — they are ~170 MB of mp4 and live in shared storage.
This file is the map; the numbered titles below are the filenames there.

---

## 1. What the first ten already cover

| Route / feature | Where |
|---|---|
| `/` landing | 01 |
| `/get-started`, `/checkout/:id`, paid `/sign-up`, `/onboarding` (paid) | 02 |
| `/admin/structure` (add section, add student) | 03 |
| `/admin/people` (invite with scope, grant individual access) | 03 |
| `/teacher` Today | 04, 05 |
| `/teacher/intake` + identifier catch at the keyboard | 04 |
| `/teacher/drafts/:id` — accept-everything path, approve | 04 |
| `/teacher/cases/:k/log` quick entry (desktop) | 05 |
| `/teacher/cases/:k` Progress tab | 05 |
| `/teacher/patterns`, `/teacher/candidates/:id` — confirm, seed a strategy | 06 |
| `/teacher/reviews`, `/teacher/reviews/:id` — agreeing with the computed result | 07 |
| `/support` cross-case, Data quality tab, support queue (empty) | 08 |
| `/student`, `/family`, `/teacher/requests` | 09 |
| `/admin` overview, catalog (read), equity, prompts (read), audit (read) | 10 |

## 2. What is missing

**Public and access**
- `/sign-in` on camera, including the new-device code. Every sign-in so far was off camera.
- The invited person's path: Clerk invitation link → `/sign-up?__clerk_ticket=…` ("You have been
  invited") → lands in the surface their role and scope fix. Video 03 sends an invitation; nobody
  ever accepts one.
- `/onboarding` for a signed-in person with no invitation ("your account isn't in a workspace yet").
- `/sign-up` with no checkout and no ticket (the "invitation-based" copy).
- Signing out.

**Teacher**
- `/teacher/cases` — the whole page. Search box and the All / Active plans / Under review / Drafts
  filter have never been on screen.
- Case **Plan** tab — the approved sixteen-section plan as a reader sees it.
- Case **Patterns** tab and its **Re-evaluate** button (`POST /cases/:k/sweep`).
- Case **Data quality** tab from the teacher's own surface (08 showed it as the specialist).
- **Review now** — opening a review cycle early from the case page.
- Safety-concern banner and **Acknowledge — procedure followed**.
- **Recent notes** panel (free-text notes, never shown to students or families).
- `/teacher/cases/:k/print` — the print/PDF plan for a family meeting.
- Draft review, everything except the happy path: **Edit** a section as structured data with a live
  preview, **Reject**, the "rejected sections still ship unless you edit them" warning,
  **Regenerate**, **Discard**, a `needs_attention` draft with its guardrail findings listed, and the
  second-model check line (causal claims, hypotheses-as-fact, stigmatising, out of scope).
- Intake: the "this student already has a case" callout.
- Quick entry: the **note** field with its own identifier guard, and **More chips**
  (assessment type, period).

**Pattern engine**
- Adjudicating any way other than confirm: **dismiss** with the reason that tunes the rule,
  **needs more data** with what to collect and how many more observations, **escalate**.
- Seeding a **goal** (06 seeded a strategy).
- **Reinterpret** (`POST /candidates/:id/reinterpret`).
- A candidate that routes to the **support team** and therefore gets no intervention proposals at
  all — `attendance-performance-coupling` is `piloting` and routes that way.
- The full loop of Data quality → log what is missing → Re-evaluate → a new candidate appears.
  `time-of-day-clustering` currently needs entries on one more distinct day.

**Review cycles**
- Disagreeing with the computed recommendation, which makes a rationale mandatory.
- The decisions other than "collect more": continue, modify, seek support, fade.

**Student**
- Switching between goals; the accomplishments list in detail.
- Actually raising the help flag (09 only hovered it), and the teacher's side of it.

**Family**
- A correction request answered in a way the family can read back; the request lifecycle.

**Administrator**
- Catalog: **activate** a piloting rule with a named reviewer, **retire** one, and the
  thresholds / confounders / written proxy review behind each rule. Six of eight rules are
  `piloting` right now, so this is real.
- Prompts: create a new version with a changelog, be **refused** promotion without a passing eval
  run, **Run evals** against the real model, then promote. Plus "where educators rewrite the
  draft" (the aggregated draft-to-approved diff).
- People: the directory, **revoke an invitation**, **revoke an individual authorization**.
- Audit: filtering by action, case and student — and seeing the events the rest of the video just
  generated.

**Cross-cutting, never shown at all**
- The command palette (⌘K).
- Dark mode and the theme toggle.
- The phone layout: bottom tab bar, the navigation sheet, and quick entry as it was actually
  designed (phone-first).
- Scope isolation between two teachers — Luis Ortega cannot see Dana Whitfield's students.
- The same case seen as teacher, student, family and administrator, side by side, to show what
  each role's payload leaves out.

**Added since this audit** (Sept 20 2026, covered by 04–06)
- A teacher buying the Classroom plan and setting up their own class instead of a school
  (`/onboarding` teacher option), `/teacher/class` — sections, roster, family and student access —
  and the same access card on the case Overview.

**Has no UI at all** (worth knowing, not filmable)
- `GET /api/admin/egress` — the egress log. "Every outbound call is logged" is a headline claim on
  the landing page and there is no screen for it.
- `GET /api/admin/jobs` — the job queue.
- `POST /api/plans/:id/transition` — plan state machine, API only.

---

## 3. The finished series: thirty-four videos in one order

One numbered run, grouped by who is watching and what they are trying to do. The ten already made
are marked **done**. All thirty-four are now recorded. Each is about a minute, except 32, which carries both a failed and a passing eval run.

### Part 1 — What it is, and getting a school onto it
| # | Title | Role | State |
|---|---|---|---|
| 01 | Meet Class Pulse | public | **done** |
| 02 | Starting a Workspace | new customer | **done** |
| 03 | Setting Up Your School | administrator | **done** |
| 04 | A Class of Your Own | teacher, signing up alone | **done** |
| 05 | Your Own Roster | teacher | **done** |
| 06 | Letting the Family In | teacher | **done** |
| 07 | Getting In | invited teacher | **done** |
| 08 | Who Sees What | four roles | **done** |

### Part 2 — The teacher's core loop
| # | Title | Role | State |
|---|---|---|---|
| 09 | From an Observation to an Approved Plan | teacher | **done** |
| 10 | What the Guardrails Caught | teacher | **done** |
| 11 | Changing the Draft | teacher | **done** |
| 12 | Finding Your Way Around | teacher | **done** |
| 13 | The Case File | teacher | **done** |
| 14 | Fifteen Seconds, and What It Adds Up To | teacher | **done** |
| 15 | Quick Entry in Full | teacher | **done** |
| 16 | On a Phone | teacher | **done** (portrait 1080x1920) |
| 17 | What Progress Will Not Claim | teacher | **done** |

### Part 3 — The pattern engine
| # | Title | Role | State |
|---|---|---|---|
| 18 | When a Pattern Fires | teacher | **done** |
| 19 | Asking the Engine Again | teacher | **done** |
| 20 | Four Ways to Answer a Candidate | teacher | **done** |
| 21 | When It Isn't the Teacher's Call | teacher, admin, support | **done** |

### Part 4 — Review cycles
| # | Title | Role | State |
|---|---|---|---|
| 22 | The Review Cycle | teacher | **done** |
| 23 | Deciding a Review, the Hard Way | teacher | **done** |

### Part 5 — Everyone who is not a teacher
| # | Title | Role | State |
|---|---|---|---|
| 24 | The Support Professional | support | **done** |
| 25 | The Student, the Family, and the Reply | student, guardian, teacher | **done** |
| 26 | The Student's Day | student | **done** |
| 27 | Putting a Hand Up | student, teacher | **done** |
| 28 | The Family's Page, in Full | guardian | **done** |

### Part 6 — Running it
| # | Title | Role | State |
|---|---|---|---|
| 29 | Oversight and Trust | administrator | **done** |
| 30 | Inside a Rule | administrator | **done** |
| 31 | Activating and Retiring Rules | administrator | **done** |
| 32 | Prompts and the Gate | administrator | **done** |
| 33 | Revoking Access | administrator | **done** |
| 34 | The Audit Trail | administrator | **done** |

Each part opens with a video that already exists, so the short tour pieces become the introduction
to their own section rather than a separate tier.

### Renumbering already applied

Second renumbering, Sept 20 2026: 04–06 were inserted for the teacher-owned class work, so every
video from the old 04 on moved up three. The table below shows the current numbers. Run folders for
the new three are `_work/04-a-class-of-your-own`, `05-your-own-roster` and `06-letting-the-family-in`.

| Was | Is now |
|---|---|
| 01 Meet Class Pulse | 01 (unchanged) |
| 02 Starting a Workspace | 02 (unchanged) |
| 03 Setting Up Your School | 03 (unchanged) |
| 04 From an Observation to an Approved Plan | **09** |
| 05 Fifteen Seconds, and What It Adds Up To | **14** |
| 06 When a Pattern Fires | **18** |
| 07 The Review Cycle | **22** |
| 08 The Support Professional | **24** |
| 09 The Student, the Family, and the Reply | **25** |
| 10 Oversight and Trust | **29** |

The run folders under `demos/_work/` keep their original slugs (`04-observation-to-plan` is now
video 09, and so on) — they are gitignored working files and renaming them would break nothing but
help nobody. This table is the map.

### What each new video covers
| # | Covers |
|---|---|
| 04 | The Classroom plan bought by a teacher: checkout, sign-up, the new "teach my own class or set up a school" choice, and landing on an empty My class with no administration surface |
| 05 | My class: adding students and a second section without an administrator, and "Open a case" going straight to an intake with the student and grade filled in |
| 06 | Family access from the roster: inviting a parent and the student (free, one child only), revoking a pending invitation, the roster badges, and the same card on a case page listing who already has access |
| 07 | `/sign-in` on camera with the new-device code, the invitation link, `/sign-up?__clerk_ticket` ("You have been invited"), landing in the surface the role fixes, signing out |
| 08 | The "not in a workspace yet" screen, Luis seeing only his own section, the specialist's narrower nav, the same case as teacher, student, family and administrator |
| 10 | Retitled while recording: the draft in hand passed the guardrails and still carried a real flag (diagnostic vocabulary in section thirteen), which is the honest version of this story. Shows the badge, the flag and its exact path, the flagged-section marker, and the second-model scores. |
| 11 | Edit a section as structured data with a live preview, Reject and what it does and does not do, Regenerate, Discard |
| 12 | `/teacher/cases` search and the All / Active / Under review / Drafts filter, the "already has a case" callout, the command palette, dark mode |
| 13 | Overview in full — provenance, goals, review cycles, the private notes panel — then the Plan tab, then Print / Save as PDF |
| 15 | Every chip dimension, More chips, the note field and its own identifier guard, the timed save |
| 16 | The bottom tab bar, the navigation sheet, quick entry as designed. Portrait, 1080×1920, its own calibration |
| 17 | Per-goal charts, baseline versus proposed versus established, pre-baseline shading, the blocked baseline quoting the intake |
| 19 | Data quality on the teacher's own surface, logging what a rule said was missing, Re-evaluate, a new candidate appearing |
| 20 | Dismiss with the reason that tunes the rule, needs-more-data, confirm into a goal rather than a strategy, Reinterpret |
| 21 | Escalate; activating the attendance rule, which routes to the support team; a support queue candidate with no intervention proposals at all |
| 23 | Review now from the case page, disagreeing with the computed result and being made to say why, what the other decisions change |
| 26 | Switching goals, the accomplishments list, the daily check-in in detail |
| 27 | The help flag raised for real, then the teacher's safety banner and "procedure followed" |
| 28 | Goals, summaries, help at home, confirmed patterns with evidence counts, and a straight answer about what is held |
| 30 | Thresholds, the confounders it must weigh, the written proxy review, and the fire and confirmation numbers |
| 31 | Activating a piloting rule with a named reviewer, retiring one, and what each changes for teachers |
| 32 | A new version with a changelog; promotion refused with no eval run; a real run that scores 13/20 and stays blocked; then a second version that scores 20/20 and is promoted. Both runs were real: about 17 and 15 minutes. |
| 33 | The directory, revoking an invitation, revoking an individual authorization |
| 34 | Filtering by action, case and student, finding the events the other videos just made, and why it cannot be edited |

## 4. Settled before recording

- **Eval run: for real.** Video 29 runs the real suite (~17 minutes, ~60 model calls). It is a
  single synchronous request, so the browser must sit on it — 32 is recorded last, in one block,
  and the wait is spent compiling the others.
- **Bot check: Joel clicks it.** Clerk serves a Turnstile on repeated sign-ups. Video 07 stops and
  asks him to tick the box on the recording monitor, then carries on.
- **Phone video: yes, portrait.** Video 16 is 1080×1920 from its own calibration pass. Everything
  else stays 1920×1080.
- **Length: about a minute each**, matching the ten already made.
- **`blocked_pii` may not be honestly reachable** — the keyboard scan and the egress gate share a
  detector. If it cannot be triggered without contriving it, 10 shows the guardrail path instead
  and the gate is explained, not staged.
- **The approver-role refusal** needs `PLAN_APPROVER_ROLES` narrowed for one take. Left out.
