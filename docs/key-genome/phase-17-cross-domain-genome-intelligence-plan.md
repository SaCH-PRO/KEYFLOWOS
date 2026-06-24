# Phase 17 — Cross-Domain Genome Intelligence / Stabilization

Status: **Planned**  
Owner: Engineering / Product  
Depends on: Phase 16 (Marketing / Growth Genome), Infra-M1 (Prisma Migration History Repair)

---

## Goal

Stop adding new KEY Genome domains. Instead, make the existing domains reason across each other.

Phase 17 turns KEY Genome from a collection of domain snapshots into a **unified operating-intelligence layer** that can:

1. Surface a single cross-domain Genome health score.
2. Generate recommendations that combine signals from multiple domains.
3. Rank next actions by expected gain, risk, capacity, and financial viability.
4. Synthesize module readiness so KEY Autonomy and the Command Center know what is safe to execute.
5. Feed the Command Center with a unified CEO dashboard view.
6. Provide a clear migration-repair path for the existing Prisma migration-history debt.

This phase is about **integration, synthesis, and stabilization**, not new surface area.

---

## Scope

### In scope

- Cross-domain Genome health score and unified snapshot section.
- Cross-domain recommendation engine and ranking model.
- Module-readiness synthesis across Finance, Customer/Sales, Operations, and Marketing.
- KEY Autonomy gating: action proposals check module readiness, fact confidence, risk level, and cross-domain constraints before execution.
- Command Center integration: a `keyGenome` section in the snapshot with top recommendations, unsafe blocks, and stale facts.
- Temporal Flow enrichment: business events emit cross-domain signals, not just domain-local signals.
- Outcome learning: track which recommendations produced real business results and feed that back into ranking.
- Migration-history repair plan and execution checklist (`Infra-M1`).
- Stabilization: flake fixes, test categorization, env docs, production-readiness checklist.

### Out of scope

- No new genome domain (no HR, Legal, R&D, or Product genome).
- No new major schema models beyond `GenomeCrossDomainSnapshot` and supporting fields.
- No campaign execution, posting, ad integrations, or outbound automation.
- No changes to the 12-domain scoring weights until cross-domain scoring is validated.
- No production deployment until `Infra-M1` migration repair is complete and verified.

---

## Target architecture

```text
KeyGenome kernel
  ├── domain snapshots (finance, customer-sales, operations, marketing)
  ├── cross-domain synthesizer
  │     ├── health score
  │     ├── readiness matrix
  │     ├── risk aggregator
  │     └── opportunity detector
  ├── recommendation ranker
  │     ├── expected gain model
  │     ├── risk-weighted priority
  │     └── effort/capacity filter
  └── autonomy gate
        ├── assertActionAllowed()
        ├── cross-domain constraint check
        └── human approval escalation

Command Center snapshot
  └── keyGenome: { health, readiness, topRecommendations, unsafeBlocks, staleFacts }

KEY Autonomy
  └── policy service consumes Genome readiness + cross-domain risk before proposing/executing actions
```

---

## Proposed data model additions

> Minimal schema footprint. The migration must be created after `Infra-M1` repair.

```text
GenomeCrossDomainSnapshot
  id
  businessId
  period
  healthScore            // 0-100
  readinessScore         // 0-100
  confidenceScore        // 0-100
  staleFactCount
  criticalMissingFactCount
  domainHealth           // JSON { financial, customerSales, operations, marketing }
  domainReadiness        // JSON { financial, customerSales, operations, marketing }
  topRisks               // JSON
  topOpportunities       // JSON
  unsafeAutomationBlocks // JSON
  computedAt
```

Existing `GenomeRecommendation` and `GenomeSignal` records remain the source of truth; the cross-domain snapshot is a computed aggregate.

---

## Proposed services

| Service | Responsibility |
| --- | --- |
| `GenomeCrossDomainService` | Compute the unified cross-domain snapshot by reading domain snapshots, signals, readiness, and facts. |
| `GenomeRecommendationRankerService` | Rank recommendations by expected gain, risk, effort, capacity, and domain readiness. |
| `GenomeOpportunityDetectorService` | Detect cross-domain opportunities (e.g., marketing has budget + operations has capacity + finance margin is healthy). |
| `GenomeAutonomyGateService` | Check whether a proposed KEY action is allowed given readiness, risk, confidence, and cross-domain constraints. |
| `CommandCenterKeyGenomeBridgeService` | Translate KEY Genome state into Command Center snapshot shape. |

Existing services to extend:

| Service | Extension |
| --- | --- |
| `GenomeSignalService` | Accept cross-domain signal types and emit them from Temporal Flow events. |
| `GenomeRecommendationService` | Support cross-domain recommendation generation and ranking metadata. |
| `GenomeModuleReadinessService` | Synthesize readiness across all domains. |
| `OutcomeLearningService` | Track recommendation outcomes across domains. |

---

## Controller routes

Base path: `/business-genome/businesses/:businessId/key-genome/cross-domain`

```text
GET    /snapshot
POST   /snapshot/compute?period=
GET    /recommendations/ranked
POST   /recommendations/ranked/generate
POST   /signals/cross-domain/generate
POST   /autonomy-gate/check
```

No changes to existing domain routes. New routes are additive.

---

## Command Center integration

Add a `keyGenome` section to the existing `BusinessCommandCenterSnapshot`:

```ts
interface BusinessCommandCenterSnapshot {
  keyGenome: {
    healthScore: number;
    readinessScore: number;
    confidenceScore: number;
    staleFactCount: number;
    criticalMissingFactCount: number;
    domainHealth: Record<string, number>;
    domainReadiness: Record<string, number>;
    topRecommendations: KeyGenomeRecommendation[];
    unsafeAutomationBlocks: GenomePolicyBlock[];
  };
}
```

The Command Center service should call `GenomeCrossDomainService` and render the new section in the existing Command Center UI.

---

## KEY Autonomy integration

Before any KEY action is proposed or executed:

1. Check module readiness for all affected domains.
2. Check fact confidence for inputs used in the action.
3. Check cross-domain risk (e.g., a marketing spend action must not violate finance margin limits).
4. Check capacity constraints (e.g., operations must be able to fulfill increased lead volume).
5. Escalate to human approval if any check is yellow or red.
6. Record the gate decision in `GenomeMemoryService`.

---

## UI plan

### New components

- `KeyGenomeCrossDomainPanel` — unified health, readiness, domain breakdown, top risks/opportunities.
- `KeyGenomeRecommendationRanker` — ranked recommendation cards with expected gain, risk, effort, and affected domains.
- `CommandCenterKeyGenomeCard` — compact Command Center widget.

### Modified components

- `BusinessCommandCenterService` backend snapshot shape.
- Command Center frontend page to render the `keyGenome` section.
- `KeyAutonomyPolicyService` to call the autonomy gate.

### Navigation

Add a "Cross-Domain" sub-tab in `BusinessGenomeTab` next to the existing domain tabs.

---

## Migration repair plan (`Infra-M1`)

Phase 17 must not proceed to implementation until the migration-history debt is resolved.

### Steps

1. Audit current migrations vs. actual production schema state.
2. Identify the failing migration (`20260624000000_add_status_enums` references missing `invoices` table in shadow DB).
3. Decide repair strategy:
   - Option A: Fix the migration SQL to be idempotent / conditional.
   - Option B: Baseline the schema with `prisma migrate diff` against a clean database.
   - Option C: Reset migrations in a controlled environment and re-baseline.
4. Validate repair in a fresh local database:
   - `prisma migrate deploy` succeeds.
   - `prisma db seed` (if used) succeeds.
   - Full test suite passes.
5. Document the repair in `docs/migrations/infra-m1-migration-repair.md`.

### Verification

| Check | Command | Result |
| --- | --- | --- |
| Migrate deploy | `pnpm --filter db exec prisma migrate deploy` | ✅ Pass |
| Generate client | `pnpm --filter db db:generate` | ✅ Pass |
| Server build | `pnpm --filter server build` | ✅ Pass |
| Server tests | `pnpm --filter server test:ci` | ✅ Pass |

---

## Implementation sequence

1. **Infra-M1** — migration repair (own branch, own verification).
2. **Cross-domain types** — extend `key-genome.types.ts` with cross-domain snapshot and ranking types.
3. **Cross-domain service** — implement `GenomeCrossDomainService`.
4. **Recommendation ranker** — implement `GenomeRecommendationRankerService`.
5. **Opportunity detector** — implement `GenomeOpportunityDetectorService`.
6. **Autonomy gate** — implement `GenomeAutonomyGateService`.
7. **Controller routes** — add `/cross-domain` routes.
8. **Module wiring** — register services in `KeyGenomeModule`.
9. **Command Center bridge** — extend Command Center snapshot.
10. **UI** — build panels and Command Center widget.
11. **Tests** — service, controller, and integration tests.
12. **Stabilization** — env docs, production-readiness checklist, flake fixes.
13. **Verification doc** — `docs/key-genome/phase-17-verification.md`.

---

## Verification criteria

| Check | Command / Action | Target result |
| --- | --- | --- |
| Migration deploy | `pnpm --filter db exec prisma migrate deploy` | ✅ Pass |
| Server build | `pnpm --filter server build` | ✅ Pass |
| Cross-domain service tests | `pnpm --filter server test genome-cross-domain` | ✅ New tests pass |
| Autonomy gate tests | `pnpm --filter server test genome-autonomy-gate` | ✅ New tests pass |
| Controller tests | `pnpm --filter server test key-genome.controller` | ✅ Pass |
| Full server suite | `pnpm --filter server test:ci` | ✅ Pass |
| Web typecheck | `cd apps/web && npx tsc --noEmit` | ✅ Pass |
| Web build | `pnpm --filter web build` | ✅ Pass |
| Web lint | `pnpm --filter web lint` | ✅ 0 new errors |

---

## Risks and dependencies

- **Migration-history debt** — blocked until `Infra-M1` is complete.
- **Cross-domain complexity** — ranking models can become opaque. Every recommendation must keep explainability (insight, diagnosis, evidence).
- **Autonomy gating** — false positives (blocking safe actions) or false negatives (allowing risky actions) hurt trust. Start conservative.
- **Performance** — computing cross-domain snapshots may be expensive. Cache and debounce.
- **Scope creep** — Phase 17 is tempting as a place to add new domains or execution features. Resist both.

---

## Success criteria

After Phase 17, a founder should be able to open the Command Center and see:

```text
Your business health: 74/100
Readiness: 68/100
Top risk: Operations capacity is overloaded (HIGH)
Top opportunity: Marketing has budget + Operations has capacity → test paid channel
Next safe action: [Approve] Increase ad spend by 15% for 14 days
Blocked actions: [Increase hiring] — missing finance approval workflow
```

That is the leap from **domain intelligence** to **operating intelligence**.

---

## Related documents

- `docs/KEY_GENOME_ROADMAP.md`
- `docs/key-genome/README.md`
- `docs/key-genome/phase-16-verification.md`
- `docs/PHASE_17_STABILIZATION.md`
- `apps/server/src/modules/business-genome/key-genome/key-genome.ontology.ts`
