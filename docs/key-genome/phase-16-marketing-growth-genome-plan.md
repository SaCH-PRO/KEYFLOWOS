# Phase 16 — Marketing / Growth Genome Plan

Status: **Planned**  
Owner: Engineering / Product  
Depends on: Phase 14 (Customer / Sales / Revenue Genome), Phase 15 (Operations / Delivery Genome)

---

## Goal

Make **Marketing & Growth** a first-class evidence-backed domain inside KEY Genome.

Today the ontology recognizes `MARKETING_GROWTH` as a section with a small set of blueprint-derived facts (primary channel, content strategy, ad budget). Phase 16 extends that into a full genome module that can:

1. Capture structured growth inputs: channels, content strategy, campaigns, and funnel assumptions.
2. Compute a Marketing & Growth snapshot from live business data and genome facts.
3. Emit signals when channel performance, content consistency, or lead economics change.
4. Generate recommendations and experiments for growth strategy.
5. Feed the Command Center, Executive Modes, and KEY Autonomy with marketing-specific intelligence.

This phase is strictly **intelligence and planning**. It does not send emails, post to social channels, run ads, or execute outbound campaigns.

---

## Scope

### In scope

- New Prisma models for growth-channel, content-strategy, and marketing snapshot data.
- New kernel services under `apps/server/src/modules/business-genome/key-genome/`.
- New controller routes under `/business-genome/businesses/:businessId/key-genome/marketing-growth`.
- New API client methods in `apps/web/src/lib/api/business-genome.ts`.
- A new `KeyGenomeMarketingGrowthPanel` UI component.
- Wiring into existing `GenomeSignalService`, `GenomeRecommendationService`, `GenomeMemoryService`, `GenomeModuleReadinessService`, and `DepartmentReadinessService`.
- Updates to `key-genome.ontology.ts` fact requirements (read-only expansion of the existing `MARKETING_GROWTH` section config).

### Out of scope

- No changes to `schema.prisma` in this document; the schema design below is the target shape for a follow-up migration task.
- No changes to `key-genome.types.ts`, `key-genome.controller.ts`, `key-genome.module.ts`, `business-genome.ts`, `BusinessGenomeTab`, or any Phase 15 operations panel files.
- No automated campaign execution, email sending, social publishing, or ad-platform API integrations.
- No changes to the existing 12-domain scoring weights.

---

## Target data model

> **Note:** These models are the design target. The actual migration is a separate task and must not be applied until the Phase 15 operations schema is stable.

```text
GenomeGrowthChannel
  id
  businessId
  key          // e.g. 'organic_search', 'paid_meta', 'whatsapp', 'email', 'referral'
  label
  channelType  // 'owned' | 'earned' | 'paid'
  status       // 'ACTIVE' | 'TESTING' | 'PAUSED' | 'DEPRECATED'
  monthlyBudget
  currency
  targetCac
  targetConversionRate
  assumptions  // JSON
  evidenceIds  // string[]
  confidenceScore
  createdAt
  updatedAt

GenomeContentStrategy
  id
  businessId
  pillars      // string[]
  cadence      // e.g. '2 posts per week'
  formats      // e.g. ['short_video', 'carousel', 'blog']
  distributionChannels // string[]
  contentGoals // JSON
  confidenceScore
  createdAt
  updatedAt

GenomeMarketingSnapshot
  id
  businessId
  periodStart
  periodEnd
  channelMix   // computed array of { channelKey, sharePercent, status }
  leadVolumeEstimate
  blendedCac
  contentConsistencyScore
  channelDiversificationScore
  funnelConversionEstimate
  overallRisk  // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN'
  warnings     // JSON
  recommendations // JSON
  signalsGeneratedAt
  recommendationsGeneratedAt
  createdAt
```

---

## Service architecture

### New services

| Service | Responsibility |
| --- | --- |
| `MarketingGenomeService` | Compute snapshots, generate signals/recommendations, orchestrate channel and content services. |
| `GenomeGrowthChannelService` | CRUD + validation for `GenomeGrowthChannel`. |
| `GenomeContentStrategyService` | CRUD + validation for `GenomeContentStrategy`. |

### Existing services reused

| Service | Use in this phase |
| --- | --- |
| `GenomeSignalService` | Emit signals such as `channel_dependency_risk`, `content_cadence_gap`, `cac_spike_detected`. |
| `GenomeRecommendationService` | Create recommendations like "Diversify away from a single paid channel" or "Increase content cadence on the best-performing format". |
| `GenomeMemoryService` | Record marketing snapshot compute events and recommendation outcomes. |
| `GenomeModuleReadinessService` | Report readiness for the `marketing` module. |
| `DepartmentReadinessService` | Recompute readiness for `CMO_MARKETING` and related departments. |

---

## API surface

Base path: `/business-genome/businesses/:businessId/key-genome/marketing-growth`

### Channels

```text
GET    /channels
POST   /channels
PATCH  /channels/:channelId
DELETE /channels/:channelId
```

### Content strategy

```text
GET    /content-strategy
POST   /content-strategy
PATCH  /content-strategy/:strategyId
DELETE /content-strategy/:strategyId
```

### Snapshot / intelligence

```text
GET    /snapshot
POST   /snapshot/compute?period=
GET    /snapshots
POST   /signals/generate
POST   /recommendations/generate
```

---

## Web API client additions

Add to `apps/web/src/lib/api/business-genome.ts`:

```text
export type GenomeGrowthChannel ...
export type GenomeContentStrategy ...
export type GenomeMarketingSnapshot ...

fetchGenomeGrowthChannels(businessId)
createGenomeGrowthChannel(businessId, body)
updateGenomeGrowthChannel(businessId, channelId, body)
deleteGenomeGrowthChannel(businessId, channelId)

fetchGenomeContentStrategy(businessId)
createGenomeContentStrategy(businessId, body)
updateGenomeContentStrategy(businessId, strategyId, body)
deleteGenomeContentStrategy(businessId, strategyId)

getGenomeMarketingSnapshot(businessId)
computeGenomeMarketingSnapshot(businessId, period?)
listGenomeMarketingSnapshots(businessId, filters?)
generateGenomeMarketingSignals(businessId)
generateGenomeMarketingRecommendations(businessId)
```

---

## UI plan

### New component

`apps/web/src/app/app/profile/components/business-genome/key-genome-marketing-growth-panel.tsx`

Sections:

1. **Snapshot summary** — overall risk, blended CAC, lead volume estimate, channel diversification score.
2. **Channel mix** — list of active/test/paused channels with budget, target CAC, and status.
3. **Content strategy** — pillars, cadence, formats, distribution channels.
4. **Warnings** — signal-derived alerts (e.g., "Single paid channel drives 80% of leads").
5. **Recommendations** — ranked cards with expected gain, risk, and experiment suggestion.
6. **Add channel / edit strategy** forms using native controls (same pattern as Phase 14).

### Navigation

A new "Marketing & Growth" sub-tab is added to `BusinessGenomeTab` in a later UI wiring task. This document does not modify `BusinessGenomeTab`.

---

## Implementation tasks

1. **Schema** — add `GenomeGrowthChannel`, `GenomeContentStrategy`, and `GenomeMarketingSnapshot` models and run migration.
2. **Services** — implement `GenomeGrowthChannelService`, `GenomeContentStrategyService`, and `MarketingGenomeService`.
3. **Controller** — add `marketing-growth` route handlers to `KeyGenomeController`.
4. **Module wiring** — register new services in `KeyGenomeModule`.
5. **Ontology** — expand `MARKETING_GROWTH` required/optional facts in `key-genome.ontology.ts`.
6. **API client** — add types and fetch functions to `business-genome.ts`.
7. **UI** — build `KeyGenomeMarketingGrowthPanel`.
8. **Tests** — unit tests for services, controller tests, and web typecheck.
9. **Backfill** — optionally seed channels/content strategy from existing Blueprint marketing data.

---

## Verification criteria

| Check | Command / Action | Target result |
| --- | --- | --- |
| Server build | `pnpm --filter server build` | ✅ Pass |
| Service unit tests | `pnpm --filter server test marketing-genome` | ✅ New tests pass |
| Controller tests | `pnpm --filter server test key-genome.controller` | ✅ Existing + new routes pass |
| Full server suite | `pnpm --filter server test:ci` | ✅ Pass |
| Web typecheck | `cd apps/web && npx tsc --noEmit` | ✅ Pass |
| Web lint | `pnpm --filter web lint` | ✅ 0 new errors |
| Web build | `pnpm --filter web build` | ✅ Pass |

---

## Risks and dependencies

- **Phase 15 stability** — the Operations / Delivery Genome migration must be landed before Marketing & Growth models are added, to avoid migration conflicts.
- **Data availability** — channel mix and CAC estimates may rely on live commerce/campaign data that not every business has. The snapshot must degrade gracefully.
- **Overlap with Customer/Sales Genome** — LTV/CAC metrics already live in Customer/Sales Genome. Marketing Genome should reference or reuse those computations rather than duplicate them.
- **Scope creep** — marketing naturally invites execution features (send campaign, post to social). This phase must remain intelligence-only.

---

## Related documents

- `docs/KEY_GENOME_ROADMAP.md`
- [`README.md`](./README.md)
- `docs/key-genome/phase-14-verification.md`
- `apps/server/src/modules/business-genome/key-genome/key-genome.ontology.ts`
