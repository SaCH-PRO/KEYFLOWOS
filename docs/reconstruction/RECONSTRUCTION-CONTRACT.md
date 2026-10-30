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


## Microhistory and engineering leverage: mandatory discovery axis

The reconstruction must recover **small, incidental, cross-disciplinary and tooling-related ideas**, not just main modules, big launches and the most recent proposal. A comment, sketch, prompt, folder-layout proposal, abandoned script, naming convention, optimization note, research analogy or negative experiment qualifies as an extractable candidate. Discover first, then classify its acceptance and utility. Never silently drop it on the grounds that it looks too small to be a product feature.

Special, non-exhaustive discovery dimensions:

1. **Developer efficiency and repository organization:** physical folder/module boundaries, monorepo layout, package/layer placement, code ownership, entry points, architecture routing files, root and domain-specific agent instructions, `.vscode/` tasks/debug configurations, generated maps, graph indexes, naming, file-discovery methods, context loading granularity, token/cost/latency benchmarks, build/test feedback speed, and edit locality.
2. **AI-agent context engineering:** routing Markdown, Context Compiler, task-specific ContextBundles, RAG/indexing, provenance/freshness/revision tags, retrieval correctness, prompt stratification, skills/harness procedures, agent specialization, minimal vs complete context, duplicate context, stale maps and measured impact on agent accuracy/time/cost.
3. **Development orchestration and autonomy:** GitHub/Claude/ChatGPT/Kimi workflows and their historical changes, multi-worker isolation, parallelization limits, permissions, Git worktrees, resource locks, failure handling, review gates, exact-head evidence and automatic learning from corrections.
4. **Nonheadline UX/product ideas:** minor interface interactions, visual design and identity changes, navigation, keyboard shortcuts, onboarding friction, accessibility, loading states, performance, mobile behavior, automation defaults, gamification and customer-facing conversion details.
5. **Research and analogy lineage:** prior scientific/cognitive/biological/organizational analogies and book/repository/video research, including explicitly speculative lines. Preserve the original claim, its usefulness hypothesis, tests and later disposition; do not represent analogy as scientific proof.
6. **Negative knowledge:** unsuccessful designs, abandoned branches, reverted commits, audit findings, red tests, implementation debt, original causes of recurring friction, security incidents, failed UI designs and evidence of why an earlier abstraction was superseded.
7. **Performance, reliability and operating economics:** developer throughput, agent token usage, CI wall-clock, UI perceived speed, runtime latency, tenancy and scale, API/queue throughput, cost-aware model routing, infrastructure/deployment trade-offs, data retention and backup/restore trade-offs.
8. **Data, memory and learning mechanics:** ownership graph, retrieval boundaries, knowledge freshness, Business/Context/Project Genome, state-space models, temporal/causal graphs, episodic/procedural memory, corrections, uncertainty and controlled promotion.
9. **Alternative paths and unadopted options:** distinguish mentioned/proposed/experimented/accepted/rejected/superseded/unknown and preserve evidence for why a different approach was not selected.

For every recovered optimization, record its **claimed benefit separately from measured benefit**, including benchmark scope and date, failure modes, dependencies, whether it is active on `main`, and applicability to the target build. Do not treat an archived claim of faster development as proven speed improvement. Where multiple similar ideas exist, build an evolution graph rather than creating redundant new subsystems.

No retrieval keyword list is an exhaustive whitelist. Conduct both taxonomy-led searches and open-ended anomaly/orphan scanning over conversations, reviews, diagrams, Markdown bodies, historical revisions, issue threads, scripts and source-code comments. Every reviewed source should explicitly mark whether it yielded any requirements, decisions, constraints, design choices, experiments or negative findings; items without such claims remain accounted for.

### Specific earlier threads to recover and verify

- July 2026 root/domain documentation, `.vscode/` workspaces, `CLAUDE.md`, and architecture placement proposals. Historical conversation evidence; current code and adoption require verification.
- October 5 root-routing Markdown + domain architecture map as agent repository second brain; existing `AGENTS.md` and `.agents/skills/codebase-architect/SKILL.md` are direct codebase evidence, not proof of consistent usage.
- October 5–6 Context Genome / Context Compiler / ContextBundle experiments and task-specific agent context packing; recover the exact trace and benchmarks before assigning performance claims.
- Draft PRs #141 and #142 Living System Atlas and materializer; classify as drafts until admission/merge evidence establishes otherwise.
- Draft PR #163 historical thread harvester, #165 intelligence reconciliation, and #167 skills-first R&D; do not infer execution or release from proposal existence.

## Source-completeness checks specific to historical recovery

- Coverage extends to **PR review threads, comments, hidden/dot files, non-Markdown design artifacts, issue discussions, diffs, historical deleted files, branch-only plans, older user prompts, and attached design materials** when accessible and relevant.
- Sample historical periods and obscure/minor categories, not only latest changes or title-matched results; independently search for orphan ideas and compare against the product/KEY/development-system ontology.
- Maintain explicit **unavailable/unrecoverable** dispositions rather than asserting 100% coverage of private conversation history or uncommitted work.
- Separate active engineering stack from historically discussed optional agents; exact tooling roles may have changed over time.
