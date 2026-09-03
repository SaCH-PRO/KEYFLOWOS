# KEYFLOWOS — Complete Application Specification

> Synthesized from direct code reads across the monorepo (8 parallel deep-dives) plus the strategy/vision docs in `docs/` and the architecture memory in `architecture/`. Doc-vintage caveat: strategy docs range 2026-05 → 2026-08 and some are self-reported status; where docs and code disagree, code wins and the drift is flagged in §14.

---

## 1. Vision & Product Identity

**What it is:** KEYFLOWOS is a vertically integrated **business operating system for SMBs** — CRM, commerce/invoicing, payments, double-entry finance, bookings/calendar, projects, marketing, documents, contracts, omnichannel communications, a public storefront/presence layer, and a deeply integrated AI layer called **KEY** — in one multi-tenant platform.

**The one-sentence vision** (`docs/KEYFLOWOS_WORLD_PLUGGED_OS_MASTER_PLAN.md`): KEYFLOWOS lets an owner **"plug their business into their real world"** — phone/camera/voice, WhatsApp, calls, email, Google Workspace, files, storefront, invoices/payments, customers, social, team, operations, accounting, reviews/referrals, community.

**Target feeling:** *"My business is connected to my world. KEYFLOWOS sees what matters, understands it, and helps me act."* The app should play 13 roles: command center, secretary, CRM, commerce engine, financial flow, calendar/time system, storefront, automation/bot/flow builder, omnichannel inbox, device-native capture assistant, integration hub, growth network, AI worker.

**KEY's ambition** (`docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md`): feel like *"the best business partner and employee a user could hire"* — remembers like an institutional veteran, reasons across functions like a senior operator, acts with judgment, explains itself, learns, and evolves without losing its values. Definition of done: a **"digital employee acceptance test"** — handle a full week of routine operations with human-level judgment, <1 escalation per critical decision.

**KEY's operating loop:** `observe → listen → read → classify → understand → link → ask → plan → draft → execute safely → request approval → notify → log → learn → improve`.

**Market position** (`docs/KEYFLOWOS_FEATURE_AUDIT.md`): not competing with Jobber/Fresha/Square — competing with **Zoho One + QuickBooks + Mailchimp** "at 1/10th the price with Caribbean localization." Target user: **Caribbean SMB** (WiPay gateway, TTD currency, Trinidad & Tobago compliance rules). Pricing: FREE $0 / FLOW TTD 99 (~USD 15) / KEYFLOW TTD 249 (~USD 39). Wins on: double-entry accounting + bank reconciliation (competitors lack it), Caribbean focus, AI-native (100+ governed tools, not a bolt-on), breadth, embeddable widgets. Gaps: no native mobile app (PWA only), brand awareness, field-service GPS/routing, POS hardware.

---

## 2. Core Metaphors & Design Principles

### 2.1 The Business Organism
The codebase is mapped against a *Universal Business Organism* framework (28 sections) used as a **completeness checklist**. An organ is "done" when four layers exist and agree:
1. **Data** — Prisma models with `businessId`, tenant-filtered queries.
2. **Service** — real tenant-scoped logic.
3. **Manual UI** — the user can perform every verb KEY can, without KEY. **"KEY is optional, never mandatory"** — non-negotiable manual parity.
4. **KEY tools** — read+write tools with correct risk tier and a `manualEquivalentRoute` pointing at the equivalent screen.

**The reflex test:** an organ is connected when a real event traverses `signal → classified → owner assigned → evidence gathered → decision → action → result measured → knowledge retained`.

### 2.2 KEY as Mind / Soul / Evolution
- **Mind:** perception, reasoning, memory, planning/action, metacognition engines.
- **Soul:** identity kernel (`BusinessBlueprint` + `BusinessGenome` as canonical self-model), values kernel, governance (Constitution, `AuthorityGrant`, `AutopilotSettings`, autonomy gates), trust, voice (personas).
- **Evolution engine:** eval harness, feedback loops, knowledge ingestion, value learning, memory consolidation, self-assessment.
- Code uses CNS-style naming: thalamus (cognitive triage), amygdala (salience), endocrine system (4 persisted hormones: cortisol, dopamine, humility, malaise), circadian clock, immune system, cerebellum, epigenetics, homeostasis, blood-brain barrier (safe database), efferent bridge.

### 2.3 Non-negotiable principles
- **No internal tiers exposed.** Users never see "Manual OS / AI Tier / Tier 1/2/3" — one seamless product.
- **Manual parity:** everything usable by hand before KEY gets the verb.
- **Honesty rules:** no capability claims without source reads; tools must not claim success for work not done (`flow-tool-honesty.spec.ts`); delete what lies, mark what is dormant (`@keyflow:dormant`).
- **Governance ladder:** read/summarize/draft → allowed; tag/stage updates → allowed with audit; customer messages → approval unless trusted autopilot; quote/invoice → approval; publish → approval; mark-paid/financial → owner approval; delete/permissions → owner approval or blocked. Every tool declares `ToolRisk` (tier, category, requiresApproval, reversible). Labels: Safe, Needs review, Approval required, Owner approval required, Blocked.
- **Human-in-the-loop by default, autonomous by grant** — authority delegated per business, per domain, per risk tier.
- **One source of truth per concern:** one autonomy oracle, one memory retrieval layer, one value model, one eval harness.
- **Architecture principles** (`architecture/target-architecture.md`): domain boundaries over file count; events over direct service calls for cross-module workflows; tenant isolation non-optional; compiled packages first-class; small reversible steps; non-goals = no framework rewrite, no microservices.

### 2.4 Interface grammar
Every page: ModuleHeader (name + business-outcome subtitle + primary action + Capture + Ask KEY) → BusinessPulseStrip (4–6 metrics) → Command/Action Zone → Main Workspace → Context Rail. Premium, calm, uncluttered, business-outcome oriented. Outcome-based empty states and value-reinforcing success messages ("Invoice sent. TTD 2,400 is now in your collection pipeline.").

---

## 3. System Architecture

### 3.1 Topology

```
Web Client (Next.js 16, React 19, Tailwind, PWA)         apps/web        :5000
        │  REST (primary) / tRPC (unused by web) / SSE / LiveKit RTC
API Server (NestJS 11, compiled tsc → dist)               apps/server     :3001
        ├── @keyflow/db      Prisma 6 + pg adapter, tenant/soft-delete/encryption extensions
        ├── @keyflow/api     tRPC 10 routers (mounted at /trpc; no web consumer today)
        ├── @keyflow/shared  Domain constants & pure helpers
        └── @keyflow/ui      Shared presentational components
Voice Worker (LiveKit agents + OpenAI Realtime)           apps/voice-agent
Infrastructure: PostgreSQL 16 + pgvector, Redis 7 (BullMQ + cache), MinIO/S3,
                Docling (document parsing), LiveKit server v1.9.12 (pinned),
                Chatwoot (self-hosted support desk), Caddy edge proxy
```

- **Monorepo:** pnpm 9.15 workspaces + Turborepo; Node 20.x; server is **CommonJS** (guarded by `commonjs-compat.test.ts`).
- **Compiled server required:** `tsx` breaks `emitDecoratorMetadata`; dev/prod run `node dist/main.js`. Launcher: `bash scripts/launch-dev.sh`.
- **~101 server modules** (104 registered in AppModule), **441 Prisma models**, **~276 event names**, **287 canonical KEY tools**, **202 page.tsx** in web.

### 3.2 Request & tenant model
- **Dual auth:** Supabase JWT (primary; role taken from the *local Prisma User row*, not the JWT) + local HMAC-JWT admin token fallback (`ADMIN_JWT_SECRET`, 24h, jti revocation in Redis). `KEYFLOW_DEV_AUTH_BYPASS` hard-fails boot.
- **Guard stack:** `AuthGuard` → `BusinessGuard` (membership of `:businessId`) → optional `PlanLimitGuard`, `ModuleScopeGuard` (`@RequireModuleScope('crm','write')`), `FeatureFlagGuard`. Public surfaces: `PublicRateLimitGuard` + `HoneypotGuard` (`_hp` fields + 1.5s min fill time).
- **Tenant isolation:** `TenantInterceptor` sets an AsyncLocalStorage `{businessId, userId}` per HTTP request; Prisma client extensions auto-inject `where.businessId` into 12 read/write ops for ~330 curated models and force `data.businessId` on create/upsert. `skipTenantIsolation()` opts out for admin/diagnostics. Known limits: HTTP-only (cron/BullMQ/WS/webhooks must scope explicitly); `Payment`, `MarketplaceOrder`, `WebhookEvent` deliberately excluded (provider-key global lookups).
- **Soft delete:** 14 models (Business, Contact, Product, Quote, Invoice, StaffMember, Service, Booking, SocialPost, Automation, Project, ProjectTask, Site, CalendarEvent) — `delete` rewritten to `deletedAt = now`.
- **Field encryption:** AES-256-GCM `enc:v1:` (scrypt key) on Business OAuth tokens (15 fields), SocialConnection/ChannelConnection tokens, Webhook secrets. Connector credentials separately encrypted into `ConnectorStatus.metadata.encryptedCredentials`.
- **Idempotency:** `Idempotency-Key` header interceptor (Redis, 24h); webhook idempotency via `WebhookEvent @@unique([provider, providerEventId])`; ledger postings via deterministic `externalRef`.

### 3.3 Event & queue systems (two, coexisting)
1. **EventEmitter2** (`@nestjs/event-emitter`, wildcard, `.`-delimited, ~276 events) — in-process pub/sub. `event-wiring.spec.ts` enforces emitter↔listener parity.
2. **BusinessEvent** — canonical immutable audit log (BullMQ `business-events` queue, concurrency 10, circuit-broken resilient emitter, before/after snapshots redacted via `safeRedactedSnapshot`, anomaly detection: ≥20 deletes/hr or ≥50 updates/hr per business/actor). An interceptor auto-logs mutating HTTP requests (`@SkipBusinessEvent()` opts out).

BullMQ queues: `business-events` (10), `temporal-flow-memory` (3), AI module queues — all degrade safely when Redis is down. No leader election anywhere: ~52 `setInterval` schedulers + 26 `@Cron` jobs are **idempotent by design** instead.

### 3.4 Work-obligation contract
`WORK_OBLIGATION_RAISED / WORK_OBLIGATION_SETTLED` (from `@keyflow/shared`) is the cross-module "due this week" contract used by bookings, contracts, and the command module.

---

## 4. Data Model (441 models, 16 enums — `packages/db/prisma/schema.prisma`, 12,826 lines)

Conventions: cuid PKs, snake_case tables/columns via `@@map`/`@map`; finance money `Decimal(18,4)`; commerce (Quote/Invoice/Product) still `Float`. Key enums: `InvoiceStatus` (11 values), `QuoteStatus` (9), `DealStatus`, `BookingStatus` (6), `ContractStatus` (6), `ApprovalStatus` (6), `BusinessEventType` (12), `FlowType` (TEMPORAL|FINANCIAL|PEOPLE), `EvidenceClaimType` (10).

### Domain entity groups
- **Identity & access:** `User` (id mirrors Supabase), `Business` (**tenant root**, ~200 relations, profile/brand/autopilot/FIN5 accounting settings/15 encrypted OAuth token columns), `Membership` (OWNER|ADMIN|STAFF, permissionScopes, maxApprovalTier), `Session`, `ApiKey` (hash+prefix), `PushSubscription`, `FeatureFlag`, `AuthRateLimit`, `AuthAuditLog`, `RiscEvent`.
- **Org/HR:** `OrgUnit` (BRANCH|DEPARTMENT|DIVISION|TEAM|WAREHOUSE), `JobRole`, `OrgAssignment` (position filled by membership or contact-only person; reportsTo chain), `PayRate`, `PayrollRun`/`PayrollItem` (DRAFT→APPROVED→PAID), `StaffPerformanceSnapshot`, `DelegationRule`, `Skill`.
- **CRM:** `Contact` (normalized email/phone uniques, tsvector `searchVector`, ~20 AI intelligence fields, merge lineage, soft delete), `Account` (domain dedupe), `DealStage`/`Deal` (health score, bottleneck flag, quote/invoice links), `WonLostReason`, `Tag`/`CustomFieldDefinition`, `ContactNote`/`ContactTask` (evidenceRequired)/`ContactEvent`, `ContactRelationship` (typed edges + auto-inverse), `CrmSequence`/`CrmSequenceEnrollment` (graph steps + A/B variants), `MergeOperation` (revertible, expiring), `ContactDataIssue`, `ContactAuditEntry`/`ContactExportJob`/`ContactForgetRequest`/`ConsentRecord` (GDPR), `ContactMomentum`, intelligence caches.
- **Commerce:** `Product` (execution model tiers DIY|AI_ASSISTED|HYBRID|FULL_SERVICE, inventory modes), `ProductVariant`, `ProductCostProfile` (landed cost), `MarginSnapshot`, `Quote`/`QuoteItem` (public `viewToken`), `Invoice`/`InvoiceItem` (taxRateId FK, QuickBooks/Xero external refs), `Payment` (global `providerPaymentId` unique), `PaymentLink`, `RecurringInvoice`, `PromoCode`, `ProductReview`, `CommercialDocumentTemplate`.
- **Bookings/calendar:** `StaffMember`, `Service` (deposit, invoiceTiming), `Availability`, `Booking`, `BookingWaitlistEntry` (WAITING→OFFERED→CONVERTED), `CalendarEvent` (canonical projection, unique per businessId+sourceType+sourceId), `CalendarSyncConflict`.
- **Marketing/comms:** `SocialConnection`, `SocialPost`, `SocialEngagement`, outbound engine (`ChannelConnection`→`ChannelDestination`→`OutboundContent`→`OutboundVariant`→`OutboundDelivery`→`DeliveryEvent`), `EmailCampaign`/`EmailCampaignContact`, `LeadForm`/`LeadFormSubmission`, `GoogleFormMapping`, `LandingPage` (orphaned — no API), `MarketingCampaignPlan`.
- **Inbox/nervous system:** `KeyInboxThread`/`KeyInboxMessage`/`KeyInboxInsight`, `WhatsAppContact`/`WhatsAppMessage`, `MessageIntake`, `IngestionItem`, `ChannelAccount`, `InteractionIntent` (intent + profitPotential), `ResponseDraft`, `MediaAsset`, `VisualIntake`, `ExtractedEntity`.
- **Projects/time:** `Project`, `ProjectTask` (kanban), `ProjectMilestone`, `ProjectDeliverable`, `ChangeOrder`, `TimeEntry` (billable/billed), `ProjectTemplate`, `ProjectPlan`/`ProjectPlanEvent` (AI planner: IN_APP tool steps vs OUT_APP manual steps), `RetainerAgreement`/`RetainerPeriod`, `PortalAccess`, `CallLog`, `TaskAssignment` (polymorphic, no businessId).
- **Marketplace/supply chain:** `MarketplaceListing`, `MarketplaceOrder`, `FulfillmentRoute`, `Warehouse`, `InventoryStock`, `StockMovement`, `Shipment`, `CustomsDeclaration`, `PreOrder`, `PurchaseOrder`, `GoodsReceipt`, `StockCount`, `DeliveryNote`, `SupplierConnection`, `ProductSourceLink`, `ProcurementRequest`.
- **Finance OS (FIN1–FIN8):** `FinancialAccount`↔`ChartOfAccount` (system rows keyed `systemKey`: CASH, ACCOUNTS_RECEIVABLE, REVENUE, TAX_PAYABLE…), `FinancialTransaction`→`LedgerEntry` (append-only double-entry, `externalRef` idempotency, reversal lineage, reconciliation locking), `BankTransaction` (CSV/OFX/MT940/QIF import + matching), `Reconciliation`, `BankRule`, `BankConnection` (Plaid/Yodlee metadata), `TaxRate`, `TaxLiability` (amendment lineage), `RecurringJournalEntry`, `CreditNote`, `AccountingPeriod`, `ExchangeRate`, `FixedAsset`, `CashReserveBucket`, `Expense`/`ExpenseCategory`/`RecurringExpense`/`ExpenseBudget`, `RevenueAction`, `FinanceActionItem`, `RevenueAttribution`, `TimeCostEntry`.
- **KEY AI/autonomy:** `CortexSession`, `KeyCommand`, `CommandItem` (universal command queue: SUGGESTION vs OBLIGATION), `KeyActionProposal` (**canonical unified approval entity**), `AiApprovalItem`/`AiApprovalRequest`/`ApprovalRequest` (legacy), `AiExecutionLog` (idempotencyKey), `BusinessAutonomyProfile` (kill switch, daily limits), `AutopilotSettings`, `AutonomyDailySpend`/`AutonomyDailyActionCount`, `AutonomyRule`, `AutonomyVerdict` (immutable decision audit), `AuthorityGrant` (tier-4 delegated authority), `IdempotencyKey`, `SagaExecution`/`SagaStep`, `AiMemory` + `AiMemoryEmbedding` (**pgvector `vector(1536)`**, OpenAI text-embedding-3-small, cosine search), `KeyCortexMemory`, `CognitiveEvent`, `ValueConstraint`, `KnowledgeSource`, `AgentTrigger`, `AgentMessage`, `VoiceSession`, `KeyVoicePreference`, `AutopilotTask`, `DelegationLoop`/`DelegationLoopRun`.
- **Genome/Blueprint:** `BusinessBlueprint` (one-per-business operating DNA; ~26 JSON sections incl. Genesis: founder/legal/registration/tax/ownership/market/offer/sales/marketing/operations/projections/risk/compliance/roadmap), `BusinessGenome`, `GenomeFact` (unique per business/section/domain/field, 5 quality scores, verification status) + `GenomeEvidence`, `GenomeSignal` (NEW→MERGED lifecycle), `GenomeModuleReadiness`, `GenomeRecommendation` + outcome + learning windows, `GenomeExperiment`, `GenomeDepartment`, `GenomeMemoryEvent`, `BusinessConstitutionVersion` (immutable, auto-versioned on integrity change ≥1pt), `GenomeChatMessage`, domain genomes (finance/customer-sales/operations/marketing snapshots + cross-domain), `MarketStrategy`, `Competitor`.
- **Flows:** `FlowSignal` (canonical signal layer), `FlowRoleSubscription`, `TemporalFlowEvent` (universal timeline, unique per businessId+source+externalId), `TemporalFlowMemory`, `AutomationFlow`→`FlowVersion`→`FlowRun`→`FlowRunStep`, `FlowTemplate`, legacy `Automation`/`CrossModuleWorkflow`.
- **Presence/storefront:** `Site`, `SitePageDraft`/`SitePagePublished` (preview tokens), `PublicVisitor`/`PublicVisitorEvent`, `PresenceDailyStat`, `StorefrontConversionDaily`, SEO set (`SeoPage`, `SeoKeyword`, `RankingSnapshot`, `SeoIssue`, `ContentBrief`).
- **Documents:** taxonomy `DocumentCategory`→`DocumentType`→`DocumentTemplate`→`DocumentClause`; instances `DocumentInstance`→`DocumentVersion`/`DocumentSection`/`DocumentChangeLog`; `BusinessProfileVersion` + `ImpactRule` (profile change → document staleness); `IntakeSubmission`, `QualificationJourney`; contracts: `Contract`/`ContractParty`/`ContractTerm`/`ContractVersion`/`ContractAlert`.
- **Operating kernel:** `BusinessEvent`, `Evidence` (checksum'd proof attachments), `Asset`, `BusinessEntityLink`, `BusinessRisk`, `BusinessInitiative`, `BusinessRule`/`BusinessSignal`, `BusinessHealthSnapshot`, `Notification`, `TimelineEvent`.
- **Connectors:** `ConnectorStatus` (most-consumed connector model), `ConnectorActivityLog`/`ConnectorAuditLog`/`ConnectorHealthLog`, `SyncJob`, `DriveIntakeFile`, `Webhook`/`WebhookDeliveryLog`, `IntegrationProvider`/`IntegrationConnection`/`IntegrationSyncRun`, `ExternalObjectMap`.
- **Community (dormant):** posts, cohorts, courses, network graph, referrals, reputation, matches, Keystore services marketplace.
- **Platform billing:** `Subscription` (FREE|FLOW|KEYFLOW), `SubscriptionPayment`, `AiUsageLog` (billable flag frozen at call time), `LLMProviderCost`.

Data-ownership registry: 441 models, **86 unassigned** (zero server references — dead/raw-SQL/write-only). Heaviest contention: `Business` (373 refs), `Contact` (290), `Booking` (144). Integrity choices: `Quote`/`Invoice`/`Booking` use `onDelete: NoAction` toward Contact/Product so financial history survives contact deletion.

---

## 5. The KEY AI Brain

### 5.1 Model Gateway (`modules/ai/model-gateway.service.ts`, 3030 lines)
- **Providers:** OpenAI, Anthropic, xAI, Kimi (Moonshot), Google (Gemini OpenAI-compat), native (`KEYFLOW_NATIVE_AI_URL`), opensource (OpenRouter/Ollama). **BYOK:** per-business encrypted keys (`BYOK_ENCRYPTION_SECRET`).
- **Routing:** `DEFAULT_ROUTING_TABLE` keyed by `AiMode` (balanced|premium|fast) × 12 `TaskCategory`s (extraction, classification, reasoning, emotion-analysis, creative, code, forecasting, content-generation, summarization, analysis, tool-calling, general). Balanced: gpt-4o-mini for extraction/classification/summarization/analysis, gpt-4o for reasoning/content/tool-calling/code, Claude 3.5 Sonnet for emotion-analysis; fallbacks Claude Haiku/Sonnet → Kimi. DB-overridable per business; `preferredProvider` is soft; per-provider circuit breakers + health stats.
- **Contracts:** `expectedContract` output validation with coercion/fallback (`ai-output-contracts.ts`).
- **Cost:** `LLMCostService` token-cost table (chat/embeddings/TTS/whisper); `AiUsageService` meters billable usage, enforces plan credits (`AI_CREDIT_COSTS`, overage in TTD/USD); monthly `BudgetCaps` per provider; Langfuse tracing.

### 5.2 Tool system (canonical: `flow-tool-registry.ts`, 6162 lines)
- **287 `FLOW_TOOLS`**, each `{name, family: read|draft|organize|execute|crud, riskLevel, riskTier 1-4, changedEntities, followOnSuggestions, parameters, outputSchema, manualEquivalentRoute}`. The manual-equivalent route is **CI-enforced** (`check-tool-routes.ts`) — AI is never the only way to act.
- Two other registries coexist (cortex organ registry — mid-consolidation per ADR-0001, and the ai module's finance-flavored `KeyToolRegistryService`); Flow is canonical.
- **MCP bridge:** allowlisted remote HTTP MCP servers (`MCP_REMOTE_SERVERS` env JSON); tools bridged as `mcp__{server}__{tool}` at riskTier 2 (read-only) or 3; lazy connect, 5-min cache, 60s call timeout, 8000-char output cap.
- **Code execution:** `code-executor.service.ts` — local Node child-process sandbox or **E2B** cloud microVM; max 10 tool calls, 4000-char output cap, 15s timeout; sandboxed code can `api.callTool()` back into the flow registry.

### 5.3 Chat pipeline (`KeyCortexQueryPipelineService`, 1801 lines)
Per query: resolve session → build context snapshot (Redis-cached 5 min: genome DNA/stage/readiness, recent tasks/events/messages, key metrics, active projects, pending invoices, team status) → `AdaptiveRouterService` classifies on 6 dimensions (complexity, domain, urgency, emotionalWeight, timeHorizon, dataRequirement) → `RouteDecision` picks reasoning layers (emotion|reasoning|creativity|temporal|ethics|actions), prompt variant, genome/memory/action inclusion → genome-enriched context → `buildV3SystemPrompt` (persona + genome block + DNA-derived behavioral guidance) → message stack: system → running summary → AI memory → semantic memory → lessons → business context → last 10 session messages → user text → model call → `KeyCortexToolLoopService` runs tool calls (autonomy-gated, idempotency keys, saga/compensation, audit) → final answer.

### 5.4 KEY Cortex module (~90 services)
- **Core brain:** reasoning orchestrator → query pipeline, session service, prompt context, tool loop, system prompt (v2/v3 genome-aware), provider selection, structured output, action/mood detection, quality, command execution.
- **Reasoning sub-engines:** temporal reasoning, creativity, reflection, intuition, metacognition, consciousness (powers `/conscious/chat` — a 10-step pipeline streamed as `CognitionPhase` events), ethics (deliberately **not** in the execution path — see §14), emotion, expertise lens.
- **Body-metaphor services:** event bus, tool registry, organ adapters (temporal-flow, inbox, genome, storefront, connectors), interoception, awareness, endocrine, homeostasis, cerebellum, circadian, salience, immune, epigenetics, incentive, efferent bridge, adaptive router, cognitive triage, safe-database (authority-gated `QUERY_DATABASE`/`UPDATE_RECORD`).
- **Execution foundation:** audit, **approval orchestrator** (collapses 3 approval models into one path), idempotency, saga, compensation.
- **v2 integration layer:** universal connector + 17 typed module adapters (CRM, commerce, bookings, content, comms, flow, autopilot, temporal, inbox, notifications, projects, activity, social, finance, analytics, intelligence, settings), capability registry, `FullBusinessContext` assembly, NL→structured command parser, executor with rollback, planner.
- **v3/v4/v5:** sandbox (code gen/execute), flow studio, evolution (self-tuning), phone (calls/scripts/transcripts), documents (RAG/extract/compare), genome bridge, immutable BusinessEvent writer, evidence, realtime gateway (socket.io namespace `/key-cortex` with JWT+business handshake — server-side only; the web app uses SSE).
- **Learning (Phase D):** BI engine, digest, proactive engine, triggers, learning, watchers (invoice-overdue, booking-no-show, sentiment), unified memory retrieval/writer, eval harness, cognitive event bus, value learning, knowledge ingestion, memory consolidation, self-assessment, digital-employee acceptance, trust explanation.

### 5.5 Autonomy framework (`modules/key-autonomy/`)
- **`AutonomyOrchestratorService`** — single source of truth for "may KEY act?". `evaluate()` produces one canonical persisted `AutonomyVerdict {allowed, requiresApproval, tier, confidence, reason, ruleTrace[]}` — conservative AND across 8 rule providers: autonomy level, per-business DB rules, AI oversight (tool risk tier, blocked tools/modules), genome autonomy gate, genome policy, constitution values, authority grants (L4), static action policy.
- **`AutonomyLevelService`:** levels 0–5 → modes `advisory(0)|assisted(1-2)|pro_auto(3-4)|autopilot(5)`; precedence `AutopilotSettings.autonomyLevel → Blueprint.aiPreferences → BusinessSettings → default 2`.
- **`KeyAutonomySafetyService`:** enforces `BusinessAutonomyProfile` — **global kill switch**, tier ceiling, **daily autonomous action cap** and **daily spend cap (TTD)** via accumulator tables.
- **Action proposals:** `KeyActionProposal` statuses PENDING|APPROVED|REJECTED|EXECUTING|EXECUTED|FAILED|BLOCKED|CANCELLED; risk LOW|MEDIUM|HIGH|CRITICAL; 16 executable action types; approve/reject/cancel/execute endpoints; safety shell, action audit, compliance map.
- **8 KEY roles** with tool reach (`role-engine.service.ts`): general (114 tools), operator (95), operations (85), marketing (54), sales (50), support (45), finance (44), executive (40). Above-tier tools route to quick-confirm (T2), formal approval (T3), admin approval (T4).

### 5.6 Business Genome
- **DNA integrity:** 12 DNA sections (founder 10, vision 5, business 15, market 15, financial 15, legal 10, operations 10, sales/marketing/growth/technology 5, risk 0) roll up to `genomeIntegrity` 0–100.
- **Three-Pillar Minimum:** `founder ≥ 50 && business ≥ 50 && market ≥ 50` — gates onboarding completion and module unlocks (frontend: soft banner only, never redirect).
- **Genome stages:** CONCEPT → VALIDATED_CONCEPT → REGISTERED_ENTITY → REVENUE_ENGINE → OPERATING_BUSINESS → GROWTH_BUSINESS → ENTERPRISE_READY (≥95).
- **Fact-based kernel** (`business-genome/key-genome/`, ~45 services): `GenomeFact` scoring = completeness + quality + confidence + freshness (30-day half-life) + operationalReadiness − riskPenalty; verification base USER_VERIFIED 1.0 / INFERRED 0.7 / UNVERIFIED_IMPORTED 0.5 / STALE 0.2 / DISPUTED 0. Modules propose facts as **signals** (deduped, confidence-upgraded, NEW→REVIEWED→ACCEPTED→MERGED). Signals drive **recommendations** (ranked by financial viability + capacity gating + safeToExecute) with outcome tracking and per-domain learning windows. Domain verticals: finance, customer-sales, operations, marketing-growth + cross-domain snapshots. Genome autonomy gate maps actions to affected domains and demotes/blocks autonomy by cross-domain risk.
- **Constitution:** versioned `BusinessConstitutionVersion` generated from Blueprint + integrity; auto-versioned on integrity change ≥1 point; one ACTIVE at a time.

### 5.7 Business Genesis (onboarding engine)
Idea → blueprint. `analyzeIdea` (10–4000 chars) runs an LLM extraction under the `genesis_idea_extraction` output contract → `BlueprintPatch` (identity, operatingModel, legalProfile w/ entity type, customerModel, marketProfile, financials, projections, founder, goals, constraints, riskProfile) → **Trinidad & Tobago compliance inference** (employees, NIS employer status, revenue, regulated industry, physical location) → readiness scoring (overall + legal/finance/market/operations/compliance + blockers) → prioritized question bank → roadmap/document-pack/risk-register/market-strategy generation. A genome chat proposes `ProposedGenomeUpdate`s that patch the blueprint and write `GenomeFact`+`GenomeEvidence` rows.

### 5.8 Legacy AI module surface (`@Controller('ai')`, ~99 routes)
Chat, morning/EOD briefings, cash-flow forecast, simulate, business plan, SEO score, usage/credits/billing, plans (+approve, step undo), workflows, suggestions, execution logs/stats, approvals, governance, memory CRUD, strategic/* (revenue forecast, profitability, pricing advisor, seasonal patterns, weekly plan), control tower, providers/preferences/budget-status/routing-config, `key/command` (modes `ask|do|plan|draft|auto`; autonomy levels READ_ONLY 0 → TRUSTED_AUTOPILOT 4), journeys, inbox, goals, workload, priorities, capacity alerts, agent config. Plus: **agents subsystem** (triggers, agent bus, health, state machine, pattern detector, cron scheduler, BullMQ queues, monitor, auditor, planner, morning briefing, chaser, goal tracker, journey orchestrator, feedback loop, undo, intent parser, plan executor), **semantic memory** (pgvector), **conversational AI** (omnichannel inbound for whatsapp/messenger/instagram/email/sms — resolves contact, records into unified inbox thread, returns `{reply, actions, sentiment, intent, extractedData}` under governance), document intelligence, business matching, blueprint onboarding chat, conversation genome extractor.

---

## 6. Money Flow (quote → invoice → payment → ledger)

1. **Quote** DRAFT → SENT (mints public `viewToken`) → customer views/accepts via `/quote/[token]` (`quote.viewed|accepted`) → convert requires ACCEPTED → DRAFT invoice with `quoteId` backlink in one transaction (`quote.converted` + `invoice.created`).
2. **Invoice** DRAFT → SENT via `InvoiceWorkflowService.transition` — the money state machine (`ALLOWED_TRANSITIONS`; illegal → 409). On ACCRUAL basis, finalizing posts Dr ACCOUNTS_RECEIVABLE / Cr REVENUE[_SERVICE|_PRODUCT|_PACKAGE splits] synchronously in the same Prisma transaction; CASH basis is a no-op until payment. 15-min scheduler flips SENT past due → OVERDUE.
3. **Payment:** (a) public checkout `/pay/[invoiceId]` → Stripe Checkout / PayPal Orders / WiPay redirect → signed webhook (HMAC/verify-API/MD5 resp.) → idempotency-checked (`WebhookEvent`) → `Payment` row + ledger posting **in one transaction** → `reconcileFromPayments`; or (b) manual `recordPayment` (cash/bank_transfer/check…, over-payment allowed, optional AI evidence extraction). Balance recompute → PARTIALLY_PAID or PAID (`paidAt` set; COGS Dr COGS / Cr INVENTORY_ASSET posted atomically).
4. **Ledger discipline (FIN1–FIN7):** every monetary movement goes through `PostingService.post()` (≥2 entries, debit XOR credit, debits==credits ±0.0001, deterministic `externalRef` idempotency). Direct `LedgerEntry` inserts forbidden; entries append-only; `reverse()` writes offsetting entries; reconciliation completion locks in-period entries. `ChartOfAccountsSeederService` seeds a system COA per business (CASH, BANK, PAYMENT_PROCESSOR, AR, AP, TAX_PAYABLE, OWNER_EQUITY, REVENUE+children, COGS, 10+ expense children…). Basis-aware recipes in `RevenuePostingService` (CASH vs ACCRUAL).
5. **Refund/credit:** provider refund webhooks → negative REFUNDED Payment + ledger reversal → invoice reopens to PARTIALLY_PAID. Credit notes pro-rate across revenue credits, post REVERSAL, flip invoice to PARTIALLY_/FULLY_CREDITED (bypasses the workflow — known caveat). VOID reverses accrual recognition.
6. **Downstream of `invoice.paid`:** receipt email (business's own Gmail), margin snapshots (landed-cost engine), storefront revenue attribution, revenue actions queue, CRM timeline (`RevenueEventListener` — single idempotent writer for quote/invoice/payment/store-order events), outbound webhooks, nightly tax-liability rollups (VAT/SALES_TAX monthly, BUSINESS_LEVY quarterly, Trinidad-anchored; FILED/PAID periods recompute into AMENDED siblings), bank matching (amount ±0.01, ±3-day window, description token score ≥0.5), accounting period close locks.
7. **Finance surface:** general ledger, trial balance, AR aging, customer balances, manual journal entries, bank import (CSV/OFX/QFX/MT940/QIF) + rules + auto-match + reconciliation (with PDF/CSV reports), recurring journals, exchange rates (frankfurter.app, TTD-anchored fallback), fixed assets (straight_line|reducing_balance depreciation, disposal), accountant export ZIP (P&L/cashflow/balance-sheet PDFs + AR-aging CSV, emailed via Resend), **safe-to-spend** (cash − tax reserved − bills due 30d − payroll − debt − operating buffer), cash reserves, cashflow forecast, money-moves recommendations, finance intelligence actions.
8. **Recurring invoices:** hourly processor creates DRAFT → SENT (posts accrual immediately) → advances nextRunDate; failure counters.
9. **Reports:** P&L, cashflow (indirect method on accrual), balance sheet, tax summary, AR/AP aging, revenue-by/expense-by — computed from the double-entry ledger per business basis (cash|accrual), rendered as CSV/PDF (pdfkit), plus AI narrative reports.
10. **Payments ops:** unified checkout (`payableType: invoice|storefront_order|event_ticket|mass_comm` × `gateway: stripe|paypal|wipay`), per-business gateway resolution from `Business.metaData` with env fallbacks (WiPay: TTD/JMD/BBD/GYD/XCD; PayPal: USD; Stripe: USD/EUR/GBP/CAD/AUD), merchant console (transactions merged across gateways, amounts converted to TTD, payment links create/revoke, refunds — WiPay lacks links/refunds), QuickBooks/Xero invoice+customer push.

---

## 7. Domain Modules (server)

### CRM (`/crm`, 9 controllers, ~45 providers)
Contacts (rich filters + tsvector search, delta polling, favorites, bulk ops, soft-delete + undo), **duplicates & revertible merge** (`MergeOperation` with snapshot + expiry), **data quality** (nightly scanner → `ContactDataIssue`: invalid_email/phone, missing_required, stale_data, suspected_duplicate; wizard + bulk apply), notes/tasks (evidenceRequired, callLogId), timeline events + communication logging, journey/story/dossier/conversation-context views, **next actions** (set/complete/snooze + AI next actions), lists & saved views, import (file/link/image OCR/scan), conversations (read/reply/unread counts, AI summary/suggested replies/insights), stats/segments/intelligence/predictive revenue, favorites, **best-channel** prediction (per-contact channel + time window, nightly), **deals** (stages with reassign-on-delete, move-stage, win/lose with reasons, forecast, velocity, health score + bottleneck), **accounts** (domain dedupe, insight KPIs, merge wizard, pivots), **sequences** (graph nodes email/whatsapp/sms/wait/branch/end, sticky A/B variants with two-proportion z-test winner detection, attribution windows, deal-won conversion attribution), **relationship health** (HOT→WARM→COLD→DORMANT→AT_RISK with per-business thresholds + manual overrides), **network graph** (typed contact↔contact edges with auto-inverse, referral tracking → reputation scores), custom fields, tags, Apollo enrichment, **GDPR privacy** (audit trail, token-gated export ZIP, forget with purge window, consent records), Google Contacts OAuth import, and a 20+ endpoint AI surface (insight cards, prep briefs, NL commands, churn risk, follow-up drafts).

### Bookings (`/bookings`)
CRUD (plan-limit gated), public booking (`/book/[slug]` + widget: services/staff/slots with availability engine, honeypot + rate limits, creates contact + booking), staff + weekly availability, **waitlist** (FIFO per tenant, slot-match on service/staff/date/time-bucket, offer/convert/cancel, auto-match on cancel/reschedule), no-show tracking, schedule optimizer (health, no-show risks, rebooking suggestions), Google Calendar push/pull with conflict resolution (keep_keyflow|keep_external|dismissed), 5-min reminder loop (transactional email), invoice creation from bookings (deposit + invoiceTiming BOOKING|COMPLETION), AI endpoints (search, schedule optimizer, no-show predictor, revenue insights) with prompt-injection sanitization.

### Calendar (`/calendar`)
Canonical **projection table** fed by 7 listeners (bookings, marketing, CRM, commerce, projects, orders, connectors) — every schedulable record upserted by `(businessId, sourceType, sourceId)`; canonical status vocabulary mapped back to source statuses. Two-way Google sync (per-event-type toggles, push 90d/pull 60d horizon, consecutive-error backoff, hourly scheduler), conflicts, insights, agenda, daily plan, weekly capacity, KEY natural-language calendar ops (interpret/build/execute/talk).

### Projects (`/projects`)
Projects/tasks (kanban)/milestones/deliverables/budget/timeline/templates; **AI plan generator** (strategy summary, SWOT, resource estimate, risk register, timeline of task|milestone|decision_gate|review events typed IN_APP tool steps vs OUT_APP manual steps with dependencies, costs, impact analysis with dependency-violation gating) → approve → materialize into a real Project. Time entries (billable → invoice-from-time). Revenue listener auto-advances project status on `invoice.paid`/`booking.completed`.

### Marketing & outbound
Campaign plans CRUD; **lead forms** (public submit → contact); email campaigns (per-recipient open/click/bounce, AI campaign briefings); unified **outbound engine** (channel connections/destinations → content → per-platform variants → deliveries with retry/backoff → delivery events); social (Meta ingestion → inbox threads, publishing, analytics); content ops (content requests → Drive delivery → invoicing); growth intelligence (first/last-touch/linear attribution, customer journeys); SEO (dormant pack). Landing pages: model exists, no API (orphaned).

### Communications
- **Key Inbox** (`/key-inbox`): unified threads across email, whatsapp, sms, google_forms, instagram_dm, facebook_messenger/comments, meta_lead_form, website_form/chat, manual. Idempotent upsert on `(businessId, channel, externalThreadId)`. AI per-thread analysis `{intent, sentiment, urgency, confidence, summary, entities, suggestedActions[]}` with one-click action execution (create_task, create_contact…), channel-aware reply sender (WhatsApp/SMS via WhatsAppService, email via Gmail), periodic intelligence reports (11 metric trends) feeding genome signals, temporal-flow bridge.
- **WhatsApp** (`/whatsapp`): Twilio or Meta Cloud API, encrypted config, template messages (distinct-variable validation), scheduled dispatch (claim-first to avoid replica double-send), inbound → entity resolution → inbox thread; notification listeners (booking confirmation, invoice notice, payment receipt).
- **Chatwoot**: L1 support-desk bridge — KEY (support persona) answers inbound customer messages via the agent-bot webhook, posts replies back over the Chatwoot API. Env-scoped single business.
- **Conversational AI**: omnichannel inbound responder with governance, plan executor, agent bus, role engine, usage metering.
- **Notifications:** in-app store + **TransactionalEmailService** (~30 customer-facing templates via the business's own Gmail: booking_*, invoice_*, payment_*, order_*, quote_*, review_request…) + **SystemEmailService** (platform mail via Resend).

### Site / storefront / presence (`/site`)
Storefront config in `Business.metaData.storefront`; public micro-site per slug; analytics events + conversion funnel (daily idempotent rollup from visitor events); public checkout + orders + promo codes + reviews; intake forms; **qualification flows** (guided journeys → quote/invoice/project); customer referrals; AI case studies; **Presence** sub-surface: draft/preview/publish state machine (S3-backed, 24h preview tokens), completeness scoring, action cards, public directory, storefront intelligence. `/site/[slug]` is a server component with ISR + JSON-LD + SEO metadata.

### Contracts & documents
- **Contracts:** parties/terms/version snapshots on every write, alerts regenerated from expiry (30/7/1 days) and renewal dates, AI term extraction, **CUAD clause analysis** (all 41 labels; Docling parse → GPT-4o checklist; explicitly advisory, human-review routed), daily renewal sweep emitting work obligations, tags, acknowledge-alert.
- **Documents:** category/type taxonomy with risk tiers and jurisdiction sensitivity (e.g. privacy-policy citing GDPR + T&T Data Protection Act 2011), templates with clauses, AI-generated instances with versions/sections/change log, per-section editing modes (FREE|GUIDED|RESTRICTED), AI tweak, email send, Google Drive link/import/sync, **staleness detection** (instances link a profile version; profile change → impact detection + compare), review workflow, org standards.

### Operations kernel & misc modules
- **Command** (Universal Command Spine): one `CommandItem` model (status, priority, urgency/impact/confidence scores, expectedValue, executableByKey, requiresApproval, riskTier, toolName, executionPayload) absorbing finance actions, revenue actions, presence actions, KEY recommendations, approvals, automation errors, inbox replies; SUGGESTION vs OBLIGATION kinds with discharge tracking.
- **Temporal Flow:** canonical chronological event spine (sources APP|KEY|GOOGLE_CALENDAR|WHATSAPP|EMAIL|META|…; upsert per businessId+source+externalId), memory layer (durable facts, ≥0.7 confidence → pgvector semantic memory; BullMQ compaction/pattern detection), **genome bridge** (15-min pattern scan → genome signals: primary lead channel, complaint risk…), AI analysis endpoint.
- **Business Events:** §3.3. **Diagnostics** (`/api/diagnostics`): health score report — Postgres/Supabase/Redis/BullMQ/encryption keys/env/event wiring.
- **Autopilot:** proactive task engine (per-archetype setup templates) + **5 delegation loops** (payment_recovery, lead_reactivation, post_purchase, booking_prep, weekly_hygiene — risk-tiered, oversight-gated, recurring scans drafting customer-facing actions) + 9 AI action types (follow_up, birthday, payment_reminder, check_in, offer, review_request, referral_request, thank_you, re_engage).
- **Flow Studio:** `AutomationFlow`→versions (nodes/edges)→runs→steps; 12 seed templates (missed-call text-back, WhatsApp price inquiry→booking, overdue-invoice reminder, quote follow-up, card-scan→follow-up, review request, dormant reactivation, receipt→expense, form-lead nurture, complaint escalation, payment-failed recovery…); guided/visual/NL builder.
- **Other modules (sweep):** actions, activity, admin-analytics, admin-auth, admin-platform (real GDPR Art. 17 whole-business erasure), analytics (snapshots, maturity scoring), api-keys, approvals, assets, automation (legacy), business-assets, business-command-center, call-tasks, catalog (canonical products/services), change-orders, communications, community (dormant), connect, content, continental-ops (T&T trade docs: delivery notes, goods receipts, stock counts), conversion (abandoned-cart 24/48/72h recovery, lead magnets, referral rewards), device (capture registry + visual classifier), directory, education, email-marketing, event-stream (SSE), events (ticketing/check-in), evidence, expenses (bills = payable lifecycle), feature-flags, flow, flow-signal (normalized signals → canonical owner roles), gamification (dormant), google-drive, governance, helpdesk, ingestion (Docling parsing), integration-hub, keyflow-command (unified timeline + notes + TTS/STT), keystore (services marketplace), marketplace (fulfillment routing), momentum (RFM client scoring), os, payroll (DRAFT→APPROVED→PAID, tier-3 gated), people-flow, phone-voice (Twilio media stream → OpenAI Realtime receptionist with calendar/booking/ticket tools), portal (client portal), procurement, product-analytics, public-events, push-notifications, realtime (dormant SSE), retainers, risc (Google Cross-Account Protection), security-audit, seo, shopify, slack, social, sop, staff-performance (position scorecards), structure (org chart + position-scoped governance envelopes), subscriptions (plan catalog + PlanLimitGuard), supplier, task-assignments (AI assignment recommender), templates, time-tracking, timeline (canonical cross-module feed), trash (22 trashable models, restore), uploads (presigned), voice (TTS provider abstraction).

---

## 8. Connector & Integration Framework

### 8.1 Framework (`core/connectors/`, global module)
Common `IConnector` contract (`authenticate, healthCheck, getStatus, isConnected, sync, disconnect` + optional `testConnection, smokeTest, getAuthUrl, syncToIngestion, parseInbound, verifyWebhook`). 22 registered implementations; `ConnectorMeta` drives the frontend (authType, connectMode dialog|oauth|webhook|external, credential schema, scopes). Registry emits `connector.connected/disconnected/synced/error/tested/smoke_tested`. Credentials AES-256-GCM into `ConnectorStatus.metadata.encryptedCredentials` (clients only ever see masked `•••• last4`; legacy plaintext `Business.metaData` read as migration fallback). Health monitor re-tests all connections every 15 min (classifies expired vs error, notifies with 24h re-notify window). Nightly sync 02:00 UTC. Sync-mode audit (`connector-sync-modes.ts`): most payment/accounting/marketing `sync()` bodies are **STATUS_ONLY** — real ingestion arrives via OAuth callbacks and webhooks, not pull. **Entity resolution:** match order external_id → email → phone (`ContactExternalMapping`), auto-create LEAD contacts, configurable merge rules; resolvers for payments/bookings/invoices/companies.

### 8.2 The 22 connectors
- **Google (unified OAuth, one consent for 6 services — gmail, calendar, drive, forms, contacts, business_profile; HMAC state; per-service token columns on Business; live verification per service):** Gmail (history-API ingestion → Key Inbox, 30-day backfill), Calendar (push bookings, conflicts), Drive (file intake → receipts/statements into commerce), Forms (response ingestion + field mappings → contacts/opportunities), Contacts (two-way sync), Business Profile (reviews + replies, posts, insights). Plus Microsoft Outlook contacts (separate OAuth).
- **Messaging/social:** WhatsApp (Twilio + Meta Cloud inbound parsing, HMAC verify), Meta social (FB/IG via SocialConnection), LinkedIn/TikTok/Twitter (shared base, provider ping health).
- **Payments (`IPaymentGatewayConnector`: listRecentTransactions, payment links create/revoke, refunds):** Stripe, PayPal, WiPay (Caribbean; no links/refunds).
- **Accounting:** QuickBooks, Xero (encrypted creds, invoice/customer push).
- **Email marketing:** Mailchimp, Klaviyo. **Forms (webhook-secret ingestion):** Typeform, Jotform, generic webhook_form (auto-generated per-business secret, timing-safe verify, `x-keyflow-signature` header, sample curl provided).
- **Shopify:** declared in the type union but implemented as a standalone module (`/shopify` — products/orders/customers sync, sku-deduped imports).
- **Frontend placeholders (not connectable):** facebook_page, instagram, meta_messenger, slack, zapier.

### 8.3 Parallel stacks (noted drift)
A newer `/key-connector` REST module + `keyConnector` tRPC router (provider registry, sync engine, health, `IntegrationConnection`/`ConnectorAuditLog`) overlaps the core framework; `processAiCommand` is an acknowledged placeholder. The tRPC surface overall (`packages/api`, 12 routers: identity, crm, commerce, bookings, events, social, automation, site, admin, diagnostics, supplier, keyConnector) has **no web consumer** — the web app calls REST.

### 8.4 Web surface: `/app/key-connect`
Integration hub grouped priority/meta/google/social/messaging/storage/payments/accounting/marketing/forms/productivity/developer/other; per-connector manage drawers (Drive intake queue, contact/calendar sync settings, Forms, Sheets, Business Profile, WhatsApp), credential dialogs, health section, banking section, inbox-config per connector (`intakeEnabled, autoApproveThreshold, createContactsAutomatically`).

---

## 9. Voice & Realtime

### 9.1 Voice paths (three)
1. **LiveKit full-duplex** (`apps/voice-agent` + `modules/livekit`): server creates room `key-voice-<biz8>-<ts>` (metadata businessId/userId, 300s empty timeout), dispatches agent `key-voice-agent` (best-effort — room works human-to-human if the worker is down), mints join token, records `VoiceSession(mode: livekit_full_duplex)`. Worker: LiveKit agents + **OpenAI Realtime `gpt-realtime`** (account lacks gpt-4o-realtime-preview), voice `alloy`; builds persona instructions from Business + Blueprint ("You are KEY, the AI co-founder of {businessName}"); one tool `transfer_to_human` → creates a high-priority SupportTicket; agent state via `lk.agent.state` participant attribute. Webhook (`room_started/finished`, signature-verified) syncs session status. **Caveats:** the `KeyLiveVoice` web control + `lib/api/livekit.ts` are built but **mounted nowhere**; transcripts are not persisted (stub hook). LiveKit server pinned v1.9.12.
2. **TTS stack:** `TtsEngine` with providers browser | openai | elevenlabs (auto-selects best available), sentence-splitting, next-sentence prefetch, speed 0.5–2×, auto-speak toggle, per-message play buttons; server `/voice/.../tts` (OpenAI `gpt-4o-mini-tts` / ElevenLabs).
3. **Push-to-talk STT:** MediaRecorder + RMS VAD (1.4s silence, 90s max) → `POST /keyflow/.../voice/transcribe` → Whisper; hands-free loop re-opens the mic after TTS replies. **Phone-voice module:** Twilio media-stream WebSocket → OpenAI Realtime receptionist with tools (calendar conflict check, create booking, create ticket).

### 9.2 Realtime mechanics
No general WebSockets in web (only LiveKit RTC; the cortex socket.io gateway exists server-side without a web client). Realtime = **SSE + polling**:
- KEY chat streaming: `POST /ai/businesses/:id/flow/chat/stream` (fetch + ReadableStream; chunk types content_delta|tool_calls|tool_results|confirmation_required|usage|card|done|error).
- Deep-think consciousness stream: `GET /api/v1/cortex/conscious/stream` (10-phase `CognitionPhase` events + answer with confidence/permitted/actions).
- Cortex SSE chat (`/api/v1/cortex/chat/stream`, GET with query params — Nest `@Sse` constraint).
- `event-stream` module: SSE bridge for evidence/task-assignment/anomaly/content-request events. (`realtime` module + `use-realtime.ts` appear unwired — dormant.)
- CRM conversation stream (EventSource with `?access_token=` query param).
- Polling in ~15 surfaces; client-side `window` CustomEvents bus (`kf:open-key`, `kf:key-state`, `kf:open-module-launcher`, widget postMessage).

---

## 10. Web Application (`apps/web`, Next.js 16 App Router, React 19)

### 10.1 Shell
Root layout: Geist fonts, PWA manifest (standalone, theme #F97316), offline page, service worker (prod: shell/static/API caches + IndexedDB offline write queue + Background Sync; localhost: self-unregistering no-op as Turbopack defense). `/app` layout provider stack: RequireAuth (token cookie mirror, `/identity/me` validation, 3 retries) → NavigationContext → AiContext → Notes/Guide → TTS → **KeyChatProvider** → GenomeProvider; chrome: DesktopSidebar (primary rail + fly-out), AppHeader (notifications, user menu), breadcrumbs, MobileDrawer, MobileBottomNavV2 (Home/Flows/AI/Inbox/Me with haptics), KeyAgent + KeyChatBubble, keyboard shortcuts (`Ctrl+K` palette, `Shift+K` launcher, `j` talk to KEY, `1/2/3` disclosure modes), MobileGestureProvider (edge swipes, bottom swipe-up launcher). **Disclosure modes** startup|growth|enterprise filter nav density.

### 10.2 Navigation (`lib/nav-config.ts`)
Primary rail: Cockpit, KEY, Operate (drawer), Build (drawer), Me (drawer).
- **Operate:** KEY (Chat, Inbox, Worker, Autonomy, Modes, Data Inbox, Capture) · Money (financial-flow overview, sales/commerce, gateway, inventory, payments, expenses, procurement, retainers, budgets, payroll, reports + full double-entry books under `/app/finance/*`) · Customers (people-flow, contacts, deals, sequences, support, insights, accounts, data quality, duplicates, relationship map, dashboard) · Schedule (temporal-flow, calendar, bookings) · Work (projects, approvals, performance, time tracking, operations, SOPs, change orders) · Marketing (campaigns, content, social, events, WhatsApp, campaign plans) · Compliance (evidence, contracts, legal) · Strategy (insights, goals, market).
- **Build:** Business (profile, genome `/app/genome`, storefront, presence, templates, assets, client portal) · System (account, workspace, team, org chart, AI, compliance, developers, trash) · Connect (`/app/key-connect`) · Automate (flows, automations, role flows).
- Dormant (feature-flag gated): community, learn, marketplace, supplier, salesPack, webPresencePack.

### 10.3 Major surfaces
- **`/app/command-center`** — the cockpit: MissionControlHero (hull score = genome overall), health strip, business pulse, KEY briefing, governance summary, due-this-week obligations, command queue (complete/approve/execute/assign/dismiss/snooze/discharge), top priorities/pending approvals/urgent columns, nudges, risks/opportunities, genome cards, module readiness grid, executive mode grid, cross-domain panel, KEY noticed stream + awareness panel.
- **`/app/crm`** — contacts (consolidated pipeline view, broadcast drawer, next-action queue, autopilot actions), deals (list/board/by-account/reports), accounts (+merge wizard), sequences (builder + A/B reports), dashboard, data-quality, duplicates, intelligence, network map, intake.
- **`/app/commerce`** — revenue workspace (Snapshot/Pipeline/Recurring tabs, KPI strip, action queue, payment recorder) + invoices, quotes, payments, products, recurring, collections, billing, gateway (3-provider console), insights, templates.
- **`/app/money` + `/app/finance/*`** — books: accounts, chart of accounts, journal, general ledger, reconciliation, tax, trial balance, accounting periods (close the month), fixed assets, bank rules, credit notes, exchange rates, recurring journals, cashflow, reports, settings.
- **`/app/bookings`** — master calendar, booking CRUD + detail drawers, services/staff/availability, stats, schedule health, Google sync, org units, waitlist panel, AI hub.
- **`/app/calendar`** — unified temporal view (temporal overview stats + MasterCalendar + intelligence panel).
- **`/app/projects`** — board/list/intelligence/plans/templates/playbooks tabs; AI plan generator; execution strip.
- **`/app/marketing`** — campaigns, lead forms, action queues, social, audience segments/health, unified composer, content studio, outbound history.
- **`/app/contracts`, `/app/documents`** (redirects to profile outputs), **`/app/genome`** — Genome Hub: hero integrity ring, DNA constellation, recommendations/governance action feed, memory timeline, genome chat (tabs overview/dna/actions/memory/chat, swipe-enabled).
- **`/app/key/chat`** — full-page KEY chat: session history rail, mode tabs (9 modes), streaming messages (plan cards, tool results, inline previews genome/commerce/temporal/approval/task/email, cognition trace, usage), command bar (slash commands `/task /email /schedule /genome /commerce /calendar`, attachments, mic), voice bar, right rail (pending approvals, action grid, genome preview). `/app/key` = Worker console (command log, approvals, agent config, execution logs). Slide-out panel + floating bubble global via `openKey()` (`kf:open-key` event).
- **`/app/key-connect`** — integration hub (§8.4). **`/app/key-inbox`** — omnichannel threads + brief. **`/app/temporal-flow`** + five sibling Flow pages (financial, people, marketing, operations, governance) sharing FlowShell + quick launcher.
- **`/app/flows`** — automation list/editor/templates. **`/app/onboarding`** — chat-driven funnel `welcome → intake → template → configure → complete` (legacy genesis/genome mapped; only `markOnboardingComplete` finishes; completion → command center).
- **`/app/settings`** — billing, invite & earn, payment gateways, catalog, team, custom fields, notifications, webhooks, templates, AI output, developers (API keys), AI control, **autonomy kill switch**, L4 AI (authority grants), privacy/GDPR, compliance, security.
- **`/app/profile`** — business profile hub (9 tabs incl. readiness, intelligence, outputs, pricing calculator, business-genome deep links, security; embedded BlueprintOnboardingChat).
- **`/admin/*`** — platform admin console (separate HMAC-JWT login): overview, activation funnel, integration health, users, businesses, analytics, events, feature flags, AI usage, system.

### 10.4 Public surfaces
`/` marketing landing (server component) · `/pricing` (TTD/USD toggle) · **`/site/[slug]`** published presence site (ISR, JSON-LD, SEO metadata, referral `?ref=` capture) · `/site/preview/[token]` (24h draft preview) · `/directory` · **`/book/[slug]`** full public storefront (catalog, cart, checkout, wishlist, testimonials, theming) · **`/pay/[invoiceId]`** + `/pay/link/[token]` (gateway picker) · **`/quote/[token]`** (view/accept/reject, lifecycle bar) · `/order/[token]` (tracking timeline) · `/me/refer` (customer referral links) · **`/widgets/{booking,cart,pay}`** — embeddable iframe widgets, themed via query params, postMessage resize/event protocol.

### 10.5 Design system
`globals.css` HSL tokens: brand orange `--kf-accent1` #F97316 + teal `--kf-accent2` #14B8A6, full semantic set, luminous accents (violet/gold/rose/mint/sky — power the `LauncherTone` system in ModuleLauncherSheet/KeyActionGrid), elevations, z-index scale, motion tokens, global `prefers-reduced-motion` rule. Component families: `ui/` (59 primitives incl. workspace-shell, tab-nav underline+pill, module-launcher-sheet, business-object-drawer with 10 traceability tabs), `ui-v2/`, `layout/`, `key/` (38 chat files + flow studio), `ai/` (command hub, action queue, graph insights), `contacts/` (25+), plus command, genome, finance, email, voice, tts, guide, keyflow-notes, device-capture, upload, timeline. Client infra: ~48 typed API clients in `lib/api/`, 31 hooks, client-side module-events bus, resume-task registry, feature flags.

---

## 11. Identity, Security & Compliance

- **Signup/login** (`/identity`): Supabase Admin API; `session` mode (dev auto-confirm) vs `verification` mode (prod default); verification links built server-side from `SITE_URL` only (request Origin not trusted); 60s resend cooldown. **Password policy:** 12–256 chars, letter+number, common-password blocklist, **HIBP k-anonymity breach check** (threshold ≥100, fail-open). Bootstrap creates local User + first Business (with referral code). Team management (memberships, permission scopes, maxApprovalTier), profile completeness tiers, auth audit log, sliding-window login throttle.
- **Rate limits:** Redis sliding-window per ip+business+handler (`@RateLimit`), public per-route limits, CRM AI rate limits, honeypot + min-fill-time on public forms.
- **Encryption:** §3.2 (field-level AES-256-GCM, connector creds, BYOK keys, Drive tokens separately keyed).
- **Privacy/GDPR:** contact audit trail (tamper-evident, hashed identifiers survive purge), token-gated one-time export ZIP, forget → soft-delete → scheduled hard purge, per-channel consent records, platform-level whole-business erasure (`gdpr-purge.service.ts`), RISC (Google Cross-Account Protection) receiver with 90-day retention.
- **Observability:** Sentry (env-gated, header/body scrubbing), error registry + digest, correlation IDs, Langfuse LLM tracing, diagnostics health score, GrowthBook feature flags + DB-backed flags.
- **Object storage:** S3-compatible abstraction (S3/R2/MinIO/Supabase Storage/Wasabi) with ACL policies persisted in object metadata; presigned uploads.

## 12. Deployment & Operations

- **Dev:** `bash scripts/launch-dev.sh` (port cleanup, cache clearing, env guards, DB checks, builds shared/db/api/server, starts web `--webpack` on :5000 + API on :3001 + voice worker). Docker dev services: db (pgvector/pgvector:pg16), redis, minio, docling, livekit (v1.9.12 pinned), chatwoot(+worker).
- **Production:** single VPS `docker-compose.production.yml` — Caddy (auto-HTTPS; keyflowos.com → web, api.keyflowos.com → api, livekit.keyflowos.com → livekit RTC on 7881/7882), web, api, voice-agent (`OPENAI_API_KEY` overwritten from `AI_INTEGRATIONS_OPENAI_API_KEY` — stale user env shadowing), db, redis, minio, docling, livekit, chatwoot (profile). Health probes: API `/healthz` `/readyz` (Prisma 5-attempt backoff), web `/api/healthz` (probes API).
- **Scheduler safety:** `safeInterval`/`runGuarded` wrappers (main.ts exits on unhandledRejection); kill switches `KF_DISABLE_SCHEDULERS`, per-scheduler `DISABLE_*`; all schedulers idempotent (no leader election).

## 13. The Operating Layer (`architecture/os/`)

A **self-correcting agent loop**: scheduled cycles (truth/audit/burndown/reflect) read state → run gates and probes → fix drift → update docs → reflect. Doc taxonomy with 8 kinds (constitution/playbook/state/ledger/generated/journal/inbox/snapshot), each with a named rot mode and honesty mechanism. **Prime rule:** *"A failing gate is information. A cycle may never make a gate pass by editing the gate."* NEVER list: no prod deploys, no secrets in commits, no editing test assertions/ledgers/gates, no ESM-only deps, a vitest skip is a failure (`0 skipped` asserted), never merge your own PR. Defense in depth: monotonicity tracking (ledgers shrink-only), negative controls (re-add fixed entry, watch gate fail, revert), attribution issues for agent-touched gate files.

---

## 14. Known Gaps, Drift & Honest Caveats (from code-level audit)

- **Ethics gate deliberately NOT wired** into the execution path (its vetoes are unreachable against the 78 real write tools; decision recorded — real governance today = risk tiers + approval routing).
- **Three tool registries coexist**; `FLOW_TOOLS` (287) is canonical per ADR-0001; cortex registry mid-consolidation.
- **LiveKit voice UI unwired** (`KeyLiveVoice` imported nowhere); shipped voice UX = TTS bar + push-to-talk. Voice transcripts not persisted.
- **tRPC unused by web**; REST is the real API surface. `/key-connector` REST + tRPC twin overlap; `processAiCommand` is a placeholder.
- **Pull sync unimplemented by design** for payment/accounting/marketing connectors (STATUS_ONLY); ingestion is webhook/callback-driven.
- **Orphaned/partial:** `LandingPage` model has no API; `marketing` module thin; webhook delivery logs in-memory only (a `WebhookDeliveryLog` model exists); `directory` controller mock-backed; community/gamification/SEO/salesPack dormant behind flags; `BankConnection` stores tokens but no live Plaid/Yodlee client; `RealtimeService`/`use-realtime.ts` unwired; `/app/api/actions` + `/app/api/ai/suggest` stubs; `/public/{book,pay,social}` demo utilities with hardcoded data.
- **Doc/code drift:** AGENTS.md says `KeyChatInput` wraps `KeyChatCommandBar` (they're independent); older docs claim chat SSE is POST-with-body (it's GET + query params); two nav systems coexist in the docs (7-item master-plan nav vs 4-surface IA vs the shipped Cockpit/KEY/Operate/Build/Me rail).
- **Approval consolidation in progress:** `KeyCortexApprovalOrchestratorService` collapses 3 approval models into one path; legacy `AiApprovalItem`/`ApprovalRequest` still live alongside canonical `KeyActionProposal`.
- **86 of 441 Prisma models have zero server references** (dead/raw-SQL/write-only, per ownership registry).
- **Schema caveats:** commerce money still `Float` (finance is Decimal); credit-note status flips bypass the invoice workflow; recurring invoices generate SENT with zero tax; discount type spellings differ between service and schema comment; daily autonomy spend cap is TTD-only; Genesis compliance rules are Trinidad & Tobago-specific.
- **Live counts** (2026-08-06 capability map, re-derived): 137 KEY tools exposed to roles (287 in registry), risk tiers 73 T1/48 T2/13 T3/3 T4, 97 cortex services, 101 server modules, 55 nav destinations, 19 standing gate specs, 3,126 server + 117 web tests.

---

## 15. Source Map (where to verify what)

| Area | Canonical location |
|---|---|
| Vision/strategy | `docs/KEYFLOWOS_WORLD_PLUGGED_OS_MASTER_PLAN.md`, `docs/business-organism-map.md`, `docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md`, `docs/KEY_GENOME_ROADMAP.md` |
| Capability truth | `docs/CAPABILITY_MAP.md` (every claim carries file:line) |
| Architecture memory | `architecture/` (system-overview, module-registry, data-model, execution-paths, target-architecture) |
| Operating loop | `architecture/os/OS.md` |
| Tool registry | `apps/server/src/modules/ai/flow-tool-registry.ts` |
| Chat pipeline | `apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts` |
| Autonomy oracle | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts` |
| Money state machine | `apps/server/src/modules/commerce/invoice-workflow.service.ts` |
| Ledger | `apps/server/src/modules/finance/posting.service.ts` |
| Tenant isolation | `packages/db/src/client.ts` + `apps/server/src/core/tenant/` |
| Connector framework | `apps/server/src/core/connectors/` |
| Web shell & nav | `apps/web/src/app/app/layout.tsx`, `apps/web/src/lib/nav-config.ts` |
| Design tokens | `apps/web/src/app/globals.css` |
