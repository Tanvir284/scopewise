# Focused bug hunt — historical edition

This record describes the earlier browser-local Scopewise edition before the SQLite server, 48-rule engine, and expanded operations workflows. Its persistence description and three-suite count are historical. Current implementation and verification are recorded in verification.md, coverage.md, server-data.md, and rule-engine-audit.md.



Confirmed and fixed:

1. **Cross-project task/change links accepted by import validation.** A task could refer to a change in a different project. Reproduced with a malformed workspace fixture. Validation now requires both records to share the same project. Regression test rejects the malformed relationship.
2. **Route-breaking imported IDs accepted.** IDs containing slash/hash/query characters could create records that the hash router could not open. Reproduced with `bad/id`. IDs now must be nonempty ASCII letters, numbers, underscore or hyphen, within the existing length limit. Regression cases cover empty/slash/hash/query IDs.
3. **Corrupted saved data overwritten by a later save.** The app previously showed temporary sample data after a parse/validation failure, then could overwrite the damaged original. Storage writes now preserve the damaged original under a separate recovery key before replacement; if recovery cannot be safely preserved, saving fails without overwriting it. Settings offers a recovery download when present. Tested corrupted JSON, existing recovery preservation, quota failure and denied storage using a deterministic storage fixture.
4. **Edited decided plans kept their old approval.** Editing summary/questions could leave a materially changed plan marked Approved or Declined. Such edits now return it to In review. Browser-verified: edited description appears in the linked task and review queue updates.
5. **Clipboard operation could remain pending without feedback.** Copy now has a timeout and selectable text fallback. Actual clipboard contents were verified after the changes, including saved task edits, criteria, status and edited summary.

The final project retains the structural cyberpunk design and browser-local data. Normal persistence/preferences were verified in the live browser after the storage integration. Corruption/quota/denied-storage paths were exercised through the storage test fixture, not by damaging the user's real browser workspace. A pre-existing different recovery copy blocks an unsafe overwrite; manual recovery may be needed in that uncommon case.

All three npm test suites pass; final JavaScript syntax checks pass. This is a focused audit, not a guarantee that no bugs remain. Other browser engines, screen-reader combinations, actual exhausted browser storage, and every provider-related requirement are not comprehensively tested. Rule-based analysis still requires human review; no live AI/backend/team synchronization is configured.
