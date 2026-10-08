# Rule engine and pending-work audit

Date: 8 October 2026 (Asia/Dhaka).
Scope: independent source review of public/rules-engine.js and public/server-client.js, direct Node assertion-based reproductions with in-memory mock transport, and the targeted regression suites. No audit reproduction wrote to the actual application database, contacted external services, or verified browser interaction.

## Confirmed defects fixed and independently checked

### P1 — Recovered stale draft could overwrite another tab

Before correction, initialize read canonical revision 2, returned a pending revision-1 draft, and promoted the write revision to 2. Retrying then passed optimistic concurrency and replaced the other tab's state.

Reproduction: canonical {original:1,otherTab:3}, pending {original:1,myEdit:2} at revision 1. Recovery reported conflict=true, but save replaced canonical with {original:1,myEdit:2}.

Root retained a conflict latch and pending base revision until explicit recovery. An independent assertion-based rerun verified that saving the conflicted draft makes zero PUT requests, throws status 409, and preserves canonical and pending records.

### P1 — Repeated queued snapshot could lose its pending journal

JSON equality was used instead of save identity for cleanup. For queued n=1, n=2, n=1, the first successful n=1 write deleted the final n=1 journal. If n=2 committed and the final write failed, canonical was n=2 and no journal survived.

Root added a generation per save and advancement after successful own writes. The independent rerun verified fulfilled/fulfilled/rejected outcomes, canonical n=2, and pending n=1 at revision 3.

### P2 — Disabled review rules still emitted their questions

Disabling review.ambiguity, review.deadline, review.budget and review.person removed warnings/evidence but left their questions.

Root gated the question branches. Added regression coverage verifies all five associated question fragments disappear from the disabled plan, no disabled rule emits evidence/warnings, and enabled reporting-domain questions remain.

### P2 — Explicit negative scope generated affirmative implementation work

Baseline: No online payment is supported.
Client message: Do not add online payment.

Before correction, output was Addition with Implement the requested payment flow. Root added review.negation and Constraint classification, drafting a review of excluded scope instead of implementing the excluded capability.

Added regression checks verify the excluded capability is not introduced, provider implementation criteria/questions are absent, and a following positive CSV-report request still retains implementation criteria.

### P2 — Combined-domain task priority understated matched risk

Add payment and email confirmation matched a High payment rule but emitted Medium priority because notification was selected as primary.

Root now takes the highest matched-domain priority. Added regression checks verify High priority and preservation of both payment-verification and notification-delivery criteria.

### P2 — Malformed pending journal could be silently overwritten

Source inspection found malformed JSON was treated as absent, while a truthy invalid state reached later workspace validation and failed boot. There was no raw recovery archive before the next save.

Root added pending-envelope validation, an optional state validator during initialize, and raw invalid-journal archives before replacement. The current server-client suite verifies malformed JSON and invalid state are archived byte-for-byte, canonical state loads, and a subsequent write succeeds. Browser recovery UX remains outside these Node checks.

## P1 shared-tab race fixed and independently checked

At the time of this independent reproduction, successful-save journal advancement still updated any surviving journal, including a generation belonging to another API client/tab.

Reproduced with two API clients sharing one storage instance and initial canonical revision 1:

1. A and B concurrently write different snapshots.
2. A commits; B receives 409.
3. A's cleanup advances B's surviving journal to revision 2.
4. Reopening reads B's journal as equal to canonical revision 2 and reports conflict=false.
5. Retrying B's stale snapshot overwrites A's committed record.

Observed output: first writes fulfilled/rejected; canonical {start:1,fromA:1}; pending {start:1,fromB:1} incorrectly at revision 2; reload conflict=false; retry canonical {start:1,fromB:1}.

Root now advances only surviving generations owned by the successful client's queue and archives foreign pending work before replacement. An independent assertion-based rerun with two clients sharing storage verified: canonical A data survives, B's pending revision stays 1, reload conflict remains true, retry throws 409 without any PUT, both A/B snapshots exist in recovery history, and explicit adoption returns canonical A safely. This reproduced race is closed.

## Actual verification and limits

- Rule suite: 18 scenarios passed against the current 48-rule catalogue, including every review trigger.
- Server-client suite: 12 scenarios passed, including malformed-journal recovery, shared storage, cancelled adoption, and initial migration conflict recovery.
- Initial stale-recovery and repeated-snapshot regressions were also independently rerun with assertions after correction.
- Existing model tests cover separate schema and calculation behavior.
- These results do not prove browser interactions, exhaustive language semantics, cloud collaboration, authentication, live AI, or accounting compliance.



## Subsequent final corrections

Later source corrections include an immutable currency control for existing monetary records, default invoice references that skip existing references, delayed clipboard fallback cancellation, and explicit recovery from an initial migration conflict while preserving legacy browser bytes.

Output truncation now always emits a mandatory system.output-limit information notice even when review.limit is disabled. This system notice is not counted as another catalogue rule. A regression checks the notice survives workspace persistence with review.limit disabled.

The rules suite now contains 18 scenarios; the transport suite contains 12, including cancelled adoption and recovery from an initial migration conflict. These additional source/code checks do not establish every clipboard permission outcome or fresh downloads of the latest operations exports.
