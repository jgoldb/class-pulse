# Class Pulse

A role-scoped web app where a teacher submits de-identified behavior observations, an LLM drafts
a structured behavior-support plan, a human approves it, and the plan becomes a live tracked
object with goals, logged data, progress views, and scheduled review decisions.

On top of that loop sits a **pattern engine**: deterministic rules watch a student's accumulated
signals (behavior, grades, attendance, assessments) for combinations worth a human's attention,
and an LLM proposes candidate interventions for the ones that fire. Detection is always
deterministic and auditable. Interpretation is generative. Decisions are always human.

**Status:** implemented through Phase 7 of the roadmap on real infrastructure (Clerk, Neon
Postgres, OpenAI), verified by a browser harness that drives every screen for every role. The
only simulated component is the payment page, which stands in for Stripe until Stripe is wired.
See [08 — Implementation notes](docs/08-implementation-notes.md).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, Tailwind v4, Radix primitives, Framer Motion, TanStack Query, Recharts |
| Auth | Clerk (email + Google sign-in, invitations delivered by Clerk, roles and scopes owned here) |
| API | Fastify, Drizzle ORM, Zod schemas shared with the frontend and the model's structured output |
| Database | Neon Postgres (branch per environment; the e2e branch is wiped by the harness) |
| Jobs | Durable Postgres-backed queue polled by the API (generation, nightly sweep, review cycles) |
| AI | OpenAI Responses API, `gpt-5.6-terra` at medium reasoning effort by default, all configurable |
| Tests | Vitest (unit + API integration), Playwright (real browser, real auth, real model) |

## Setup

Requirements: Node 22+, a Clerk application (development instance), a Neon project.

```bash
npm install
cp .env.example .env
```

Then fill `.env`:

- **Clerk:** `clerk init --app <your app id>` inside `apps/web` writes the keys to
  `apps/web/.env.local`; copy `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and
  `VITE_CLERK_PUBLISHABLE_KEY` into the root `.env` (the API reads the root file). In the Clerk
  dashboard enable Email + Password sign-in.
- **Neon:** `neon link --project-id <id> --branch production` pulls `DATABASE_URL` into `.env`.
  Create an `e2e` branch and put its connection string in `DATABASE_URL_E2E`.
- **OpenAI:** `OPENAI_API_KEY`. Model and effort default to `gpt-5.6-terra` / `medium`.

```bash
npm run seed                # workspace, sections, 26 synthetic students, Clerk demo accounts,
                            # one case walked through the real model (~2 minutes)
npm run dev                 # API on :3001, web on :5173
```

Open http://localhost:5173. Demo accounts (password printed by the seed):

| Role | Email |
|---|---|
| Teacher | teacher+clerk_test@example.com |
| Second teacher (other section) | teacher2+clerk_test@example.com |
| Support professional | support+clerk_test@example.com |
| Administrator | admin+clerk_test@example.com |
| Student | student+clerk_test@example.com |
| Guardian | guardian+clerk_test@example.com |

`+clerk_test` addresses are Clerk test users: any verification code prompt accepts `424242`.

New workspaces are created through the public flow: landing → plan → simulated checkout →
Clerk sign-up → onboarding, where you say whether you are a teacher setting up your own class
or an administrator rolling out a school. A teacher gets a section and a roster they own (My
class) and invites the family and the student for any child on it — scoped to that child, free,
and revocable. Staff roles, which take an educator seat, are invited by an administrator
(People & access). Either way the invitation sets a role and a scope before the person ever
signs in.

## Verify

```bash
npm test              # 124 unit/integration tests: domain, policy matrix, PII, guardrails,
                      # egress invariant, detection precision/recall, review engine, API per role
npm run typecheck
npm run lint          # includes the rule that only the egress gate may import the provider SDK
npm run e2e           # Playwright: seeds the e2e Neon branch through the real model, then drives
                      # sign-up, intake→draft→approval→quick entry, patterns, reviews, every role,
                      # and captures screenshots of every screen at desktop and phone widths
npm run e2e:fast      # same, reusing the previous seed
npm run evals         # 20-case plan-generation eval suite on the real model (~17 min)
```

Screenshots from the harness land in `e2e/screenshots/<desktop|mobile>/`.

## Repository layout

```
apps/
  api/        Fastify + Drizzle + Clerk backend. Routes per area, services, jobs, seed.
  web/        React app. components/ui is the design system; pages are grouped by role surface.
packages/
  domain/     Zod schemas shared by API, web and the model's structured output.
  policy/     Pure, exhaustively tested: field × role visibility, row scope, cell suppression.
  ai/         egress/ (THE gate — the only module that imports the provider SDK), prompts/
              (immutable versions), guardrails/, pii/, evals/.
  patterns/   The rule catalog as data, the detection runner, the review-cycle engine, evals.
e2e/          Playwright harness: fixtures, specs, seed-then-start launcher.
docs/         The plan (00–07) and implementation notes (08).
```

## The plan

| Doc | What it covers |
|---|---|
| [00 — Overview](docs/00-overview.md) | Product shape, users, scope, guiding principles |
| [01 — Domain model](docs/01-domain-model.md) | Entities, the signal layer, key type decisions |
| [02 — Pattern engine](docs/02-pattern-engine.md) | Detection rules, LLM interpretation, adjudication, equity guardrails |
| [03 — AI layer](docs/03-ai-layer.md) | Prompt registry, structured output, guardrails, eval harness |
| [04 — Privacy & access](docs/04-privacy-and-access.md) | De-identification boundary, role/field policy, audit |
| [05 — Architecture](docs/05-architecture.md) | Stack, repo layout, services, jobs |
| [06 — Roadmap](docs/06-roadmap.md) | Phased build order with exit criteria |
| [07 — Open questions](docs/07-open-questions.md) | Decisions to make before/while building |
| [08 — Implementation notes](docs/08-implementation-notes.md) | What was built, deviations, decisions, eval findings |
| [Appendix A](docs/appendix-a-source-prompt.md) | Source prompt (v0) from the originating assignment |
