# 06 — Roadmap

Ordering principle: get the core loop demonstrably useful before adding roles, and build the
evaluation and privacy scaffolding early — both are cheap now and expensive to retrofit.

Phases are sequenced, not time-boxed. Each has an exit criterion.

---

## Phase 0 — Core loop

**Build:** domain schemas (`Baseline` union, `Goal`, `Signal` with context tags). Intake form for
the 7 educator fields. Egress gate with allowlist and PII scan. Prompt registry with the source
Final Prompt as v1, adapted for structured output. Async generation. Draft rendering.

Synthetic students only. Stubbed auth. One role.

**Exit:** a teacher-shaped user submits an intake and gets back a structured draft plan that
correctly refuses to invent a baseline from the ambiguous grade-6 test case.

> Ship the `Signal` model now even though nothing writes to it yet. Retrofitting context tags
> onto logging data collected without them means the pattern engine starts from zero history.

---

## Phase 1 — Evals and guardrails

**Build:** eval harness with 15–25 cases and the 11-criterion rubric. Deterministic guardrail
checks. Guardrail classifier. Prompt-version promotion gated on a passing suite.

**Exit:** a prompt change that reintroduces a V1-style failure — a numeric target with no
supporting baseline — fails CI and cannot be promoted to `active`.

> Deliberately before the approval UI. The source assignment's methodology is the strongest asset
> here; encoding it while the surface area is small is the cheapest it will ever be.

---

## Phase 2 — Approval workflow

**Build:** section-by-section accept / edit / reject. Draft-vs-approved diff capture. Plan
lifecycle state machine. Structured goal and strategy editing. Plan PDF export for family
meetings.

**Exit:** a plan reaches `active` only through a named reviewer, and the diff between draft and
approved text is queryable.

---

## Phase 3 — Logging and progress

**Build:** quick-entry UI, mobile-first, with context chips. Signal writes. Progress charts with
baseline bands, goal lines, and observation counts. Student self-check entry. Basic review-cycle
scheduling.

**Exit:** median logging interaction under 15 seconds, measured on a phone, by someone who did
not build it.

> This is the phase that decides whether the product survives a real classroom. If quick entry is
> slow, nothing downstream matters — the signal store stays empty and the pattern engine has
> nothing to work with.

---

## Phase 4 — Pattern engine

**Build:** `PatternDefinition` structure and the seed catalog. Detection runner with sufficiency
gates and suppression. Interpretation prompt and its guardrails. Pattern queue and adjudication
UI. Detection eval suite on labeled synthetic histories. Review-cycle rules on the same engine.

Start with two definitions — `strength-underutilization` (cheap, positive, immediately
actionable) and `context-performance-divergence` (the motivating example). Add the rest once the
adjudication loop is proven.

**Exit:** a seeded history reproducing the motivating example produces a candidate whose card
leads with evidence, addresses every listed confounder, and can be confirmed into a new goal.

---

## Phase 5 — Real auth and access control

**Build:** SSO. Scoped role assignments. Row-level security. The `policy` package with the full
field-visibility matrix. Audit log and its viewer. `AuthorizationRecord` flow for individual
administrative access.

**Exit:** integration tests prove each role's API payloads exclude hidden fields entirely — not
merely unrendered — and every individual-record read writes an audit event.

---

## Phase 6 — Student and family surfaces

**Build:** student dashboard with age-appropriate UI and self-reflection. Parent/guardian
dashboard. Transparency views — plan provenance, confirmed patterns in plain language,
correction pathway.

**Exit:** a sixth grader can find their own goals and complete a self-check unaided.

---

## Phase 7 — Administration and tuning

**Build:** aggregate trend views with minimum cell size and complementary suppression. Pattern
catalog health dashboard — fire rate, confirmation rate, dismissal reasons, time to adjudication.
Equity monitoring with disproportionality alerting. Prompt and definition tuning workflow from
accumulated diffs and adjudications.

**Exit:** a definition below the confirmation-rate floor, or showing disproportionate firing, is
visible and retirable from the admin surface.

---

## What "demonstrable" means at each stage

- **After Phase 2** — a coherent story: submit observations, get a careful draft, approve it.
- **After Phase 4** — the actual product thesis: the system notices something a busy teacher
  would have missed, shows its work, and asks rather than tells.
- **After Phase 5** — deployable in a real school, given the operational-posture work in
  [04](04-privacy-and-access.md).

Phases 0–4 are a genuine product demonstration. Everything after is what makes it adoptable.
