# KEY Genome Roadmap — Central Intelligence Kernel

The repo now has the surrounding operating system: **Business Genesis**, **Genome Chat**, **Business Command Center**, **KEY Executive Modes**, **KEY Autonomy**, **Temporal Flow**, **Blueprint**, **Assets**, and **Constitution**. What remains is to formalize **KEY Genome** as the central evidence-backed intelligence kernel beneath all of them.

This roadmap defines the target architecture, schema, services, scoring model, and phased build plan.

---

# 1. Updated repo status

The updated `AppModule` imports and registers the core systems needed for the larger architecture:

```text id="u1s8k"
BlueprintModule
BusinessGenesisModule
TemporalFlowModule
BusinessGenomeModule
KeyInboxModule
PeopleFlowModule
SopModule
MarketingModule
IntelligenceModule
KeyAutonomyModule
BusinessCommandCenterModule
```

plus operational modules such as CRM, Catalog, Commerce, Bookings, Payments, Finance, Expenses, Reports, Email Marketing, Procurement, Supplier, Documents, Google Drive, Communications, WhatsApp, Slack, Shopify, Integration Hub, Analytics, Realtime, and Security Audit.

That means the repo has enough structural surface area to make KEY Genome the **central business brain**.

---

# 2. Current ranking

| Capability                          | Current rank |
| ----------------------------------- | ------------: |
| Business ontology coverage          |      8.5/10 |
| Business Genesis / onboarding       |      8.5/10 |
| Genome Chat                         |        7/10 |
| Command Center integration          |        8/10 |
| KEY autonomy connection             |        7/10 |
| Executive-mode intelligence         |      7.5/10 |
| Temporal Flow → Genome learning     |      6.5/10 |
| Evidence-backed facts               |      3.5/10 |
| Module readiness contracts          |      2.5/10 |
| Scoring sophistication              |        6/10 |
| Recommendation / pivot intelligence |      6.5/10 |
| Full KEY Genome foundation          |      7.5/10 |

The largest remaining gap is the same:

```text id="n9x4a"
The repo has Genome surfaces, but not yet a proper KEY Genome fact/evidence/signal/readiness/recommendation kernel.
```

---

# 3. What exists now

## 3.1 Business Genesis

`BusinessGenesisModule` imports Blueprint, AI, Documents, and Governance, and includes services for projection, readiness scoring, action plan building, document packs, risk register, market strategy generation, and Genome Chat.

The controller exposes endpoints for idea analysis, next questions, answer submission, readiness, roadmap generation, document pack generation, risk register generation, and market strategy generation.

## 3.2 Idea analysis writes toward Blueprint

`BusinessGenesisService.analyzeIdea()` builds a model prompt, requests a `genesis_idea_extraction` contract, converts the result into a Blueprint patch, previews compliance, computes readiness, and returns next questions.

## 3.3 Answer submission updates Blueprint, compliance, projection, and readiness

When the user submits answers, the service calls `blueprint.inferFromOnboarding`, recalculates compliance if legal/tax/registration inputs changed, recalculates projections if financial inputs changed, stores readiness score, and returns next questions.

## 3.4 Genome Chat

`GenomeChatController` exposes message retrieval, message sending, and `apply-updates`.

`GenomeChatService` persists messages, calls `calculateGenomeIntegrity`, builds a Genome Mode prompt, extracts proposed structured updates from JSON, and applies confirmed updates through `blueprint.updateDnaSection`.

## 3.5 Genesis readiness

`GenesisReadinessScorer` calculates legal, finance, market, operations, and compliance scores, with overall weighted as legal 25%, finance 25%, market 20%, operations 15%, and compliance 15%.

## 3.6 Action plan generation

`GenesisActionPlanBuilder` generates legal, finance, market, operations, and compliance action plans, including today, 7-day, 30-day, 90-day, and 12-month milestones.

## 3.7 Business Command Center

`BusinessCommandCenterService` pulls together:

```text id="c3m2p"
Executive Brief
KEY Executive Modes
pending approvals
approved awaiting execution
Temporal Flow analysis
Genome Evolution proposals
Genome Integrity
Business Assets
Constitution version and staleness
```

## 3.8 KEY Executive Modes

`KeyExecutiveModeService` generates mode briefs for Strategist, CFO, CMO, COO, Legal Guide, Growth Advisor, Risk Officer, and Executive Assistant, combining Executive Brief, Blueprint, Temporal Flow, Genome Evolution proposals, and Business Assets.

## 3.9 KEY Autonomy

`KeyActionProposalService` creates, approves, rejects, cancels, executes, and logs KEY action proposals. It emits Temporal Flow lifecycle events as actions are proposed, approved, executed, failed, or rejected.

`KeyActionPolicyService` defines action-level approval requirements and risk levels.

---

# 4. Verdict

The updated repo has moved from:

```text id="v2k9q"
Genome as profile/scoring system
```

to:

```text id="w8j3r"
Genome + Genesis + Chat + Command Center + Executive Modes + Autonomy
```

But it still needs to move from:

```text id="x1l5s"
Feature-connected Genome
```

to:

```text id="y6m7t"
KEY Genome as central evidence-backed operating intelligence
```

| Current updated repo                           | Needed KEY Genome                                      |
| ---------------------------------------------- | ------------------------------------------------------ |
| Blueprint stores structured business data      | GenomeFact stores normalized business truth            |
| Genesis asks questions and updates Blueprint   | Genesis produces evidence-backed facts                 |
| Genome Chat proposes updates                   | Genome Chat creates verifiable proposals with evidence |
| Command Center aggregates items                | Command Center ranks actions by expected gain/risk     |
| Executive Modes produce findings               | Executive Modes consume Genome facts and emit signals  |
| KEY Autonomy has action policy                 | Autonomy policy checks Genome readiness/confidence     |
| Temporal Flow detects some candidates          | Temporal Flow becomes full signal pipeline             |
| Recommendations mostly open pages/review items | Recommendations become business action/pivot decisions |

---

# 5. Target rank after KEY Genome build

| Capability                  | Current | Target |
| --------------------------- | ------: | -----: |
| Business ontology coverage  |  8.5/10 | 9.7/10 |
| Business Genesis onboarding |  8.5/10 | 9.7/10 |
| Genome Chat                 |    7/10 | 9.2/10 |
| Command Center              |    8/10 | 9.5/10 |
| KEY Executive Modes         |  7.5/10 | 9.3/10 |
| KEY Autonomy                |    7/10 | 9.2/10 |
| Scoring sophistication      |    6/10 | 9.2/10 |
| Evidence-backed facts       |  3.5/10 | 9.6/10 |
| Module readiness contracts  |  2.5/10 | 9.5/10 |
| Recommendation intelligence |  6.5/10 | 9.3/10 |
| Pivot guidance              |  3.5/10 | 8.8/10 |
| Automation governance       |    7/10 | 9.4/10 |
| User trust / explainability |    6/10 | 9.5/10 |
| Business OS foundation      |  7.5/10 | 9.6/10 |

---

# 6. KEY Genome definition

> **KEY Genome is the evidence-backed operating intelligence layer of a business. It stores what the business is, who it serves, what it sells, how it makes money, how it operates, what risks constrain it, what evidence supports each belief, what modules are ready to act, what KEY is allowed to do, and what the founder should do next.**

The current `BusinessGenomeModule` can remain, but a more explicit kernel is introduced internally:

```text id="z2n8u"
business-genome/
  key-genome/
    key-genome.module.ts
    key-genome.service.ts
    genome-fact.service.ts
    genome-evidence.service.ts
    genome-signal.service.ts
    genome-scoring.service.ts
    genome-module-readiness.service.ts
    genome-recommendation.service.ts
    genome-experiment.service.ts
    genome-policy.service.ts
```

This lets the existing Business Genome stay compatible while KEY Genome becomes the actual intelligence kernel.

---

# 7. Target architecture

```text id="a3o9v"
Business Genesis
  → captures initial business truth

Blueprint
  → canonical aggregate business profile

KEY Genome Facts
  → normalized, evidence-backed business truth

KEY Genome Evidence
  → proof behind each fact

KEY Genome Signals
  → observations from modules

Genome Evolution
  → reviewed updates to facts and Blueprint

Genome Scoring
  → completeness + quality + confidence + freshness + readiness

Module Readiness
  → tells each module whether it has enough context to operate

Recommendation Engine
  → evidence-based best next action / pivot / experiment

KEY Autonomy
  → can only act when Genome policy permits

Command Center
  → shows prioritized business action queue
```

---

# 8. Core schema

## 8.1 `GenomeFact`

```prisma
model GenomeFact {
  id          String   @id @default(cuid())
  businessId  String   @map("business_id")
  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  section     String
  domain      String
  field       String
  value       Json
  valueType   String   @map("value_type")

  sourceModule     String? @map("source_module")
  sourceType       String  @map("source_type") // onboarding | user_edit | temporal_flow | finance | key_inbox | ai_inference
  sourceEntityType String? @map("source_entity_type")
  sourceEntityId   String? @map("source_entity_id")

  completenessScore         Float @default(0) @map("completeness_score")
  qualityScore              Float @default(0) @map("quality_score")
  confidenceScore           Float @default(0) @map("confidence_score")
  freshnessScore            Float @default(0) @map("freshness_score")
  operationalReadinessScore Float @default(0) @map("operational_readiness_score")

  verificationStatus String @default("INFERRED") @map("verification_status")
  riskIfWrong        String @default("MEDIUM") @map("risk_if_wrong")

  lastVerifiedAt DateTime? @map("last_verified_at")
  expiresAt       DateTime? @map("expires_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  evidence GenomeEvidence[]

  @@unique([businessId, section, domain, field])
  @@index([businessId, section])
  @@index([businessId, domain])
  @@index([businessId, verificationStatus])
  @@map("genome_facts")
}
```

## 8.2 `GenomeEvidence`

```prisma
model GenomeEvidence {
  id         String @id @default(cuid())
  businessId String @map("business_id")
  factId     String? @map("fact_id")
  fact       GenomeFact? @relation(fields: [factId], references: [id], onDelete: SetNull)

  sourceModule     String @map("source_module")
  sourceEntityType String @map("source_entity_type")
  sourceEntityId   String? @map("source_entity_id")

  summary          String
  evidenceStrength Float @default(0.5) @map("evidence_strength")
  occurredAt       DateTime? @map("occurred_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([businessId, factId])
  @@index([businessId, sourceModule])
  @@index([businessId, occurredAt])
  @@map("genome_evidence")
}
```

## 8.3 `GenomeSignal`

```prisma
model GenomeSignal {
  id         String @id @default(cuid())
  businessId String @map("business_id")

  sourceModule     String @map("source_module")
  sourceEntityType String? @map("source_entity_type")
  sourceEntityId   String? @map("source_entity_id")

  signalType String @map("signal_type")
  section    String
  domain     String
  field      String?
  proposedValue Json? @map("proposed_value")

  reason     String
  evidence   Json @default("[]")
  confidence Float @default(0.5)
  status     String @default("NEW") // NEW | REVIEWED | ACCEPTED | REJECTED | MERGED

  createdAt DateTime @default(now()) @map("created_at")
  reviewedAt DateTime? @map("reviewed_at")

  @@index([businessId, sourceModule])
  @@index([businessId, status])
  @@index([businessId, section])
  @@map("genome_signals")
}
```

## 8.4 `GenomeModuleReadiness`

```prisma
model GenomeModuleReadiness {
  id         String @id @default(cuid())
  businessId String @map("business_id")

  module     String
  readinessScore Int @map("readiness_score")

  requiredFacts Json @default("[]") @map("required_facts")
  missingFacts  Json @default("[]") @map("missing_facts")
  optionalFacts Json @default("[]") @map("optional_facts")

  blockedReasons Json @default("[]") @map("blocked_reasons")
  recommendedSetupActions Json @default("[]") @map("recommended_setup_actions")

  automationAllowed Boolean @default(false) @map("automation_allowed")
  riskLevel String @default("MEDIUM") @map("risk_level")

  lastComputedAt DateTime @default(now()) @map("last_computed_at")

  @@unique([businessId, module])
  @@index([businessId, readinessScore])
  @@map("genome_module_readiness")
}
```

## 8.5 `GenomeRecommendation`

```prisma
model GenomeRecommendation {
  id         String @id @default(cuid())
  businessId String @map("business_id")

  domain     String
  title      String
  insight    String
  diagnosis  String
  recommendation String

  expectedGain String? @map("expected_gain")
  expectedGainScore Float @default(0) @map("expected_gain_score")
  riskLevel String @default("MEDIUM") @map("risk_level")
  effortLevel String @default("MEDIUM") @map("effort_level")
  confidence Float @default(0.5)

  evidenceIds String[] @default([]) @map("evidence_ids")
  suggestedExperimentId String? @map("suggested_experiment_id")

  status String @default("ACTIVE") // ACTIVE | ACCEPTED | DISMISSED | APPLIED | EXPIRED
  createdAt DateTime @default(now()) @map("created_at")
  reviewedAt DateTime? @map("reviewed_at")
  outcomeTrackedAt DateTime? @map("outcome_tracked_at")

  @@index([businessId, status])
  @@index([businessId, domain])
  @@index([businessId, riskLevel])
  @@map("genome_recommendations")
}
```

## 8.6 `GenomeExperiment`

```prisma
model GenomeExperiment {
  id         String @id @default(cuid())
  businessId String @map("business_id")

  hypothesis String
  action     String
  successMetric String @map("success_metric")
  baselineValue Float? @map("baseline_value")
  targetValue   Float? @map("target_value")
  durationDays  Int    @default(14) @map("duration_days")

  riskLevel String @default("LOW") @map("risk_level")
  status    String @default("PROPOSED") // PROPOSED | RUNNING | COMPLETED | FAILED | CANCELLED
  result    Json?

  createdAt DateTime @default(now()) @map("created_at")
  startedAt DateTime? @map("started_at")
  endedAt   DateTime? @map("ended_at")

  @@index([businessId, status])
  @@map("genome_experiments")
}
```

---

# 9. Core services

## 9.1 `KeyGenomeModule`

```ts
@Module({
  imports: [
    PrismaModule,
    BlueprintModule,
    TemporalFlowModule,
    BusinessGenomeModule,
    IntelligenceModule,
    KeyAutonomyModule,
  ],
  providers: [
    KeyGenomeService,
    GenomeFactService,
    GenomeEvidenceService,
    GenomeSignalService,
    GenomeScoringService,
    GenomeModuleReadinessService,
    GenomeRecommendationService,
    GenomeExperimentService,
    GenomePolicyService,
  ],
  exports: [
    KeyGenomeService,
    GenomeFactService,
    GenomeSignalService,
    GenomeModuleReadinessService,
    GenomeRecommendationService,
    GenomePolicyService,
  ],
})
export class KeyGenomeModule {}
```

Then import `KeyGenomeModule` into:

```text id="b4p0w"
BusinessGenesisModule
BusinessCommandCenterModule
IntelligenceModule
KeyAutonomyModule
TemporalFlowModule
KeyInboxModule
FinanceModule
CalendarModule
PeopleFlowModule
MarketingModule
SopModule
```

## 9.2 `GenomeFactService`

Purpose: convert Blueprint and module activity into trusted business facts.

```ts
@Injectable()
export class GenomeFactService {
  async upsertFact(input: UpsertGenomeFactInput): Promise<GenomeFact> {}
  async getFact(businessId: string, section: string, domain: string, field: string): Promise<GenomeFact | null> {}
  async listFacts(businessId: string, filters?: GenomeFactFilters): Promise<GenomeFact[]> {}
  async backfillFromBlueprint(businessId: string): Promise<void> {}
  async markVerified(businessId: string, factId: string, userId: string): Promise<GenomeFact> {}
  async markStale(businessId: string, factId: string): Promise<GenomeFact> {}
}
```

## 9.3 `GenomeEvidenceService`

Purpose: link every important belief to evidence.

```ts
@Injectable()
export class GenomeEvidenceService {
  async attachEvidence(input: AttachGenomeEvidenceInput): Promise<GenomeEvidence> {}
  async evidenceForFact(businessId: string, factId: string): Promise<GenomeEvidence[]> {}
  async evidenceSummary(businessId: string, factId: string): Promise<EvidenceSummary> {}
}
```

## 9.4 `GenomeSignalService`

Purpose: let modules send observations without directly mutating Genome.

```ts
@Injectable()
export class GenomeSignalService {
  async emitSignal(input: EmitGenomeSignalInput): Promise<GenomeSignal> {}
  async reviewSignal(businessId: string, signalId: string, decision: 'ACCEPTED' | 'REJECTED'): Promise<void> {}
  async generateEvolutionProposalFromSignal(businessId: string, signalId: string): Promise<GenomeEvolutionProposalData> {}
  async aggregateSignals(businessId: string): Promise<GenomeSignalCluster[]> {}
}
```

This should replace the current narrow Temporal Flow candidate mechanism over time.

## 9.5 `GenomeScoringService`

Purpose: replace pure completeness with true readiness.

```ts
@Injectable()
export class GenomeScoringService {
  calculateFactScore(fact: GenomeFact, evidence: GenomeEvidence[]): FactScore {}
  calculateSectionScore(facts: GenomeFact[]): SectionGenomeScore {}
  async calculateBusinessGenome(businessId: string): Promise<KeyGenomeScore> {}
}
```

Formula:

```text id="d5r2y"
sectionScore =
  completeness * 0.25
+ quality * 0.25
+ confidence * 0.20
+ freshness * 0.10
+ operationalReadiness * 0.20
- riskPenalty
```

## 9.6 `GenomeModuleReadinessService`

Purpose: tell every module whether it has enough context to operate.

```ts
@Injectable()
export class GenomeModuleReadinessService {
  async computeForModule(businessId: string, module: KeyGenomeModuleName): Promise<ModuleReadiness> {}
  async computeAll(businessId: string): Promise<ModuleReadiness[]> {}
  async missingFactsForModule(businessId: string, module: KeyGenomeModuleName): Promise<MissingGenomeFact[]> {}
  async assertReadyForAutomation(businessId: string, module: string, actionType: string): Promise<void> {}
}
```

## 9.7 `GenomeRecommendationService`

Purpose: turn evidence + best practice into action.

```ts
@Injectable()
export class GenomeRecommendationService {
  async generateRecommendations(businessId: string): Promise<GenomeRecommendation[]> {}
  async generatePivotWarnings(businessId: string): Promise<GenomeRecommendation[]> {}
  async generateExperiments(businessId: string): Promise<GenomeExperiment[]> {}
  async trackOutcome(businessId: string, recommendationId: string, result: RecommendationOutcome): Promise<void> {}
}
```

Recommendation output must include:

```text id="e6s3z"
Insight
Evidence
Diagnosis
Recommendation
Expected gain
Risk
Experiment
Confidence
Next step
```

---

# 10. KEY Genome scoring upgrade

The current Genesis readiness score is useful but narrow: legal, finance, market, operations, and compliance.

KEY Genome should score the whole business using 12 refined domains:

```text id="f7t4a"
Founder & Leadership
Vision & Identity
Business Model
Customer & Market
Offer & Product
Financial
Legal, Governance & Compliance
Operations & Delivery
Sales
Marketing & Growth
Technology, Data & Intelligence
Risk & Resilience
```

## Recommended weights

| Domain                          | Weight |
| ------------------------------- | -----: |
| Founder & Leadership            |      8 |
| Vision & Identity               |      6 |
| Business Model                  |     10 |
| Customer & Market               |     10 |
| Offer & Product                 |     10 |
| Financial                       |     12 |
| Legal, Governance & Compliance  |     10 |
| Operations & Delivery           |     10 |
| Sales                           |      7 |
| Marketing & Growth              |      7 |
| Technology, Data & Intelligence |      5 |
| Risk & Resilience               |      5 |

Risk must have a real weight. It should not be zero.

---

# 11. Build plan by phase

## Phase 1 — Codify KEY Genome ontology

### Goal

Create the stable ontology that everything else plugs into.

### Code changes

Add `apps/server/src/modules/business-genome/key-genome/key-genome.ontology.ts` with sections, domains, fact requirements, and module impact mapping.

### Ranking after Phase 1

| Area                      | New rank |
| ------------------------- | -------: |
| Ontology                  |   9.5/10 |
| Product clarity           |   8.5/10 |
| Module mapping foundation |     7/10 |

---

## Phase 2 — Add Fact/Evidence/Signal schema

### Goal

Move from JSON profile to evidence-backed business truth.

### Code changes

Add Prisma models:

```text id="g8u5b"
GenomeFact
GenomeEvidence
GenomeSignal
GenomeModuleReadiness
GenomeRecommendation
GenomeExperiment
```

Add migration under `packages/db/prisma/migrations/<timestamp>_key_genome_kernel/migration.sql`.

### Ranking after Phase 2

| Area                  | New rank |
| --------------------- | -------: |
| Evidence-backed facts |   8.5/10 |
| Auditability          |   8.5/10 |
| Future AI reliability |   8.5/10 |

---

## Phase 3 — Backfill Blueprint into KEY Genome facts

### Goal

Preserve existing data while creating normalized facts.

### Code changes

Add:

```text id="h9v6c"
apps/server/src/modules/business-genome/key-genome/genome-backfill.service.ts
scripts/backfill-key-genome-facts.ts
```

Behavior:

```text id="i0w7d"
for each BusinessBlueprint:
  read identity, operatingModel, customerModel, financials, legalProfile, etc.
  convert each populated field into GenomeFact
  mark sourceType = "BLUEPRINT_BACKFILL"
  confidenceScore = 0.65 if user-entered/unknown provenance
  freshnessScore based on updatedAt
  verificationStatus = "UNVERIFIED_IMPORTED"
```

### Ranking after Phase 3

| Area                   | New rank |
| ---------------------- | -------: |
| Backward compatibility |   9.5/10 |
| Data preservation      |   9.5/10 |
| Fact coverage          |     8/10 |

---

## Phase 4 — Upgrade Business Genesis to write Genome facts

### Current state

Business Genesis already analyzes ideas, extracts structured data, previews compliance, computes readiness, and returns next questions.

### Needed change

Every Genesis answer should create or update `GenomeFact` records.

### Code changes

In `BusinessGenesisService.submitAnswers()`:

```ts
await this.keyGenome.ingestGenesisAnswers({
  businessId,
  answers,
  blueprint,
  sourceType: 'BUSINESS_GENESIS',
});
```

Create `KeyGenomeService.ingestGenesisAnswers()` to write facts, attach evidence, update Blueprint aggregate, recalculate Genome score, recalculate module readiness, and return next missing facts.

### Ranking after Phase 4

| Area                            | New rank |
| ------------------------------- | -------: |
| Onboarding as Genome generation |   9.5/10 |
| Evidence-backed onboarding      |     9/10 |
| User activation                 |     9/10 |

---

## Phase 5 — Upgrade Genome Chat into a fact-update assistant

### Current state

Genome Chat asks questions, proposes a JSON `genome_update`, stores messages, and applies confirmed updates through Blueprint DNA updates.

### Needed change

Genome Chat should produce proposed fact changes, evidence, confidence, source attribution, section impact, affected module readiness, and risk if wrong.

### New contract

Add to `ai-output-contracts.ts`:

```ts
export interface GenomeUpdateContract {
  reply: string;
  proposedFacts: Array<{
    section: string;
    domain: string;
    field: string;
    value: unknown;
    confidence: number;
    evidenceSummary: string;
    riskIfWrong: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
  followUpQuestion?: string;
}
```

Add contract type `genome_update`.

### Ranking after Phase 5

| Area                 | New rank |
| -------------------- | -------: |
| Genome Chat          |   9.2/10 |
| Trust/explainability |   8.8/10 |
| Structured updating  |     9/10 |

---

## Phase 6 — Module readiness contracts

### Goal

Make every module declare what it needs from KEY Genome.

### Add file

```text id="j1x8e"
apps/server/src/modules/business-genome/key-genome/module-contracts.ts
```

Must cover first:

```text id="k2y9f"
KeyInbox
Finance / Financial Flow
Commerce
Calendar / Bookings
People Flow
SOP / Projects
Marketing
CRM
Business Assets / Documents
KEY Autonomy
```

### Ranking after Phase 6

| Area               | New rank |
| ------------------ | -------: |
| Module integration |     9/10 |
| Module readiness   |   9.5/10 |
| Product coherence  |   9.2/10 |

---

## Phase 7 — Temporal Flow → GenomeSignal pipeline

### Current state

Temporal Flow detects candidate Genome updates such as WhatsApp leads, Instagram DMs, bookings, paid invoices, and asset expiries.

### Needed change

Temporal Flow should emit `GenomeSignal` records first. A signal aggregator then decides whether to update confidence, create a fact proposal, create a recommendation, recalculate module readiness, or request user confirmation.

### Ranking after Phase 7

| Area                        | New rank |
| --------------------------- | -------: |
| Learning from real activity |   9.4/10 |
| Genome Evolution            |   9.3/10 |
| Evidence quality            |   9.2/10 |

---

## Phase 8 — Recommendation and pivot engine

### Current state

Command Center ranks items and creates recommended actions from existing items. Executive Modes create findings from Executive Brief, DNA scores, Temporal Flow, proposals, and assets.

### Needed change

Create real business recommendations.

Add:

```text id="l3z0g"
apps/server/src/modules/business-genome/key-genome/best-practice-rules.ts
apps/server/src/modules/business-genome/key-genome/genome-recommendation.service.ts
apps/server/src/modules/business-genome/key-genome/genome-pivot-detector.service.ts
```

Example rule:

```ts
{
  id: 'pricing_capacity_pressure',
  domain: 'financial',
  trigger: {
    requiredSignals: ['capacity_overload', 'stable_lead_volume'],
    requiredFacts: ['offer_product.core_offer', 'financial.avg_ticket'],
  },
  recommendation:
    'Test a 10–15% price increase on the next 10 qualified leads before increasing marketing spend.',
  expectedGainType: 'margin_improvement',
  riskLevel: 'MEDIUM',
}
```

### Ranking after Phase 8

| Area                        | New rank |
| --------------------------- | -------: |
| Recommendation intelligence |   9.3/10 |
| Pivot guidance              |   8.8/10 |
| Founder value               |   9.6/10 |

---

## Phase 9 — KEY Autonomy governed by KEY Genome

### Current state

KEY Autonomy already has action proposals and policy.

### Needed change

Before any KEY action is proposed or executed, check:

```text id="m4a1h"
1. module readiness
2. fact confidence
3. risk level
4. autonomy settings
5. approval requirements
6. legal/financial/compliance blocks
7. stale fact warnings
```

Add `GenomePolicyService.assertActionAllowed()`.

### Ranking after Phase 9

| Area                  | New rank |
| --------------------- | -------: |
| Automation governance |   9.4/10 |
| Safety                |   9.5/10 |
| User trust            |   9.5/10 |

---

## Phase 10 — Command Center becomes KEY Genome cockpit

### Current state

Business Command Center already aggregates the important systems.

### Needed change

Add a `keyGenome` section to the snapshot:

```ts
interface BusinessCommandCenterSnapshot {
  keyGenome: {
    integrity: number;
    readiness: number;
    confidence: number;
    staleFacts: number;
    criticalMissingFacts: MissingFact[];
    moduleReadiness: ModuleReadiness[];
    topRecommendations: KeyGenomeRecommendation[];
    activeExperiments: GenomeExperiment[];
    unsafeAutomationBlocks: GenomePolicyBlock[];
  };
}
```

The Command Center should become:

> **The CEO dashboard powered by KEY Genome.**

### Ranking after Phase 10

| Area                 | New rank |
| -------------------- | -------: |
| Command Center       |   9.5/10 |
| Executive usefulness |   9.6/10 |
| Product clarity      |   9.3/10 |

---

# 12. Specific file-level implementation plan

## New files

```text id="n5b2i"
apps/server/src/modules/business-genome/key-genome/key-genome.module.ts
apps/server/src/modules/business-genome/key-genome/key-genome.service.ts
apps/server/src/modules/business-genome/key-genome/key-genome.ontology.ts
apps/server/src/modules/business-genome/key-genome/key-genome.types.ts
apps/server/src/modules/business-genome/key-genome/genome-fact.service.ts
apps/server/src/modules/business-genome/key-genome/genome-evidence.service.ts
apps/server/src/modules/business-genome/key-genome/genome-signal.service.ts
apps/server/src/modules/business-genome/key-genome/genome-scoring.service.ts
apps/server/src/modules/business-genome/key-genome/genome-module-readiness.service.ts
apps/server/src/modules/business-genome/key-genome/genome-recommendation.service.ts
apps/server/src/modules/business-genome/key-genome/genome-experiment.service.ts
apps/server/src/modules/business-genome/key-genome/genome-policy.service.ts
apps/server/src/modules/business-genome/key-genome/module-contracts.ts
apps/server/src/modules/business-genome/key-genome/best-practice-rules.ts
apps/server/src/modules/business-genome/key-genome/genome-backfill.service.ts
```

## Existing files to modify

```text id="o6c3j"
apps/server/src/modules/business-genome/business-genome.module.ts
apps/server/src/modules/business-genesis/business-genesis.module.ts
apps/server/src/modules/business-genesis/business-genesis.service.ts
apps/server/src/modules/business-genesis/genome-chat.service.ts
apps/server/src/modules/blueprint/blueprint.service.ts
apps/server/src/modules/temporal-flow/temporal-flow.service.ts
apps/server/src/modules/intelligence/business-intelligence.service.ts
apps/server/src/modules/intelligence/key-executive-mode.service.ts
apps/server/src/modules/business-command-center/business-command-center.service.ts
apps/server/src/modules/key-autonomy/key-action-proposal.service.ts
apps/server/src/modules/key-autonomy/key-action-policy.service.ts
apps/server/src/modules/ai/ai-output-contracts.ts
packages/db/prisma/schema.prisma
```

---

# 13. Product UI plan

The frontend should present KEY Genome as five primary surfaces.

## 13.1 Genome Overview

Shows:

```text id="p7d4k"
Genome Integrity
Executive Readiness
Confidence
Stale Facts
Critical Missing Facts
Stage
Three-Pillar Status
Risk Level
Top Recommendations
```

## 13.2 DNA Builder

For every DNA section:

```text id="q8e5l"
completeness
quality
confidence
freshness
readiness
missing fields
evidence
affected modules
improve button
```

## 13.3 Evidence Explorer

Example:

```text id="r9f6m"
Fact: Primary lead source = WhatsApp
Confidence: 84%
Evidence:
- 16 WhatsApp lead events in 30 days
- 7 converted to paid invoices
- 3 customer replies mentioned WhatsApp
Affected modules:
- KeyInbox
- Sales
- Marketing
- Growth
```

## 13.4 Module Readiness Map

Example:

```text id="s0g7n"
Finance: 68% ready
Missing:
- tax profile
- reserve policy
- payment terms

Automation:
Blocked for high-risk financial actions.
```

## 13.5 KEY Recommendations

Each card must show:

```text id="t1h8o"
Insight
Evidence
Diagnosis
Recommendation
Expected gain
Risk
Experiment
Confidence
Next step
```

---

# 14. Final score projection

| Capability                  | Current | Target |
| --------------------------- | ------: | -----: |
| Blueprint / ontology        |  8.5/10 | 9.7/10 |
| Business Genesis            |  8.5/10 | 9.7/10 |
| Genome Chat                 |  7.0/10 | 9.2/10 |
| DNA scoring                 |  6.0/10 | 9.2/10 |
| Fact-level evidence         |  3.5/10 | 9.6/10 |
| Temporal learning           |  6.5/10 | 9.4/10 |
| Genome Evolution            |  6.5/10 | 9.3/10 |
| Executive Modes             |  7.5/10 | 9.3/10 |
| Business Command Center     |  8.0/10 | 9.5/10 |
| KEY Autonomy governance     |  7.0/10 | 9.4/10 |
| Module readiness            |  2.5/10 | 9.5/10 |
| Recommendation engine       |  6.5/10 | 9.3/10 |
| Pivot guidance              |  3.5/10 | 8.8/10 |
| User trust/explainability   |  6.0/10 | 9.5/10 |
| Business OS foundation      |  7.5/10 | 9.6/10 |

---

# 15. Final KEY Genome build sequence

```text id="u2i9p"
1. KEY Genome ontology
2. GenomeFact / GenomeEvidence / GenomeSignal schema
3. Blueprint → GenomeFact backfill
4. Business Genesis → GenomeFact writing
5. Genome Chat → evidence-backed updates
6. Scoring 2.0
7. Module readiness contracts
8. Temporal Flow → GenomeSignal
9. Recommendation / pivot engine
10. KEY Autonomy policy integration
11. Command Center KEY Genome cockpit
12. Frontend Evidence Explorer + Module Readiness Map
```

---

# Bottom line

The updated repo is now much closer to the vision.

Before, the answer was:

```text id="v3j0q"
"Genome has a strong foundation, but it needs more infrastructure."
```

Now the answer is:

```text id="w4k1r"
"The app already has the surrounding infrastructure. What remains is to formalize KEY Genome as the central fact/evidence/signal/readiness/recommendation kernel."
```

The current repo can already:

```text id="x5l2s"
onboard a business through Genesis
generate readiness
create a roadmap
chat about Genome
update DNA sections
track Temporal Flow
generate Executive Briefs
run Executive Modes
surface priorities in Command Center
create KEY action proposals
```

The missing layer is:

```text id="y6m3t"
Normalized, evidence-backed, module-aware KEY Genome intelligence.
```

Once that is coded, KeyFlowOS can credibly become:

> **An evidence-based AI business operating system that tells the founder what is true, what is missing, what is risky, what to do next, why it matters, what gain is expected, and what KEY can safely do for them.**
