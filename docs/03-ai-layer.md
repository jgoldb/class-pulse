# 03 — AI layer

Two generative surfaces, one shared machinery:

1. **Plan generation** — intake → structured draft behavior-support plan (16 sections)
2. **Pattern interpretation** — pattern candidate + evidence → hypothesis and candidate interventions

Both are drafts. Neither writes to an approved object without a human in between.

## Prompt registry

Prompts are versioned application code with a test suite — which is exactly what the source
assignment demonstrated by hand across V1, V2, and Final.

```ts
type PromptVersion = {
  id: string
  surface: 'plan_generation' | 'pattern_interpretation' | 'guardrail_classifier'
  version: number
  body: string              // immutable once created
  model: string
  params: { temperature: number; maxTokens: number }
  changelog: string         // what problem in the prior version this addresses
  createdBy: UserId
  status: 'draft' | 'active' | 'retired'
}
```

Rules: immutable once created; exactly one `active` per surface; every `GenerationRun` records
the prompt version, model ID, input hash, latency, and token counts. When output quality shifts
you can tell whether it was the prompt, the model, or the input — without that, you are guessing.

Prompt v1 for `plan_generation` is the Final Prompt from the source assignment
([Appendix A](appendix-a-source-prompt.md)), adapted to emit structured output.

## Structured output, not markdown

The model emits JSON conforming to a schema, via tool use / structured output — not prose that
gets parsed.

Prose is unqueryable. You cannot chart a goal that lives in a paragraph, cannot diff an edit at
the field level, cannot validate that a numeric target has a supporting baseline. Render prose
*from* the structure for reading and printing; never the reverse.

The plan schema mirrors the source prompt's 16 sections, with sections 5 (goals), 12–13
(dashboard content and exclusions), and 14 (review criteria) as structured arrays rather than
text. Sections 13 and 14 are worth a specific note:

- **Section 13, "Information That Should Not Be Displayed," is design-time input, not runtime
  authorization.** Capture what the model says, use it to inform the policy layer, but never let
  model output gate a request. See [04](04-privacy-and-access.md).
- **Section 14, review criteria, becomes rules**, evaluated against logged data by the same engine
  described in [02](02-pattern-engine.md). The model writes the narrative around a computed
  recommendation; it does not make the call. The source document's own line: *"These decisions
  should not be based solely on an AI-generated recommendation."*

## Guardrails

Every generation passes a post-check before any human sees it.

**Deterministic checks** (fast, free, no false humility):

| Check | Action on failure |
|---|---|
| Numeric target present while `baseline.status !== 'available'` | Reject, regenerate |
| Vague terms in a goal's observable definition ("focused", "engaged", "on task") | Flag for reviewer |
| Diagnostic or disability vocabulary anywhere | Reject |
| Required schema sections missing or empty | Reject, regenerate |
| Confounder not addressed (pattern interpretation) | Reject, regenerate |
| Causal verbs inside a `hypothesis` field | Reject, regenerate |

**Model-based check** — a second, cheap classification call scoring the draft for unsupported
causal claims, hypotheses stated as fact, stigmatizing language, and content outside educational
scope. Low-confidence results flag rather than reject.

Nothing fails silently. A rejected generation either regenerates once or surfaces to the reviewer
marked as needing attention.

## Eval harness

The source assignment's methodology — one fixed test input, three prompt versions, scored against
11 success criteria — becomes an automated regression gate. This is the natural extension of work
already done, and it is cheap now and painful to retrofit.

**Eval cases.** Start with the grade-6 case from the source document as case 001, then add
15–25 covering the hard paths:

- Ambiguous baseline (the original case — a combined "3–5 times" spanning two behaviors)
- Missing fields entirely
- Contradictory input
- An input containing student PII (must be blocked upstream by the egress gate — assert that)
- An out-of-scope request ("does this student have ADHD?")
- A safety concern (must route to escalation, not to strategies)
- Sparse data where the correct answer is "collect more"
- A rich, unambiguous case where the model *should* set a numeric target

**Rubric** — the source document's 11 success criteria, scored per case: accurate, relevant,
clear and organized, observable and measurable, personalized without unsupported assumptions,
practical, supportive rather than punitive, privacy-conscious, transparent about uncertainty,
workload-reducing, appropriate for human review.

**Scoring** — deterministic assertions wherever the criterion can be mechanized (a numeric target
without a baseline is a hard fail, full stop), LLM-as-judge for the qualitative remainder, with
judge prompts themselves versioned.

**Gate** — no prompt version reaches `active` without passing the suite. Run on every prompt
change and on every model upgrade.

## Model choice

- **Plan generation**: the strongest available model. The whole documented value of the prompt
  revision arc was correct reasoning about ambiguous evidence — refusing to convert "3–5 times"
  into a baseline. That is exactly where weaker models regress, and the failure is invisible
  because the wrong answer reads perfectly fluently.
- **Pattern interpretation**: strong model. Same reasoning demands, smaller inputs.
- **Guardrail classifier**: fast, cheap model. High volume, narrow task.

Model IDs live in `PromptVersion`, so an upgrade is a prompt-version bump that re-runs the evals.

## Feedback loop

Two labeled datasets accumulate for free:

1. **Draft vs. approved diffs** from plan review — where educators consistently rewrite is where
   the prompt is weak.
2. **Pattern adjudications** — confirmation and dismissal reasons per definition.

Review both each term. Feed the first into prompt revision, the second into definition tuning.
This is how the system improves after launch without anyone guessing.
