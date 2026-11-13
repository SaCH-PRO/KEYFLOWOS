# KeyFlowOS Finding Register — Command Center Reachability Supplement

Status: CANONICAL CONTINUATION — J17 COMMAND CENTER / PRIORITY REACHABILITY
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F181 — Command Center Temporal overdue-invoice priority logic is not load-bearing from the standard invoice-overdue lifecycle

**Status:** VERIFIED CROSS-COMPONENT / REACHABILITY FINDING

`TemporalFlowService.analyze()` contains explicit current-priority logic:

```text
recent TemporalFlowEvent
where source = APP
and type = invoice.overdue
and status != RESOLVED
→ urgent item
→ risk item
→ BusinessCommandCenter Temporal priority mapping
```

The standard overdue-invoice lifecycle is separately real:

```text
invoice transitions to status OVERDUE
→ EventEmitter2 emits invoice.overdue
```

and `CommandGeneratorService` independently scans:

```text
Invoice.status = OVERDUE
→ persistent CommandItem(COLLECT_RECEIVABLE)
```

However the inspected repository does not provide a load-bearing bridge from the `invoice.overdue` application event into the `TemporalFlowEvent` rows consumed by `TemporalFlowService.analyze()`:

- `TemporalFlowEvent` direct create/upsert writes are owned by `TemporalFlowService.emit()`;
- repository-wide searches for `invoice.overdue temporalFlow.emit` and `invoice.overdue temporal.emit` return no caller;
- `TemporalFlowModule` registers `TemporalFlowKeyInboxListener` but no generic application-event mirror/listener;
- direct TemporalFlow producers are explicit services/tools such as KEY Inbox, business assets, Blueprint/Genome flows, KEY action execution, calendar sync, controller/manual creation and Cortex adapters;
- the standard invoice-overdue EventEmitter path was not observed to invoke any of them.

Therefore the current Command Center can contain code that says:

```text
if TemporalFlowEvent(APP, invoice.overdue) exists
→ surface overdue-invoice urgency
```

without the normal invoice lifecycle making that row exist.

### Consequence

The persistent Command Queue can surface an overdue invoice via direct domain-state scanning while the synthesized Temporal priority path remains empty, not because the invoice is unimportant or resolved, but because the expected materialization path is absent.

This weakens any assumption that the two Command Center surfaces are merely duplicate projections of the same load-bearing signal. The first-order defect is reachability/materialization, not duplication.

### Canonical distinction

```text
CONSUMER LOGIC EXISTS
!= PRODUCER PATH IS WIRED
!= BUSINESS CONDITION REACHES THE PROJECTION
```

and:

```text
DOMAIN STATE = OVERDUE
!= TemporalFlowEvent(invoice.overdue) EXISTS
```

### Why this is distinct

- F179: an available snapshot source fails and is substituted with healthy-looking emptiness.
- F181: the expected source occurrence may never be materialized into that source at all.
- F120: one canonical occurrence has multiple consequence owners. F181 concerns missing projection/event materialization, not duplicate material consequences.
- existing event-wiring concerns remain relevant, but F181 is the J17 load-bearing product consequence: Command Center priority semantics depend on an unwired occurrence family.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J7, J17, J23.

---

## Target pressure

Do not solve this by indiscriminately mirroring every EventEmitter event into TemporalFlow.

The target needs an explicit event/projection admission contract:

```text
Authoritative domain occurrence
→ decide whether operator temporal projection is warranted
→ stable occurrence/materialization identity
→ durable projection event or direct source adapter
→ source freshness/completeness
→ priority synthesis
→ source-state resolution/supersession propagation
```

If overdue invoices are better represented directly from authoritative Invoice/Command obligation state, remove/rewrite the unreachable Temporal branch rather than creating a redundant event copy merely to satisfy existing code.

No production implementation is authorized by this finding.
