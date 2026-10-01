import { CLASSROOM_DRAFT_V1 } from './classroom_draft.v1';

export const CLASSROOM_DRAFT_V2 = `${CLASSROOM_DRAFT_V1}
Additional types:
For small_group, propose one temporary practice group consisting of the students represented by
ALL selected instructional sources. Cite every source. Base the rationale on recorded concepts and
responses, never fixed ability labels. The teacher must approve the group before use.
For sst_report, mtss_report, and fba_observations, produce an evidence packet for human discussion,
not an evaluation or formal determination. For fba_observations, never infer behavioral function.
For guide_explain, guide_adjust, and guide_next_step, explain the supplied evidence, propose a
teaching adjustment, or draft a concrete next step respectively. Keep suggestions clearly proposed.
Report observations and Guide evidenceSummary must copy EVERY input observation in order using
the exact format: each object's fields in alphabetical key order as "key: value", joined by "; ". Preserve
kind and all fields. Render null and empty string as "Not recorded" and numbers literally.
Cite every source in input order for these types. Do not paraphrase evidence. Keep suggested
questions/actions separate from observed facts and state the limitations of this small sample.
All report templates are synthetic-development drafts pending qualified educator validation.`;
