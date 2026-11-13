# R1-B — Capability Registry / Fallback Disposal Packet

Status: READY_FOR_IMPLEMENTATION_REVIEW
Programme: KIGP-001
Owner candidates: FLOW_TOOLS / CapabilityContractService / KeyCortexToolRegistryService / KeyCommandService
Prerequisite: R0-B complete

## Objective
Remove semantic ambiguity caused by the live `KeyToolRegistryService` fallback without creating another registry.

## Current facts
- `FLOW_TOOLS` is the documented/tested canonical executable catalogue.
- `CapabilityContractService` projects canonical capability identity.
- `KeyCortexToolRegistryService` is a runtime execution/gating projection.
- `KeyCommandService` still falls back to `KeyToolRegistryService`.
- `KeyToolRegistryService` hand-registers 14 finance/contacts/commerce/timeline/connect tools.

## Exact legacy tool set to classify
- finance.summarizeCashPosition
- finance.calculateSafeToSpend
- finance.listOverdueInvoices
- finance.generateMoneyMoves
- finance.cashflowForecast
- finance.createInvoiceReminderDraft
- contacts.recommendFollowUps
- contacts.createCommandItem
- commerce.summarizeRevenue
- timeline.createReminder
- connect.scanDrive
- connect.listDriveIntake
- messages.listMessageIntake
- social.listRecentEngagement

## Required implementation work
1. For each legacy tool, resolve canonical FLOW_TOOLS equivalent or prove no equivalent exists.
2. Compare:
   - parameters;
   - output shape;
   - risk tier;
   - approval semantics;
   - tenant scoping;
   - handler destination;
   - audit/evidence behavior;
   - manual equivalent.
3. Classify each SAME / ALIAS / SPECIALIZATION / MISSING / OBSOLETE.
4. For SAME/ALIAS, route command execution through canonical capability identity/runtime.
5. For SPECIALIZATION/MISSING, either register it canonically in FLOW_TOOLS with tests or document why it must remain isolated.
6. Remove `KeyCommandService` fallback only after all reachable behavior has a canonical replacement.
7. Deprecate/remove `KeyToolRegistryService` only when no caller requires it.

## Hard invariants
- one capability identity per semantic action;
- risk/approval cannot become more permissive during migration;
- no handler can become unreachable silently;
- no false-success path;
- chat/cortex/command surfaces resolve the same capability contract.

## Tests required
- equivalence table checked into architecture docs/generated registry;
- positive execution for every migrated legacy tool;
- approval/risk non-regression;
- unknown capability fails closed;
- no direct fallback after disposal;
- audit/effect evidence still emitted.

## Exit condition
`KeyCommandService` has no ambiguous fallback, and every surviving legacy capability has an explicit canonical identity.
