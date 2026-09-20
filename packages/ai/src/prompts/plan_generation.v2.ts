import { PLAN_GENERATION_V1 } from './plan_generation.v1';

/**
 * plan_generation v2. Changelog (from the first full eval run of v1 on gpt-5.6-terra, 11/20):
 *  - Three cases set a numeric target from a single observation, a "twice this week" note, or an
 *    estimated range, by labelling them baseline.status = "available". v2 defines what counts as
 *    an available baseline (≥3 behavior-specific counts on separate occasions) and names the
 *    other two cases as ambiguous / unavailable.
 *  - One case echoed the diagnostic term from an out-of-scope question into section 13. v2
 *    confines any such echo to outOfScopeRequestNoted.
 *  - One case did not weigh documented absence as an alternative explanation for a grade
 *    difference across settings. v2 asks each hypothesis to name alternatives present in the input.
 *  - Empty strengths / documented patterns are now explicitly allowed and must be surfaced under
 *    missingInformation (the v1 guardrail that rejected them was wrong and was relaxed).
 */
export const PLAN_GENERATION_V2 = PLAN_GENERATION_V1.replace(
  'MEASUREMENT\n',
  `MEASUREMENT

What counts as a baseline. baseline.status = "available" only when the input contains at least three behavior-specific counts taken on separate occasions (for example "4, 3, 5 times over three periods" or "40, 45, 35 percent of intervals across three sessions"). A single observation ("once last week", "twice this week"), a frequency without counts ("most days", "daily"), or an estimate or range ("roughly 4-6 times", "about 3-5 times") is NOT an available baseline: use status "ambiguous" for estimates and ranges (rawInput = the text, whyAmbiguous = why it is not a set of observations) and status "unavailable" for single observations or missing data. When the baseline is not "available", target.status must be "blocked_on_baseline".

`,
)
  .replace(
    '4. Identify hypotheses that should be monitored. Label them as hypotheses; never state them as facts; do not use causal language ("because", "due to", "caused by").',
    '4. Identify hypotheses that should be monitored. Label them as hypotheses; never state them as facts; do not use causal language ("because", "due to", "caused by"). In each hypothesis, name at least one alternative explanation that the input itself supports (for example, documented absence when grades differ across settings, or shared group scores when group grades are low), and set whatToObserve so that it can distinguish between them.',
  )
  .replace(
    '2. Identify student strengths.\n3. Identify documented patterns.',
    '2. Identify student strengths. If none are documented, leave studentStrengths empty and list them under missingInformation; do not invent any.\n3. Identify documented patterns. If none are documented, leave documentedPatterns empty and list situational patterns under missingInformation; do not infer any from the behavior description alone.',
  )
  .replace(
    'If a request is inappropriate or outside the task (for example, asking whether a student has a condition), do not answer it: record the limitation in outOfScopeRequestNoted, redirect toward observable educational information, and still produce the cautious draft from whatever observable information is present.',
    'If a request is inappropriate or outside the task (for example, asking whether a student has a condition, or whether a student should be suspended), do not answer it: record the limitation in outOfScopeRequestNoted, redirect toward observable educational information, and still produce the cautious draft from whatever observable information is present. Do not repeat a diagnostic, medical, disability or disciplinary term from the input anywhere in the plan except inside outOfScopeRequestNoted; in every other section describe the request generically ("a question outside this tool\'s scope").',
  );

if (PLAN_GENERATION_V2 === PLAN_GENERATION_V1) throw new Error('plan_generation.v2 did not apply its edits');
