# Patch 3 — Market Strategy & Intelligence Design Spec

## Overview

Add AI-generated market strategy capabilities to Business Genesis:

- SWOT analysis
- PESTLE analysis
- Competitor profile
- Offer positioning
- 90-day marketing launch plan

The outputs are generated from the existing `BusinessBlueprint` context, persisted in a dedicated `MarketStrategy` row and `Competitor` rows, and surfaced in a new `/app/market` hub. A combined “Market Strategy” document instance is also created so the result can be viewed in the document hub and shared.

## Decisions

| Decision | Choice |
|----------|--------|
| Generation style | AI-generated from blueprint context |
| Persistence | Dedicated Prisma tables (`MarketStrategy`, `Competitor`) |
| Competitor source | AI-generated plausible competitors based on industry/geography |
| UI entry point | New `/app/market` hub + onboarding dashboard card |
| Generation UX | One “Generate market strategy” button creates/updates all artifacts |
| Readiness impact | Yes — market domain score incorporates strategy signals |
| Document output | One combined `DocumentInstance` of type `market-strategy` |
| Regeneration | Reuses the same `DocumentInstance`; replaces sections and appends a new `DocumentVersion` |
| Failure mode for AI calls | All-or-nothing fail-fast for infrastructure errors; content-level errors fall back to safe defaults |
| Concurrency | Frontend button disabling only; no distributed backend lock for MVP |

## Data Model

### Prisma schema additions

```prisma
model MarketStrategy {
  id               String   @id @default(cuid())
  businessId       String   @unique @map("business_id")
  business         Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  swot             Json?    // { strengths[], weaknesses[], opportunities[], threats[] }
  pestle           Json?    // { political, economic, social, technological, legal, environmental }
  positioning      Json?    // { tagline, valueProposition, keyMessages[], differentiators[], targetSegments[] }
  launchPlan       Json?    // { summary, phases[{ name, duration, actions[] }] }
  analysisSummary  Json?    // { marketOpportunityScore: number, keyInsight: string }
  generatedAt      DateTime? @map("generated_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  @@map("market_strategies")
}

model Competitor {
  id          String   @id @default(cuid())
  businessId  String   @map("business_id")
  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  name        String
  threatLevel String?  // LOW | MEDIUM | HIGH
  strengths   String[]
  weaknesses  String[]
  positioning String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@index([businessId])
  @@map("competitors")
}
```

The `Business` model is updated to include the inverse relations:

```prisma
model Business {
  // ... existing fields ...
  marketStrategy MarketStrategy?
  competitors    Competitor[]
}
```

### Blueprint signals for readiness

After generation, the service patches `marketProfile` on the blueprint:

```ts
{
  marketStrategyGeneratedAt: string; // ISO 8601
  competitorCount: number;
  marketOpportunityScore: number; // 0-100, clamped, sourced from analysisSummary
}
```

The readiness score itself is persisted in the existing `BusinessBlueprint.readinessScore` column.

### Type updates

Update `apps/server/src/modules/blueprint/blueprint.types.ts`:

```ts
export interface BlueprintMarketProfile {
  targetGeography?: string;
  marketCategory?: string;
  marketStage?: string;
  trends?: string[];
  barriersToEntry?: string[];
  demandSignals?: string[];
  marketOpportunityScore?: number;
  marketStrategyGeneratedAt?: string;
  competitorCount?: number;
}
```

Mirror the same additions in `apps/web/src/lib/blueprint-types.ts` so the frontend type stays in sync.
```

## Backend

### New endpoints

In `BusinessGenesisController` under `business-genesis/businesses/:businessId`:

- `POST /generate-market-strategy` — create/update strategy, competitors, document, readiness. Returns `200 OK` for both initial creation and regeneration.
- `GET /market-strategy` — return `MarketStrategyResponse`.

Both use existing `AuthGuard` and `BusinessGuard`.

**`GET /market-strategy` behavior**
- Delegate to `GenesisMarketStrategyService.getMarketStrategy(businessId)`.
- The service loads strategy + competitors via `MarketStrategyRepository.findStrategyWithCompetitors`, computes the current readiness from the blueprint, and resolves `documentInstanceId` through the deterministic document-instance helper owned by `MarketStrategyDocumentBuilder`.
- Return the same `MarketStrategyResponse` shape; `strategy` is `null` when no strategy has been generated yet.

Server response DTOs (to be added to `business-genesis.types.ts`):

```ts
export interface MarketStrategyDto {
  id: string;
  businessId: string;
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
  positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
  launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
  analysisSummary: { marketOpportunityScore: number; keyInsight: string };
  generatedAt: string;
}

export interface CompetitorDto {
  id: string;
  businessId: string;
  name: string;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  strengths: string[];
  weaknesses: string[];
  positioning: string | null;
}

export interface MarketStrategyResponse {
  strategy: MarketStrategyDto | null;
  competitors: CompetitorDto[];
  documentInstanceId: string | null;
  readiness: GenesisReadinessScore;
}
```

Controller returns `MarketStrategyResponse` for both endpoints.

### Service decomposition

A thin orchestrator service plus focused helpers so each unit is independently testable.

#### 1. `MarketStrategyContextBuilder`

- File: `apps/server/src/modules/business-genesis/market-strategy-context-builder.service.ts`
- Responsibility: Build the context block passed to the AI from `identity`, `marketProfile`, `offerArchitecture`, `customerModel`, `operatingModel`, `financials`, `marketingSystem`, `goals`, and `projectionProfile`.
- Interface: `build(blueprint: BlueprintData): string`
- Missing or incomplete sections are rendered as empty strings/empty arrays rather than omitted, so the prompt stays stable and the model can infer defaults from available context.
- Field mapping from `BlueprintData` to the context block placeholders:

| Placeholder | Blueprint source |
|---|---|
| `name` | `blueprint.identity.name` |
| `industry` | `blueprint.identity.industry` |
| `country` | `blueprint.identity.country` |
| `targetGeography` | `blueprint.marketProfile?.targetGeography` |
| `archetype` | `blueprint.identity.archetype` |
| `revenueModel` | `blueprint.operatingModel?.revenueModel` |
| `pricingModel` | `blueprint.financials?.pricingModel` |
| `channels` | `blueprint.operatingModel?.channels?.join(', ')` |
| `idealCustomer` | `blueprint.customerModel?.idealCustomer` |
| `coreOfferName` | `blueprint.offerArchitecture?.coreOffer?.name` |
| `coreOfferDescription` | `blueprint.offerArchitecture?.coreOffer?.description` |
| `currency` | `blueprint.financials?.currency` |
| `monthlyTarget` | `blueprint.financials?.monthlyTarget` |
| `runwayMonths` | `blueprint.projectionProfile?.runwayMonths` |
| `marketingChannels` | `blueprint.marketingSystem?.channels?.map(c => c.channel).join(', ')` |
| `northStar` | `blueprint.goals?.northStar` |
| `priorities` | `blueprint.goals?.priorities?.join(', ')` |

- `generatedAt` is stored as a Prisma `DateTime?` and converted to/from ISO-8601 strings at the service boundary. API responses expose ISO strings.

#### 2. `MarketStrategyAiGenerator`

- File: `apps/server/src/modules/business-genesis/market-strategy-ai-generator.service.ts`
- Responsibility: Call `ModelGatewayService.complete` for the three contracts and coerce outputs.
- Types (added alongside contracts in `apps/server/src/modules/ai/ai-output-contracts.ts`):
  ```ts
  export interface GenesisSwotPestlePositioningResult {
    swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
    pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
    positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
    analysisSummary: { marketOpportunityScore: number; keyInsight: string };
  }

  export interface GenesisCompetitorResult {
    name: string;
    threatLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    strengths: string[];
    weaknesses: string[];
    positioning?: string;
  }

  export interface GenesisLaunchPlanResult {
    launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
  }
  ```
- Interface:
  ```ts
  generateSwotPestlePositioning(context: string): Promise<GenesisSwotPestlePositioningResult>
  generateCompetitors(context: string): Promise<GenesisCompetitorResult[]>
  generateLaunchPlan(context: string): Promise<GenesisLaunchPlanResult>
  ```
- Does **not** pass `expectedContract` to `ModelGatewayService.complete`; instead it parses `response.content` and applies `validateOutputContract` + `coerceToContract<T>` manually. Extending `ContractType` and `validateOutputContract` is sufficient because `coerceToContract` relies on the validator. This lets malformed content fall back to safe defaults while infrastructure errors still propagate.
- On malformed/partial model output (JSON parse error or validation failure), returns deterministic safe fallbacks:

| Contract | Fallback |
|----------|----------|
| `genesis_swot_pestle_positioning` | `{ swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] }, pestle: { political: '', economic: '', social: '', technological: '', legal: '', environmental: '' }, positioning: { tagline: '', valueProposition: '', keyMessages: [], differentiators: [], targetSegments: [] }, analysisSummary: { marketOpportunityScore: 0, keyInsight: '' } }` |
| `genesis_competitors` | `[]` |
| `genesis_launch_plan` | `{ launchPlan: { summary: '', phases: [] } }` |

- `generateCompetitors` parses `result.competitors`; if it is missing or not an array, uses an empty array. It then normalizes the array to a length of 0–5 (truncate if more than 5) and maps invalid `threatLevel` values to `null` before returning `Promise<GenesisCompetitorResult[]>`.
- If `ModelGatewayService.complete` throws (network timeout, rate-limit, 5xx, or other infrastructure failure), the error propagates to the orchestrator, which aborts the entire generation.
- Prompt/cost parameters: `temperature: 0.4`; `maxTokens: 2500` for `genesis_swot_pestle_positioning`, `1500` for `genesis_competitors`, `2000` for `genesis_launch_plan`. The default model configured in `ModelGatewayService` is used; no additional retry/back-off is added beyond what the gateway already provides.



The three contracts execute in parallel inside the orchestrator via `Promise.all`. If any contract throws an infrastructure error, the whole operation fails with no partial persistence. Update `ContractType` in `apps/server/src/modules/ai/ai-output-contracts.ts` to include `genesis_swot_pestle_positioning`, `genesis_competitors`, and `genesis_launch_plan`, and extend the `validateOutputContract` switch with the validation rules listed above.

#### 3. `MarketStrategyRepository`

- File: `apps/server/src/modules/business-genesis/market-strategy.repository.ts`
- Responsibility: Prisma persistence for `MarketStrategy` and `Competitor`.
- Data shapes passed across the boundary:

```ts
interface MarketStrategyData {
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
  positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
  launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
  analysisSummary: { marketOpportunityScore: number; keyInsight: string };
  generatedAt: string;
}

interface CompetitorData {
  name: string;
  threatLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  strengths: string[];
  weaknesses: string[];
  positioning?: string;
}
```

- Interface:
  ```ts
  replaceStrategyAndCompetitors(
    businessId: string,
    data: MarketStrategyData,
    competitors: CompetitorData[],
  ): Promise<{ strategy: MarketStrategy; competitors: Competitor[] }>
  findStrategyWithCompetitors(businessId: string): Promise<{ strategy: MarketStrategy | null; competitors: Competitor[] }>
  ```
- `replaceStrategyAndCompetitors` executes the strategy upsert and competitor replacement inside a single Prisma `$transaction` so the persisted state is always consistent.
- Competitor replacement first deletes all existing `Competitor` rows for the business, then inserts the new rows, preventing orphaned or duplicate competitors.
- Invalid `threatLevel` values are normalized to `null` before persistence.
- `generatedAt` is converted from ISO-8601 string to `Date` on write.

#### 4. `MarketStrategyDocumentBuilder`

- File: `apps/server/src/modules/business-genesis/market-strategy-document-builder.service.ts`
- Responsibility: Create or update a deterministic `DocumentInstance` from the generated strategy content.
- Finds the `market-strategy` `DocumentType` (seeded from document taxonomy). If it is missing, throws a `NotFoundException` so the failure is surfaced to the orchestrator, which degrades gracefully by returning `documentInstanceId: null`.
- Compute a deterministic `instanceId = `market-strategy:${businessId}`. Implementation may use `prisma.documentInstance.upsert()` or an explicit find-then-create/update wrapped in `$transaction`; both produce the same deterministic id.
- `create` path (atomic transaction):
  - Payload: `{ id: instanceId, businessId, documentTypeId, title: 'Market Strategy', status: 'DRAFT', healthStatus: 'CURRENT', currentVersionNum: 1, sections: { create: [...] }, versions: { create: { versionNumber: 1, ... } } }`.
- `update` / regeneration path (atomic transaction):
  - Delete existing `DocumentSection` rows for the instance, create new sections from the generated JSON, create a new `DocumentVersion` with `versionNumber = currentVersionNum + 1`, and update `currentVersionNum` on the instance.
- The `instanceId` is stable so existing links keep working.
- **Concurrency:** MVP relies on frontend button disabling while `generating` is true. There is no backend distributed lock. Concurrent POSTs from multiple tabs/clients can race: one may succeed while the other hits a unique-constraint error or partial state; the failed request returns a generic error toast. This is accepted for the initial ship.
- Creates these `DocumentSection` rows:

| sectionKey | sectionName | content source |
|---|---|---|
| `swot` | SWOT Analysis | Rendered from `strategy.swot` JSON |
| `pestle` | PESTLE Analysis | Rendered from `strategy.pestle` JSON |
| `competitors` | Competitor Profile | Rendered from `competitors` array |
| `positioning` | Offer Positioning | Rendered from `strategy.positioning` JSON |
| `launch-plan` | 90-Day Launch Plan | Rendered from `strategy.launchPlan` JSON |

Each section is stored as Markdown plain text in `content`, `contentFormat: 'PLAIN'`, `contentSource: 'AI_GENERATED'`, `editableMode: 'GUIDED'`, `riskScore: 'GREEN'. String constants match the defaults already used by the document engine (`AI_GENERATED`, `GUIDED`, `GREEN`, `PLAIN`).

Example rendering for the `swot` section:
```markdown
## Strengths
- Easy-to-remember brand name
- Low startup overhead

## Weaknesses
- Limited initial marketing budget

## Opportunities
- Growing demand in the local area

## Threats
- Established competitors with larger ad spend
```

Example rendering for the `competitors` section:
```markdown
## Competitor: Joe's Local Bakery
- Threat level: HIGH
- Strengths: Established brand, prime location, loyal customer base
- Weaknesses: Limited online ordering, slow to adopt new flavors
- Positioning: Traditional neighborhood bakery focused on daily bread and pastries.

## Competitor: National Cake Delivery Chain
- Threat level: MEDIUM
- Strengths: Wide delivery network, aggressive digital marketing
- Weaknesses: Generic products, higher prices
- Positioning: Convenience-first premium dessert delivery.
```

The `DocumentVersion` stores:
- `content`: `{ sections: [...] }` where each item mirrors `{ sectionKey, sectionName, content }`.
- `sectionSnapshots`: the same array for a stable snapshot of the generated version.

String constants used (`PLAIN`, `AI_GENERATED`, `GUIDED`, `GREEN`) match the defaults already declared in the document-engine Prisma schema and service code.

- Interface:
  ```ts
  buildOrUpdate(businessId: string, strategy: MarketStrategyData, competitors: CompetitorData[]): Promise<DocumentInstance>
  getInstanceId(businessId: string): string
  exists(businessId: string): Promise<boolean>
  ```

#### 5. `MarketStrategyMapper`

- File: `apps/server/src/modules/business-genesis/market-strategy.mapper.ts`
- Responsibility: Convert raw Prisma `MarketStrategy`/`Competitor` rows into API DTOs (`MarketStrategyDto`/`CompetitorDto`).
- Applies JSON coalescence (safe fallbacks for missing fields) and converts `generatedAt` from `Date` to ISO-8601 string.
- Also converts Prisma `Competitor.threatLevel` to `'LOW'|'MEDIUM'|'HIGH'|null` and `positioning` to `string|null`.
- Interface:
  ```ts
  toStrategyDto(strategy: MarketStrategy | null): MarketStrategyDto | null
  toCompetitorDtos(competitors: Competitor[]): CompetitorDto[]
  ```

#### 6. `GenesisMarketStrategyService` (orchestrator)

- File: `apps/server/src/modules/business-genesis/genesis-market-strategy.service.ts`
- Responsibility: Coordinate the helpers, patch the blueprint, and recalculate readiness.
- Exposes two methods used by the controller:
  ```ts
  generateMarketStrategy(businessId: string): Promise<MarketStrategyResponse>
  getMarketStrategy(businessId: string): Promise<MarketStrategyResponse>
  ```
- `generateMarketStrategy` flow:
  1. Load blueprint via `BlueprintService.getBlueprint` (it lazily creates a row from the Business record, so it throws only if the business does not exist; the controller's `BusinessGuard` ensures the business exists before this point).
  2. Compute the current readiness snapshot from the loaded blueprint via `GenesisReadinessScorer.calculate(blueprint)` and keep it as `previousReadiness`.
  3. `contextBuilder.build(blueprint)`.
  4. Run AI generations in parallel via `Promise.all`. If any generation throws an infrastructure error, abort and surface the error.
  5. Extract `marketOpportunityScore`. If it is missing or not a number, treat it as `0`; then clamp to `[0, 100]`.
  6. `repository.replaceStrategyAndCompetitors(businessId, strategy, competitors)`.
  7. Build/update document via `documentBuilder.buildOrUpdate`. Capture the returned `DocumentInstance.id` as `documentInstanceId`. Wrap in try/catch; on failure, log a warning and continue with `documentInstanceId: null`.
  8. Patch blueprint `marketProfile` readiness signals via `BlueprintService.updateBlueprint` with this patch:
     ```ts
     { marketProfile: { marketStrategyGeneratedAt: new Date().toISOString(), competitorCount: competitors.length, marketOpportunityScore } }
     ```
     Capture the returned `BlueprintData` as `updatedBlueprint`. `BlueprintService.updateBlueprint` shallow-merges the patch, so existing `marketProfile` fields are preserved.
  9. Recalculate readiness via `GenesisReadinessScorer.calculate(updatedBlueprint)` and persist the new `readinessScore` via `BlueprintService.updateBlueprint` with `{ readinessScore: newReadiness.overall }`, wrapped in try/catch. On failure, log a warning and return `previousReadiness` from step 2.
  10. Use `MarketStrategyMapper.toStrategyDto(strategy)` and `MarketStrategyMapper.toCompetitorDtos(competitors)` to produce the DTO parts.
  11. Return `{ strategy, competitors, documentInstanceId, readiness }`.
- `getMarketStrategy` flow:
  1. Load strategy + competitors via `repository.findStrategyWithCompetitors`.
  2. Load blueprint and compute current readiness via `GenesisReadinessScorer.calculate`.
  3. Resolve `documentInstanceId`: call `documentBuilder.getInstanceId(businessId)` and `documentBuilder.exists(businessId)`. If it exists, use that id; otherwise `null`.
  4. Return `{ strategy: mapper.toStrategyDto(strategy), competitors: mapper.toCompetitorDtos(competitors), documentInstanceId, readiness }`.

Register `GenesisMarketStrategyService` and helpers as Nest providers in `BusinessGenesisModule`.

### AI contracts

Add to `apps/server/src/modules/ai/ai-output-contracts.ts`:

1. `genesis_swot_pestle_positioning`
   - `{ swot: { strengths[], weaknesses[], opportunities[], threats[] }, pestle: { political, economic, social, technological, legal, environmental }, positioning: { tagline, valueProposition, keyMessages[], differentiators[], targetSegments[] }, analysisSummary: { marketOpportunityScore: number, keyInsight: string } }`
   - Validation: required top-level keys `swot`, `pestle`, `positioning`, `analysisSummary`; `swot` sub-keys must be arrays; `pestle` sub-keys must be strings; `positioning` sub-keys `tagline`/`valueProposition` must be strings and array sub-keys must be arrays; `analysisSummary.marketOpportunityScore` must be a number.

2. `genesis_competitors`
   - `{ competitors: [{ name, threatLevel?: string, strengths[], weaknesses[], positioning? }] }`
   - Validation: `competitors` is an array; each item must have a string `name`; `strengths` and `weaknesses` must be arrays; `threatLevel` is accepted as any string (or omitted) and normalized by the generator.
   - Target count: 3–5 competitors. The prompt should ask for 3–5. If the model returns fewer, persist those. If it returns more, truncate to 5. If it returns zero, persist an empty array.
   - `MarketStrategyAiGenerator` maps any `threatLevel` value other than `LOW`, `MEDIUM`, or `HIGH` to `null` before returning. It also logs a warning when malformed competitor output is received so operators can observe model drift.

3. `genesis_launch_plan`
   - `{ launchPlan: { summary: string, phases: [{ name: string, duration: string, actions: string[] }] } }`
   - Validation: `launchPlan` is an object; `summary` is a string; `phases` is an array; each phase has `name` and `duration` strings and `actions` array.

### Prompt guardrails

- System prompt: “You are the KEYFLOWOS Market Strategy engine. Produce structured strategy content for a small business based on its blueprint.”
- Context: business name, industry, country, target geography, ideal customer, core offer, pricing model, channels, goals.
- Guardrail: “Make outputs locally relevant to the business context. Do not limit yourself to the Caribbean; adapt to the stated country and region. Do not invent real company names unless certain; use plausible competitor archetypes when uncertain.”

### Readiness scoring update

In `GenesisReadinessScorer`, replace the existing `scoreMarket` implementation with the formula below.

> **Breaking-change note:** Existing market-readiness scores were based only on `customerModel`, `offerArchitecture`, and `marketingSystem`. After this patch the market score is also driven by `marketStrategyGeneratedAt`, `competitorCount`, and `marketOpportunityScore`. Scores for existing businesses will shift when they next generate (or regenerate) a market strategy. This is acceptable because the score is recomputed on demand from the blueprint, not cached independently.

```ts
private scoreMarket(blueprint: BlueprintData): number {
  const marketProfile = blueprint.marketProfile || {};
  const customer = blueprint.customerModel || {};
  const offer = blueprint.offerArchitecture || {};
  const marketing = blueprint.marketingSystem || {};

  // Legacy signals (preserved so existing businesses are not penalized)
  let baseScore = 0;
  if (customer.idealCustomer && customer.idealCustomer.trim().length > 0) baseScore += 40;
  if (offer.coreOffer && Object.keys(offer.coreOffer).length > 0) baseScore += 30;
  if (marketing.channels && marketing.channels.length > 0) baseScore += 30;

  // New strategy signals (bonuses)
  const opportunityScore = typeof marketProfile.marketOpportunityScore === 'number'
    ? Math.max(0, Math.min(100, marketProfile.marketOpportunityScore))
    : 0;
  const generatedBonus = marketProfile.marketStrategyGeneratedAt ? 10 : 0;
  const competitorBonus = Math.min((marketProfile.competitorCount || 0) * 5, 10);

  return Math.min(100, Math.round(baseScore + opportunityScore * 0.1 + generatedBonus + competitorBonus));
}
```

`overall` continues to weight market at 20%. Existing businesses that have not generated a strategy keep their previous market score (up to 100) because the legacy base signals remain unchanged.

### Document integration

- Add a new document taxonomy category `Strategy & Planning` in `apps/server/src/modules/documents/document-taxonomy.ts`:
  ```ts
  {
    name: 'Strategy & Planning',
    slug: 'strategy-planning',
    description: 'Strategic planning documents including market analysis and launch plans',
    icon: 'Target',
    sortOrder: 19,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  }
  ```
  Add the `market-strategy` document type under it.
- The taxonomy is seeded automatically by `apps/server/src/core/seed/seed.service.ts` (`seedDocumentTaxonomy`) from `DOCUMENT_CATEGORIES` and `DOCUMENT_TYPES`; no new seed file is needed.
- New taxonomy entry:
  ```ts
  {
    name: 'Market Strategy',
    slug: 'market-strategy',
    description: 'Combined SWOT, PESTLE, competitor analysis, positioning, and launch plan',
    categorySlug: 'strategy-planning',
    riskTier: 'GREEN',
    requiredProfileFields: ['name', 'industry'],
    brandSensitive: true,
    financialSensitive: false,
    legalSensitive: false,
    jurisdictionSensitive: false,
    sortOrder: 1,
  }
  ```
- `MarketStrategyDocumentBuilder` creates deterministic sections from the AI-generated JSON, not a second AI call.
- The `/app/market` hub shows a **“View strategy document”** link to `/app/documents/{instanceId}`.

### Error handling

| Scenario | Behavior |
|----------|----------|
| Blueprint not found | Throw `NotFoundException`; frontend shows error toast. |
| AI infrastructure error (timeout/rate-limit/5xx) | Propagate error; generation aborts; nothing persisted; frontend shows error toast. |
| AI returns malformed JSON or fails contract validation | `MarketStrategyAiGenerator` returns safe fallbacks (empty arrays/objects); generation continues. |
| AI returns empty/partial output | Persist whatever was returned; empty sections render empty state in UI. |
| Competitor count outside 3–5 | Persist 0–5 competitors (truncate if >5). |
| Document type `market-strategy` missing | `MarketStrategyDocumentBuilder` throws `NotFoundException`, which the orchestrator catches; endpoint returns strategy/competitors/readiness with `documentInstanceId: null` and logs a warning. |
| Document creation/update fails | The orchestrator catches the error, logs a warning, and returns strategy/competitors/readiness with `documentInstanceId: null`. |
| Readiness calculation or persistence fails | Log warning; return strategy/competitors with the `previousReadiness` snapshot computed at step 2. |
| Concurrent generation requests | MVP relies on frontend button disablement while `generating` is true. No backend distributed lock; racing POSTs may fail with a database/transaction error surfaced as a generic error toast. |

## Frontend

### New page

`apps/web/src/app/app/market/page.tsx` (client component; include `"use client"` at the top).

### Layout

- `WorkspaceShell` with title “Market Strategy & Intelligence”.
- Top summary cards:
  - Market readiness score (the `market` domain score from `GenesisReadinessScore`)
  - Competitors tracked (`competitors.length`)
  - Launch actions count (`strategy.launchPlan.phases.flatMap(p => p.actions).length`; show `0` when no strategy exists)
- Primary CTA: **Generate market strategy** (becomes **Regenerate** when data exists).
- Scrollable cards:
  - **SWOT analysis** — 2×2 grid
  - **PESTLE analysis** — 3-column grid
  - **Competitor profile** — cards with threat-level badges
  - **Offer positioning** — tagline, value proposition, differentiators, target segments
  - **90-day launch plan** — phase timeline
- Empty state when no strategy exists.

### Loading, empty, and error states

- **Loading:** Skeleton cards while `getMarketStrategy` is in flight.
- **Empty:** Hero text “Build a market strategy” + primary CTA.
- **Error:** Toast from `apiPost`/`apiGet` error; retry button on the page.
- **After generation:** Use local React state (`useState`) to store the `MarketStrategyResponse` returned from `generateMarketStrategy`; do not reload the full page. The button stays disabled during generation to prevent duplicate submissions. (The project does not currently use SWR/React Query for this screen.)

### Components

Under `apps/web/src/app/app/market/components/`:

- `MarketStrategyPanel.tsx` — orchestrator
- `SwotCard.tsx`
- `PestleCard.tsx`
- `CompetitorList.tsx`
- `PositioningCard.tsx`
- `LaunchPlanCard.tsx`

### API helpers

Add to `apps/web/src/lib/api/business-genesis.ts`:

```ts
export interface MarketStrategyResponse {
  strategy: {
    id: string;
    businessId: string;
    swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
    pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
    positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
    launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
    analysisSummary: { marketOpportunityScore: number; keyInsight: string };
    generatedAt: string;
  } | null;
  competitors: {
    id: string;
    businessId: string;
    name: string;
    threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    strengths: string[];
    weaknesses: string[];
    positioning: string | null;
  }[];
  documentInstanceId: string | null;
  readiness: GenesisReadinessScore;
}

export function generateMarketStrategy(businessId: string) {
  return apiPost<MarketStrategyResponse>({
    path: `/business-genesis/businesses/${businessId}/generate-market-strategy`,
    body: {},
  });
}

export function getMarketStrategy(businessId: string) {
  return apiGet<MarketStrategyResponse>(
    `/business-genesis/businesses/${businessId}/market-strategy`,
  );
}
```

### Navigation

- **App nav:** Edit `apps/web/src/lib/nav-config.ts`. Under `operateSections`, in the `strategy` section, add:
  ```ts
  { label: "Market Strategy", href: "/app/market", icon: Target }
  ```
  `Target` is already imported from `lucide-react`; if it is removed in future refactors, re-add it.
- **Onboarding dashboard card:** Create `apps/web/src/app/app/onboarding/components/GenesisMarketStrategyCard.tsx` following the pattern of `GenesisDocumentPackCard.tsx`. Render it in `apps/web/src/app/app/onboarding/components/GenesisReadinessPanel.tsx` inside the `actionPlan` block, alongside the existing cards.
- **Web blueprint types:** Mirror the new `BlueprintMarketProfile` fields in `apps/web/src/lib/blueprint-types.ts`:
  ```ts
  marketStrategyGeneratedAt?: string;
  competitorCount?: number;
  ```
- **View strategy document link:** Hide the link when `documentInstanceId` is `null`; render it as a secondary button when available.

## Migration

`packages/db/prisma/migrations/20260615000000_add_market_strategy_and_competitors/migration.sql`

### Up

```sql
CREATE TABLE "market_strategies" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "swot" JSONB,
  "pestle" JSONB,
  "positioning" JSONB,
  "launch_plan" JSONB,
  "analysis_summary" JSONB,
  "generated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_strategies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_strategies_business_id_key" ON "market_strategies"("business_id");
ALTER TABLE "market_strategies" ADD CONSTRAINT "market_strategies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "competitors" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "threat_level" TEXT,
  "strengths" TEXT[],
  "weaknesses" TEXT[],
  "positioning" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "competitors_business_id_idx" ON "competitors"("business_id");
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### Down

```sql
DROP TABLE IF EXISTS "competitors";
DROP TABLE IF EXISTS "market_strategies";
```

Apply with `prisma migrate deploy` (per project convention). The taxonomy entries are code-level seed data, not migration data, and are applied by `seedDocumentTaxonomy` on application bootstrap.

Also update `packages/db/prisma/schema.prisma` with the new `MarketStrategy` and `Competitor` models and the `Business` relation additions; the migration file is generated from the schema change. Note that `updated_at` columns are `NOT NULL` with no default because Prisma's `@updatedAt` handles updates at the ORM layer.

## Testing

### Server

- Unit tests for each helper:
  - `MarketStrategyContextBuilder` — verify context includes expected blueprint fields.
  - `MarketStrategyAiGenerator` — stub `ModelGatewayService`; assert coercion, fallback behavior, infrastructure-error propagation, partial-field fallback, and competitor array normalization.
  - `MarketStrategyRepository` — test upsert, competitor replacement, find, and JSON coalescence on read.
  - `MarketStrategyDocumentBuilder` — assert correct `DocumentInstance` and sections created from sample strategy JSON, including regeneration appending a new version and the document-type-missing fallback path.
  - Concurrency/ordering — add a test that two rapid regeneration calls do not produce duplicate `DocumentInstance` rows (deterministic id guards this).
- Controller tests for new endpoints.
- Integration test for `GenesisMarketStrategyService.generateMarketStrategy` orchestration.

### Web

- `pnpm tsc --noEmit` passes.
- New Playwright E2E `apps/web/e2e/business-genesis-market.spec.ts`:
  - Seed auth.
  - Navigate to `/app/market`.
  - Assert empty state.
  - Stub generate/market-strategy endpoints.
  - Click **Generate market strategy**.
  - Assert SWOT, PESTLE, Competitors, Positioning, Launch Plan render.
  - Assert **View strategy document** link appears.

## Out of Scope

- Manual competitor CRUD (add/edit/delete individual competitors).
- Real-time web search for actual competitor names.
- New documents hub UI (the existing `/app/documents/[instanceId]` page is reused).
- Export to PDF (can reuse document engine later).


## Appendix A — AI Prompts

All three contracts share a base context block built by `MarketStrategyContextBuilder` (see the field mapping table in the `MarketStrategyContextBuilder` section). The rendered block looks like:

```
Business: {name}
Industry: {industry}
Country: {country}
Target geography: {targetGeography}
Archetype: {archetype}
Revenue model: {revenueModel}
Pricing model: {pricingModel}
Primary channels: {channels}
Ideal customer: {idealCustomer}
Core offer: {coreOfferName} — {coreOfferDescription}
Financial context: currency {currency}, estimated monthly target {monthlyTarget}, runway {runwayMonths} months
Marketing channels: {marketingChannels}
Goals: {northStar} / {priorities}
```

Missing fields are rendered as empty strings.

### A.1 `genesis_swot_pestle_positioning`

**System prompt**
```
You are the KEYFLOWOS Market Strategy engine. Produce structured strategy content for a small business based on its blueprint.

Rules:
- Be specific to the business context. Do not limit yourself to the Caribbean; adapt to the stated country and region.
- Use concise, actionable language.
- For SWOT, list 3–5 bullet points per quadrant.
- For PESTLE, write 1–2 sentences per factor.
- For positioning, produce a tagline, value proposition, 3 key messages, 3 differentiators, and 2 target segments.
- For analysisSummary, score market opportunity from 0–100 and write a one-sentence key insight.

Return ONLY valid JSON matching this schema:
{
  "swot": { "strengths": string[], "weaknesses": string[], "opportunities": string[], "threats": string[] },
  "pestle": { "political": string, "economic": string, "social": string, "technological": string, "legal": string, "environmental": string },
  "positioning": { "tagline": string, "valueProposition": string, "keyMessages": string[], "differentiators": string[], "targetSegments": string[] },
  "analysisSummary": { "marketOpportunityScore": number, "keyInsight": string }
}
```

**User prompt**
```
Generate a SWOT analysis, PESTLE analysis, and positioning statement for this business.

{context}
```

### A.2 `genesis_competitors`

**System prompt**
```
You are the KEYFLOWOS Market Strategy engine. Identify 3–5 plausible competitor archetypes for the business described.

Rules:
- Do not invent real company names unless you are certain.
- Use plausible competitor archetypes (e.g., "established local bakery", "national ecommerce marketplace") when uncertain.
- Adhere to the business's country and region.
- threatLevel must be one of LOW, MEDIUM, or HIGH.

Return ONLY valid JSON matching this schema:
{
  "competitors": [
    { "name": string, "threatLevel"?: "LOW" | "MEDIUM" | "HIGH", "strengths": string[], "weaknesses": string[], "positioning"?: string }
  ]
}
```

**User prompt**
```
Generate competitor profiles for this business.

{context}
```

### A.3 `genesis_launch_plan`

**System prompt**
```
You are the KEYFLOWOS Market Strategy engine. Create a 90-day marketing launch plan for the business.

Rules:
- Phases should be realistic for a small business with limited budget/time.
- Each phase must have a name, duration (e.g., "Weeks 1–4"), and 3–5 concrete actions.
- Include a one-paragraph summary.

Return ONLY valid JSON matching this schema:
{
  "launchPlan": {
    "summary": string,
    "phases": [
      { "name": string, "duration": string, "actions": string[] }
    ]
  }
}
```

**User prompt**
```
Generate a 90-day marketing launch plan for this business.

{context}
```
