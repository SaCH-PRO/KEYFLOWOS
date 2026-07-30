# KEY Audit Backlog

Derived from `docs/audits/KEY_AUDIT_REPORT.md`.  
Each item maps to a finding in that report and is ready to be turned into an issue or sprint task.

## Legend

- **Sev:** Critical / High / Medium / Low
- **Effort:** S (small, ≤1 day), M (medium, 1–3 days), L (large, 3–7 days), XL (>1 week)
- **Order:** Suggested sequence within priority band

---

## P0 — Blockers (fix before production autonomy expansion)

| ID | Area | Task | Sev | Files / Entry Points | Acceptance Criteria | Order | Effort |
|---|---|---|---|---|---|---|---|
| P0-1 | Business Genome | Fix invalid `verificationStatus` values written by Genesis → Genome fact sync | Critical | `apps/server/src/modules/business-genesis/business-genesis.service.ts:448`, `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts` | Genesis fact sync uses only valid enum values (`INFERRED`, `USER_VERIFIED`, `UNVERIFIED_IMPORTED`, `STALE`, `DISPUTED`); existing bad rows backfilled or rejected; tests added | 1 | S |
| P0-2 | KeyAutonomy | Wire `SafetyShellService.check()` into action execution path | Critical | `apps/server/src/modules/key-autonomy/safety-shell.service.ts`, `key-action-proposal.service.ts`, `key-action-executor.service.ts` | Every `KeyActionProposal.execute()` and `KeyActionExecutorService.execute()` calls `safetyShell.check()` before running; blocked actions return clear error; tests cover idempotency/precondition failures | 2 | M |
| P0-3 | Key Connect | Enforce `X-Hub-Signature-256` verification on Meta social webhooks | Critical | `apps/server/src/modules/social/meta-social-ingestion.service.ts`, `SocialController` | Webhook controller computes HMAC-SHA256 signature and returns `400` on mismatch; tests verify pass/fail cases; no unsigned fallback | 3 | M |
| P0-4 | Key Connect | Fail closed on WhatsApp webhooks when verification secrets are missing | High | `apps/server/src/modules/whatsapp/whatsapp.service.ts`, `WhatsAppController` | Missing secret → `400` with logged reason; tests verify rejection and acceptance paths | 4 | S |
| P0-5 | Key Connect | Resolve ingestion architecture drift: choose canonical model | Critical | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts`, `apps/server/src/modules/key-inbox/key-inbox.service.ts`, `core/connectors/*` | Either (a) messaging flows route through `IngestionItem` and UI renders triage cards, or (b) spec updated and `IngestionItem` code removed/deprecated; no parallel models remain | 5 | L |

---

## P1 — Hardening

| ID | Area | Task | Sev | Files / Entry Points | Acceptance Criteria | Order | Effort |
|---|---|---|---|---|---|---|---|
| P1-1 | KeyCortex | Implement real calendar rollback compensation | High | `apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts` | `calendar.create_event`/`delete_event` compensations undo or mark the calendar event; tests pass | 1 | M |
| P1-2 | KeyCortex | Implement real communications rollback compensation | High | `apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts` | `communications.send_message`/`recall_message` compensations recall/delete or mark message; tests pass | 2 | M |
| P1-3 | KeyCortex | Wire semantic memory indexing in unified memory writer | High | `apps/server/src/modules/key-cortex/unified-memory-writer.service.ts`, `apps/server/src/modules/ai/semantic-memory.service.ts` | `indexSemantic: true` actually calls `SemanticMemoryService.store()`; skipped path removed or documented; tests added | 3 | M |
| P1-4 | KeyAutonomy | Add unit tests for `AutonomyOrchestratorService` | High | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts` | New `autonomy-orchestrator.service.spec.ts` covers conservative AND logic, rule traces, tier overrides, persistence; CI green | 4 | M |
| P1-5 | KeyAutonomy | Parameterize `SemanticMemoryService.store()` | High | `apps/server/src/modules/ai/semantic-memory.service.ts:40-50` | `store()` uses parameterized query (like `search()` does) instead of string-interpolated vector literal; security test added | 5 | S |
| P1-6 | Key Connect | Honor `ConnectorStatus.intakeEnabled` in `IngestionOrchestrator.receive()` | High | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts`, `packages/db/prisma/schema.prisma` | `receive()` queries `connectorStatus.intakeEnabled` and drops/skips events when disabled; tests added | 6 | S |
| P1-7 | Key Connect | Honor `ConnectorStatus.autoApproveThreshold` | High | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts`, connector controllers | Confidence ≥ threshold sets `IngestionItem.status = 'auto_executed'` and executes without approval; UI slider functional; tests added | 7 | M |
| P1-8 | Key Connect | Fix `correct()` so edited actions propagate to execution | High | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` | After `correct()`, `execute()` uses the corrected proposedActions, not the legacy orchestrator plan; tests added | 8 | M |
| P1-9 | Key Connect | Add `ModuleScopeGuard` to Key Inbox endpoints | Medium | `apps/server/src/modules/key-inbox/key-inbox.controller.ts` | Controller uses `AuthGuard, BusinessGuard, ModuleScopeGuard` with `operations` scope; unauthorized users rejected | 9 | S |
| P1-10 | Business Genome | Add unit tests for `GenomeFactService` and `GenomeExperimentService` | Medium | `apps/server/src/modules/business-genome/key-genome/genome-fact.service.ts`, `genome-experiment.service.ts` | New spec files cover CRUD, scoring side effects (fact service), and experiment lifecycle | 10 | M |
| P1-11 | Key Connect | Return `409 Conflict` on optimistic-lock failures with current state | Medium | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` | Status mismatch returns `409` plus current item state; tests added | 11 | S |
| P1-12 | Key Connect | Implement connector ingestion hooks on target connectors | High | `core/connectors/implementations/google-drive.connector.ts`, `gmail.connector.ts`, `whatsapp.connector.ts`, `meta-social.connector.ts` | Each connector implements the spec hooks (`syncToIngestion`, `parseInbound`, `verifyWebhook`) and is wired into controllers | 12 | L |
| P1-13 | Key Connect | Write webhook delivery attempts to `WebhookDeliveryLog` | Medium | Webhook controllers, `packages/db/prisma/schema.prisma` | Every inbound webhook creates an audit row with status, provider, error, timestamp | 13 | S |
| P1-14 | KeyAutonomy | Remove `as any` casts in autonomy orchestrator | Medium | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts:141,196,258,473` | Casts replaced with strict typing or DTO validation; compiler clean | 14 | S |

---

## P2 — Completeness

| ID | Area | Task | Sev | Files / Entry Points | Acceptance Criteria | Order | Effort |
|---|---|---|---|---|---|---|---|
| P2-1 | KeyCortex | Implement `KnowledgeIngestionService.ingestUrl` content fetching | Medium | `apps/server/src/modules/key-cortex/knowledge-ingestion.service.ts` | URL content fetched (with timeout, size limit, safe MIME filter), chunked, stored; pending sources resolved | 1 | M |
| P2-2 | KeyCortex | Replace voice audio storage placeholder | Medium | `apps/server/src/modules/key-cortex/key-cortex-voice.service.ts` | Audio uploaded to configured storage (S3/CloudFront or local fallback), URL persisted, tests added | 2 | M |
| P2-3 | Business Genome | Reconcile Blueprint-derived and fact-based Genome scoring | High | `apps/server/src/modules/blueprint/blueprint.service.ts`, `apps/server/src/modules/business-genome/key-genome/genome-scoring.service.ts` | Single source of truth for DNA integrity/stage; UI and gates use consistent scores; migration/backfill provided | 3 | L |
| P2-4 | Business Genome | Create unified `KeyGenomeService` | Medium | `apps/server/src/modules/business-genome/key-genome/` | New service exposes `ingestGenesisAnswers`, `recomputeScores`, `getReadiness`; Genesis service delegates to it | 4 | M |
| P2-5 | Business Genome | Make Genome Chat produce evidence-backed fact proposals | Medium | `apps/server/src/modules/business-genesis/genome-chat.service.ts` | Chat `genome_update` blocks create `GenomeFact` + `GenomeEvidence` with confidence/source; user confirmation persists them | 5 | M |
| P2-6 | Business Genome | Recompute module readiness after Blueprint updates | Medium | `apps/server/src/modules/blueprint/blueprint.service.ts` | `updateBlueprint` calls readiness recomputation; fact scores updated if needed | 6 | S |
| P2-7 | Business Genome | Auto-version constitution on integrity change ≥ 1 point | Low | `apps/server/src/modules/blueprint/blueprint.service.ts`, `ConstitutionVersionService` | DNA write that changes integrity by ≥1 triggers new constitution version; tests added | 7 | S |
| P2-8 | Business Genome | Expand `GenomeGateGuard` to chat apply-updates and generation endpoints | Low | `apps/server/src/core/auth/genome-gate.guard.ts`, `genome-chat.controller.ts` | Specified endpoints reject when three-pillar minimum not met; tests added | 8 | S |
| P2-9 | Key Connect | Redirect legacy `/app/inbox/*` pages to `/app/key-inbox` | Medium | `apps/web/src/app/app/inbox/intake/page.tsx`, `unified/page.tsx`, `page.tsx` | Old pages return `redirect('/app/key-inbox')`; no stale links remain | 9 | S |
| P2-10 | Key Connect | Resolve or remove duplicate `key-connector` module | Medium | `apps/server/src/modules/key-connector/` | Decision documented: either integrate with `/app/key-connect` and add auth guards, or delete module and migrate tables | 10 | L |
| P2-11 | KeyAutonomy | Expose `ComplianceMapService` via API | Low | `apps/server/src/modules/key-autonomy/compliance-map.service.ts` | New controller endpoint returns compliance mapping for a business; tests added | 11 | S |
| P2-12 | KeyAutonomy | Expand `AuthorityGrantRuleService.inferScope()` coverage | Medium | `apps/server/src/modules/key-autonomy/authority-grant-rule.service.ts` | Comprehensive action-to-scope mapping or keyword expansion; tests added | 12 | S |
| P2-13 | Command Center | Align web `CommandCenterItemType` with server types | Low | `apps/web/src/lib/api/business-command-center.ts`, `apps/server/src/modules/business-command-center/business-command-center.types.ts` | `GENOME_SIGNAL` and `GENOME_RECOMMENDATION` added to web union; TypeScript build clean | 13 | XS |
| P2-14 | KeyCortex | Build Business Office Copilot unified control center UI | High | New web pages under `/app/key` or `/app/command-center` | Single UI surfaces command input, approvals, memory, genome context, and trust explanations; uses existing controllers | 14 | XL |

---

## Suggested Sprint Order

### Sprint A (safety & data integrity)
- P0-1, P0-2, P0-3, P0-4, P1-5

### Sprint B (ingestion model decision + first fixes)
- P0-5, P1-6, P1-7, P1-8, P1-9, P1-12, P1-13

### Sprint C (autonomy hardening)
- P1-4, P1-14, P1-1, P1-2, P1-3, P2-11, P2-12

### Sprint D (genome coherence)
- P2-3, P2-4, P2-5, P2-6, P1-10, P2-7, P2-8

### Sprint E (cleanup & UI)
- P2-9, P2-10, P2-1, P2-2, P2-13, P2-14
