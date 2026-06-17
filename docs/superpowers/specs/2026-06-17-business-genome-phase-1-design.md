# Business Genome — Phase 1 Design Specification

**Date:** 2026-06-17  
**Status:** Approved for implementation  
**Related specs:** [Business Genesis Patch 1](./2026-06-14-business-genesis-patch-1-design.md), [Market Strategy](./2026-06-14-market-strategy-design.md)

---

## 1. Executive Summary

This spec re-invents the KEYFLOWOS onboarding/blueprint experience as the **Business Genome** — a permanent, living operating DNA for every business, surfaced inside `/app/profile`.

- **Business Genesis** replaces the old “onboarding” concept: the first-time discovery flow that produces a Business Genome.
- **Business Blueprint** becomes a generated report from the Genome, not a separate system.
- The Genome lives under `/app/profile` as a first-class tab with sub-tabs for Overview, DNA Sections, Genome Chat, Reports, and Advanced Editor.
- A **Three-Pillar Minimum** (Founder DNA + Business DNA + Market DNA ≥ 50%) unlocks the rest of the app.
- After unlocking, the app uses soft nudges, banners, and a persistent DNA icon + **Genome Integrity** percentage to encourage completion.

Phase 1 keeps the existing `BusinessBlueprint` database table and maps its JSON columns into DNA sections. Phase 2 will introduce a fully restructured `BusinessGenome` model, version history, and evolution proposals.

---

## 2. Goals

1. Consolidate onboarding, blueprint, and profile business insight into one place: **Business Genome**.
2. Make the Genome the authoritative source of truth that KEY and the rest of the OS read from.
3. Replace the brittle `< 60% completeness` guard with a clear, strategic **Three-Pillar Minimum**.
4. Deliver a seamless **KEY Genome Chat** as the primary input method, while keeping structured manual editing available.
5. Preserve existing data and avoid risky schema rewrites in Phase 1.
6. Lay future-ready hooks for confidence scoring, recommendations, Constitution versioning, and Genome Evolution.

---

## 3. Non-Goals (Phase 1)

- Full backend restructure into a `BusinessGenome` table.
- Constitution PDF/export.
- Genome Evolution Proposals with automated approval workflows.
- Full version history UI.
- Industry-specific operating packs.
- Autonomous KEY execution.

---

## 4. Terminology

| Term | Definition |
|---|---|
| **Business Genesis** | The first-time discovery experience that creates a Business Genome. |
| **Business Genome** | The permanent operating DNA of the business, stored in structured sections. |
| **DNA Section** | A themed cluster of business attributes (e.g., Financial DNA, Market DNA). |
| **Genome Integrity** | A 0–100 score measuring how complete the Genome is. |
| **DNA Confidence** | A 0–100 score measuring the quality/certainty of captured data (placeholder in Phase 1). |
| **Three-Pillar Minimum** | Founder DNA + Business DNA + Market DNA each ≥ 50%. |
| **Business Constitution** | A living document generated from the Genome. |
| **Genome Chat** | A dedicated, persistent KEY conversation for building the Genome. |

---

## 5. Current State Summary

From the audit:

- `BusinessBlueprint` is the single source of truth, with core 10 sections + Genesis JSONB columns.
- `useOnboardingGuard` blocks the app at `completeness < 60%`.
- There are competing UX surfaces: `/app/onboarding` (Genesis flow), `/app/blueprint` (manual editor), and the Profile Blueprint tab.
- The manual Blueprint editor and Blueprint Onboarding Chat both write to the same table.
- Completeness and readiness scores are calculated separately and can confuse users.

---

## 6. Relationship to Prior Specs

This Phase 1 spec **supersedes the onboarding/blueprint UX** defined in the earlier [Business Genesis Patch 1](./2026-06-14-business-genesis-patch-1-design.md) spec. The data model, AI generation endpoints, and document engines from Patch 1 remain in use; only the entry points and navigation change.

### 6.1 Prior spec reconciliation

| Patch 1 artifact | Phase 1 fate |
|---|---|
| `/app/onboarding` route + page | Removed; redirect to `/app/profile?tab=business-genome&intro=1`. |
| `/app/onboarding/business-os` route | Removed; redirect to `/app/profile?tab=business-genome`. |
| `/app/blueprint` route + page | Removed; redirect to `/app/profile?tab=business-genome&section=advanced-editor`. |
| `GenesisConversation` component | Repurposed into `GenomeChatPanel` inside Business Genome. The typed-question logic can be reused as chat prompts. |
| `BusinessGenesisService` | **Retained and reused.** It still powers `/business-genesis/businesses/:id/*` generation endpoints (market strategy, roadmap, document pack, etc.). |
| `/business-genesis/businesses/:id/generate-market-strategy` | **Retained.** The Market Strategy hub stays at `/app/market`; it is also linked from Business Genome → Reports. |
| `readinessScore` + domain scores | **Retained on the backend** for generation modules. The UI gate moves to Genome Integrity / Three-Pillar Minimum. |
| `BlueprintOnboardingController` (`/blueprint/.../onboarding-chat`) | Replaced by new `/genome-chat/...` endpoints. Old endpoints may be deprecated after migration. |
| Manual Blueprint editor (`/app/blueprint`) | Moved to **Advanced Genome Editor** inside Business Genome. |
| Market Strategy card in `GenesisReadinessPanel` | Moves to **Business Genome → Overview** and **Business Genome → Reports**. |

### 6.2 Coexistence with Market Strategy

- `/app/market` remains the dedicated Market Strategy hub.
- Business Genome → Reports links to it.
- Market strategy generation continues to use the existing `BusinessGenesisService.generateMarketStrategy()` endpoint.
- Genome Integrity and Market readiness score serve different purposes:
  - **Genome Integrity** = completeness of the operating DNA; drives the gate and nudges.
  - **Market readiness score** = quality of the market strategy output; displayed inside `/app/market`.

---

## 7. Information Architecture

### 7.1 `/app/profile` tabs

```text
/app/profile
├── Overview
├── Business Genome          ← new primary home
│   ├── Overview
│   ├── DNA Sections
│   ├── Genome Chat
│   ├── Reports
│   └── Advanced Editor
├── Constitution             ← generated living document
├── Documents
├── Team & Roles
├── Integrations
├── Permissions
└── Settings
```

### 7.2 Route redirects

| Old route | Redirect |
|---|---|
| `/app/onboarding` | `/app/profile?tab=business-genome&intro=1` |
| `/app/onboarding/business-os` | `/app/profile?tab=business-genome` |
| `/app/blueprint` | `/app/profile?tab=business-genome&section=advanced-editor` |
| `/app/settings/profile` | `/app/profile` |

The old pages are removed; only redirects remain.

---

## 8. DNA Section Mapping

Phase 1 maps existing `BusinessBlueprint` JSONB columns into 11 DNA sections. Missing columns are handled gracefully: if a source column is absent, the section treats its fields as empty.

| DNA Section | Source JSON column(s) | Integrity Weight |
|---|---|---|
| **Founder DNA** | `founderProfile` | 10% |
| **Vision DNA** | `identity` (mission/vision/values) + `brand` | 5% |
| **Business DNA** | `identity` + `operatingModel` + `brand` + `goals` + `constraints` + `workflowModel` + `aiPreferences` | 15% |
| **Market DNA** | `customerModel` + `marketProfile` | 15% |
| **Financial DNA** | `financials` + `projectionProfile` | 15% |
| **Legal DNA** | `legalProfile` + `registrationProfile` + `taxProfile` + `ownershipProfile` + `complianceProfile` | 10% |
| **Operations DNA** | `operationsSystem` | 10% |
| **Sales DNA** | `salesSystem` | 5% |
| **Marketing DNA** | `marketingSystem` | 5% |
| **Growth DNA** | `executionRoadmap` | 5% |
| **Technology DNA** | `workflowModel` + `aiPreferences` | 5% |

### 8.1 Inverse write-mapping

When a DNA section is edited, the update is shallow-merged into its underlying `BusinessBlueprint` JSONB column(s).

| DNA Section | Writes to column(s) |
|---|---|
| Founder DNA | `founderProfile` |
| Vision DNA | `identity` (mission/vision) + `brand` (voice/tone/valueProps) |
| Business DNA | `identity`, `operatingModel`, `brand`, `goals`, `constraints`, `workflowModel`, `aiPreferences` |
| Market DNA | `customerModel`, `marketProfile` |
| Financial DNA | `financials`, `projectionProfile` |
| Legal DNA | `legalProfile`, `registrationProfile`, `taxProfile`, `ownershipProfile`, `complianceProfile` |
| Operations DNA | `operationsSystem` |
| Sales DNA | `salesSystem` |
| Marketing DNA | `marketingSystem` |
| Growth DNA | `executionRoadmap` |
| Technology DNA | `workflowModel`, `aiPreferences` |

Merge semantics: shallow merge at the top level of each target column. Existing sibling fields are preserved unless explicitly overwritten.

The exact fields and scoring formula are defined in **Appendix A**.

---

## 9. Genome Integrity, Confidence & Gate

### 9.1 Integrity scoring

```ts
{
  genomeIntegrity: 42,
  dnaScores: {
    founder: 60,
    business: 52,
    market: 48,
    financial: 20,
    legal: 10,
    operations: 5,
    // ...
  }
}
```

- Integrity is the weighted average of DNA section scores.
- Per-section scores are stored alongside the overall score so the UI never recalculates them inconsistently.
- Integrity is recomputed on every answer/chat update.

### 9.2 DNA Confidence (Phase 1 placeholder)

A `dnaConfidence` object is stored and returned with the same shape as `dnaScores`, defaulting to the integrity value. In Phase 2, KEY will distinguish:

```text
100% complete  ≠  100% confident
```

Phase 1 does **not** surface confidence in the UI, but the API returns it so future work does not require a contract change.

### 9.3 Three-Pillar Minimum

The app unlocks when:

```text
Founder DNA  ≥ 50%
Business DNA ≥ 50%
Market DNA   ≥ 50%
```

This ensures KEY knows:

- **Who** is building the business
- **What** is being built
- **Who** it serves

### 9.4 Gate behavior

#### Client-side gate

New hook `useGenomeGate` replaces `useOnboardingGuard`.

Allowed paths during the gate (user can navigate here without being redirected):

```text
/app/profile
/app/settings
/app/billing
/app/help
/app/key-connect
/public routes
/auth routes
/logout
```

If the Three-Pillar Minimum is not met and the user is on any other `/app/*` path, redirect to `/app/profile?tab=business-genome&intro=1`.

The redirect lands on the **Business Genome Overview with an intro banner**, not a hard block. The user can still navigate to allowed paths.

#### Server-side enforcement

A new `GenomeGateGuard` (NestJS guard) protects **write** endpoints that assume the business is initialized:

- `PATCH /blueprint/businesses/:id/dna/:section`
- `POST /genome-chat/businesses/:id/apply-updates`
- Any generation endpoint that requires the Three-Pillar Minimum

Read endpoints are not blocked, so the UI can always fetch the Genome to show the intro.

#### Decision matrix

| `genesisCompleted` | Three-Pillar met | Behavior |
|---|---|---|
| false | false | Show Genesis intro banner; redirect non-allowed `/app/*` paths to Genome. |
| false | true | Show “Genesis complete” prompt; allow all `/app/*` paths; prompt user to mark Genesis done. |
| true | false | Allow all paths; show soft nudges/banner. |
| true | true | Normal operation; show integrity badge + optional nudges if integrity < 80%. |

---

## 10. Business Genesis State

A lightweight state flag tracks where the business is in the lifecycle:

```prisma
genesisCompleted Boolean? @default(false)
```

| State | Meaning |
|---|---|
| `genesisCompleted = false` | User is still in Business Genesis. |
| `genesisCompleted = true` | Genesis is done; user is now maintaining/evolving the Genome. |

This is independent from integrity scores and allows the UI to tailor the experience without inference.

---

## 11. Genome Stage

`genomeStage` is derived from integrity and the Three-Pillar status. Enum values:

```ts
enum GenomeStage {
  CONCEPT = 'CONCEPT',
  VALIDATED_CONCEPT = 'VALIDATED_CONCEPT',
  REGISTERED_ENTITY = 'REGISTERED_ENTITY',
  REVENUE_ENGINE = 'REVENUE_ENGINE',
  OPERATING_BUSINESS = 'OPERATING_BUSINESS',
  GROWTH_BUSINESS = 'GROWTH_BUSINESS',
  ENTERPRISE_READY = 'ENTERPRISE_READY',
}
```

Transition rules (Phase 1):

| Stage | Condition |
|---|---|
| `CONCEPT` | Default. |
| `VALIDATED_CONCEPT` | Three-Pillar Minimum met. |
| `REGISTERED_ENTITY` | Three-Pillar met + Legal DNA ≥ 60% + Financial DNA ≥ 40%. |
| `REVENUE_ENGINE` | Integrity ≥ 60% + Sales DNA ≥ 50% + Marketing DNA ≥ 50%. |
| `OPERATING_BUSINESS` | Integrity ≥ 75% + Operations DNA ≥ 60%. |
| `GROWTH_BUSINESS` | Integrity ≥ 85% + Growth DNA ≥ 60%. |
| `ENTERPRISE_READY` | Integrity ≥ 95%. |

Phase 1 uses Genome Stage for display only; it gates no features. Feature gating by stage is a Phase 2 concern.

---

## 12. UX of Business Genome Sub-Tabs

### 12.1 Overview

The command center.

```text
Genome Integrity: 42%
Business Stage: Concept → Validated Concept
Business Health: — (Phase 2)
Maturity: — (Phase 2)

Strong: Founder DNA, Business DNA
Weak: Legal DNA, Financial DNA, Operations DNA

Next recommended action:
“Complete Financial DNA next to unlock break-even analysis
 and your 90-day profit roadmap.”

[Continue Genome Chat]  [Review DNA Sections]
```

Components:

- `GenomeIntegrityRing` — radial progress with DNA icon.
- `DnaStrengthGrid` — 11 mini-cards colored by score.
- `NextActionCard` — KEY recommendation.

### 12.2 DNA Sections

A scrollable list of 11 accordion cards.

Each card shows:

```text
Financial DNA          43%
─────────────────────────────
Summary: Pricing model set; projections missing.
Fields captured: 4 of 9
Missing: monthly fixed costs, variable cost %, runway months
KEY recommends: Add startup capital and monthly costs to model runway.
[Expand] [Edit]
```

On expand/edit, open a **side drawer** with the structured form for that DNA section. In Phase 1 these forms write to the existing `BusinessBlueprint` JSON columns.

### 12.3 Genome Chat

A full-tab chat interface. This is the **primary** way users build the genome.

- Persistent conversation, scoped to the business.
- KEY runs in **Genome Mode** here: asks pillar questions, extracts answers, confirms before updating DNA.
- Every message saved permanently.
- Normal KEY chat remains separate.

Example flow:

```text
KEY: Let’s complete your Financial DNA. I’ll ask only what
     is needed to model revenue, break-even, and runway.

KEY: What is your estimated monthly fixed cost?
User: About $3,000.

KEY: Got it. And your expected average sale price?
...
```

Before persisting any extracted DNA update, KEY presents a confirmation:

```text
KEY extracted:
- Monthly fixed cost: TTD 3,000
- Average sale price: TTD 500

Save to Financial DNA?

[Save] [Edit] [Ignore]
```

#### Genome Chat AI contract

The assistant must include a machine-readable update block whenever it extracts facts. The update block is wrapped in a ````json` fence with the key `genome_update`:

```text
I’ve captured the following for your Financial DNA.

```json
{
  "genome_update": {
    "section": "financial",
    "data": {
      "monthlyFixedCosts": 3000,
      "avgTicket": 500
    },
    "summary": "Monthly fixed cost: TTD 3,000; Average sale price: TTD 500"
  }
}
```
```

`GenomeChatService` parses this block, removes it from the displayed message, and returns `proposedUpdates` to the UI. The UI prompts the user to confirm; only then does it call `POST /genome-chat/businesses/:id/apply-updates`.

If the assistant does not include a `genome_update` block, `proposedUpdates` is `null`.

### 12.4 Reports

List of generated deliverables from the genome:

```text
Business Blueprint
Business Constitution
SWOT Analysis
PESTLE Analysis
Financial Projection
Risk Register
90-Day Plan
Marketing Plan
Operations Plan
Legal Readiness Checklist
```

Phase 1 behavior:

- If a document already exists (e.g., Market Strategy, Business Plan), link to it.
- If a document does not exist, show a **generated preview** card with:
  - What it is.
  - What DNA sections are needed to generate it.
  - A disabled or “Generate” CTA if the backend supports it.
- Do not block the UI because the document engine is incomplete.

### 12.5 Advanced Editor

The existing manual Blueprint editor, moved here and renamed **Advanced Genome Editor**.

- Accessible from the bottom of the **DNA Sections** sub-tab via a subtle “Advanced Editor” link.
- Also reachable via the redirect from the old `/app/blueprint` route.
- Visible to all users but de-emphasized so it does not confuse new users.
- Reuses the existing Blueprint form fields and `PATCH /blueprint/businesses/:id` endpoint.

---

## 13. Constitution Tab

The Constitution is a sibling tab to Business Genome under `/app/profile`.

- Phase 1: read-only generated view from the Genome.
- Tracks version metadata from the start:
  - `constitutionVersion`
  - `constitutionGeneratedAt`
- Version bump rule (Phase 1): auto-increment `constitutionVersion` and update `constitutionGeneratedAt` whenever a Genome write operation changes `genomeIntegrity` by ≥ 1 point.
- Triggering write operations:
  - `PATCH /blueprint/businesses/:id/dna/:section`
  - `POST /genome-chat/businesses/:id/apply-updates`
- PDF/export deferred to Phase 2.

### 13.1 Constitution generation (Phase 1)

The Constitution is rendered as a structured document assembled directly from Genome sections. No AI generation is required in Phase 1.

| Constitution Section | Genome Source |
|---|---|
| Executive Summary | `identity` (name/mission/oneLiner) + `brand` (voice/valueProps) + `goals` |
| Business Model | `identity` + `operatingModel` + `goals` + `constraints` |
| Governance Framework | `ownershipProfile` + `legalProfile` |
| Legal Framework | `legalProfile` + `complianceProfile` + `registrationProfile` |
| Financial Strategy | `financials` + `projectionProfile` |
| Marketing Strategy | `marketingSystem` + `customerModel` |
| Sales Strategy | `salesSystem` |
| Operations Strategy | `operationsSystem` + `workflowModel` |
| Growth Roadmap | `executionRoadmap` |
| Risk Register | `riskProfile` |

If a section’s source data is sparse, render a placeholder explaining what is needed.

---

## 14. Backend & API

### 14.1 Data model changes

Add cache/state fields to `BusinessBlueprint`:

```prisma
model BusinessBlueprint {
  // existing columns...

  genomeIntegrity     Int?     @map("genome_integrity")
  genomeDnaScores     Json?    @default("{}") @map("genome_dna_scores")
  genomeDnaConfidence Json?    @default("{}") @map("genome_dna_confidence")
  genomeStage         String?  @map("genome_stage")
  genesisCompleted    Boolean? @default(false) @map("genesis_completed")

  constitutionVersion     Int?      @default(1) @map("constitution_version")
  constitutionGeneratedAt DateTime? @map("constitution_generated_at")

  // Pre-Phase 1 architecture hooks
  lastGenomeSyncAt      DateTime? @map("last_genome_sync_at")
  businessAssets        Json?     @default("{}") @map("business_assets")
  executiveReadinessScore Int?    @map("executive_readiness_score")
}
```

Add chat history table:

```prisma
model GenomeChatMessage {
  id         String   @id @default(cuid())
  businessId String   @map("business_id")
  role       String   // user | assistant | system
  content    String
  metadata   Json?    // extracted DNA updates, action hints
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([businessId, createdAt])
  @@map("genome_chat_messages")
}
```

### 14.2 New service responsibilities

Extend `apps/server/src/modules/blueprint/blueprint.service.ts`:

- `calculateGenomeIntegrity(businessId): GenomeIntegrityResult`
- `getDnaSections(businessId): DnaSection[]`
- `checkThreePillarMinimum(businessId): boolean`
- `determineGenomeStage(integrity, scores): GenomeStage`
- `getRecommendations(businessId): GenomeRecommendation[]`

New service `apps/server/src/modules/business-genome/genome-chat.service.ts`:

- Build genome-mode system prompt from current DNA state.
- Call model gateway with rate-limiting and error fallback.
- Parse assistant response for `genome_update` JSON blocks.
- Return proposed updates for user confirmation before persisting.
- Persist all messages to `GenomeChatMessage`.

Relationship to `BusinessGenesisService`:

- `BusinessGenesisService` continues to own **generation** endpoints (market strategy, roadmap, document pack, risk register, etc.).
- `GenomeChatService` owns the **conversation** that builds and refines the Genome.
- `BlueprintService` owns the **DNA mapping, integrity scoring, and Constitution rendering**.

### 14.3 API endpoints

BlueprintController additions:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/blueprint/businesses/:id/genome` | Full genome view: DNA sections, integrity, confidence placeholder, stage, three-pillar status, genesisCompleted |
| `GET` | `/blueprint/businesses/:id/integrity` | Integrity + per-section scores |
| `PATCH` | `/blueprint/businesses/:id/dna/:section` | Update one DNA section |
| `GET` | `/blueprint/businesses/:id/three-pillar-status` | Returns unlock status |
| `GET` | `/blueprint/businesses/:id/recommendations` | Returns KEY recommendations based on weak/missing DNA |
| `GET` | `/blueprint/businesses/:id/constitution` | Returns generated Constitution |

Genome Chat endpoints:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/genome-chat/businesses/:id/messages` | List messages |
| `POST` | `/genome-chat/businesses/:id/messages` | Send user message, get assistant reply + proposed updates |
| `POST` | `/genome-chat/businesses/:id/apply-updates` | Confirm and persist proposed DNA updates |

Existing endpoints remain for backward compatibility during the transition.

### 14.4 API DTOs

#### `GET /blueprint/businesses/:id/genome`

Response:

```json
{
  "businessId": "cmpcs917u00go9z00hvf3wcw3",
  "genomeIntegrity": 42,
  "genomeDnaScores": {
    "founder": 60,
    "business": 52,
    "market": 48,
    "financial": 20,
    "legal": 10,
    "operations": 5,
    "sales": 0,
    "marketing": 0,
    "growth": 0,
    "technology": 15,
    "vision": 30
  },
  "genomeDnaConfidence": {
    "founder": 60,
    "business": 52,
    ...
  },
  "genomeStage": "CONCEPT",
  "genesisCompleted": false,
  "threePillarMinimumMet": false,
  "dnaSections": [
    {
      "key": "financial",
      "label": "Financial DNA",
      "integrity": 20,
      "confidence": 20,
      "summary": "Pricing model set; projections missing.",
      "fieldsCaptured": 4,
      "fieldsTotal": 9,
      "missingFields": ["monthlyFixedCosts", "variableCostPercent", "runwayMonths"],
      "recommendation": "Add startup capital and monthly costs to model runway."
    }
  ],
  "constitutionVersion": 1,
  "constitutionGeneratedAt": "2026-06-17T12:00:00.000Z"
}
```

#### `PATCH /blueprint/businesses/:id/dna/:section`

Request (path param `:section` is authoritative; no `section` in body):

```json
{
  "data": {
    "monthlyFixedCosts": 3000,
    "variableCostPercent": 20
  }
}
```

Response: same shape as `GET /genome`.

Rules:

- `:section` must be one of the 11 DNA keys.
- `data` is shallow-merged into the underlying `BusinessBlueprint` JSON columns (see Section 8.1).
- Integrity, scores, and stage are recomputed and returned.

#### `POST /genome-chat/businesses/:id/messages`

Request:

```json
{
  "message": "My monthly fixed cost is about $3,000."
}
```

Response:

```json
{
  "message": {
    "id": "msg_2",
    "role": "assistant",
    "content": "Thanks. And what is your expected average sale price?",
    "createdAt": "2026-06-17T12:00:00.000Z"
  },
  "proposedUpdates": null
}
```

When the assistant extracts updates:

```json
{
  "message": {
    "id": "msg_4",
    "role": "assistant",
    "content": "I’ve captured the following for your Financial DNA.",
    "createdAt": "2026-06-17T12:00:00.000Z"
  },
  "proposedUpdates": {
    "section": "financial",
    "data": {
      "monthlyFixedCosts": 3000,
      "avgTicket": 500
    },
    "summary": "Monthly fixed cost: TTD 3,000; Average sale price: TTD 500"
  }
}
```

#### `POST /genome-chat/businesses/:id/apply-updates`

Request:

```json
{
  "section": "financial",
  "data": {
    "monthlyFixedCosts": 3000,
    "avgTicket": 500
  }
}
```

Response: same shape as `GET /genome`.

### 14.5 Error handling for Genome Chat

- If the model gateway fails (401, rate limit, timeout), return a friendly fallback message and log the error. Do not crash the conversation.
- If extraction fails to parse, ask the user to rephrase instead of silently ignoring.
- Rate-limit user messages to prevent abuse (e.g., 30 messages/minute).

---

## 15. Frontend Implementation

### 15.1 New/renamed files

```text
apps/web/src/app/app/profile/
├── page.tsx                         ← add Business Genome & Constitution tabs
├── components/
│   ├── business-genome-tab.tsx      ← shell with sub-tabs
│   ├── constitution-tab.tsx
│   └── business-genome/
│       ├── genome-overview.tsx
│       ├── dna-sections-list.tsx
│       ├── dna-section-drawer.tsx
│       ├── genome-chat-panel.tsx
│       ├── genome-reports.tsx
│       └── advanced-genome-editor.tsx
├── hooks/
│   └── use-genome-gate.ts           ← replaces useOnboardingGuard
├── lib/
│   └── api/
│       └── business-genome.ts
└── components/
    ├── genome-integrity-banner.tsx  ← replaces BlueprintCompletionBanner
    └── genome-integrity-badge.tsx   ← DNA icon + percentage
```

### 15.2 Removed/redirected files

- `apps/web/src/app/app/onboarding/page.tsx` → redirect
- `apps/web/src/app/app/onboarding/business-os/page.tsx` → redirect
- `apps/web/src/app/app/blueprint/page.tsx` → redirect
- `apps/web/src/hooks/use-onboarding-guard.ts` → replaced
- `apps/web/src/components/blueprint/blueprint-completion-banner.tsx` → replaced

### 15.3 App shell

`apps/web/src/app/app/layout.tsx` uses `useGenomeGate` and renders the genome integrity banner/badge.

---

## 16. Migration & Rollout

### 16.1 Database migration

1. Add cache/state fields to `BusinessBlueprint`.
2. Create `GenomeChatMessage` table.
3. Add `constitutionVersion` / `constitutionGeneratedAt`.

### 16.2 Backfill script

A one-time script (`scripts/backfill-genome-integrity.ts`):

```text
For each BusinessBlueprint row:
  1. Map existing JSON columns to DNA sections.
  2. Calculate per-section scores using Appendix A formula.
  3. Compute genomeIntegrity.
  4. Set genomeDnaScores and genomeDnaConfidence placeholders.
  5. Determine genomeStage.
  6. Set genesisCompleted based on Three-Pillar Minimum.
  7. Set initial constitutionVersion / constitutionGeneratedAt.
  8. Save.
```

Run in dev/staging first, then production.

### 16.3 Rollout order

1. Backend migration + DNA mapping + integrity calculator.
2. Backend recommendations endpoint.
3. Backend Genome Chat service + persistence.
4. Web Business Genome tab shell + Overview + DNA Sections.
5. Web Genome Chat sub-tab.
6. Web Reports + Advanced Editor + Constitution tab.
7. Web gate/banner/nudges + route redirects.
8. QA: unit tests, E2E, backfill verification.

---

## 17. Testing Plan

### Server

- Unit tests for DNA section scoring using Appendix A fields.
- Unit tests for overall integrity calculation.
- Unit tests for Three-Pillar Minimum check.
- Unit tests for Genome Stage determination.
- Unit tests for Genome Chat extraction/confirmation flow.

### Web

- E2E: redirects from old routes to new profile tab.
- E2E: Business Genome tab navigation and DNA section edit.
- E2E: Genome Chat confirmation flow.
- E2E: gate behavior before/after Three-Pillar Minimum.
- Update existing tests affected by removed onboarding routes.

### Data

- Backfill script tested on staging copy.
- Verify integrity scores are deterministic and within 0–100.
- Verify existing blueprints without Genesis columns get graceful zero scores.

---

## 18. Future Hooks (Phase 2)

| Hook | Phase 1 state | Phase 2 direction |
|---|---|---|
| `genomeDnaConfidence` | Stored, default = integrity | KEY distinguishes completeness vs confidence |
| `/recommendations` | Simple rule-based list | Full recommendation engine from KEY |
| Constitution versioning | Metadata fields + auto-bump | Full version history + diff UI |
| Genome Evolution Proposals | Not built | Proposal/approval/evidence engine |
| Genome History | Not built | Auditable change log |
| Business Graph integration | Reads existing entities | Full graph-driven updates to Genome |
| Industry packs | Not built | Vertical-specific DNA templates |

---

## 19. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Missing Genesis JSON columns cause crashes | Graceful defaults; treat missing fields as empty. |
| Integrity score feels arbitrary | Tunable weights and per-section transparency in UI. |
| Existing users below Three-Pillar Minimum get redirected abruptly | Backfill sets `genesisCompleted`; show gentle intro rather than blocking. |
| Genome Chat competes with normal KEY chat | Clear scope: Genome Chat only edits Genome; normal chat operates the business. |
| Advanced Editor confusion | Hidden by default; labeled as power-user/admin mode. |
| Constitution generation is too sparse | Render placeholders explaining missing data instead of failing. |

---

## 22. Pre-Phase 1 Architecture Additions

The following fields are added to `BusinessBlueprint` now so later phases can build on them without another migration.

### 22.1 Business Lifecycle Engine

`genomeStage` (§11) is already first-class. Future work will expose stage-specific outputs:

| Stage | KEY outputs |
|---|---|
| `CONCEPT` | Market-validation prompts, idea-stress tests |
| `VALIDATED_CONCEPT` | Formation checklist, first 30-day plan |
| `REGISTERED_ENTITY` | Banking, tax, bookkeeping setup tasks |
| `REVENUE_ENGINE` | Sales-system optimization, conversion KPIs |
| `OPERATING_BUSINESS` | Operations dashboards, capacity planning |
| `GROWTH_BUSINESS` | Channel expansion, hiring playbooks |
| `ENTERPRISE_READY` | Governance, delegation, board-readiness |

These outputs will read from the Genome and write back recommendations, not mutate DNA directly.

### 22.2 Temporal Flow Integration Hook

```prisma
lastGenomeSyncAt DateTime? @map("last_genome_sync_at")
```

This marks the last time the Genome was reconciled with the Temporal Flow (calendar, messages, invoices, tasks, CRM events). Future KEY agents compare flow patterns against the Genome and propose `GenomeEvolution` updates.

### 22.3 Business Asset Registry

```prisma
businessAssets Json? @default("{}") @map("business_assets")
```

Future shape: domains, websites, social pages, WhatsApp numbers, email accounts, trademarks, vehicles, equipment, software licenses. Phase 1 stores the placeholder only.

### 22.4 Executive Readiness Score

```prisma
executiveReadinessScore Int? @map("executive_readiness_score")
```

A future metric distinct from Genome Integrity:

- **Genome Integrity** = completeness of the operating DNA.
- **Executive Readiness** = probability of execution success based on systems, habits, team, and historical follow-through.

Phase 1 stores the field; UI and algorithm are Phase 2.

---

## 20. Open Questions

1. Should the Three-Pillar Minimum threshold be configurable per tenant/business type in Phase 2?
2. Should Genome Chat support file uploads (e.g., pitch decks, spreadsheets) in Phase 2?
3. Should Constitution auto-regenerate on every Genome update, or require explicit user action?
4. How should the system handle multiple founders in Founder DNA?

---

## 21. Decision Log

| Decision | Rationale |
|---|---|
| Keep `BusinessBlueprint` table in Phase 1 | Avoids risky schema rewrite; maps cleanly to DNA sections. |
| Three-Pillar Minimum = Founder + Business + Market | Captures the minimum context KEY needs to operate intelligently. |
| Integrity, not completion | Executive framing; Genome is alive, not a checklist. |
| Constitution as separate profile tab | Clear separation: Genome = source, Constitution = generated output. |
| Advanced Editor retained | Power users and developers still need raw structured editing. |
| Per-section scores stored with overall integrity | Prevents UI/backend recalculation drift. |
| DNA Confidence returned but not surfaced | Future-proofs the API without adding Phase 1 UI complexity. |
| Genome Stage display-only in Phase 1 | Avoids premature feature gating before thresholds are validated. |
| `BusinessGenesisService` retained | Generation endpoints (market strategy, roadmap, etc.) remain valuable and are consumed by the new UI. |

---

## Appendix A — DNA Section Scoring

Phase 1 reuses the field lists already defined in `apps/server/src/modules/blueprint/blueprint.service.ts` (`COMPLETENESS_FIELDS`) and maps them into DNA sections.

### A.1 Field mapping

| DNA Section | Required fields | Source section(s) |
|---|---|---|
| Founder DNA | `founderName`, `background`, `skills`, `weeklyAvailabilityHours` | `founderProfile` |
| Vision DNA | `mission`, `vision`, `values`, `voice`, `tone`, `valueProps` | `identity` + `brand` |
| Business DNA | `name`, `archetype`, `industry`, `revenueModel`, `deliveryMode`, `serviceArea`, `teamSize`, `northStar`, `budgetRange`, `timeCommitment`, `riskTolerance`, `primaryWorkflow`, `autonomyLevel`, `reportingCadence` | `identity` + `operatingModel` + `goals` + `constraints` + `workflowModel` + `aiPreferences` |
| Market DNA | `idealCustomer`, `segments`, `painPoints`, `targetGeography`, `marketCategory`, `demandSignals` | `customerModel` + `marketProfile` |
| Financial DNA | `currency`, `pricingModel`, `avgTicket`, `monthlyTarget`, `startupCapital`, `monthlyFixedCosts`, `variableCostPercent` | `financials` + `projectionProfile` |
| Legal DNA | `country`, `recommendedEntityType`, `regulatedIndustry`, `businessNameStatus`, `companiesRegistryStatus`, `vatStatus`, `taxIdStatus`, `hasPartners`, `owners`, `complianceItems` | `legalProfile` + `registrationProfile` + `taxProfile` + `ownershipProfile` + `complianceProfile` |
| Operations DNA | `coreWorkflows`, `fulfillmentProcess` | `operationsSystem` |
| Sales DNA | `salesChannels`, `pipelineStages` | `salesSystem` |
| Marketing DNA | `channels`, `launchPlan` | `marketingSystem` |
| Growth DNA | `today`, `sevenDayPlan`, `thirtyDayPlan` | `executionRoadmap` |
| Technology DNA | `primaryWorkflow`, `autonomyLevel`, `outreachStyle`, `reportingCadence` | `workflowModel` + `aiPreferences` |

### A.2 Scoring formula

A field is considered populated if it is:

- a non-empty string
- a non-empty array
- a non-empty object
- a non-NaN number

For each DNA section:

```ts
sectionScore = round(
  (populatedFields / requiredFields.length) * 100
)
```

Overall Genome Integrity:

```ts
genomeIntegrity = round(
  sum(sectionScore * sectionWeight) / sum(sectionWeights)
)
```

Where `sectionWeight` is defined in Section 8.

### A.3 Three-Pillar Minimum check

```ts
threePillarMet =
  dnaScores.founder >= 50 &&
  dnaScores.business >= 50 &&
  dnaScores.market >= 50;
```

### A.4 Graceful handling of missing source columns

If a source JSON column does not exist in the row, it is treated as `{}`. Therefore all fields from that source are unpopulated and the section score reflects only the columns that do exist.

---

*End of Phase 1 Business Genome design specification.*
