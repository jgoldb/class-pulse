# 07 — Open questions

Decisions that change the shape of the build. Roughly ordered by how early they need an answer.

## Blocking Phase 0

**1. Demonstration or operational posture?**
Synthetic students for a portfolio and proof of concept, or real students in real schools? The
architecture serves both, but the operational posture adds FERPA and state student-privacy
compliance, SSO, DPAs, audit review, retention policy, incident response, and a district
procurement story — a body of work comparable in size to the app itself. Deciding late means
discovering it mid-build.

**2. Who is the first real user?**
A specific teacher, in a specific school, with a specific class. Without one, Phase 3's 15-second
target is unverifiable and the pattern engine has no real histories to tune against. This is the
most valuable thing to secure early, and it is not an engineering task.

## Blocking Phase 3–4

**3. Where do grades, attendance, and assessment scores come from?**
Manual teacher entry, CSV import, or SIS integration (Clever, ClassLink, OneRoster)? The
motivating pattern requires all three signal types. Manual entry for all of them almost certainly
breaks the workload budget — a teacher will not re-key their gradebook. SIS integration is the
realistic answer and is a significant project with a procurement dependency. **This is the single
largest unscoped item in the plan.**

**4. Is context tagging achievable in the teacher's actual workflow?**
The entire pattern engine rests on knowing whether an assignment was group or independent, long
or short. If tags can't be captured cheaply — pre-filled from schedule, defaulted from the last
entry, mapped from SIS assignment categories — the engine starves. Worth prototyping the
quick-entry screen with a real teacher before committing to the rest of Phase 4.

**5. What are the actual thresholds?**
"Performance materially exceeds" needs a number, and so do `minObservations`, `minSpanDays`, and
the confirmation-rate floor. These should be set with someone who has behavioral-assessment
expertise, not guessed by engineers, and then tuned against real adjudications.

**6. Is a single-student signal window sufficient?**
Cross-student patterns — the same shape appearing across six students in one period — are a
classroom or structural signal rather than a student one, and arguably more actionable. Valuable,
but a different privacy surface and a different consumer. Probably a post-v1 feature; worth not
foreclosing in the data model.

## Blocking Phase 5–6

**7. Who can approve a plan?**
Any teacher, or only a credentialed support professional? Does it differ by school? This is the
core authorization question and likely varies by district policy, meaning it may need to be
configurable rather than fixed.

**8. What is the student's role in their own plan?**
The source document gives the student a self-reflection surface. Do they see the full plan? Can
they propose a strategy? Can they disagree with a goal? There is real evidence that student voice
improves behavior-plan outcomes, and it is also the most sensitive UI in the product.

**9. Parent visibility into pattern candidates.**
A confirmed pattern is a meaningful statement about a child. Do families see candidates, only
confirmed patterns, or only the resulting goals? Transparency argues for more; the risk of a
hypothesis being read as a finding argues for care in framing. Recommendation: confirmed patterns
only, in plain language, with the evidence shown.

## Ongoing

**10. Who owns the pattern catalog?**
Engineers can write detection code, but thresholds, confounders, and plain-language descriptions
need educator and behavioral expertise. There needs to be a named reviewer for each definition
before it leaves `piloting`, and a standing review cadence.

**11. Model and prompt drift.**
Model upgrades change output subtly. The eval suite catches regressions on known cases; it will
not catch a drift the suite doesn't test for. Plan for periodic human spot-review of live
generations, not just automated gating.

**12. What happens when the system is wrong in a way that matters?**
A confirmed pattern that misdirects support for a term has a real cost to a real child. Worth
deciding in advance: how a teacher reports that, how it gets recorded against the definition, and
what threshold triggers retirement rather than re-thresholding.
