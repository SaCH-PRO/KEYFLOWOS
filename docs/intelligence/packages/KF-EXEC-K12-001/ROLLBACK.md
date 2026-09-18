# KF-EXEC-K12-001 Rollback & Disable Contract

## Reversible
- CI invocation wiring;
- evaluator binary/script version;
- report adapter;
- policy manifest version;
- local developer convenience wrappers.

## Never roll back to
- treating missing required evidence as success;
- count-only proof;
- unsafe/shared resource use;
- silent cleanup uncertainty;
- candidate self-certification.

## Resource rollback
If a run-owned resource cannot be cleaned:
1. mark lease QUARANTINED;
2. block reassignment;
3. record resource IDs without secrets;
4. require explicit repair/cleanup;
5. only then mark reusable.

## Version rollback
A prior evaluator/policy may be reactivated only if it satisfies the current minimum safety invariants. Otherwise use forward repair.
