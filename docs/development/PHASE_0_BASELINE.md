# Phase 0 Execution Foundation — Baseline Snapshot

> Generated: 2026-06-26  
> Branch: `main`  
> Base commit: current `HEAD`

This document is a **snapshot of the Phase 0 exit baseline**, not a plan. It captures the state of the execution foundation before Phase 1 (Organ Maturation) begins.

## Verification Checklist

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | `CommunicationsService` is real | ✅ Confirmed | `apps/server/src/modules/communications/communications.service.ts` delegates to `AiMessageSenderService`, `DeliveryQueueService`, `OutboundContentService`, `KeyInboxService`, and `KeyInboxReplySenderService` |
| 2 | `KeyCortexConnectorService` uses typed adapters | ✅ Confirmed | `apps/server/src/modules/key-cortex/key-cortex-connector.service.ts` routes through `CrmAdapterService`, `CommunicationsAdapterService`, `KeyCortexBridgeAdapterService`, etc. |
| 3 | Approval unification path exists | ✅ Confirmed | `KeyCortexApprovalOrchestratorService` + `KeyActionProposalService` are the canonical approval path; legacy `ApprovalRequest` is shadow-migrated to `KeyActionProposal` on creation |
| 4 | Autonomy safety profile + tier enforcement | ✅ Confirmed | `BusinessAutonomyProfile` model includes `globalKillSwitch`, `maxDailyAutoActions`, `maxDailySpendTtd`, and `maxTierWithoutApproval`; `KeyAutonomySafetyService` enforces all four gates |
| 5 | Idempotency + saga layer | ✅ Confirmed | `IdempotencyKey`, `SagaExecution`, `SagaStep` models exist; `KeyIdempotencyService` and `KeyCortexSagaService` are wired into `KeyCortexToolRegistryService` |
| 6 | Unified memory retrieval | ✅ Confirmed | `UnifiedMemoryRetrievalService`, `UnifiedMemoryWriterService`, and `KeyCortexMemoryRetrievalService` provide a single memory interface |
| 7 | Every tool execution emits a `BusinessEvent` | ✅ Confirmed | `KeyCortexToolRegistryService` emits via `KeyCortexAuditService` (preferred) or `KeyCortexEventBusService` fallback after every handler attempt |
| 8 | `tsc --noEmit` | ✅ Clean | Run in `apps/server` with no errors |
| 9 | Key-cortex + key-autonomy test suite | ✅ 330+ passing | All key-cortex and key-autonomy spec files pass |

## Type Safety

- `npx tsc --noEmit` executed in `apps/server`: **no errors**.

## Test Summary

```
Test Files  45 passed (45)
Tests       330 passed (330)
Duration    ~18s
```

Run command:
```bash
cd apps/server && pnpm vitest run src/modules/key-cortex src/modules/key-autonomy --reporter=dot
```

## What Is in the Baseline

1. **Real communications facade** — `CommunicationsService` is no longer a stub; it delegates to existing senders and returns real results.
2. **Canonical approval path** — `KeyActionProposal` is the single source of truth. Legacy `ApprovalRequest` records are automatically shadow-migrated via `KeyCortexApprovalOrchestratorService.propose()` with `sourceType: 'HUMAN_WORKFLOW'`, and the proposal ID is stored back on `ApprovalRequest.migratedToProposalId`.
3. **Global autonomy safety** — `BusinessAutonomyProfile` provides the kill switch, daily action cap, daily spend cap, and `maxTierWithoutApproval` tier enforcement. Tools with `riskTier > maxTierWithoutApproval` are blocked from autonomous execution and flagged as `requiresApproval: true`.
4. **Idempotency and sagas** — `IdempotencyKey` prevents duplicate autonomous actions; `SagaExecution` / `SagaStep` log multi-step operations with compensation support.
5. **Decomposed connector** — `KeyCortexConnectorService` is a thin dispatcher; capability registry, context assembly, and typed adapters live in focused services.
6. **Unified memory** — Read/write memory paths are consolidated behind `UnifiedMemoryRetrievalService` / `UnifiedMemoryWriterService`.
7. **Tool execution audit** — Every tool attempt writes a `BusinessEvent` with `businessId`, `actorId`, `actionType` (tool name), `subjectType`/`subjectId`, `before`/`after`, and identity thread fields (`correlationId`, `commandId`, `sessionId`, `proposalId`).
8. **Bridge adapter placeholder removed** — `genome.get_dna` in `KeyCortexBridgeAdapterService` now delegates to `KeyCortexGenomeBridgeService.getDnaScores()` instead of returning a placeholder.

## Remaining Work for Later Phases

- `KeyCortexReasoningService` is still ~1,480 lines; further decomposition into `KeyCortexPromptBuilderService` and `KeyCortexRouteDecisionService` is tracked for a future refactor if needed.
- Some bridge adapter actions (e.g., `intelligence.analyze_sentiment`, `analytics.create_dashboard`) remain simplified implementations pending organ maturation.

## Next Steps

Begin Phase 1: Organ Maturation.
