# KF-EXEC-K12-001 Debug Contract

Extends `../DEBUGGABILITY-CONTRACT.md`.

## Required IDs

- `proofRunId`
- `packageId`
- `sourceSha`
- `policyManifestId`
- `policyVersion`
- `evaluatorVersion`
- `resourceLeaseId`
- `runnerReportId`
- `cleanupReceiptId`
- `caseId`
- `negativeControlId` when applicable

## Structured events

```text
proof.run.requested
proof.policy.loaded
proof.resource.preflight_started
proof.resource.admitted
proof.resource.rejected
proof.runner.started
proof.runner.report_received
proof.case.discovered
proof.runner.error
proof.cleanup.started
proof.cleanup.completed
proof.cleanup.failed
proof.evaluation.started
proof.evaluation.rejected
proof.evaluation.incomplete
proof.evaluation.satisfied
```

## Required rejection reason codes

- KF_PROOF_REQUIRED_CASE_MISSING
- KF_PROOF_REQUIRED_CASE_SKIPPED
- KF_PROOF_DUPLICATE_CASE_ID
- KF_PROOF_COLLECTION_ERROR
- KF_PROOF_SETUP_ERROR
- KF_PROOF_UNHANDLED_ERROR
- KF_PROOF_STALE_CACHE_AS_FRESH
- KF_PROOF_RESOURCE_UNSAFE
- KF_PROOF_RESOURCE_SHARED
- KF_PROOF_CLEANUP_FAILED
- KF_PROOF_CLEANUP_UNKNOWN
- KF_PROOF_MANIFEST_UNTRUSTED
- KF_PROOF_SOURCE_MISMATCH
- KF_PROOF_REPORT_MALFORMED

## Diagnostic query goal

Given `proofRunId`, an engineer must be able to reconstruct:
policy → resource admission → runner invocation → discovered cases → failures/skips → cleanup → evaluator verdict.

No secret env values are logged.
