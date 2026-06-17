# Business Genome Phase 1 Implementation Plan

**Date:** 2026-06-17  
**Spec:** `docs/superpowers/specs/2026-06-17-business-genome-phase-1-design.md`  
**Approach:** Build backend-first (data model → scoring → gate → chat), then surface in `/app/profile` as the new Business Genome tab. Preserve the existing `BusinessBlueprint` table and reuse `COMPLETENESS_FIELDS` / types from `apps/server/src/modules/blueprint/blueprint.types.ts`. Each phase is independently buildable and testable.

---

## Phase 1: Backend DNA Mapping & Integrity Scoring

**Goal:** Add cache/state columns to `BusinessBlueprint`, create `GenomeChatMessage`, implement DNA section mapping, integrity scoring, and stage determination in `BlueprintService`.

### 1.1 Prisma schema changes

**Files:**
- `packages/db/prisma/schema.prisma`

**Changes:**
1. Extend `BusinessBlueprint`:
   ```prisma
   genomeIntegrity     Int?     @map("genome_integrity")
   genomeDnaScores     Json?    @default("{}") @map("genome_dna_scores")
   genomeDnaConfidence Json?    @default("{}") @map("genome_dna_confidence")
   genomeStage         String?  @map("genome_stage")
   genesisCompleted    Boolean? @default(false) @map("genesis_completed")

   constitutionVersion     Int?      @default(1) @map("constitution_version")
   constitutionGeneratedAt DateTime? @map("constitution_generated_at")

   // Architecture hooks for Phase 2+
   lastGenomeSyncAt        DateTime? @map("last_genome_sync_at")
   businessAssets          Json?     @default("{}") @map("business_assets")
   executiveReadinessScore Int?      @map("executive_readiness_score")
   ```
2. Add `GenomeChatMessage`:
   ```prisma
   model GenomeChatMessage {
     id         String   @id @default(cuid())
     businessId String   @map("business_id")
     role       String
     content    String
     metadata   Json?
     createdAt  DateTime @default(now()) @map("created_at")

     @@index([businessId, createdAt])
     @@map("genome_chat_messages")
   }
   ```
3. Run migration: `pnpm --filter db migrate dev --name business_genome_phase_1`.
4. Regenerate client: `pnpm --filter db generate`.

### 1.2 Add DNA types to `blueprint.types.ts`

**Files:**
- `apps/server/src/modules/blueprint/blueprint.types.ts`

**Changes:**
1. Add:
   ```ts
   export type DnaSectionKey =
     | 'founder' | 'vision' | 'business' | 'market' | 'financial'
     | 'legal' | 'operations' | 'sales' | 'marketing' | 'growth' | 'technology';

   export type GenomeStage =
     | 'CONCEPT' | 'VALIDATED_CONCEPT' | 'REGISTERED_ENTITY'
     | 'REVENUE_ENGINE' | 'OPERATING_BUSINESS' | 'GROWTH_BUSINESS'
     | 'ENTERPRISE_READY';

   export interface DnaSectionScore {
     key: DnaSectionKey;
     label: string;
     integrity: number;
     confidence: number;
     summary: string;
     fieldsCaptured: number;
     fieldsTotal: number;
     missingFields: string[];
     recommendation: string;
   }

   export interface GenomeIntegrityResult {
     genomeIntegrity: number;
     genomeDnaScores: Record<DnaSectionKey, number>;
     genomeDnaConfidence: Record<DnaSectionKey, number>;
     genomeStage: GenomeStage;
     threePillarMinimumMet: boolean;
     dnaSections: DnaSectionScore[];
   }
   ```

### 1.3 Implement DNA scoring in `BlueprintService`

**Files:**
- `apps/server/src/modules/blueprint/blueprint.service.ts`

**Changes:**
1. Add constants:
   ```ts
   const DNA_SECTION_WEIGHTS: Record<DnaSectionKey, number> = {
     founder: 10, vision: 5, business: 15, market: 15, financial: 15,
     legal: 10, operations: 10, sales: 5, marketing: 5, growth: 5, technology: 5,
   };

   const DNA_SECTION_FIELDS: Record<DnaSectionKey, { sources: BlueprintSectionKey[]; fields: string[]; label: string }> = {
     founder: { sources: ['founderProfile'], fields: ['founderName','background','skills','weeklyAvailabilityHours'], label: 'Founder DNA' },
     vision: { sources: ['identity','brand'], fields: ['mission','vision','values','voice','tone','valueProps'], label: 'Vision DNA' },
     business: { sources: ['identity','operatingModel','brand','goals','constraints','workflowModel','aiPreferences'], fields: ['name','archetype','industry','revenueModel','deliveryMode','serviceArea','teamSize','northStar','budgetRange','timeCommitment','riskTolerance','primaryWorkflow','autonomyLevel','reportingCadence'], label: 'Business DNA' },
     market: { sources: ['customerModel','marketProfile'], fields: ['idealCustomer','segments','painPoints','targetGeography','marketCategory','demandSignals'], label: 'Market DNA' },
     financial: { sources: ['financials','projectionProfile'], fields: ['currency','pricingModel','avgTicket','monthlyTarget','startupCapital','monthlyFixedCosts','variableCostPercent'], label: 'Financial DNA' },
     legal: { sources: ['legalProfile','registrationProfile','taxProfile','ownershipProfile','complianceProfile'], fields: ['country','recommendedEntityType','regulatedIndustry','businessNameStatus','companiesRegistryStatus','vatStatus','taxIdStatus','hasPartners','owners','complianceItems'], label: 'Legal DNA' },
     operations: { sources: ['operationsSystem'], fields: ['coreWorkflows','fulfillmentProcess'], label: 'Operations DNA' },
     sales: { sources: ['salesSystem'], fields: ['salesChannels','pipelineStages'], label: 'Sales DNA' },
     marketing: { sources: ['marketingSystem'], fields: ['channels','launchPlan'], label: 'Marketing DNA' },
     growth: { sources: ['executionRoadmap'], fields: ['today','sevenDayPlan','thirtyDayPlan'], label: 'Growth DNA' },
     technology: { sources: ['workflowModel','aiPreferences'], fields: ['primaryWorkflow','autonomyLevel','outreachStyle','reportingCadence'], label: 'Technology DNA' },
   };
   ```
2. Add methods:
   - `calculateGenomeIntegrity(businessId): Promise<GenomeIntegrityResult>` — reads blueprint, maps sections, computes scores/stage.
   - `getDnaSections(blueprint): DnaSectionScore[]` — uses existing `readObject` + `isPopulated` helpers.
   - `checkThreePillarMinimum(scores): boolean`.
   - `determineGenomeStage(integrity, scores): GenomeStage` — implements rules from spec §11.
   - `_buildSectionScore(key, blueprint): DnaSectionScore` — computes summary, missing fields, recommendation text.
3. Call `calculateGenomeIntegrity` from `updateBlueprint` and persist `genomeIntegrity`, `genomeDnaScores`, `genomeDnaConfidence` (placeholder = scores), `genomeStage` after every write.
4. Update `getBlueprint` / serialization to return these new fields.

### 1.4 Add unit tests

**Files:**
- `apps/server/src/modules/blueprint/blueprint.service.spec.ts` (create if absent)

**Tests:**
1. Empty blueprint → all DNA scores 0, stage `CONCEPT`.
2. Fully populated blueprint → each section score 100, integrity 100, stage `ENTERPRISE_READY`.
3. Three-Pillar Minimum met exactly at 50% each.
4. Stage transitions: `REGISTERED_ENTITY`, `REVENUE_ENGINE`, `OPERATING_BUSINESS`, `GROWTH_BUSINESS` boundary conditions.
5. Missing JSON columns are treated as `{}` and do not throw.
6. `pnpm --filter server build` passes.

---

## Phase 2: Three-Pillar Gate & Recommendations

**Goal:** Expose genome endpoints, add server `GenomeGateGuard`, and replace `useOnboardingGuard` with `useGenomeGate`.

### 2.1 Extend `BlueprintController`

**Files:**
- `apps/server/src/modules/blueprint/blueprint.controller.ts`

**Changes:**
1. Add endpoints:
   - `GET /genome` → `BlueprintService.calculateGenomeIntegrity(...)`.
   - `GET /integrity` → `{ integrity, scores, stage }`.
   - `GET /three-pillar-status` → `{ met, founder, business, market }`.
   - `GET /recommendations` → `BlueprintService.getRecommendations(...)`.
   - `GET /constitution` → `BlueprintService.generateConstitution(...)`.
   - `PATCH /dna/:section` → validate section key, shallow-merge into underlying columns, recompute integrity, return full genome.
2. Reuse existing `AuthGuard` + `BusinessGuard`.

### 2.2 Create `GenomeGateGuard`

**Files:**
- `apps/server/src/core/auth/genome-gate.guard.ts` (new)
- `apps/server/src/core/auth/auth.module.ts` or relevant module exports

**Changes:**
1. Guard checks `BlueprintService.checkThreePillarMinimum(businessId)`.
2. Allow if met; throw `403 { code: 'GENOME_GATE_BLOCKED', genomeIntegrity, missingPillars: [...] }` if not.
3. Apply only to write/generation endpoints:
   - `PATCH /blueprint/businesses/:id/dna/:section`
   - `POST /genome-chat/businesses/:id/apply-updates`
   - Any generation endpoint that requires the minimum (add later as needed).

### 2.3 Implement recommendations logic

**Files:**
- `apps/server/src/modules/blueprint/blueprint.service.ts`

**Changes:**
1. Add `getRecommendations(businessId): Promise<GenomeRecommendation[]>`.
2. Rule-based: pick the lowest non-zero DNA section; if a pillar is missing, recommend it first.
3. Return shape:
   ```ts
   export interface GenomeRecommendation {
     id: string;
     section: DnaSectionKey;
     title: string;
     reason: string;
     href?: string;
   }
   ```

### 2.4 Create `useGenomeGate` hook

**Files:**
- `apps/web/src/hooks/use-genome-gate.ts` (new)
- `apps/web/src/hooks/use-onboarding-guard.ts` (replace usages, then delete)

**Changes:**
1. Fetch `/blueprint/businesses/:businessId/three-pillar-status` and `/genome`.
2. Allowed paths:
   ```ts
   ['/app/profile','/app/settings','/app/billing','/app/help','/app/key-connect','/logout','/auth','/public']
   ```
3. If not met and current path is not allowed, redirect to `/app/profile?tab=business-genome&intro=1`.
4. Return `{ gateActive, genomeIntegrity, threePillarMet, genesisCompleted, isAllowedPath }`.

### 2.5 Tests

**Server:**
- `GenomeGateGuard` unit tests: allowed vs blocked.
- `GET /recommendations` returns expected ordering.

**Web:**
- `useGenomeGate` redirects correctly.
- `pnpm --filter web build` and `pnpm --filter server build` pass.

---

## Phase 3: Genome Chat Backend

**Goal:** Persistent Genome Chat with AI contract parsing and confirmation flow.

### 3.1 Create `GenomeChatService`

**Files:**
- `apps/server/src/modules/business-genesis/genome-chat.service.ts` (new)
- `apps/server/src/modules/business-genesis/business-genesis.module.ts` (modify)

**Changes:**
1. Inject `PrismaService`, `BlueprintService`, and the model gateway service used by `BusinessGenesisService`.
2. Methods:
   - `getMessages(businessId, { limit?, cursor? })` — paginated list.
   - `sendMessage(businessId, userId, content)` — build genome-mode system prompt, call model, parse `genome_update` block, persist user + assistant messages, return `{ message, proposedUpdates }`.
   - `applyUpdates(businessId, userId, { section, data })` — shallow-merge via `BlueprintService.updateBlueprint`, recompute integrity, persist system message noting the update.
3. System prompt includes current DNA scores and next recommended section.

### 3.2 Create `GenomeChatController`

**Files:**
- `apps/server/src/modules/business-genesis/genome-chat.controller.ts` (new)

**Endpoints:**
- `GET /genome-chat/businesses/:businessId/messages`
- `POST /genome-chat/businesses/:businessId/messages`
- `POST /genome-chat/businesses/:businessId/apply-updates`

Apply `AuthGuard`, `BusinessGuard`, and `GenomeGateGuard` on `apply-updates`.

### 3.3 AI contract parsing

**Files:**
- `apps/server/src/modules/business-genesis/genome-chat.service.ts`

**Changes:**
1. After model response, search content for the last ` ```json ` block containing `"genome_update"`.
2. Validate `section` is a `DnaSectionKey` and `data` is an object.
3. Strip the block from displayed `content`.
4. If parse fails, log and return `proposedUpdates: null` with a clarifying assistant follow-up.

### 3.4 Rate limiting & error handling

**Changes:**
1. Add `@nestjs/throttler` or a simple in-memory rate limiter: 30 messages/minute per business.
2. On model gateway failure, return friendly fallback message; do not crash.

### 3.5 Tests

- Unit test parsing of valid/invalid `genome_update` blocks.
- Unit test `applyUpdates` recomputes integrity and bumps Constitution version when threshold crossed.
- Server build passes.

---

## Phase 4: Web Business Genome Tab Shell + Overview + DNA Sections

**Goal:** Add Business Genome as a primary tab under `/app/profile` with Overview and DNA Sections sub-tabs.

### 4.1 Refactor `/app/profile` tabs

**Files:**
- `apps/web/src/app/app/profile/page.tsx`
- `apps/web/src/app/app/profile/components/profile-types.ts` (or equivalent)

**Changes:**
1. Add `"business-genome"` and `"constitution"` to the active-tab union and tab config.
2. Keep `"blueprint"` tab redirecting to `"business-genome"` (or render Business Genome content when legacy `tab=blueprint` is present).
3. Render `BusinessGenomeTab` when active.

### 4.2 Create Business Genome shell

**Files to create:**
- `apps/web/src/app/app/profile/components/business-genome-tab.tsx`
- `apps/web/src/app/app/profile/components/business-genome/genome-overview.tsx`
- `apps/web/src/app/app/profile/components/business-genome/dna-sections-list.tsx`
- `apps/web/src/app/app/profile/components/business-genome/dna-section-drawer.tsx`
- `apps/web/src/lib/api/business-genome.ts`

**Files to modify:**
- `apps/web/src/app/app/profile/components/blueprint-tab.tsx` — repurpose into Advanced Editor or mark deprecated.

**Implementation notes:**
1. `business-genome-tab.tsx`:
   - Read `?section=overview|dna-sections|genome-chat|reports|advanced-editor`.
   - Render sub-tab navigation and selected panel.
2. `genome-overview.tsx`:
   - Use `GenomeIntegrityRing` radial progress.
   - `DnaStrengthGrid` 11 mini-cards.
   - `NextActionCard` from `/recommendations`.
   - CTA buttons to Genome Chat and DNA Sections.
3. `dna-sections-list.tsx`:
   - Fetch `/genome`.
   - Render accordion cards with score, summary, captured/total, missing fields, recommendation.
4. `dna-section-drawer.tsx`:
   - Accept `section: DnaSectionKey`.
   - Render form fields mapped from `DNA_SECTION_FIELDS`.
   - On save, call `PATCH /blueprint/businesses/:id/dna/:section`.
   - Refetch genome data.

### 4.3 Add API client

**Files:**
- `apps/web/src/lib/api/business-genome.ts`

**Functions:**
- `getGenome(businessId)`, `updateDnaSection(businessId, section, data)`, `getRecommendations(businessId)`, `getConstitution(businessId)`.

### 4.4 Tests

- `pnpm --filter web build` passes.
- E2E: `/app/profile?tab=business-genome` loads Overview.
- E2E: expand a DNA section, edit, save, score updates.

---

## Phase 5: Web Genome Chat + Reports + Advanced Editor + Constitution Tab

**Goal:** Complete the Business Genome sub-tab UI and add the Constitution sibling tab.

### 5.1 Genome Chat sub-tab

**Files to create:**
- `apps/web/src/app/app/profile/components/business-genome/genome-chat-panel.tsx`

**Implementation notes:**
1. Fetch messages from `GET /genome-chat/.../messages`.
2. Render chat UI similar to existing `BlueprintOnboardingChat`.
3. On assistant message with `proposedUpdates`, render confirmation card with Save/Edit/Ignore.
4. Save calls `POST /genome-chat/.../apply-updates` and refetches genome.

### 5.2 Reports sub-tab

**Files to create:**
- `apps/web/src/app/app/profile/components/business-genome/genome-reports.tsx`

**Implementation notes:**
1. Static list of deliverables: Business Blueprint, Constitution, SWOT, PESTLE, Financial Projection, Risk Register, 90-Day Plan, Marketing Plan, Operations Plan, Legal Readiness Checklist.
2. Link to existing documents if `documentProfile.generatedDocuments` contains them.
3. Otherwise show preview card with required DNA sections and disabled/generate CTA.

### 5.3 Advanced Editor sub-tab

**Files to create:**
- `apps/web/src/app/app/profile/components/business-genome/advanced-genome-editor.tsx`

**Implementation notes:**
1. Reuse existing Blueprint form fields and `PATCH /blueprint/businesses/:id`.
2. Label clearly as “Advanced Editor — power-user mode”.
3. Link from bottom of DNA Sections.

### 5.4 Constitution tab

**Files to create:**
- `apps/web/src/app/app/profile/components/constitution-tab.tsx`

**Implementation notes:**
1. Fetch `GET /constitution`.
2. Render structured document sections from spec §13.1.
3. Show version badge and generated timestamp.
4. If source data sparse, render placeholder explanation.

### 5.5 Tests

- E2E: Genome Chat confirmation flow.
- E2E: Constitution tab renders without errors.
- `pnpm --filter web build` passes.

---

## Phase 6: Route Redirects + App Shell Banner + Backfill Script

**Goal:** Remove old routes, add redirects, wire gate/banner, and backfill existing businesses.

### 6.1 Route redirects

**Files to create/modify:**
- `apps/web/src/app/app/onboarding/page.tsx` → replace with `redirect('/app/profile?tab=business-genome&intro=1')`.
- `apps/web/src/app/app/onboarding/business-os/page.tsx` → replace with `redirect('/app/profile?tab=business-genome')`.
- `apps/web/src/app/app/blueprint/page.tsx` → replace with `redirect('/app/profile?tab=business-genome&section=advanced-editor')`.
- `apps/web/src/app/app/settings/profile/page.tsx` → replace with `redirect('/app/profile')`.

### 6.2 App shell banner + badge

**Files:**
- `apps/web/src/app/app/layout.tsx`
- `apps/web/src/components/blueprint/blueprint-completion-banner.tsx` → replace usages
- `apps/web/src/components/genome-integrity-banner.tsx` (new)
- `apps/web/src/components/genome-integrity-badge.tsx` (new)

**Changes:**
1. In `layout.tsx`, call `useGenomeGate`.
2. Render `GenomeIntegrityBanner` when gate active or integrity < 80%.
3. Render `GenomeIntegrityBadge` in top bar (DNA icon + percentage).
4. Delete `BlueprintCompletionBanner` once no longer referenced.

### 6.3 Backfill script

**Files:**
- `scripts/backfill-genome-integrity.ts` (new)

**Logic:**
1. Iterate all `BusinessBlueprint` rows.
2. Call `BlueprintService.calculateGenomeIntegrity(businessId)`.
3. Persist `genomeIntegrity`, `genomeDnaScores`, `genomeDnaConfidence`, `genomeStage`, `genesisCompleted = threePillarMet`, `constitutionVersion = 1`, `constitutionGeneratedAt = now()`.
4. Run via `tsx scripts/backfill-genome-integrity.ts` in dev/staging, then production.

### 6.4 Tests

- E2E: old `/app/onboarding` redirects to new profile tab.
- E2E: banner appears for sub-minimum businesses.
- Backfill script runs without errors and produces deterministic scores.

---

## Testing & Verification Checklist

| Phase | Verification |
|-------|--------------|
| 1 | `pnpm --filter db migrate dev` succeeds; Prisma client regenerated; `pnpm --filter server build` passes; DNA scoring unit tests pass. |
| 2 | New genome endpoints return correct shape; `GenomeGateGuard` blocks/allows as expected; `useGenomeGate` redirects correctly. |
| 3 | Genome Chat persists messages; `genome_update` block parsed; `apply-updates` recomputes integrity; server build passes. |
| 4 | `/app/profile?tab=business-genome` renders; DNA section drawer saves and updates score; web build passes. |
| 5 | Genome Chat confirmation flow works; Reports list renders; Constitution tab renders; Advanced Editor saves. |
| 6 | Old routes redirect; app shell banner/badge visible; backfill script runs; E2E suite passes. |

---

## Rollout Notes / Risks

| Risk | Mitigation |
|------|------------|
| Existing users below Three-Pillar Minimum get redirected abruptly | Backfill sets `genesisCompleted`; gate lands on intro banner, not hard block; allowed paths remain navigable. |
| Integrity score feels arbitrary | UI exposes per-section breakdown and weights; thresholds are tunable in one place. |
| Missing Genesis JSON columns cause crashes | `readObject` returns `{}` for null/missing columns; scoring tolerates all missing fields. |
| Genome Chat competes with normal KEY chat | Clear scope in system prompt and UI: Genome Chat edits DNA only. |
| Advanced Editor confuses new users | Hidden behind sub-tab link and labeled as power-user mode. |
| Constitution too sparse | Render placeholders explaining missing data instead of failing. |
| Old `useOnboardingGuard` still referenced | Search/replace all usages before deleting the file. |

---

## Next Action

Approve this plan and start **Phase 1.1** (Prisma schema migration).
