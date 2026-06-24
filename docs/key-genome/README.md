# KEY Genome Roadmap Index

A navigation hub for everything KEY Genome: strategy, phases, verification reports, ontology, and implementation files.

---

## 1. Strategy and roadmap

| Document | Purpose |
| --- | --- |
| [`KEY_GENOME_ROADMAP.md`](../KEY_GENOME_ROADMAP.md) | Central intelligence kernel roadmap. Defines the 10-phase build, target schema, services, scoring model, and UI plan. |
| [`KEYFLOWOS_PHASE_11_16_SUMMARY.md`](../KEYFLOWOS_PHASE_11_16_SUMMARY.md) | Strategic OS arc for Phases 11–16 (Executive Brief, Constitution, Document Pack, Executive Modes, KEY Autonomy, Command Center). |
| [`PHASE_17_STABILIZATION.md`](../PHASE_17_STABILIZATION.md) | Stabilization plan after the main phase build (tests, navigation, env docs, production readiness). |

---

## 2. Phase plans and verification reports

| Phase | Status | Document |
| --- | --- | --- |
| Phase 14 — Customer / Sales / Revenue Genome | ✅ Complete | [`docs/key-genome/phase-14-verification.md`](./phase-14-verification.md) |
| Phase 15 — Operations / Delivery Genome | 🚧 In progress | Tracked in `schema.prisma` and Phase 15 operations panel files (not documented here yet). |
| Phase 16 — Marketing / Growth Genome | 📋 Planned | [`docs/key-genome/phase-16-marketing-growth-genome-plan.md`](./phase-16-marketing-growth-genome-plan.md) |

---

## 3. Detailed feature specs and plans

| Document | Purpose |
| --- | --- |
| [`docs/superpowers/specs/2026-06-17-business-genome-phase-1-design.md`](../superpowers/specs/2026-06-17-business-genome-phase-1-design.md) | Business Genome Phase 1 design: DNA sections, Three-Pillar Minimum, Genome Chat, Constitution tab. |
| [`docs/superpowers/plans/2026-06-17-business-genome-phase-1-plan.md`](../superpowers/plans/2026-06-17-business-genome-phase-1-plan.md) | Implementation plan for Business Genome Phase 1 backend and web UI. |

---

## 4. Ontology and type contracts

> Read-only references. These files are the source of truth for the kernel.

| File | Responsibility |
| --- | --- |
| `apps/server/src/modules/business-genome/key-genome/key-genome.ontology.ts` | Sections, weights, fact requirements, and module impact mapping. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts` | Central type contracts for facts, evidence, signals, readiness, recommendations, and experiments. |
| `apps/server/src/modules/business-genome/key-genome/key-genome-departments.ts` | Canonical department registry (CEO_STRATEGY, CFO_FINANCE, CMO_MARKETING, etc.). |

---

## 5. Kernel services

| File | Responsibility |
| --- | --- |
| `apps/server/src/modules/business-genome/key-genome/genome-fact.service.ts` | Normalize and query business facts. |
| `apps/server/src/modules/business-genome/key-genome/genome-evidence.service.ts` | Store and retrieve evidence records. |
| `apps/server/src/modules/business-genome/key-genome/genome-signal.service.ts` | Emit and aggregate Genome signals. |
| `apps/server/src/modules/business-genome/key-genome/genome-scoring.service.ts` | Integrity and readiness scoring. |
| `apps/server/src/modules/business-genome/key-genome/genome-module-readiness.service.ts` | Per-module readiness contracts. |
| `apps/server/src/modules/business-genome/key-genome/genome-recommendation.service.ts` | Recommendation lifecycle. |
| `apps/server/src/modules/business-genome/key-genome/genome-experiment.service.ts` | Experiment tracking. |
| `apps/server/src/modules/business-genome/key-genome/genome-memory.service.ts` | Memory / audit events. |
| `apps/server/src/modules/business-genome/key-genome/department-readiness.service.ts` | Department-level readiness. |
| `apps/server/src/modules/business-genome/key-genome/key-genome-backfill.service.ts` | Backfill Blueprint data into Genome facts. |
| `apps/server/src/modules/business-genome/key-genome/key-genome-governance.service.ts` | Governance summary and queue. |

---

## 6. Domain-specific genome services

| Domain | Service |
| --- | --- |
| Finance | `apps/server/src/modules/business-genome/key-genome/finance-genome.service.ts` |
| Customer / Sales / Revenue | `apps/server/src/modules/business-genome/key-genome/customer-sales-genome.service.ts` |
| Marketing / Growth *(planned)* | `apps/server/src/modules/business-genome/key-genome/marketing-genome.service.ts` *(Phase 16)* |

---

## 7. Controller and module wiring

| File | Responsibility |
| --- | --- |
| `apps/server/src/modules/business-genome/key-genome/key-genome.controller.ts` | `/business-genome/businesses/:businessId/key-genome/*` REST routes. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.module.ts` | NestJS module registering all kernel providers. |
| `apps/server/src/modules/business-genome/business-genome.module.ts` | Aggregates `KeyGenomeModule` with evolution/constitution controllers. |

---

## 8. Frontend

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/api/business-genome.ts` | API client for genome endpoints. |
| `apps/web/src/app/app/profile/components/business-genome-tab.tsx` | Tab shell for Business Genome sub-views. |
| `apps/web/src/app/app/profile/components/business-genome/` | Genome panel components. |
| `apps/web/src/hooks/use-genome-gate.ts` | Genome integrity gate hook. |
| `apps/web/src/components/genome-integrity-banner.tsx` | Integrity banner component. |

---

## 9. Consumers of KEY Genome

| Module | Integration file |
| --- | --- |
| Business Command Center | `apps/server/src/modules/business-command-center/business-command-center.service.ts` |
| Key Autonomy | `apps/server/src/modules/key-autonomy/key-genome-bridge.controller.ts` |
| Key Autonomy policy | `apps/server/src/modules/key-autonomy/key-action-genome-policy.service.ts` |
| Recommendation bridge | `apps/server/src/modules/key-autonomy/genome-recommendation-action-bridge.service.ts` |
| Intelligence / Executive Modes | `apps/server/src/modules/intelligence/key-executive-mode.service.ts` |
| Temporal Flow | `apps/server/src/modules/temporal-flow/temporal-flow-genome-bridge.service.ts` |

---

## 10. How to use this index

1. **New to KEY Genome?** Start with [`KEY_GENOME_ROADMAP.md`](../KEY_GENOME_ROADMAP.md).
2. **Implementing a phase?** Check the phase plan/verification doc in `docs/key-genome/`.
3. **Adding a new domain?** Read `key-genome.ontology.ts`, then model after the Phase 14 service/controller pattern.
4. **Wiring UI?** Reference `apps/web/src/lib/api/business-genome.ts` and existing panel components.
5. **Debugging scoring/readiness?** Trace through `genome-scoring.service.ts`, `genome-module-readiness.service.ts`, and `department-readiness.service.ts`.
