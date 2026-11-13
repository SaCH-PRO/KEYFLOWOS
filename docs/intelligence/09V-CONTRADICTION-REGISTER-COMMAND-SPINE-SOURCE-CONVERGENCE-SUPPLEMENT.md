# KeyFlowOS Contradiction Register — Command Spine Source Convergence Supplement

Status: CANONICAL CONTINUATION — J17 OPERATOR WORK / SOURCE CONVERGENCE
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C132 — resolved source condition vs still-open CommandItem projection

**Status:** VERIFIED ACTIVE CONTRADICTION

The persistent Command spine can create actionable work from a reversible source predicate such as:

```text
Invoice.status = OVERDUE
→ CommandItem(COLLECT_RECEIVABLE, OPEN)
```

but the inspected implementation has no load-bearing inverse lifecycle that guarantees:

```text
Invoice no longer overdue
→ corresponding CommandItem resolves/supersedes
```

`CommandBridgeService.resolveCommandsForEntity()` exists but has no observed caller, and the generator does not reconcile existing rows against changed source state.

The contradiction is therefore:

```text
AUTHORITATIVE SOURCE SAYS CONDITION RESOLVED
vs
OPERATOR WORK PROJECTION CAN STILL SAY OPEN / ACTIONABLE
```

### Target resolution

Every source-derived durable command/work projection needs explicit reverse convergence:

```text
source occurrence/state
→ projection admission
→ stable source/projection identity
→ source mutation/resolution
→ deterministic projection update / resolve / supersede
```

A periodic regeneration pass that only creates/skips is insufficient.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J7, J17, J18, J23.

No production implementation is authorized by this contradiction.
