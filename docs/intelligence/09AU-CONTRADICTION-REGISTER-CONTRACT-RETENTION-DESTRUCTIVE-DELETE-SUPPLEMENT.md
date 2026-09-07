# KeyFlowOS Contradiction Register — Contract Retention / Destructive Delete Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C168 — Contract retention state implies a preservation boundary while the live delete door can erase the Contract and Contract-owned evidence without consulting it

KeyFlow persists and exposes:

```text
retentionPolicy
retentionUntil
```

but `deleteContract()` hard-deletes by Contract ID without reading either field.

The database then cascades deletion to Contract-owned parties, extracted terms, versions, alerts and tag mappings.

Therefore the same domain can represent:

```text
retain this Contract / retain until time T
```

and simultaneously allow:

```text
delete now
```

without an observed policy decision reconciling those meanings.

### Canonical contradiction

```text
DECLARED RETENTION STATE
!= LOAD-BEARING RETENTION POLICY
```

unless destructive operations are actually constrained or the fields are explicitly classified as non-enforceable descriptive metadata.

### Required resolution pressure

Choose one coherent contract:

```text
A. retention is enforceable domain/control state
→ destructive lifecycle must consult it and preserve required deletion evidence
```

or:

```text
B. retention is descriptive-only metadata
→ product/API naming and affordances must not imply a load-bearing retention control
```

Do not retain the current ambiguity.

This contradiction does not assert any jurisdiction-specific legal duty or mandatory retention duration.

No production implementation is authorized by this contradiction.
