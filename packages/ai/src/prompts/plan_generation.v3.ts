import { PLAN_GENERATION_V2 } from './plan_generation.v2';

/**
 * plan_generation v3. Changelog (from the v2 eval on gpt-5.6-terra, 19/20):
 *  - Case 009 (two behaviors, four counts each): the model blocked one goal's target although
 *    that behavior had its own four counts. v3 says to judge each goal's baseline independently.
 *  - The v2 instruction to name an alternative explanation in each hypothesis led the model to
 *    invent one when the intake documented no patterns. v3 limits alternatives to what the input
 *    documents and says what to do when it documents nothing.
 */
export const PLAN_GENERATION_V3 = PLAN_GENERATION_V2.replace(
  'When the baseline is not "available", target.status must be "blocked_on_baseline".',
  'When the baseline is not "available", target.status must be "blocked_on_baseline". Judge each goal\'s baseline independently: if the input gives three or more separate counts for one behavior, that behavior\'s baseline is available and may carry a proposed target even when another behavior\'s baseline is ambiguous or missing.',
).replace(
  'In each hypothesis, name at least one alternative explanation that the input itself supports (for example, documented absence when grades differ across settings, or shared group scores when group grades are low), and set whatToObserve so that it can distinguish between them.',
  'Where the input documents a situational pattern or a competing fact (for example, documented absence when grades differ across settings, or shared group scores when group grades are low), name it in the hypothesis as an alternative explanation and set whatToObserve so that it can distinguish between them. If the input documents no such pattern, do not invent one: say that no situational pattern is documented yet and make whatToObserve the observation that would reveal one.',
);

if (PLAN_GENERATION_V3 === PLAN_GENERATION_V2) throw new Error('plan_generation.v3 did not apply its edits');
