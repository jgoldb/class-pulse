# Class Pulse — working notes for agents

Read `docs/00`–`08` before changing behavior; the docs are the spec and `docs/08` records the
decisions taken during implementation. The owner wants a real product: no simulated services
except the Stripe stand-in on the checkout page. When a decision or a credential is needed,
ask them; do not build a throwaway substitute.

## Invariants (tests enforce these; do not weaken them)

- Only `packages/ai/src/egress/openai.ts` may import the provider SDK. ESLint and
  `packages/ai/src/egress/egress.test.ts` both check the whole tree.
- Everything the model emits lands in a draft/candidate state. A named human promotes it.
- Detection (`packages/patterns/definitions`) never sees names, ids or demographics.
  Demographics are read in exactly one place: `services/admin.ts#equityMonitor`.
- A numeric goal target requires `baseline.status === 'available'` with ≥3 observations.
- `PLAN_TRANSITIONS` / `CANDIDATE_TRANSITIONS` in `packages/domain` are the only state machines.
- Prompt files are immutable. A change is a new `plan_generation.vN.ts` with a changelog,
  promoted only after `npm run evals` passes (the API enforces this on promotion).
- `audit_events` and `egress_log` are append-only (database trigger).
- Access is invitation-based: a user row exists only via an `invitations` row or workspace
  onboarding. `Authorization: Test <userId>` is honoured only under `NODE_ENV=test`.
- The mock model provider is honoured only under `NODE_ENV=test`.

## Commands

```
npm test | npm run typecheck | npm run lint
npm run seed            # --reset to wipe; uses DATABASE_URL, creates Clerk demo users, calls OpenAI
npm run dev             # api :3001, web :5173   (port 4300 is reserved by the owner for another app)
npm run e2e             # Playwright on :3011/:5174 against DATABASE_URL_E2E; e2e:fast reuses the seed
npm run evals           # EVAL_PROMPT_VERSION=N to test a draft prompt
npm run db:generate     # after editing apps/api/src/db/schema.ts (drizzle-kit prompts on renames:
                        # add tables in one generate, drop in a second)
npm run deploy          # fly deploy + the VITE_CLERK_PUBLISHABLE_KEY build arg the Dockerfile
                        # requires; a bare `fly deploy` fails. Extra flags pass through after --
```

`AI_PROVIDER=off` turns the model off for a whole deployment (`fly secrets set AI_PROVIDER=off`,
which restarts the machine). Every call then fails as a non-retryable provider error and still
writes its `egress_log` row; `/health` reports `provider: "disabled"`. The seed and the evals
refuse to start, so prompt promotion is blocked while it is on. See `docs/08`.

## Verifying UI work

Look at it. Run `npm run e2e` (or `e2e:fast`) and open `e2e/screenshots/`, or drive the app in
the browser pane with a seeded account (`teacher+clerk_test@example.com`, password from the
seed; new-device verification code is `424242`). Text-only checks are not verification.

## Gotchas

- Windows + Git Bash: avoid multi-file heredocs in one shell call and sed on files with quotes;
  use the Write/Edit tools.
- `tsx watch` API processes can outlive the preview server; kill the port before reseeding.
- Roster denylist entries are added as full names and as single parts; single words match only
  when capitalised (see `detector.ts`). Synthetic surnames like "Example" exist to stress this.
- OpenAI strict structured output: schemas use `nullable`, never `optional`; `oneOf` is rewritten
  to `anyOf` in `packages/ai/src/schema`.
- Clerk rejects emails with unusual TLDs; test accounts use `+clerk_test@example.com`.
- Playwright starts web servers before globalSetup; anything that resets the database must
  happen inside `e2e/start-api.mjs`, before `/health` answers.
