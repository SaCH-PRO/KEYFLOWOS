# KEYFLOWOS / KEY — Canonical Reconstruction Contract

**Status:** DRAFT RECONSTRUCTION FRAMEWORK, NOT ADMITTED PRODUCT CANON.

## Mission
Recover and reconcile every accessible, materially relevant historical intent, architecture, research result, design decision, test, implementation, failure, and control rule for (1) KEYFLOWOS business platform, (2) KEY embedded intelligence, and (3) autonomous/multi-agent development system. Transform the reconciled evidence into an implementation-complete, machine-consumable, testable specification without pretending it is already complete.

## Sources and precedence
- **Code/runtime:** exact deployed artifacts and observed tests describe actual behavior, not necessarily desired behavior.
- **GitHub authority:** applicable canonical issue #80 messages and execution/control standards govern agent permissions. An open PR or old proposal is not an execution grant.
- **Operator intent:** explicit current user choices override earlier unadmitted ideas for product goals but do not silently bypass current safety and merge requirements.
- **Repository intelligence and reviews:** evidence of discovered domains, semantics, contradictions, performance, failures, solutions, and decisions; resolve dated conflicts explicitly.
- **External R&D:** hypotheses and sources require applicability assessment and independent tests before promotion.
- **Historical documents:** recover intent; never use chronological recency alone as proof of acceptance.

Preserve source identity and provenance. No automatic synthesis may turn an idea, recommendation, code artifact, or passing test into an approved and proven target.

## Audit coverage ledger
Every source needs: source_uri, source_type, exact_sha_or_version, fetch_date, review_status, extraction_status, related_claims, and known_gaps. PRs additionally require all changed-file pages, applicable patches, issue/review discussion, disposition, merge state, supersession relationships and proof references. A discovery census is not a deep read. Historical deleted or renamed paths and branch-only documents must be separately enumerated. Treat snippets as incomplete until bodies are inspected.

## Each recovered atomic claim
Represent an idea, requirement, feature or invariant using:

```yaml
id: KF-REC-REQ-0001
name: example
system: KEYFLOWOS | KEY | DEVELOPMENT_SYSTEM | SHARED
subsystem: example
kind: product_goal | requirement | architectural_law | interface | algorithm | research_hypothesis | rejected_approach | constraint | proof_obligation
statement: ""
original_evidence: [{uri: "", revision: "", excerpt_location: ""}]
evolution: [{when: "", change: "", source: ""}]
authority_status: MENTIONED | PROPOSED | ACCEPTED | REJECTED | SUPERSEDED | UNRESOLVED
implementation_status: UNTRACED | ABSENT | PARTIAL | PRESENT | DEAD_CODE | UNKNOWN
proof_status: NOT_TESTED | PARTIAL | VERIFIED | FAILED | UNKNOWN
semantic_owner: ""
dependencies: []
related_claims: []
conflicts: []
security_privacy_cost_operational_risks: []
target_disposition: RETAIN | REPAIR | CONVERGE | REPLACE | RETIRE | RESEARCH | UNDECIDED
acceptance_tests: []
open_questions: []
confidence: low | medium | high
```

## Required architecture volumes
1. **Constitution and goals:** founder vision, products and differentiation, user segments, 60-second value proposition, business and regulatory boundaries, success metrics.
2. **KEYFLOWOS functional atlas:** onboarding/identity/tenancy, Business Genome, contact intelligence, CRM/network, financial flow (invoicing, quotes, payments, expense, accounting, inventory), public space/storefront, bookings/time, marketing/Growth Engine, content/social, communication, analytics, projects/operations, workforce/admin, integrations, mobile/UX and gamification.
3. **KEY cognitive atlas:** perception, contextual intake, Context Genome, episodic/semantic/association memory, retrieval/freshness/provenance, business knowledge, agent planning, tools/capabilities, policies and authorization, execution and effects, confidence/evidence, self-model, reflection/learning, research ingestion, native model/optional offload, voice/multimodal, multi-tenant isolation.
4. **Development system atlas:** GitHub control plane, operator/ChatGPT/Claude/Kimi roles, packets and dependencies, message envelopes, state reducer, PR review, exact-head grants, CI, anti-vacuity, worktree isolation, locks, proof, observability, test strategy, external R&D mining, converged architecture memory, continuity/handoffs, release and production safety.
5. **Domain semantic primitives:** stable identities, canonical authorities, state transitions, events, temporal executions, financial truth, external-effect identity/certainty, cancellations/corrections/reversals, idempotency, retry/reconciliation, operator attention, audit evidence, tenant boundaries, recovery and observability.
6. **Infrastructure/topology:** web/api/voice/queues/data/storage/auth/providers, app/deployment topology, environment strategy, backups, security and secrets, cost controls and third-party constraints.
7. **User experience:** exact navigation, screens, flows, interaction contracts, accessible behaviors, responsive states, gamification, onboarding and operator surfaces.
8. **Implementation design:** versioned DB schemas/migrations, APIs and DTOs, event envelopes, dependency graph, capabilities and tool contracts, executable examples, nonfunctional targets, adversarial test matrices, module acceptance and migration strategy.
9. **Decision and contradictions ledger:** accepted vs draft vs rejected/superseded; why changed, what remains contested and who can decide.
10. **Delivery packets:** sequence by dependency, source/target SHAs, allowed scope, files, acceptance proof, tests, rollback, tenant/security and cost gates, review and merge control.

## Analytical method
INVENTORY -> EXTRACT -> SOURCE/CLAIM LINK -> TEMPORAL EVOLUTION -> SEMANTIC DEDUPLICATION -> CONTRADICTION REGISTER -> CURRENT CODE TRACE -> CANONICAL TARGET DECISION -> INTERFACE/INVARIANT SPEC -> ADVERSARIAL TESTS -> IMPLEMENTATION PACKETS -> INDEPENDENT REVIEW -> CONVERGENCE.

Do this at both microscopic and end-to-end levels. A code class name or event registration does not prove a functioning customer journey. A merged PR does not mean its envisioned capability is fully reachable. A successful workflow does not imply its scanner exercised real inputs.

## Completion definition
- 100% of enumerated accessible sources have a recorded review disposition (including explicit inaccessible/unrecoverable status).
- Every material requirement linked to source evidence, temporal lineage and current target disposition.
- Every unresolved contradiction has owner and blocking/nonblocking classification.
- Every product journey has user-visible behavior, tenant/authority contract, data/event/effect trace, failure/recovery and executable tests.
- Every KEY action has capability checks, scoped tenant context, approval thresholds, evidence and replay semantics.
- Development agents can load bounded per-packet context without reading the entire corpus; machines read JSON/YAML, humans read linked dossiers.
- Full implementation remains subject to independent security, behavior, migration, recovery and production proof.

## Critical cautions
No big-bang rewrite authorized; compare repair vs selective rebuild vs clean implementation through measured pilots. No production mutations, external paid API effects, secrets operations or unrestricted deployments. Never downgrade a red/unknown observation to green. Do not reactivate halted architecture/os cycles. Preserve current control and release boundaries.

## Starting references
- `AGENTS.md`; `docs/development/EXECUTION_CONTROL_STANDARD.md`; `docs/development/AGENT_CONTROL_PLANE.md`; `architecture/os/OS.md`.
- `architecture/system-overview.md`; `architecture/target-architecture.md`; `docs/intelligence/00-START-HERE.md` on its historical branch.
- `docs/intelligence/handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md` on PR #180 head, not main.
- Issue #80 control record and issue #186 RELEASE-0.
- Historical product source `KEYFLOW v3.docx`, continuity and architecture reassessment documents supplied in the project; their content must be quoted only when reviewed.
- `SOURCE-MANIFEST.json` and `SOURCE-CENSUS.md` record the initial GitHub source census.
