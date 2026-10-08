# R1-B — Legacy Capability Exact Equivalence Matrix

Status: CHARACTERIZED / PARTIAL_EQUIVALENCE
Programme: KIGP-001
Source packet: R1-B-CAPABILITY-FALLBACK-DISPOSAL-PACKET.md

## Key finding

The 14-tool KeyToolRegistryService cannot be deleted as one mechanical cleanup. Some semantics have canonical FLOW_TOOLS equivalents, some are only partial overlaps, and several are still unique reachable behavior. KeyCommandService also constructs legacy names and falls back to this registry, so deleting the fallback today would break behavior.

## Equivalence table

| Legacy capability | Canonical candidate | Classification | Required disposition |
|---|---|---|---|
| finance.summarizeCashPosition | finance_cashflow / finance reports | RELATED_DISTINCT | compare exact output and date semantics; do not alias blindly |
| finance.calculateSafeToSpend | none found in FLOW_TOOLS | MISSING_CANONICAL | register canonical capability around existing SafeToSpendService or deliberately retire behavior |
| finance.listOverdueInvoices | finance_view_receivables | SPECIALIZATION | preserve overdue-invoice list semantics or route via authoritative receivables service |
| finance.generateMoneyMoves | none found in FLOW_TOOLS | MISSING_CANONICAL | canonicalize existing MoneyMovesService; this service is otherwise reached by the legacy tool |
| finance.cashflowForecast | finance_cashflow is historical cash movement, not forecast | RELATED_DISTINCT | add a canonical forecast capability around CashflowForecastService if behavior remains required |
| finance.createInvoiceReminderDraft | draft_payment_reminder | LIKELY_ALIAS/SPECIALIZATION | compare input/output; canonical draft tool is preferred owner |
| contacts.recommendFollowUps | create_followup_queue / draft_followup_message / delegation_lead_reactivation | RELATED_DISTINCT | keep recommendation/read semantics separate from mutation/delegation |
| contacts.createCommandItem | create_task / command capabilities | RELATED_DISTINCT | preserve CommandItem meaning if still required; do not map to ProjectTask by name alone |
| commerce.summarizeRevenue | commerce adapter get_revenue_summary and report capabilities | LIKELY_ALIAS/SPECIALIZATION | converge on one authoritative revenue aggregation path |
| timeline.createReminder | calendar/task capabilities | RELATED_DISTINCT | identify whether reminder is TimelineEvent, CommandItem, calendar event or task before migration |
| connect.scanDrive | no exact FLOW_TOOLS match found | MISSING_CANONICAL | canonicalize ConnectorIntelligenceService scan if still intended as KEY action |
| connect.listDriveIntake | documents/inbox capabilities are not exact | RELATED_DISTINCT | preserve ingestion-review semantics until canonical intake capability exists |
| messages.listMessageIntake | inbox_list_threads | LIKELY_ALIAS/SPECIALIZATION | compare source/status mapping; unified inbox should be preferred if semantics cover intake |
| social.listRecentEngagement | social_list_posts does not provide engagement metrics | MISSING_CANONICAL | do not alias; capability map itself says social engagement metrics remain a gap |

## Architectural consequences

1. The legacy registry is partly a hidden capability island, not merely duplicate code.
2. The correct convergence target is semantic identity first, runtime routing second, deletion last.
3. Canonical capability identity should use FLOW_TOOLS / CapabilityContractService naming.
4. Existing domain services remain implementation owners where they are already authoritative.
5. KeyCommandService must stop constructing `module.legacyName` as if that were canonical identity.

## Safe implementation slices

### B1 — exact aliases
Start only with capabilities whose semantics can be proven equivalent:
- invoice reminder draft -> draft_payment_reminder;
- message intake -> inbox_list_threads if status/source mapping proves equivalent;
- revenue summary -> canonical revenue query if output and accounting basis match.

### B2 — canonicalize unique read/intelligence services
Add canonical FLOW_TOOLS entries that delegate to existing services rather than reimplementing:
- safe-to-spend;
- cashflow forecast;
- money moves;
- Drive scan/intake where product intent remains valid.

### B3 — planner/command naming cutover
Make KeyCommandService plan with canonical capability IDs directly. Unknown canonical capability must fail closed; no silent fallback.

### B4 — fallback removal
Remove the fallback only after all reachable legacy commands have canonical destinations and execution/audit/approval tests pass.

### B5 — registry retirement
Remove KeyToolRegistryService only after repository-wide caller search and runtime tests prove zero required behavior remains.

## No-fake-green tests

- one positive execution per migrated capability;
- exact output equivalence where classified ALIAS;
- explicit non-equivalence tests for forecast vs historical cashflow and engagement vs post listing;
- risk tier cannot decrease accidentally;
- tenant isolation;
- audit/effect evidence preserved;
- no legacy name emitted by KeyCommandService after cutover;
- unknown capability fails rather than falling through;
- repository search proves no runtime caller depends on the retired registry.
