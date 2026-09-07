# KeyFlowOS Contradiction Register — Command Center Reachability Supplement

Status: CANONICAL CONTINUATION — J17 COMMAND CENTER / PRIORITY REACHABILITY
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C131 — overdue invoice domain reality vs absent TemporalFlow materialization used by Command Center priority logic

**Status:** VERIFIED ACTIVE CONTRADICTION

The application can hold and act on:

```text
Invoice.status = OVERDUE
```

and emit:

```text
invoice.overdue
```

while the Command Center's Temporal overdue-invoice priority branch requires a separate durable representation:

```text
TemporalFlowEvent(source=APP, type=invoice.overdue)
```

No load-bearing standard invoice-lifecycle bridge into that TemporalFlow representation was observed.

The resulting contradiction is:

```text
AUTHORITATIVE BUSINESS CONDITION EXISTS
vs
OPERATOR TEMPORAL PROJECTION CONDITION MAY NOT EXIST
```

This can cause the persistent Command Queue to represent overdue collection work while the synthesized Temporal priority path omits it for wiring reasons rather than business semantics.

### Target resolution

Choose an explicit projection owner/admission path rather than relying on accidental parallel representations:

```text
Invoice overdue occurrence
→ canonical operator-work/attention admission decision
→ load-bearing projection materialization
→ deterministic resolution/supersession
```

If the persistent obligation/CommandItem model is the stronger operator representation for this condition, the target may remove the redundant TemporalFlow requirement rather than mirroring merely for symmetry.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J7, J17, J23.

No production implementation is authorized by this contradiction.
