# KEYFlowOS Business Genesis — Patch 1 Design Spec

**Date:** 2026-06-14  
**Status:** Draft — pending review  
**Author:** Kimi Code CLI  
**Scope:** Transform `/app/onboarding` from a chat-only screen into a conversational Business Genesis intake that produces a structured, launch-ready Business Genome with legal, financial, and operational readiness scoring for Trinidad & Tobago founders.

---

## 1. Goals

1. **Seamless conversational intake** — User describes their business idea in plain language; KEY extracts a draft Business Genome.
2. **Progressive profiling** — KEY asks only the highest-impact missing questions, never a 150-field form.
3. **Expanded Business Genome** — Extend `BusinessBlueprint` to capture founder, legal, registration, tax, ownership, market, offer, sales, marketing, operations, projections, risk, compliance, documents, and execution-roadmap data.
4. **Trinidad & Tobago compliance engine** — Generate jurisdiction-specific registration and compliance checklists.
5. **Financial projection & readiness scoring** — Produce break-even, runway, and scenario projections from assumptions; surface a launch-readiness score.
6. **Upgrade `/app/onboarding`** — Replace the current chat-only page with a guided Genesis experience that includes extraction review, smart questions, and a readiness dashboard.
7. **Feed KEY’s brain** — Include the new genome sections in `FlowOrchestratorService` prompt context.

---

## 2. Non-Goals (Out of Scope for Patch 1)

- Full legal document generation (terms, privacy, employment contracts) — Patch 2.
- Competitor intelligence / SWOT / PESTLE generation — Patch 3.
- Automated creation of CRM pipelines, products, projects, or automations — Patch 4.
- Multi-jurisdiction compliance beyond Trinidad & Tobago — Patch 5.
- Real-time genome updates from business events — Patch 5.

---

## 3. Current State

### Backend foundation already present
- `OnboardingConciergeModule` with status, templates, chat, auto-configure, nudges.
- `BlueprintModule` with `BlueprintService`, 10-section blueprint, completeness scoring, AI onboarding chat.
- `ModelGatewayService` with provider-agnostic routing and output contracts.
- `FinanceModule` with ledger, cash-flow forecast, safe-to-spend, revenue forecast.
- `DocumentsModule` with document engine, templates, and versioning (UI currently dormant).
- `GovernanceModule` with risk register.

### Frontend foundation already present
- `/app/onboarding` renders `BlueprintOnboardingChat` and a header progress bar.
- `/app/blueprint` is a manual 10-section editor.
- `/app/profile` has a Blueprint tab and profile sections.
- `useOnboardingGuard` redirects users to `/app/onboarding` if blueprint completeness < 60%.
- `BlueprintCompletionBanner` and `KeyContextualSuggestions` drive users back to onboarding.

### Current gap
The onboarding chat extracts identity, operating model, brand, customer, and basic financials. It does not extract legal structure, registration status, tax profile, ownership, market strategy, offer architecture, projections, risks, or compliance items. There is no readiness score and no jurisdiction-specific checklist.

---

## 4. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     /app/onboarding (Genesis UI)                    │
│  GenesisConversation → ProfilePreview → QuestionSet → ReadinessPanel │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  BusinessGenesisController                          │
│  POST analyze-idea        → calls ModelGateway (genesis_idea_extraction)│
│  GET  questions/next      → static bank + missing-field priority    │
│  POST answers             → maps to blueprint sections              │
│  GET  readiness           → domain-weighted readiness score         │
│  POST generate-roadmap    → 90-day plan + compliance checklist      │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  BlueprintService     ComplianceEngine      ProjectionEngine
  (expanded schema)    (T&T rules)           (finance wrapper)
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                   BusinessBlueprint (DB)
                   + readinessScore column
```

### Key principle: extend, don’t replace
- Keep `BusinessBlueprint` as the single source of truth.
- Add new JSONB columns for Genesis sections.
- Separate `completeness` (original 10 sections, operational gate) from `readinessScore` (all sections, launch-readiness signal).

---

## 5. Data Model

### 5.1 Extend `BusinessBlueprint` Prisma model

Add new JSONB columns:

```prisma
model BusinessBlueprint {
  // existing columns: identity, operatingModel, goals, constraints, brand,
  // customerModel, financials, intelligence, workflowModel, aiPreferences,
  // completeness, confidenceScores, lastAnalyzedAt, etc.

  founderProfile      Json? @map("founder_profile")
  legalProfile        Json? @map("legal_profile")
  registrationProfile Json? @map("registration_profile")
  taxProfile          Json? @map("tax_profile")
  ownershipProfile    Json? @map("ownership_profile")
  marketProfile       Json? @map("market_profile")
  offerArchitecture   Json? @map("offer_architecture")
  salesSystem         Json? @map("sales_system")
  marketingSystem     Json? @map("marketing_system")
  operationsSystem    Json? @map("operations_system")
  projectionProfile   Json? @map("projection_profile")
  riskProfile         Json? @map("risk_profile")
  complianceProfile   Json? @map("compliance_profile")
  executionRoadmap    Json? @map("execution_roadmap")

  readinessScore      Int @default(0) @map("readiness_score")

  @@map("business_blueprints")
}
```

`completeness` continues to be computed from the original 10 sections so the existing onboarding guard stays stable.
`readinessScore` is computed from all sections weighted by domain.

**Schema versioning:** `schemaVersion` on `BusinessBlueprint` is bumped from `1` to `2`. Existing rows are backfilled to version 2 when the migration runs. The `serialize()` method returns empty objects `{}` for any new JSONB column that is null or undefined.

### 5.2 TypeScript types

Extend `apps/server/src/modules/blueprint/blueprint.types.ts` and mirror in `apps/web/src/lib/blueprint-types.ts`.

New section keys:

```ts
export type GenesisSectionKey =
  | 'founderProfile'
  | 'legalProfile'
  | 'registrationProfile'
  | 'taxProfile'
  | 'ownershipProfile'
  | 'marketProfile'
  | 'offerArchitecture'
  | 'salesSystem'
  | 'marketingSystem'
  | 'operationsSystem'
  | 'projectionProfile'
  | 'riskProfile'
  | 'complianceProfile'
  | 'executionRoadmap';

export type BlueprintSectionKey =
  | 'identity'
  | 'operatingModel'
  | 'goals'
  | 'constraints'
  | 'brand'
  | 'customerModel'
  | 'financials'
  | 'intelligence'
  | 'workflowModel'
  | 'aiPreferences'
  | GenesisSectionKey;
```

Representative interfaces (full list in implementation):

```ts
export interface BlueprintFounderProfile {
  founderName?: string;
  background?: string;
  skills?: string[];
  weaknesses?: string[];
  riskTolerance?: 'LOW' | 'MEDIUM' | 'HIGH';
  weeklyAvailabilityHours?: number;
  visionStatement?: string;
}

export interface BlueprintOwnershipProfile {
  hasPartners?: boolean;
  owners?: Array<{
    name?: string;
    role?: string;
    ownershipPercent?: number;
    contribution?: string;
  }>;
  needsShareholderAgreement?: boolean;
  unresolvedOwnershipRisks?: string[];
}

export interface BlueprintLegalProfile {
  country?: string;
  jurisdiction?: string;
  hasPhysicalLocation?: boolean;
  recommendedEntityType?: 'SOLE_TRADER' | 'PARTNERSHIP' | 'LIMITED_COMPANY' | 'NONPROFIT' | 'UNKNOWN';
  entityTypeReason?: string;
  regulatedIndustry?: boolean;
  regulatedIndustryNotes?: string[];
  legalRiskFlags?: string[];
  disclaimerAcceptedAt?: string;
}

export interface BlueprintRegistrationProfile {
  businessNameStatus?: 'UNKNOWN' | 'IDEA_ONLY' | 'NAME_RESERVED' | 'REGISTERED';
  companiesRegistryStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_APPLICABLE';
  birStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  nisEmployerStatus?: 'NOT_NEEDED' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  vatStatus?: 'NOT_REQUIRED' | 'MONITORING' | 'REQUIRED' | 'REGISTERED';
  businessBankStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'OPENED';
  requiredLicenses?: string[];
  missingRegistrationSteps?: string[];
}

export interface BlueprintTaxProfile {
  country?: string;
  taxIdStatus?: string;
  vatThresholdWatch?: boolean;
  estimatedAnnualRevenue?: number;
  payrollExpected?: boolean;
  contractorPaymentsExpected?: boolean;
  taxReadinessScore?: number;
}

export interface BlueprintProjectionProfile {
  startupCapital?: number;
  startupCosts?: number;
  monthlyFixedCosts?: number;
  variableCostPercent?: number;
  avgTicket?: number;
  expectedMonthlyUnits?: number;
  conservativeMonthlyUnits?: number;
  aggressiveMonthlyUnits?: number;
  breakEvenUnits?: number;
  breakEvenRevenue?: number;
  runwayMonths?: number;
  monthByMonth?: ProjectionMonth[];
}

export interface BlueprintComplianceProfile {
  complianceItems?: ComplianceItem[];
  complianceScore?: number;
}

export interface BlueprintMarketProfile {
  targetGeography?: string;
  marketCategory?: string;
  marketStage?: 'IDEA' | 'PRE_LAUNCH' | 'EARLY' | 'GROWTH';
  trends?: string[];
  barriersToEntry?: string[];
  demandSignals?: string[];
  marketOpportunityScore?: number;
}

export interface BlueprintOfferArchitecture {
  coreOffer?: string;
  offerLadder?: string[];
  pricingTiers?: string[];
  upsells?: string[];
  recurringRevenueOpportunities?: string[];
}

export interface BlueprintSalesSystem {
  salesChannels?: string[];
  pipelineStages?: string[];
  leadSources?: string[];
  conversionAssumptions?: Record<string, number>;
  followUpCadence?: string;
}

export interface BlueprintMarketingSystem {
  channels?: string[];
  contentPillars?: string[];
  campaignIdeas?: string[];
  brandNarrative?: string;
  launchPlan?: string[];
}

export interface BlueprintOperationsSystem {
  coreWorkflows?: string[];
  dailyChecklist?: string[];
  weeklyChecklist?: string[];
  fulfillmentProcess?: string[];
  customerSupportProcess?: string[];
  vendorProcess?: string[];
}

export interface ComplianceItem {
  id: string;
  label: string;
  authority?: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'NOT_APPLICABLE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  notes?: string;
}

export interface BlueprintRiskProfile {
  financialRisks?: string[];
  legalRisks?: string[];
  marketRisks?: string[];
  operationalRisks?: string[];
  founderRisks?: string[];
  riskScore?: number;
  mitigationPlan?: string[];
}

export interface ProjectionMonth {
  month: number;
  revenue: number;
  expenses: number;
  profit: number;
  cashBalance: number;
}

export interface BlueprintExecutionRoadmap {
  today?: string[];
  sevenDayPlan?: string[];
  thirtyDayPlan?: string[];
  ninetyDayPlan?: string[];
  twelveMonthMilestones?: string[];
}
```

---

## 6. Backend Design

### 6.1 `BusinessGenesisModule` (new)

Files:
- `apps/server/src/modules/business-genesis/business-genesis.module.ts`
- `apps/server/src/modules/business-genesis/business-genesis.controller.ts`
- `apps/server/src/modules/business-genesis/business-genesis.service.ts`
- `apps/server/src/modules/business-genesis/business-genesis.types.ts`
- `apps/server/src/modules/business-genesis/genesis-question-bank.ts`
- `apps/server/src/modules/business-genesis/trinidad-compliance-rules.ts`
- `apps/server/src/modules/business-genesis/projection-engine.service.ts`

Register in `AppModule` next to `OnboardingConciergeModule` and `BlueprintModule`.

### 6.2 `BusinessGenesisService`

```ts
@Injectable()
export class BusinessGenesisService {
  async analyzeIdea(businessId: string, ideaText: string): Promise<GenesisIdeaAnalysis>
  async getNextQuestions(businessId: string, limit?: number): Promise<GenesisQuestion[]>
  async submitAnswers(businessId: string, answers: Record<string, unknown>): Promise<GenesisProgress>
  async getReadinessScore(businessId: string): Promise<GenesisReadinessScore>
  async generateActionPlan(businessId: string): Promise<GenesisActionPlan>
}
```

### 6.3 `analyzeIdea`

1. Validate `ideaText` length: min 10 characters, max 4000 characters. Trim whitespace. Reject empty or overly short input with `400 Bad Request`.
2. Load the current blueprint for the business (lazily creating it if needed).
3. Build prompt from current blueprint state + user idea text.
4. Call `ModelGatewayService.complete()` with `expectedContract: 'genesis_idea_extraction'`, `taskCategory: 'extraction'`, `mode: 'balanced'`.
   - Max output tokens: 2048.
   - Use existing gateway retry policy (2 retries, 500 ms backoff).
   - If the gateway returns no usable extraction, return a fallback `GenesisIdeaAnalysis`:
     ```ts
     {
       summary: "I want to make sure I understand your business correctly. Can you tell me a bit more about what you sell, who you serve, and where you operate?",
       extracted: {},
       readiness: { overall: 0, legal: 0, finance: 0, market: 0, operations: 0, compliance: 0, blockers: [] },
       suggestedEntityType: "UNKNOWN",
       nextQuestions: [/* top 3 static starter questions */]
     }
     ```
5. Parse structured extraction into a partial `BlueprintData` patch (identity, operatingModel, legalProfile, customerModel, financials, projectionProfile, riskProfile).
6. Run a preview of the compliance engine for T&T if country is Trinidad and Tobago or unspecified. Do **not** persist these preview items.
7. Compute a preview readiness score from the extracted patch merged with the current blueprint.
8. Return `GenesisIdeaAnalysis` containing the summary, extracted partial blueprint, preview `readiness` score, suggested entity type, and next questions.

**Important:** `analyzeIdea` does **not** persist anything. The user reviews and edits the extracted cards, then the frontend calls `POST /answers` with the reviewed fields to save.

### 6.4 `getNextQuestions`

1. Load blueprint and compute missing high-priority fields.
2. Use static `genesis-question-bank.ts` mapped to sections.
3. Return up to `limit` (default 3) questions sorted by numeric `priority` descending. Priority is assigned by domain:
   - legal/registration questions: priority 9–10
   - financial/projection questions: priority 7–8
   - market/offer questions: priority 5–7
   - operations questions: priority 3–5
   - founder/soft questions: priority 1–3

Patch 1 renders questions as typed form inputs (text, number, select, boolean). Free-form answer parsing via AI is deferred to Patch 2.

**Question filtering:** A question is shown only if its target `section.field` is currently empty/missing in the blueprint. Once answered, the field is no longer empty and the question is excluded. The static bank supplies one question per target field.

Example question model:

```ts
export interface GenesisQuestion {
  id: string;
  section: BlueprintSectionKey;
  field: string;
  label: string;
  helper?: string;
  type: 'text' | 'textarea' | 'number' | 'currency' | 'select' | 'multi_select' | 'boolean';
  options?: Array<{ label: string; value: string }>;
  priority: number;
}
```

Representative static questions for Patch 1:

| id | section | field | label | type | priority |
|---|---|---|---|---|---|
| `founder-name` | founderProfile | founderName | What is your name? | text | 10 |
| `weekly-hours` | founderProfile | weeklyAvailabilityHours | How many hours per week can you commit? | number | 8 |
| `has-partners` | ownershipProfile | hasPartners | Do you have co-founders or partners? | boolean | 9 |
| `has-employees` | registrationProfile | hasEmployees | Will you hire employees in the next 12 months? | boolean | 9 |
| `estimated-revenue` | taxProfile | estimatedAnnualRevenue | What do you expect your annual revenue to be in year 1? | currency | 8 |
| `physical-location` | legalProfile | hasPhysicalLocation | Will you operate from a physical location? | boolean | 7 |
| `monthly-fixed-costs` | projectionProfile | monthlyFixedCosts | What are your estimated monthly fixed costs? | currency | 8 |
| `expected-monthly-units` | projectionProfile | expectedMonthlyUnits | How many sales/bookings do you expect per month? | number | 7 |
| `target-customer` | customerModel | idealCustomer | Describe your ideal customer. | textarea | 7 |
| `sales-channels` | salesSystem | salesChannels | How will customers buy from you? | multi_select | 6 |

`multi_select`/`select` options (example for `sales-channels`):
- Online store / website
- Social media / DMs
- In-person / walk-in
- Phone / WhatsApp
- Email
- Referrals / word of mouth
- Marketplaces / platforms

The bank is loaded from `genesis-question-bank.ts` and filtered/sorted by missing fields.

### 6.5 `submitAnswers`

1. Load current blueprint.
2. Map answer keys to a blueprint patch via `BlueprintService.inferFromOnboarding()` (extended for Genesis sections). Answer keys follow the pattern `section.field` (e.g., `legalProfile.hasPhysicalLocation`, `projectionProfile.monthlyFixedCosts`) or flat legacy keys (e.g., `hasEmployees`). Unknown keys are ignored.
3. Merge the patch with the current blueprint state in memory.
4. If the patch affects legal/regulatory fields, run the compliance engine and add `complianceProfile.complianceItems` + `complianceProfile.complianceScore` to the patch.
5. If the patch affects financial fields, run the projection engine and add the resulting `projectionProfile` fields to the patch.
6. Compute `readinessScore` from the merged state and add it to the patch.
7. Persist the full patch via a single `BlueprintService.updateBlueprint()` call.
8. Return `GenesisProgress` containing the updated `blueprint`, `readiness`, `nextQuestions`, and current `complianceItems`.

This single-write pattern keeps the blueprint consistent even if compliance or projection logic fails (the failure is caught and a fallback readiness score is returned without persisting compliance/projection data).

### 6.6 `getReadinessScore`

Compute domain scores from section fill levels and quality:

```ts
export interface GenesisReadinessScore {
  overall: number;
  legal: number;
  finance: number;
  market: number;
  operations: number;
  compliance: number;
  blockers: Array<{
    label: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    nextAction: string;
  }>;
}
```

Scoring logic (each domain 0–100):
- **Legal** (`25%`): 40 points if `legalProfile.recommendedEntityType` is set; 30 points if `legalProfile.disclaimerAcceptedAt` is set; 30 points proportional to completed registration steps. Registration step count = 6 (`businessNameStatus`, `companiesRegistryStatus`, `birStatus`, `nisEmployerStatus`, `vatStatus`, `businessBankStatus`). Score = 30 × (completed_or_not_applicable_steps / 6).
- **Finance** (`25%`): 40 points if `projectionProfile.startupCapital` and `monthlyFixedCosts` are set; 30 points if `breakEvenRevenue` is set; 30 points if `runwayMonths` is set.
- **Market** (`20%`): 40 points if `customerModel.idealCustomer` is set; 30 points if `offerArchitecture.coreOffer` is set; 30 points if `marketingSystem.channels` is non-empty.
- **Operations** (`15%`): 50 points if `operationsSystem.coreWorkflows` is non-empty; 30 points if `workflowModel.primaryWorkflow` is set; 20 points if `aiPreferences.autonomyLevel` is set.
- **Compliance** (`15%`): proportional to `complianceProfile.complianceScore` (itself computed as percentage of `DONE`/`NOT_APPLICABLE` items).

**Other collected sections** (`founderProfile`, `ownershipProfile`, `taxProfile`, `salesSystem`, `marketProfile`, `riskProfile`, `executionRoadmap`) are stored for context and future patches but do not directly affect the Patch 1 readiness score.

**Blockers** are derived from domains scoring below 60:
- Legal < 60 → blocker: “Finalize legal structure and registration path.”
- Finance < 60 → blocker: “Complete financial model and break-even analysis.”
- Market < 60 → blocker: “Define target customer and offer.”
- Operations < 60 → blocker: “Document core workflows.”
- Compliance < 60 → blocker: “Complete compliance checklist.”

`overall` is the weighted average above. If a section is empty, its contribution is 0.

### 6.7 `generateActionPlan`

1. Build context from blueprint + readiness score + compliance items + projection profile.
2. Sort domains by ascending readiness score. Ties are broken by fixed priority: legal > finance > market > operations > compliance. This produces an ordered list of focus domains.
3. Build a 90-day roadmap from domain-specific templates:
   - **Days 1–30**: focus on the lowest-scoring domain.
   - **Days 31–60**: focus on the second-lowest scoring domain plus initial operations setup.
   - **Days 61–90**: focus on the third-lowest scoring domain plus launch preparation.
   Domain-specific templates (example for legal focus):
   - Days 1–7: Confirm entity type and legal risks.
   - Days 8–14: Reserve/register business name.
   - Days 15–21: Complete BIR registration and tax setup.
   - Days 22–30: Open business bank account and review licenses.
4. Derive the next 5 actions from the first 30 days of the roadmap plus any `CRITICAL` compliance items not marked `DONE`.
5. Populate `executionRoadmap` and persist via `BlueprintService.updateBlueprint()`.
6. Return `GenesisActionPlan` with `roadmap`, `complianceItems`, `nextActions`, `projectedRunwayMonths` from `projectionProfile.runwayMonths`, and `breakEvenRevenue` from `projectionProfile.breakEvenRevenue`.

AI-generated strategic plans are deferred to Patch 3.

---

## 7. Compliance Engine

### 7.1 `TrinidadComplianceEngine`

File: `apps/server/src/modules/business-genesis/trinidad-compliance-rules.ts`

Input:
- entityType, hasEmployees, estimatedAnnualRevenue, industry, regulated flags, physicalLocation.

Output: `ComplianceItem[]`.

Rules (exhaustive for Patch 1):
- Always: business name search/reservation, BIR registration.
- If employees: NIS employer registration.
- If estimatedAnnualRevenue > VAT threshold (TTD 500,000/year): VAT monitoring/registration.
- If regulated industry:
  - Healthcare / wellness: “Verify healthcare practitioner licensing, patient consent, and records requirements with the Ministry of Health or relevant professional board.”
  - Food / beverage: “Verify food handler certification and health inspection requirements.”
  - Financial services: “Confirm registration requirements with the Central Bank of Trinidad and Tobago or relevant regulator.”
- If physical location: “Confirm municipal permits and fire clearance for the premises.”

The engine returns each item as a `ComplianceItem` with `status: 'NOT_STARTED'` and priority based on the rules above.

Language must be cautious: “Verify / Prepare / Confirm” rather than definitive legal claims.

### 7.2 Jurisdiction hook

Service accepts `country`. For Patch 1, only `Trinidad and Tobago` returns the T&T rule set. Other countries receive a generic checklist:

```ts
const GENERIC_COMPLIANCE_ITEMS: ComplianceItem[] = [
  { id: 'gen-verify-business-name', label: 'Verify business name availability and register the business name', priority: 'CRITICAL' },
  { id: 'gen-register-tax', label: 'Register with the local tax authority and obtain any required tax IDs', priority: 'CRITICAL' },
  { id: 'gen-business-bank', label: 'Open a dedicated business bank account', priority: 'HIGH' },
  { id: 'gen-review-licenses', label: 'Review industry-specific licenses and permits', priority: 'HIGH' },
  { id: 'gen-employer-obligations', label: 'Confirm employer registration obligations if hiring', priority: 'MEDIUM' },
];
```

All generic items are created with `status: 'NOT_STARTED'`.

---

## 8. Projection Engine

### 8.1 `GenesisProjectionService`

File: `apps/server/src/modules/business-genesis/projection-engine.service.ts`

Inputs from `projectionProfile` + `financials`:
- startupCapital, startupCosts, monthlyFixedCosts, variableCostPercent, avgTicket, expectedMonthlyUnits.

Formulas (currency is the business currency from `financials.currency`, default TTD):
- `baseMonthlyRevenue = avgTicket * expectedMonthlyUnits`
- `conservativeMonthlyRevenue = avgTicket * (conservativeMonthlyUnits ?? Math.floor(expectedMonthlyUnits * 0.7))`
- `aggressiveMonthlyRevenue = avgTicket * (aggressiveMonthlyUnits ?? Math.floor(expectedMonthlyUnits * 1.3))`
- `variableCostPercent` default 0 if undefined
- `grossMargin = 1 - variableCostPercent`
- `breakEvenUnits = Math.ceil(monthlyFixedCosts / (avgTicket * grossMargin))` when `grossMargin > 0`; otherwise `Infinity`.
- `breakEvenRevenue = breakEvenUnits * avgTicket`
- `runwayMonths`:
  - If `baseMonthlyRevenue >= monthlyFixedCosts`: `Infinity` (displayed as “Profitable / self-sustaining”).
  - Else if `startupCapital < startupCosts`: `0` (already out of runway).
  - Else: `Math.floor(Math.max(0, startupCapital - startupCosts) / (monthlyFixedCosts - baseMonthlyRevenue))`.
- `monthByMonth[0]` cash balance = `Math.max(0, startupCapital - startupCosts)`.
- Each subsequent month: `cashBalance += baseMonthlyRevenue - monthlyFixedCosts - (baseMonthlyRevenue * variableCostPercent)`.
- Stop at 12 months or when cash balance <= 0 (whichever comes first).

### 8.2 Reuse existing finance services

For Patch 1, projections are assumption-based. Patch 3 will integrate actual ledger data via `CashflowForecastService` and `RevenueForecastService`.

---

## 9. AI Output Contracts

Extend `apps/server/src/modules/ai/ai-output-contracts.ts`:

- `genesis_idea_extraction` — structured extraction of identity, legal, financial, market, risk fields from the user's idea text. Naming matches existing `ContractType` convention (`snake_case`). Register the contract in `ai-output-contracts.ts` with a Zod-style validator (or existing contract validator) so `ModelGatewayService.validateContract()` enforces required fields.

Contract output shape:

```ts
interface GenesisIdeaExtractionContract {
  summary: string;
  identity: {
    name?: string;
    archetype?: string;
    industry?: string;
    oneLiner?: string;
    country?: string;
  };
  operatingModel: {
    revenueModel?: string;
    deliveryMode?: string;
  };
  legalProfile: {
    recommendedEntityType?: 'SOLE_TRADER' | 'PARTNERSHIP' | 'LIMITED_COMPANY' | 'NONPROFIT' | 'UNKNOWN';
    entityTypeReason?: string;
    regulatedIndustry?: boolean;
    regulatedIndustryNotes?: string[];
  };
  customerModel: {
    idealCustomer?: string;
  };
  financials: {
    pricingModel?: string;
    avgTicket?: number;
    currency?: string;
  };
  projectionProfile: {
    startupCapital?: number;
    startupCosts?: number;
    monthlyFixedCosts?: number;
    expectedMonthlyUnits?: number;
    variableCostPercent?: number;
  };
  riskProfile: {
    legalRiskFlags?: string[];
    marketRiskFlags?: string[];
    operationalRiskFlags?: string[];
  };
}
```

Use `ModelGatewayService.complete({ expectedContract: 'genesis_idea_extraction' })`.

Question answers are submitted as typed fields and mapped deterministically; no additional AI contract is required for Patch 1. The action plan is generated deterministically from readiness, compliance, and blueprint state.

---

## 10. Blueprint Service Changes

### 10.1 Section keys and completeness

Introduce two lists:

```ts
const CORE_SECTION_KEYS: BlueprintSectionKey[] = [
  'identity', 'operatingModel', 'goals', 'constraints', 'brand',
  'customerModel', 'financials', 'intelligence', 'workflowModel', 'aiPreferences',
];

const GENESIS_SECTION_KEYS: BlueprintSectionKey[] = [
  'founderProfile', 'legalProfile', 'registrationProfile', 'taxProfile',
  'ownershipProfile', 'marketProfile',
  'offerArchitecture', 'salesSystem', 'marketingSystem', 'operationsSystem',
  'projectionProfile', 'riskProfile', 'complianceProfile', 'executionRoadmap',
];

const SECTION_KEYS = [...CORE_SECTION_KEYS, ...GENESIS_SECTION_KEYS];
```

- `calculateCompleteness` uses `CORE_SECTION_KEYS` (operational gate unchanged).
- `calculateReadinessScore` uses all sections weighted by domain.

### 10.2 `inferFromOnboarding`

Extend mapping to handle Genesis answer keys:
- `country`, `legalStructurePreference`, `hasRegulatedActivity` → `legalProfile`
- `hasEmployees`, `estimatedAnnualRevenue`, `registrationStatus` → `registrationProfile`
- `startupCapital`, `monthlyFixedCosts`, `expectedMonthlyUnits` → `projectionProfile`
- `identity.name` → `identity.name`
- `identity.industry` → `identity.industry`
- `identity.archetype` → `identity.archetype`
- `identity.oneLiner` → `identity.oneLiner`
- `identity.country` / `country` → `legalProfile.country`
- `operatingModel.revenueModel` → `operatingModel.revenueModel`
- `operatingModel.deliveryMode` → `operatingModel.deliveryMode`
- `customerModel.idealCustomer` → `customerModel.idealCustomer`
- `financials.pricingModel` → `financials.pricingModel`
- `financials.avgTicket` → `financials.avgTicket`
- `financials.currency` → `financials.currency`
- `projectionProfile.startupCapital` → `projectionProfile.startupCapital`
- `projectionProfile.monthlyFixedCosts` → `projectionProfile.monthlyFixedCosts`
- `projectionProfile.expectedMonthlyUnits` → `projectionProfile.expectedMonthlyUnits`
- `legalProfile.recommendedEntityType` → `legalProfile.recommendedEntityType`
- `legalProfile.entityTypeReason` → `legalProfile.entityTypeReason`
- `legalProfile.regulatedIndustry` → `legalProfile.regulatedIndustry`
- `legalProfile.regulatedIndustryNotes` → `legalProfile.regulatedIndustryNotes`
- `legalProfile.legalRiskFlags` → `riskProfile.legalRisks`
- `riskProfile.marketRiskFlags` → `riskProfile.marketRisks`
- `riskProfile.operationalRiskFlags` → `riskProfile.operationalRisks`
- Additional explicit mappings from answer keys:
  - `hasPhysicalLocation` → `legalProfile.hasPhysicalLocation`
  - `hasRegulatedActivity` / `regulatedIndustry` → `legalProfile.regulatedIndustry`
  - `legalStructurePreference` → `legalProfile.recommendedEntityType` (allowed values: `SOLE_TRADER`, `PARTNERSHIP`, `LIMITED_COMPANY`, `NONPROFIT`)
  - `hasEmployees` → `registrationProfile.nisEmployerStatus` (`true` → `NOT_STARTED`, `false` → `NOT_NEEDED`)
  - `registrationStatus` → `registrationProfile.businessNameStatus`
  - `estimatedAnnualRevenue` → `taxProfile.estimatedAnnualRevenue` and `registrationProfile.vatStatus` (`> 500000` → `REQUIRED`, else `NOT_REQUIRED`)
  - `hasPartners` → `ownershipProfile.hasPartners`
  - `owners` → `ownershipProfile.owners`
  - `founderName`, `background`, `skills`, `weaknesses`, `riskTolerance`, `weeklyAvailabilityHours`, `visionStatement` → `founderProfile`
  - `startupCapital`, `startupCosts`, `monthlyFixedCosts`, `variableCostPercent`, `expectedMonthlyUnits`, `conservativeMonthlyUnits`, `aggressiveMonthlyUnits` → `projectionProfile`
  - `targetCustomer`, `marketCategory`, `marketStage`, `trends`, `barriersToEntry`, `demandSignals` → `marketProfile`
  - `coreOffer` → `offerArchitecture.coreOffer`
  - `offerLadder` → `offerArchitecture.offerLadder`
  - `pricingTiers` → `offerArchitecture.pricingTiers`
  - `upsells` → `offerArchitecture.upsells`
  - `recurringRevenueOpportunities` → `offerArchitecture.recurringRevenueOpportunities`
  - `salesChannels` → `salesSystem.salesChannels`
  - `pipelineStages` → `salesSystem.pipelineStages`
  - `leadSources` → `salesSystem.leadSources`
  - `conversionAssumptions` → `salesSystem.conversionAssumptions`
  - `followUpCadence` → `salesSystem.followUpCadence`
  - `channels` → `marketingSystem.channels`
  - `contentPillars` → `marketingSystem.contentPillars`
  - `campaignIdeas` → `marketingSystem.campaignIdeas`
  - `brandNarrative` → `marketingSystem.brandNarrative`
  - `launchPlan` → `marketingSystem.launchPlan`
  - `coreWorkflows`, `dailyChecklist`, `weeklyChecklist`, `fulfillmentProcess`, `customerSupportProcess`, `vendorProcess` → `operationsSystem`
  - `financialRisks`, `legalRisks`, `marketRisks`, `operationalRisks`, `founderRisks`, `mitigationPlan` → `riskProfile`
- `coreOffer`, `pricingTiers`, `salesChannels` → `offerArchitecture` / `salesSystem`

### 10.3 `getBlueprintContext`

Include new Genesis sections in the compact context returned for AI prompts.

---

## 11. KEY Prompt Context Update

Update `FlowOrchestratorService.buildBlueprintSection()` to include Genesis fields:

```ts
if (ctx.legalProfile?.recommendedEntityType) {
  lines.push(`- Recommended entity type: ${ctx.legalProfile.recommendedEntityType}`);
}
if (ctx.registrationProfile?.missingRegistrationSteps?.length) {
  lines.push(`- Missing registration steps: ${ctx.registrationProfile.missingRegistrationSteps.join('; ')}`);
}
if (ctx.projectionProfile?.runwayMonths) {
  lines.push(`- Cash runway: ${ctx.projectionProfile.runwayMonths} months`);
}
if (ctx.riskProfile?.riskScore) {
  lines.push(`- Business risk score: ${ctx.riskProfile.riskScore}/100`);
}
if (ctx.executionRoadmap?.today?.length) {
  lines.push(`- Today's priorities: ${ctx.executionRoadmap.today.join('; ')}`);
}
```

---

## 12. Onboarding Concierge Integration

### 12.1 Setup status expansion

Extend `SetupStatus` in `OnboardingConciergeService`:

```ts
export interface SetupStatus {
  // existing operational booleans
  profile: boolean;
  products: boolean;
  businessHours: boolean;
  payments: boolean;
  storefront: boolean;
  contacts: boolean;

  // new genesis booleans
  legalProfile: boolean;
  registrationPlan: boolean;
  financeModel: boolean;
  marketStrategy: boolean;
  operationsPlan: boolean;
  complianceChecklist: boolean;

  completedCount: number;
  totalSteps: number;
  percentage: number;
}
```

New booleans derive from blueprint readiness thresholds:

| Step | Truthy condition |
|---|---|
| `legalProfile` | `legalProfile.recommendedEntityType` is set AND `legalProfile.disclaimerAcceptedAt` is set. |
| `registrationPlan` | `registrationProfile` has at least one status field (`companiesRegistryStatus`, `birStatus`, `nisEmployerStatus`, `vatStatus`, or `businessBankStatus`) set to a value other than `NOT_STARTED` or `UNKNOWN`. |
| `financeModel` | `projectionProfile.monthlyFixedCosts` is set AND `projectionProfile.breakEvenRevenue` is set. |
| `marketStrategy` | `customerModel.idealCustomer` is set AND (`offerArchitecture.coreOffer` is set OR `marketingSystem.channels` is non-empty). |
| `operationsPlan` | `operationsSystem.coreWorkflows` is non-empty OR `workflowModel.primaryWorkflow` is set. |
| `complianceChecklist` | `complianceProfile.complianceItems` is non-empty AND at least one item is `DONE` or `NOT_APPLICABLE`. |

### 12.2 Nudges

Add nudges for missing genesis domains. Each nudge follows the existing nudge shape:

```ts
{
  id: 'genesis-legal',
  title: 'Complete your legal setup',
  body: 'KEY can generate your Trinidad & Tobago registration checklist once you confirm your entity type.',
  ctaLabel: 'Set up legal profile',
  ctaHref: '/app/onboarding',
  snoozable: true,
}
```

Other nudges: `genesis-finance`, `genesis-market`, `genesis-compliance`. Nudges are generated only when the corresponding domain readiness is below 60 and the user is not already on an onboarding path.

---

## 13. Frontend Design

### 13.1 Route

Upgrade the existing `/app/onboarding` page. No new route.
The onboarding guard continues to use blueprint `completeness >= 60` (operational gate).
`readinessScore` is surfaced as motivation, not a hard gate.

### 13.2 Components

Create in `apps/web/src/app/app/onboarding/components/`:

- `GenesisConversation.tsx` — orchestrates the whole flow.
- `IdeaInput.tsx` — large textarea + “Analyze my business” CTA.
- `GenesisProfilePreview.tsx` — editable cards of extracted fields.
- `GenesisQuestionSet.tsx` — renders 1–3 progressive questions.
- `GenesisReadinessPanel.tsx` — domain scores, blockers, next actions.
- `GenesisComplianceCard.tsx` — T&T checklist preview.
- `GenesisProjectionCard.tsx` — break-even, runway, scenario revenue.

### 13.3 UX flow

**Step 1 — Idea capture**
- Headline: “Tell KEY what you’re building.”
- Large textarea with placeholder: “I want to start a digital clinic management platform in Trinidad for private doctors. I have TTD 40,000 to start and want to reach TTD 50,000/month within a year.”
- CTA: “Analyze my business”

**Step 2 — Extracted profile review**
- Show cards: Business type, Target customer, Revenue model, Likely legal path, Starting budget, Risk flags.
- Each card editable inline.
- CTA: “Looks right — continue” / “Ask me the missing questions”

**Step 3 — Smart questions**
- Show up to 3 questions at a time.
- After submission, show updated readiness and next questions.
- User can skip or finish anytime.

**Step 4 — Readiness dashboard**
- Overall readiness score (0–100) with color coding.
- Domain breakdown: Legal, Finance, Market, Operations, Compliance.
- Blockers list with severity.
- “Generate action plan” button. The 90-day roadmap preview and compliance checklist preview are rendered only after the user clicks this button and the API returns `GenesisActionPlan`.
- Secondary CTAs: “Go to Command Center”, “Continue in Blueprint”.

### 13.4 Safety/disclaimer

Before showing legal/compliance checklists or generating action plans, show a modal:

> “KEY provides business preparation and administrative guidance. It does not replace a licensed attorney, accountant, tax advisor, or regulator. Review all legal, tax, and financial decisions with the appropriate professional before filing or signing.”

Acceptance stores `legalProfile.disclaimerAcceptedAt`.

---

## 14. API Contracts

### 14.1 Controller routes

Base: `/business-genesis/businesses/:businessId`
Guards: `AuthGuard`, `BusinessGuard`.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/analyze-idea` | `AnalyzeIdeaDto` | `GenesisIdeaAnalysis` |
| `GET`  | `/questions/next` | `GetQuestionsQueryDto` | `GenesisQuestion[]` |
| `POST` | `/answers` | `SubmitAnswersDto` | `GenesisProgress` |
| `GET`  | `/readiness` | — | `GenesisReadinessScore` |
| `POST` | `/generate-roadmap` | — | `GenesisActionPlan` |

### 14.2 Request DTOs

```ts
export class AnalyzeIdeaDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  ideaText: string;
}

export class SubmitAnswersDto {
  @IsObject()
  answers: Record<string, unknown>;
}

export class GetQuestionsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  limit?: number = 3;
}
```

### 14.3 Response DTOs

```ts
interface GenesisIdeaAnalysis {
  summary: string;
  extracted: Partial<BlueprintData>;
  readiness: GenesisReadinessScore;
  suggestedEntityType: string;
  nextQuestions: GenesisQuestion[];
}

interface GenesisProgress {
  blueprint: BlueprintData;
  readiness: GenesisReadinessScore;
  nextQuestions: GenesisQuestion[];
  complianceItems: ComplianceItem[];
}

interface GenesisActionPlan {
  roadmap: BlueprintExecutionRoadmap;
  complianceItems: ComplianceItem[];
  nextActions: string[];
  projectedRunwayMonths?: number;
  breakEvenRevenue?: number;
}
```

### Error response shape

All error responses follow the existing API error envelope:

```ts
interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  details?: Record<string, unknown>;
}
```

Common cases:
- `400` — invalid `ideaText` length or malformed body.
- `422` — invalid answer values or out-of-bounds numbers.
- `429` — AI/rate-limit exceeded.
- `500` — unexpected server error.

### Rate limiting

- `POST /analyze-idea`: 10 requests per business per hour. Use existing NestJS `ThrottlerModule` if configured; otherwise add a simple in-memory rate-limit guard.
- `POST /answers` and `POST /generate-roadmap`: inherit general API rate limits (60 req/min per business).

### Missing blueprint handling
- If no `BusinessBlueprint` exists for the business, `BusinessGenesisService` calls `BlueprintService.getBlueprint(businessId)` to lazily create one from the `Business` row before proceeding. This returns `200`, not `404`.

---

## 15. Error Handling & Resilience

### Input validation
- `analyzeIdea`: `ideaText` must be 10–4000 characters after trim. Return `400` with clear message otherwise.
- `submitAnswers`: unknown answer keys are ignored; invalid types are coerced or skipped. Return `422` only if the request body is missing the `answers` object entirely. Per-field bounds are applied silently (clamped or ignored). Numeric bounds:
  - `weeklyAvailabilityHours`: 0–168
  - `ownershipPercent`: 0–100
  - `startupCapital`, `startupCosts`, `monthlyFixedCosts`, `avgTicket`: >= 0
  - `variableCostPercent`: 0–1
  - `expectedMonthlyUnits`, `conservativeMonthlyUnits`, `aggressiveMonthlyUnits`: >= 0
- `getNextQuestions`: `limit` clamped between 1 and 5.

### AI failure modes
- If `ModelGatewayService.complete()` fails or returns an unparseable contract, log the error and return a graceful fallback:
  - `summary`: a generic message asking the user to share more details.
  - `extracted`: empty partial patch.
  - `nextQuestions`: the top 3 static starter questions.
- Rate-limit errors surface as `429` to the frontend, which shows a retry message.

### Unsupported countries
- If `legalProfile.country` is not `"Trinidad and Tobago"`, the compliance engine returns a generic checklist plus a note that localized rules are only available for T&T in Patch 1.

### Concurrent blueprint updates
- Patch 1 accepts last-write-wins for blueprint updates. The service reads the current row, merges the patch, and writes it back in one Prisma `update`. If concurrent updates occur, the last update wins. A future patch can introduce an optimistic lock if needed.

### Readiness calculation failure
- If readiness scoring throws (e.g., malformed section data), catch the error, log it, and return `readiness.overall = 0` with a single blocker: “We couldn’t calculate readiness. Try refreshing.”

### Frontend degradation
- If the readiness API fails, show a inline error banner and allow the user to continue to the command center.
- If the idea analysis API fails, show a fallback message and expose the static question bank immediately.

---

## 16. Migration & Backfill

### 16.1 Prisma migration

- Add new JSONB columns to `BusinessBlueprint`.
- Add `readiness_score` integer default 0.
- Bump existing rows' `schemaVersion` to 2.
- Set new JSONB columns to `{}` for existing rows.

### 16.2 Backfill script (optional)

If the migration cannot safely update all rows in one transaction, provide an idempotent script that:
- Sets `schemaVersion = 2` for rows still on version 1.
- Sets any null new JSONB columns to `{}`.
- Sets `readinessScore` to existing `completeness` for continuity.

### 16.3 Existing onboarding guard

No change. `useOnboardingGuard` continues to check `blueprint.completeness >= 60`.
`readinessScore` is displayed in UI but does not block navigation.

---

## 17. Testing Checklist

### Backend
- [ ] `analyzeIdea` extracts structured fields from a sample idea text.
- [ ] `submitAnswers` updates blueprint and recalculates readiness.
- [ ] T&T compliance engine returns correct items for employees vs. sole trader.
- [ ] Projection engine computes break-even and runway correctly.
- [ ] Readiness score weights domains as specified.
- [ ] AI output contract validation rejects malformed extractions.

### Frontend
- [ ] `/app/onboarding` shows idea capture screen.
- [ ] Submitting idea shows extracted profile cards.
- [ ] Answering questions updates readiness panel.
- [ ] Disclaimer modal appears before legal/compliance outputs.
- [ ] Skip button navigates to `/app/command-center`.

### E2E
- [ ] Playwright: new user logs in, enters idea, completes 3 questions, reaches readiness dashboard.

---

## 18. Implementation Phases

### Milestone 1 — Data foundation
- Expand blueprint types (server + web).
- Prisma migration + backfill.
- Update `BlueprintService` serialization, completeness, inference.

### Milestone 2 — Genesis backend
- Create `BusinessGenesisModule`.
- Implement `analyzeIdea`, `getNextQuestions`, `submitAnswers`.
- Add `GENESIS_IDEA_EXTRACTION` contract.

### Milestone 3 — Intelligence
- T&T compliance engine.
- Projection engine.
- Readiness scoring.
- `generateActionPlan`.

### Milestone 4 — Frontend
- Upgrade `/app/onboarding`.
- Build Genesis components.
- Wire API client.

### Milestone 5 — Integration (complete)
- `BlueprintService.getBlueprintContext` now returns Genesis sections (`legalProfile`, `registrationProfile`, `taxProfile`, `projectionProfile`, `riskProfile`, `complianceProfile`, `executionRoadmap`, `readinessScore`).
- `FlowOrchestratorService.buildBlueprintSection` folds Genesis facts into KEY's system prompt when present.
- `OnboardingConciergeService` setup status expanded to 12 steps with Genesis booleans (`legalProfile`, `registrationPlan`, `financeModel`, `marketStrategy`, `operationsPlan`, `complianceChecklist`) and emits domain-based nudges (`genesis-legal`, `genesis-finance`, `genesis-market`, `genesis-compliance`).
- Added Playwright E2E smoke test: `apps/web/e2e/business-genesis-onboarding.spec.ts`.
- Updated `AGENTS.md` with a Business Genesis note.

---

## 19. Decisions Made

These questions are resolved for Patch 1:

1. **Onboarding guard:** Continue using `completeness` (core 10 sections) as the operational gate. `readinessScore` is displayed but does not block navigation.
2. **`analyzeIdea` flow:** Always show extracted fields for review before persisting. The user can edit inline.
3. **Compliance engine:** Use deterministic rules for Trinidad & Tobago. AI augmentation and additional jurisdictions are deferred to Patch 5.

---

## 20. Decision Log

| Decision | Rationale |
|---|---|
| Extend `BusinessBlueprint` with new JSONB columns | Keeps a single source of truth and reuses existing service/serialization. |
| Separate `completeness` (core) from `readinessScore` (genome) | Prevents new legal/finance fields from breaking the existing onboarding guard. |
| Reuse `/app/onboarding` route | Existing guard and user bookmarks continue to work. |
| Deterministic T&T compliance rules | Faster, testable, and avoids legal hallucinations in Patch 1. |
| Assumption-based projection engine | Unblocks Patch 1 without requiring historical ledger data. |
| Disclaimer before legal/compliance outputs | Required safety guardrail. |

---

## 21. Types & Contracts Reference

### `BlueprintData` (existing + genesis extension)

```ts
export interface BlueprintData {
  id: string;
  businessId: string;
  schemaVersion: number;

  // core sections
  identity: BlueprintIdentity;
  operatingModel: BlueprintOperatingModel;
  goals: BlueprintGoals;
  constraints: BlueprintConstraints;
  brand: BlueprintBrand;
  customerModel: BlueprintCustomerModel;
  financials: BlueprintFinancials;
  intelligence: BlueprintIntelligence;
  workflowModel: BlueprintWorkflowModel;
  aiPreferences: BlueprintAiPreferences;

  // genesis sections (always present as objects after serialization; individual fields optional)
  founderProfile?: BlueprintFounderProfile;
  legalProfile?: BlueprintLegalProfile;
  registrationProfile?: BlueprintRegistrationProfile;
  taxProfile?: BlueprintTaxProfile;
  ownershipProfile?: BlueprintOwnershipProfile;
  marketProfile?: BlueprintMarketProfile;
  offerArchitecture?: BlueprintOfferArchitecture;
  salesSystem?: BlueprintSalesSystem;
  marketingSystem?: BlueprintMarketingSystem;
  operationsSystem?: BlueprintOperationsSystem;
  projectionProfile?: BlueprintProjectionProfile;
  riskProfile?: BlueprintRiskProfile;
  complianceProfile?: BlueprintComplianceProfile;
  executionRoadmap?: BlueprintExecutionRoadmap;

  completeness: number;
  readinessScore: number;
  confidenceScores?: Record<string, number>;
  lastAnalyzedAt?: string;
  updatedAt: string;
}
```

### `GenesisIdeaExtractionContract`

See Section 9 for the full contract shape used with `ModelGatewayService`.

### Request/Response DTOs

See Section 14 for controller request and response DTOs.
