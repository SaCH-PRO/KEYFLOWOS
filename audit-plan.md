# KEYFLOWOS Module Audit & Next-Phase Plan

## Audit Findings Summary

### P0 Critical (Break Production/AI Core)
1. **AI Approval → Execution Gap**: `GovernanceService.resolveApproval()` marks items approved but NEVER executes the plan step. Approving a KEY action is a dead end.
2. **KEY Tool Registry 100% Stubs**: `KeyCommandService.executeApprovedPlan()` calls `key-tool.registry.ts` where every tool returns `{success: true, data: {}}`. The entire legacy KEY "Do It For Me" pipeline is a no-op.
3. **Evidence Frontend Completely Broken**: Frontend uses `status`, `fileName`, `notes`, `taskType`, `taskId` that don't exist in Prisma schema. Search/filter is non-functional.
4. **Approvals Frontend Type Mismatch**: Frontend submits `priority`, `amount`, `currency` that don't exist in schema. `type` maps to wrong field.
5. **Call Tasks Duration Bug**: Schema stores seconds, frontend displays as minutes ("120m" for a 2-minute call).
6. **Commerce Bulk Quote Send Bypasses viewToken**: Bulk send sets status=SENT directly, never mints public `viewToken`, breaking client links.
7. **Commerce Create Invoice/Quote Missing productId**: Line items on create cannot reference products, breaking COGS/margin tracking.
8. **Manual Mark Paid Creates No Payment Row**: Invoice status flips to PAID but no Payment record created, breaking reconciliation.
9. **CRM minRevenue Smart Filter Dead**: Frontend passes it, backend never reads it. Filter silently ignored.

### P1 High (Feature Gaps)
10. **Missing Detail Pages**: Approvals, Evidence, Call Tasks, Assets have list-only UIs.
11. **Missing Event Emitters**: 10 of 20 default AI triggers reference events never emitted (`quote.stale`, `booking.no_show`, `recurring_invoice.due`, `manager.overload_detected`, etc.).
12. **No Marketing/Social DTOs**: All endpoints accept `Body() any` — no validation, no types.
13. **No Asset Upload UI**: Assets page is read-only; backend supports create but frontend has no upload flow.
14. **Approvals → Finance Disconnect**: Expense/PO/refund approvals approved but no finance records created.

### P2 Medium (Architecture Debt)
15. **Flow Orchestrator Bypasses Module Services**: All 60+ tools call Prisma directly, duplicating business rules.
16. **Dual Chat Surfaces**: `AiAdvisorService`, `FlowOrchestratorService`, `ConversationalAIService` are three parallel chat paths.
17. **Feedback Loop Never Wired**: `applyFeedbackToPlan()` is never called.
18. **Journey Delay Ignored**: `delayMinutes` in journey steps is never read.

## Recommended Execution Plan

### Phase A — Harden Core (Must Complete First)
- Fix AI approval→execution gap
- Fix frontend type mismatches (Evidence, Approvals, Call Tasks)
- Fix commerce critical bugs (bulk quote send, productId on create, mark-paid)
- Fix CRM minRevenue filter
- Add missing event emitters for default triggers
- Add detail pages (Approvals, Evidence, Call Tasks, Assets)

### Phase B — Build Next Extensions
- **L4 Settings Panel**: Capacity hours, skills, authority grants UI
- **Auto-Invoice from Content Delivery**: On content deliver, auto-generate invoice from deliverables
- **AI-Generated Call Scripts**: Pre-call script generation based on contact context + deal data
- **Cross-Business Intelligence**: Aggregate metrics across businesses for benchmarking

This audit took 4 parallel deep dives across 12+ modules. The codebase is feature-rich but carries quality debt in the AI execution pipeline and frontend-schema alignment.
