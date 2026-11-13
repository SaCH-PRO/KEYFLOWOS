# KF-EXEC-K12-001 Traceability Matrix

| Requirement | Source seam | Planned change class | Proof | Debug signal | Rollback concern |
|---|---|---|---|---|---|
| Exact required case identities | Vitest native reports | independent report consumer + accepted manifest | K12-P01/P02 | manifestCaseId, discoveredCaseId | evaluator can be disabled only to last safe mode |
| Skip/todo/missing rejects | Vitest report status | verdict rules | K12-P03 | caseStatus | never revert to count-only proof |
| Setup/collection errors explicit | Vitest report/process exit | normalize runner errors | K12-P04 | runnerPhase, errorClass | historical logs remain historical |
| Fresh vs cached known | Turbo task metadata/output | freshness receipt | K12-P05 | cacheStatus, sourceSha, runId | cached run may remain dev convenience, not fresh proof |
| Resource safety before setup | integration fixture/env bootstrap | preflight admission | K12-P06 | resourceClass, resourceId, admittedAt | unsafe resource must never be touched |
| Concurrent run isolation | DB/Redis/provider sandbox fixture | run-owned resource namespace | K12-P07 | runId, db/schema/queue namespace | cleanup uncertainty blocks reuse |
| Cleanup known | child processes/resources | cleanup receipt | K12-P08 | cleanupState, childPid/resourceIds | orphaned resource quarantined |
| Evaluator independence | CI/proof tooling | candidate output separated from policy | K12-P09 | policyVersion, evaluatorVersion | candidate cannot self-certify |
| Negative control sensitivity | proof evaluator | deliberate failing fixture/case | K12-P10 | negativeControlId | green negative control invalidates evaluator |
