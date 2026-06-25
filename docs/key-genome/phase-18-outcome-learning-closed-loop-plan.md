# Phase 18 — Outcome Learning + Closed-Loop Genome Intelligence

## Goal

Turn KEY Genome from a high-quality advisor into a learning operating system by tracking what actually happens after recommendations, opportunities, and autonomy-gated actions are proposed.

The system must be able to answer:

- Which recommendation was accepted?
- Was it executed?
- What changed after execution?
- Did revenue, conversion, capacity, risk, or confidence improve?
- Should the ranking/risk models trust similar actions more or less next time?

## Why now

Phase 17 completed the founder-facing intelligence chain:

```text
domain data
→ cross-domain snapshot
→ ranked recommendations
→ opportunity detection
→ autonomy safety gate
→ Command Center visibility
```

The next gap is not more data or domains. It is **feedback from outcomes**. Without outcome data, KEY Genome ranks recommendations on predicted value only. With outcome data, it can learn which recommendations actually create value and adjust rank scores, confidence, and autonomy thresholds over time.

## In scope

1. **Recommendation outcome tracking**
   - Accept / dismiss / apply / ignore lifecycle states.
   - Who acted and when.
   - Reason for dismissal if provided.

2. **Action outcome tracking**
   - Link a recommendation to an executed action (task, workflow, approval, invoice, campaign, SOP, etc.).
   - Capture action completion state and timestamp.

3. **Before/after metric snapshots**
   - Snapshot relevant KEY Genome metrics at the moment a recommendation is accepted.
   - Snapshot the same metrics after a configurable observation window (default 14 days, configurable per domain).
   - Compute delta for: health score, readiness score, confidence score, revenue/capacity/risk proxies.

4. **Confidence adjustment**
   - Increase model confidence for recommendations whose outcomes were positive.
   - Decrease confidence for recommendations whose outcomes were negative or ignored.
   - Decay stale outcomes over time so old data does not dominate.

5. **Ranking feedback**
   - Feed outcome deltas back into the recommendation ranker as a learned-impact bonus/penalty.
   - Expose outcome score as a new breakdown dimension in ranked recommendations.

6. **Command Center outcome visibility**
   - Show acceptance rate, execution rate, and win rate per domain.
   - Highlight recommendations that are awaiting outcome measurement.
   - Display trend of learned impact over time.

## Out of scope

- New business domains (finance, marketing, operations, sales are already covered).
- Marketplace or network intelligence.
- Multi-business portfolio intelligence.
- Autonomous execution expansion beyond the existing gate.
- Large UI redesign; Command Center additions only.

## Technical approach

### 1. Data model

Add a small set of outcome tables (or extend existing `GenomeRecommendation` records).

Suggested Prisma additions:

```prisma
model GenomeRecommendationOutcome {
  id                String   @id @default(cuid())
  recommendationId  String
  businessId        String
  domain            String
  actionType        String
  decision          String // ACCEPTED | DISMISSED | APPLIED | IGNORED | ESCALATED
  decidedBy         String?  // userId or key-agent
  decidedAt         DateTime @default(now())
  dismissalReason   String?

  // before snapshot
  preHealthScore    Int?
  preReadinessScore Int?
  preConfidence     Int?
  preRiskLevel      String?

  // after snapshot (observation window)
  postHealthScore   Int?
  postReadinessScore Int?
  postConfidence    Int?
  postRiskLevel     String?
  observedAt        DateTime?

  // impact
  impactScore       Float?   // -1 .. 1 normalized
  impactEvidence    String[]

  // links
  linkedActionType  String?
  linkedActionId    String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([businessId, domain])
  @@index([recommendationId])
  @@index([decidedAt])
}

model GenomeOutcomeLearningWindow {
  id              String   @id @default(cuid())
  businessId      String
  domain          String
  windowDays      Int      @default(14)
  updatedAt       DateTime @updatedAt

  @@unique([businessId, domain])
}
```

### 2. Lifecycle hooks

- When a recommendation is created, schedule an outcome observation job.
- When a user accepts/dismisses/applies a recommendation from the Command Center or Business Genome tab, record a `GenomeRecommendationOutcome`.
- When the observation window closes, recompute the relevant cross-domain snapshot and write the post-metrics.
- Emit domain events: `genome.recommendation.outcome.recorded`, `genome.recommendation.outcome.observed`.

### 3. Confidence adjustment

Simple weighted moving average per (domain, action pattern):

```text
learnedConfidence = weightedAverage(outcome.impactScore, outcome.decayWeight)
confidenceDelta = learnedConfidence * LEARNING_RATE
```

- Positive outcomes boost confidence for similar recommendations.
- Negative outcomes or dismissals reduce it.
- Decay by age (e.g., half-life 90 days).

### 4. Ranking feedback

Extend `GenomeRecommendationRankScoreBreakdown` with:

```typescript
outcomeLearning: number;
```

The ranker adds a small bonus/penalty based on historical outcome impact for the same domain + action pattern.

### 5. Command Center additions

- New section: **Outcome Learning**
  - Acceptance rate, execution rate, win rate.
  - Per-domain trend sparklines.
  - List of recent outcomes awaiting observation.
- Recommendation cards show an **outcome badge**: learned positive/negative/neutral.

## Suggested API endpoints

```text
POST   /business-genome/businesses/:businessId/recommendations/:recommendationId/outcome
GET    /business-genome/businesses/:businessId/recommendations/:recommendationId/outcome
GET    /business-genome/businesses/:businessId/outcomes
GET    /business-genome/businesses/:businessId/outcomes/summary
PATCH  /business-genome/businesses/:businessId/outcome-windows/:domain
```

## Suggested files to touch

### Backend

- `packages/db/prisma/schema.prisma` — add outcome tables.
- `packages/db/prisma/migrations/` — generate migration.
- `apps/server/src/modules/business-genome/key-genome/genome-recommendation.service.ts` — record outcomes on accept/dismiss/apply.
- `apps/server/src/modules/business-genome/key-genome/genome-recommendation-ranker.service.ts` — add outcome learning to rank score.
- `apps/server/src/modules/business-genome/key-genome/genome-outcome.service.ts` — new service for outcome CRUD and observation windows.
- `apps/server/src/modules/business-genome/key-genome/genome-outcome.scheduler.ts` — new service to close observation windows.
- `apps/server/src/modules/business-genome/key-genome/key-genome.controller.ts` — add outcome routes.
- `apps/server/src/modules/business-genome/key-genome/key-genome.module.ts` — register outcome service/scheduler.
- `apps/server/test/keyflow-operating-system.smoke.test.ts` — add outcome learning smoke checks.

### Frontend

- `apps/web/src/lib/api/business-genome.ts` — add outcome API wrappers.
- `apps/web/src/app/app/command-center/components/cross-domain-panel.tsx` — add outcome summary and awaiting-observation list.
- `apps/web/src/app/app/command-center/components/recommendation-outcome-card.tsx` — new component for recording outcomes.
- `apps/web/src/app/app/profile/components/business-genome-tab.tsx` — show recommendation outcome history.

## Verification checklist

- [ ] Schema migration generated and applied successfully.
- [ ] Recommendation accept/dismiss/apply records an outcome.
- [ ] Observation window computes before/after metric deltas.
- [ ] Confidence adjustment changes future recommendation scores.
- [ ] Ranker includes outcome learning in breakdown.
- [ ] Command Center shows acceptance, execution, and win rates.
- [ ] Server tests pass (unit + smoke).
- [ ] Web typecheck, lint, and build pass.

## Success criteria

After Phase 18, the founder can:

1. See which KEY recommendations produced measurable results.
2. Trust that highly ranked recommendations are backed by both prediction and historical proof.
3. Understand which domains or action types are most reliably improving the business.

## Estimated rating after Phase 18

```text
KEY Genome rating: ~9.2/10
```

Outcome learning closes the loop and moves KEY Genome from advisor to self-improving operating intelligence.
