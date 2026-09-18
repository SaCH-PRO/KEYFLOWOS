# KF-EXEC-EXTFX-001 Rollback

## Safe to roll back
- adapter optional context wiring;
- new consequence-repair worker path;
- debug/logging instrumentation;
- compatibility readers while new fields are nullable.

## Must be preserved
- effect snapshot/fingerprint already bound;
- provider outcome evidence;
- externalPostId;
- attempt events;
- provider first-attempt time;
- consequence repair history.

## Forbidden rollback behavior
- clearing provider success so legacy retry can resend;
- reclassifying OUTCOME_UNKNOWN as failed;
- deleting attempt evidence;
- recomputing retry payload from mutable current content.

If code rollback is required, disable new dispatch while preserving new evidence fields; prefer forward repair over destructive migration rollback.
