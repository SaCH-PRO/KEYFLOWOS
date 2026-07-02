# KEY (KeyCortex / Key Flow) Audit Report

**Branch:** `feat/key-phase-1-organ-maturation`  
**Date:** 2026-06-29  
**Audited against:** KEY specification and target documents listed in [Sources](#sources).  
**Method:** Read-only code review with focused exploration of `apps/server/src/modules/key-cortex/`, `key-autonomy/`, `key-inbox/`, `key-connector/`, `business-genome/`, `business-command-center/`, `command/`, and related web surfaces.

---

## Executive Summary

KEYFLOWOS’s KEY layer has moved from a collection of prototypes to a coherent architecture: a canonical query pipeline, an autonomy orchestrator, a unified command queue, a Business Genome kernel, and the foundations of omnichannel ingestion. Most of the **Phase 0 safety blockers** called out in the Mind/Soul/Evolution master plan are resolved, and the Phase 1 Business Genome surface is largely complete.

However, the implementation still has significant **surface-area gaps** and **architectural drift** relative to the specs:

- **Key Connect / Key Inbox** is the highest-risk area. The codebase has two competing ingestion abstractions (`IngestionItem` vs. `KeyInboxThread`), connector adapters do not implement the spec’s ingestion hooks, and social webhooks are not signature-verified.
- **KeyAutonomy** has a working orchestrator and approval flow, but the deterministic safety shell is not wired into execution, and the most critical service (`AutonomyOrchestratorService`) has no direct unit tests.
- **Business Genome** has the schema and UI in place, but Genesis writes invalid `verificationStatus` values and the Blueprint-based Phase 1 scoring is not yet reconciled with the fact-based KEY Genome scoring.
- **KeyCortex** is structurally sound, but several compensations are TODO no-ops, semantic memory indexing is skipped, and the Business Office Copilot unified UI is outside the backend scope.

Overall maturity vs. the 10/10 target: **backend architecture ~7/10, feature completeness ~5/10, test coverage ~6/10, security/governance ~5/10**.

---

## Sources

- `docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md`
- `docs/KEY_GENOME_ROADMAP.md`
- `docs/KEYFLOWOS_10_OUT_OF_10_CONSTRUCTION_MANUAL.md`
- `docs/KEYFLOWOS_PHASE_D_REMAINING_WORK_PLAN.md`
- `docs/KEYFLOWOS_AUTOMATION_BOT_FLOW_AGENT_MASTER_PLAN.md`
- `docs/superpowers/specs/2026-05-31-key-connect-key-inbox-design.md`
- `docs/superpowers/plans/2026-05-31-key-connect-key-inbox-plan.md`
- `docs/superpowers/specs/2026-06-17-business-genome-phase-1-design.md`
- `attached_assets/keyflow_ai_business_office_master_spec_1776164895811.docx`
- `attached_assets/keyflow_ai_business_office_companion_roadmap_1776164895755.docx`

---

## Maturity Matrix

| Capability Area | Spec Target | Implementation Status | Risk Level |
|---|---|---|---|
| **KeyCortex Mind** — reasoning pipeline, context v2, memory, tool registry | Mind/Soul plan Phase 0–1 | ✅ Mostly implemented | Medium |
| **KeyCortex Soul** — autonomy orchestrator, constitution, approval | Mind/Soul plan Phase 0–1 | ⚠️ Foundation; safety shell not wired | High |
| **KeyCortex Evolution** — eval harness, learning, consolidation | Mind/Soul plan Phase 0–1 | ⚠️ Foundation; live loops incomplete | Medium |
| **Key Connect / Key Inbox** — unified ingestion, connector hooks, webhooks | 2026-05-31 design spec | ❌ Architecture drift; hooks missing | **Critical** |
| **Business Genome / KeyGenome** — schema, scoring, chat, gate | Phase 1 design + roadmap | ⚠️ Mostly implemented; scoring split | High |
| **Command Center / KeyAutonomy** — pulse, briefing, queue, approvals | Phase D plan | ✅ Mostly implemented | Medium |
| **Voice / Device Capture** | Phase D + master plan | ⚠️ Voice audio storage placeholder | Medium |
| **Business Office Copilot UI** | AI Business Office spec | ❌ Not in backend scope | High |

---

## 1. KeyCortex (Mind / Soul / Evolution)

### 1.1 What is implemented

| Capability | Evidence |
|---|---|
| Unified query pipeline with routing, genome context, memory, LLM, tool loop, execution, learning | `apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts` |
| Adaptive router | `apps/server/src/modules/key-cortex/adaptive-router.service.ts` |
| Genome-enriched context and recommendations | `genome-context.service.ts`, `key-cortex-genome-bridge.service.ts` |
| Full business context v2 (CRM, commerce, bookings, autopilot, temporal, inbox, device) | `key-cortex-context-v2.service.ts` |
| Unified memory retrieval (semantic + episodic) | `unified-memory-retrieval.service.ts` |
| Memory writes persisted to DB, Redis as read cache | `key-cortex-memory.service.ts` → `UnifiedMemoryWriterService` → `AiMemoryService` |
| Canonical tool registry with risk tiers / approval / compensation | `key-cortex-tool-registry.service.ts` |
| Proactive engine (morning brief, EOD, weekly digest, signal scan) | `key-proactive-engine.service.ts` |
| Goal/plan creation, simulation, saga execution | `key-cortex-planner.service.ts`, `key-cortex-saga-executor.service.ts` |
| Autonomy bypass fix — execution now flows through `AutonomyOrchestratorService` | `key-cortex-query-pipeline.service.ts:404-465` |
| Eval harness with 5 built-in suites | `eval-harness.service.ts` |
| Learning loop, memory consolidation, self-assessment | `key-cortex-learning.service.ts`, `memory-consolidation.service.ts`, `self-assessment.service.ts` |

### 1.2 Gaps

| # | Gap | Evidence | Severity |
|---|---|---|---|
| KC-1 | Calendar and communications compensations are TODO no-ops | `key-cortex-compensation.service.ts` | High |
| KC-2 | Semantic memory indexing is skipped in `UnifiedMemoryWriterService` | `unified-memory-writer.service.ts` | High |
| KC-3 | Voice audio storage returns a local placeholder path | `key-cortex-voice.service.ts` | Medium |
| KC-4 | `KnowledgeIngestionService.ingestUrl` records URL but does not fetch content | `knowledge-ingestion.service.ts` | Medium |
| KC-5 | Heavy `as any` casts and `forwardRef` chains create brittleness | across `key-cortex` modules | Medium |
| KC-6 | Live value-learning feedback loop not wired beyond eval harness | `value-learning.service.ts` | Medium |
| KC-7 | Business Office Copilot unified control center UI not implemented | not in reviewed server scope | High |

### 1.3 Test coverage

- ~57 spec files, ~10 KLOC tests, ~22% test-to-code ratio.
- Strong coverage of planner, saga executor, compensation (CRM/commerce paths), context v2.
- Missing direct specs for: `autonomy-orchestrator.service.ts`, `value-learning.service.ts`, `key-proactive-engine.service.ts`, `key-cortex-learning.service.ts`, `key-cortex-voice.service.ts`.

---

## 2. Key Connect / Key Inbox

### 2.1 What is implemented

| Capability | Evidence |
|---|---|
| Prisma `IngestionItem` model with dedupe hashes, statuses, proposed actions | `packages/db/prisma/schema.prisma` |
| Prisma `ConnectorStatus` intake columns (`intakeEnabled`, `autoApproveThreshold`) | `packages/db/prisma/schema.prisma` |
| Prisma `WebhookDeliveryLog` audit table | `packages/db/prisma/schema.prisma` |
| `IngestionOrchestrator` and `IngestionListener` skeleton | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` |
| Thread/message-based Key Inbox API and UI | `apps/server/src/modules/key-inbox/key-inbox.service.ts`, `key-inbox.controller.ts`, `apps/web/src/app/app/key-inbox/page.tsx` |
| `/app/key-connect` hub UI | `apps/web/src/app/app/key-connect/page.tsx` |
| Google Drive ingestion via legacy `DriveIntakeFile` path | `apps/server/src/modules/ai/connector-intelligence.service.ts` |

### 2.2 Gaps

| # | Gap | Evidence | Severity |
|---|---|---|---|
| KI-1 | **Two parallel ingestion models**: `IngestionItem` queue vs. `KeyInboxThread`/`KeyInboxMessage`. Real messaging flows bypass `IngestionOrchestrator`. | `key-inbox.service.ts`, `ingestion-orchestrator.service.ts` | Critical |
| KI-2 | Connector adapters do not implement `syncToIngestion`, `parseInbound`, or `verifyWebhook`. | `core/connectors/connector.interface.ts`, all connector implementations | Critical |
| KI-3 | `IngestionOrchestrator.receive()` never checks `ConnectorStatus.intakeEnabled`. | `ingestion-orchestrator.service.ts` | High |
| KI-4 | `autoApproveThreshold` is never read; `auto_executed` status never set. | `connector.controller.ts`, DTOs only | High |
| KI-5 | `correct()` updates `IngestionItem.proposedActions`, but `execute()` uses legacy orchestrator plans, so corrections are ignored. | `ingestion-orchestrator.service.ts` | High |
| KI-6 | Optimistic-lock failures return `BadRequestException` instead of `409 Conflict` with current state. | `ingestion-orchestrator.service.ts` | Medium |
| KI-7 | Meta social webhooks do not verify `X-Hub-Signature-256`. | `apps/server/src/modules/social/meta-social-ingestion.service.ts`, `SocialController` | **Critical** |
| KI-8 | WhatsApp webhook verification is optional when secrets are missing. | `apps/server/src/modules/whatsapp/whatsapp.service.ts` | High |
| KI-9 | `WebhookDeliveryLog` is dead code — no webhook controller writes to it. | across webhook controllers | Medium |
| KI-10 | Key Inbox controller missing `ModuleScopeGuard` (`operations` scope). | `key-inbox.controller.ts` | Medium |
| KI-11 | Legacy `/app/inbox/intake` and `/app/inbox/unified` pages still live instead of redirecting. | `apps/web/src/app/app/inbox/intake/page.tsx`, `unified/page.tsx` | Medium |
| KI-12 | Separate `key-connector` module duplicates `core/connectors` and is unused/un-guarded. | `apps/server/src/modules/key-connector/` | Medium |
| KI-13 | No ingestion unit tests (`IngestionOrchestrator`, adapters, webhook verification). | `apps/server/src/modules/ingestion/` | High |

---

## 3. Business Genome / KeyGenome

### 3.1 What is implemented

| Capability | Evidence |
|---|---|
| Full Prisma kernel: `GenomeFact`, `GenomeEvidence`, `GenomeSignal`, `GenomeModuleReadiness`, `GenomeRecommendation`, `GenomeExperiment`, `GenomeChatMessage`, etc. | `packages/db/prisma/schema.prisma` |
| Blueprint cache fields (`genomeIntegrity`, `genomeDnaScores`, `genomeStage`, `genesisCompleted`, etc.) | `packages/db/prisma/schema.prisma` |
| DNA-section scoring, three-pillar minimum, stage determination | `apps/server/src/modules/blueprint/blueprint.service.ts` |
| Fact-level scoring formula | `apps/server/src/modules/business-genome/key-genome/genome-scoring.service.ts` |
| Module readiness computation | `apps/server/src/modules/business-genome/key-genome/genome-module-readiness.service.ts` |
| Genome Chat backend with proposed updates | `apps/server/src/modules/business-genesis/genome-chat.service.ts` |
| Business Genome UI tab with 17 sub-tabs | `apps/web/src/app/app/profile/components/business-genome-tab.tsx` |
| Client-side genome gate and route redirects | `use-genome-gate.ts`, onboarding redirect pages |
| Genesis → Key Genome fact sync (dirty/uncommitted) | `business-genesis.service.ts` |
| Backfill from Blueprint to Genome facts | `key-genome-backfill.service.ts` |

### 3.2 Gaps

| # | Gap | Evidence | Severity |
|---|---|---|---|
| BG-1 | `BusinessGenesisService.syncAnswersToGenomeFacts` writes invalid `verificationStatus` values (`'VERIFIED'`, `'ASSUMED'`) outside the allowed enum. | `business-genesis.service.ts:448` | **Critical** |
| BG-2 | Two competing scoring systems: Blueprint-derived Phase 1 scores vs. fact-based KEY Genome scores. | `blueprint.service.ts`, `genome-scoring.service.ts` | High |
| BG-3 | No unified `KeyGenomeService`; logic split between `BusinessGenesisService` and fact/evidence services. | missing `key-genome.service.ts` | Medium |
| BG-4 | Genome Chat updates write to Blueprint but do not create `GenomeFact`/`GenomeEvidence` directly. | `genome-chat.service.ts` | Medium |
| BG-5 | `BlueprintService.updateBlueprint` does not recompute module readiness or fact scores. | `blueprint.service.ts` | Medium |
| BG-6 | `genomeDnaConfidence` is a copy of `genomeDnaScores` (Phase 1 placeholder). | `blueprint.service.ts:1844` | Low |
| BG-7 | Constitution auto-version on integrity change ≥ 1 point not implemented. | `ConstitutionVersionService`, `BlueprintService` | Low |
| BG-8 | `GenomeGateGuard` only guards one endpoint (`PATCH /blueprint/.../dna/:section`). | `genome-gate.guard.ts`, `blueprint.controller.ts` | Low |
| BG-9 | `GenomeFactService` and `GenomeExperimentService` lack dedicated unit tests. | missing spec files | Medium |

---

## 4. Command Center / KeyAutonomy

### 4.1 What is implemented

| Capability | Evidence |
|---|---|
| Command Center snapshot API: pulse, briefing, governance, priorities, approvals, risks | `business-command-center.service.ts`, `business-command-center.controller.ts` |
| Web Command Center UI | `apps/web/src/app/app/command-center/page.tsx` + components |
| Command queue API with full lifecycle (complete, approve, execute, assign, dismiss, snooze, reopen, bulk) | `apps/server/src/modules/command/command.service.ts`, `command.controller.ts` |
| `AutonomyOrchestratorService` as single verdict source | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts` |
| Autonomy level resolution, rule providers, constitution check | `autonomy-level.service.ts`, `constitution-values.service.ts`, `key-action-policy.service.ts`, etc. |
| `KeyActionProposal` approval/execution flow | `key-action-proposal.service.ts`, `key-action-proposal.controller.ts` |
| Web proposal UI | `apps/web/src/app/app/key-autonomy/page.tsx` |
| Autonomy bypass fixed in query pipeline | `key-cortex-query-pipeline.service.ts:404-465` |

### 4.2 Gaps

| # | Gap | Evidence | Severity |
|---|---|---|---|
| KA-1 | `SafetyShellService` is registered but **never invoked** in the execution path. | `safety-shell.service.ts`, `key-action-executor.service.ts`, `key-action-proposal.service.ts` | **Critical** |
| KA-2 | `SafetyShellService.rollback()` only logs compensations. | `safety-shell.service.ts:65-73` | High |
| KA-3 | No direct unit test for `AutonomyOrchestratorService`. | missing `autonomy-orchestrator.service.spec.ts` | High |
| KA-4 | Remaining `as any` casts in autonomy orchestrator. | `autonomy-orchestrator.service.ts:141,196,258,473` | Medium |
| KA-5 | `SemanticMemoryService.store()` still uses `$executeRawUnsafe` with string interpolation. | `semantic-memory.service.ts:40-50` | High |
| KA-6 | `AuthorityGrantRuleService.inferScope()` recognizes only a narrow keyword set. | `authority-grant-rule.service.ts:33-44` | Medium |
| KA-7 | `ComplianceMapService` has no API/controller exposure. | `compliance-map.service.ts` | Low |
| KA-8 | Web `CommandCenterItemType` missing `GENOME_SIGNAL` and `GENOME_RECOMMENDATION`. | `apps/web/src/lib/api/business-command-center.ts` | Low |

---

## 5. Prioritized Recommendations

### P0 — Do before expanding production autonomy

1. **Fix invalid Genome `verificationStatus` values** (`BG-1`). Map Genesis answers to the valid enum (`INFERRED`, `USER_VERIFIED`, `UNVERIFIED_IMPORTED`, `STALE`, `DISPUTED`).
2. **Wire `SafetyShellService.check()` into action execution** (`KA-1`), or document why it is intentionally deferred.
3. **Enforce Meta social webhook `X-Hub-Signature-256` verification** (`KI-7`) and fail closed.
4. **Fail closed on WhatsApp webhooks when secrets are missing** (`KI-8`).
5. **Decide on a single ingestion model** (`KI-1`) and either migrate messaging flows to `IngestionItem` or update the spec to match the thread/message implementation.

### P1 — Hardening

6. Implement real calendar/communications compensations (`KC-1`).
7. Wire semantic memory indexing in `UnifiedMemoryWriterService` (`KC-2`).
8. Add `AutonomyOrchestratorService` unit tests (`KA-3`).
9. Parameterize `SemanticMemoryService.store()` like `search()` was fixed (`KA-5`).
10. Honor `ConnectorStatus.intakeEnabled` and `autoApproveThreshold` (`KI-3`, `KI-4`).
11. Fix `IngestionOrchestrator.correct()` so corrections propagate to execution (`KI-5`).
12. Add `ModuleScopeGuard` to Key Inbox endpoints (`KI-10`).
13. Add tests for `GenomeFactService` and `GenomeExperimentService` (`BG-9`).

### P2 — Completeness

14. Implement `KnowledgeIngestionService.ingestUrl` content fetching (`KC-4`).
15. Replace voice audio placeholder with persistent storage (`KC-3`).
16. Reconcile Blueprint-based and fact-based Genome scoring (`BG-2`).
17. Build the Business Office Copilot unified control center UI (`KC-7`).
18. Redirect legacy `/app/inbox/*` pages to `/app/key-inbox` (`KI-11`).
19. Resolve or remove the duplicate `key-connector` module (`KI-12`).

---

## 6. Test Coverage Summary

| Area | Spec Files | Coverage Notes |
|---|---|---|
| KeyCortex | ~57 | Strong for planner/saga/context; weak for autonomy, proactive, learning, voice |
| Key Inbox / Ingestion | 4 (thread-based) | No ingestion/orchestrator/webhook tests |
| Business Genome | ~27 | Good for scoring/readiness/backfill; missing `GenomeFactService`/`GenomeExperimentService` tests |
| Command Center | 3 | Good service/controller coverage |
| KeyAutonomy | 8 | Missing `AutonomyOrchestratorService`, `SafetyShellService`, `ComplianceMapService` tests |

---

## 7. Conclusion

KEY has a solid architectural foundation and has closed its most dangerous Phase 0 blockers. The biggest risks are now **security/integrity** (unsigned social webhooks, invalid Genome enum values, inert safety shell) and **architectural drift** (dual ingestion models, dual scoring models). Addressing the P0 items will make the system safe and coherent enough to iterate on; the P1/P2 items can then be tackled incrementally without restructuring.
