# KEYFLOWOS Surgical Implementation Packages

Status: **ACTIVE NON-CODING PACKAGE-HARDENING PROGRAMME**

Execution packets define *what* must be implemented. Surgical packages define *exactly how an implementation agent must approach, observe, debug, prove, and hand back that packet* without inventing architecture during coding.

A hardened package lives under:

```text
docs/intelligence/packages/<EXECUTION-PACKET-ID>/
```

and contains the package artifacts defined in `PACKAGE-STANDARD.md`.

## Hardening levels

- **L0 — Concept only:** product/journey idea.
- **L1 — Execution packet:** bounded objective, dependencies, invariants and proof families.
- **L2 — Surgical package:** machine-readable scope + traceability + debug/proof/rollback/agent handoffs.
- **L3 — Characterized package:** L2 plus current-main no-edit source characterization and exact file/function migration plan.
- **L4 — Implemented package:** authorized code changes exist.
- **L5 — Proven package:** admitted runtime/migration/provider/browser proof satisfies declared scope.
- **L6 — Released package:** controlled rollout accepted.

Current programme target before any code changes: **L2 for all 35 execution packets**.

Current hardened count: **1 / 35** — `KF-EXEC-K12-001`.

L3 deliberately waits for an explicitly authorized current-main characterization session where source drift may be inspected in detail without mutating production code.
