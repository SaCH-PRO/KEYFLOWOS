# External Repository Mining — addyosmani/agent-skills

Date: 2026-10-07
Source: https://github.com/addyosmani/agent-skills
Source license: MIT
Disposition: **MINED FOR PATTERNS; NOT VENDORED OR INSTALLED WHOLESALE**

## Purpose

Mine the repository for reusable engineering-agent workflow patterns that can strengthen KEYFLOWOS' existing architecture-forensics, implementation, verification, reconciliation, external-research, and KEY-agent loops without introducing a competing orchestration system.

This note is evidence/research only. It does not authorize production changes, provider traffic, production data mutation, deployment, map refresh, or replacement of canonical KEYFLOWOS control-plane semantics.

## Repository shape

The source repository packages production-oriented engineering guidance as:

- a portable core of 25 skills;
- 9 lifecycle commands covering DEFINE -> PLAN -> BUILD -> VERIFY -> REVIEW -> SHIP;
- specialized reviewer personas;
- shared reference/checklist material;
- host-specific adapters for Claude Code, Codex, Gemini, Copilot, Cursor and other agents;
- routing/evaluation cases and CI validation.

The important architectural idea is **process as executable agent contract**, not prose-only documentation. Each skill has explicit triggers, ordered steps, gates, evidence requirements, and anti-rationalization guidance.

## High-value patterns for KEYFLOWOS

### 1. Lifecycle routing as a small state machine

The source repo exposes a compact lifecycle:

DEFINE -> PLAN -> BUILD -> VERIFY -> REVIEW -> SHIP

This is valuable not as a replacement for KEYFLOWOS' existing packet/control model, but as a **task-routing lens**. It suggests that each autonomous work item should declare its lifecycle state and allowed transitions, rather than letting agents infer what phase they are in from conversational context.

KEYFLOWOS adaptation:
- retain canonical packet ownership and control-plane admission;
- add/strengthen explicit task phase in worker context;
- reject operations that skip required predecessor evidence;
- make "review" and "ship" distinct states so a green implementation cannot silently become merge/release authority.

### 2. Progressive disclosure of context

The context-engineering skill uses a hierarchy:
1. persistent rules;
2. relevant spec/architecture;
3. relevant source;
4. current errors/test output;
5. conversation history.

It explicitly recommends loading only the relevant spec/source slice and treating conversation as the least reliable accumulated layer.

KEYFLOWOS adaptation:
- aligns strongly with repository-as-canonical-memory;
- worker task packets should be compiled from canonical intelligence into a bounded context pack;
- every context pack should carry provenance, revision, confidence/authority, constraints, affected journeys/kernels, files, prior proof, and unresolved contradictions;
- stale verbose tool output should be discarded after extracting durable conclusions;
- fresh sessions should begin only at restartable task boundaries with durable handoff + actual git state.

This directly strengthens the existing Context Integrity Check and "MAP BEFORE MODIFYING" method rather than creating a second memory system.

### 3. Doubt-driven development

The source introduces a useful in-flight adversarial cycle:

CLAIM -> EXTRACT -> DOUBT -> RECONCILE -> STOP

The key mechanism is a **fresh-context reviewer biased to disprove**, given only the artifact and contract, not the author's reasoning. It also supports an optional cross-model second opinion.

KEYFLOWOS adaptation:
- formalize this inside the existing AI-review/reconciliation loop;
- use fresh-context review for non-trivial architectural claims, cross-module changes, security/auth/payment/deletion logic, concurrency/idempotency, migrations, and irreversible actions;
- ChatGPT, Claude Code and Kimi Code can be used as heterogeneous reviewers, but must read/write the same durable repository intelligence rather than maintain private architecture models;
- findings must be reconciled against evidence, not merely accepted because another model said them.

This is especially applicable to the project's "no fake green" directive.

### 4. Source-driven development

The source requires framework-specific implementation decisions to be verified against authoritative documentation rather than model memory.

KEYFLOWOS adaptation:
- external R&D should store source provenance and distinguish:
  - official/primary source;
  - project code evidence;
  - secondary research;
  - inference/hypothesis;
- framework/library claims entering an execution packet should carry source revision/date when materially version-sensitive;
- unverified external patterns remain research evidence, not architecture truth.

### 5. Constraint-driven development

The repository treats quality thresholds as an explicit contract decided once and enforced automatically.

KEYFLOWOS adaptation:
- convert critical project directives into machine-checkable constraints where possible;
- examples: no skipped required tests, no swallowed failures, no branch divergence, no unauthorized production effects, no weakening auth/payment/deletion invariants, no hidden fake-green state;
- distinguish hard blockers from advisory signals;
- gate-changing commits require explicit evidence and review.

### 6. Thin-slice incremental implementation

The source favors small vertical slices with tests, safe defaults, rollback paths and atomic commits.

KEYFLOWOS adaptation:
- continue bounded execution packets;
- inside a packet, prefer semantically complete slices with proof after each meaningful step;
- preserve change identity and proof lineage so partial progress cannot masquerade as completion;
- feature/refactor/security changes should not be silently mixed when that destroys reviewability.

### 7. Tests as proof, not ceremony

The source's TDD and verification stance is that "seems right" is not evidence.

KEYFLOWOS adaptation:
- each packet should map claims -> proof obligations -> commands/tests -> observed results;
- green status must be impossible if required proof was skipped, not run, stale, or only configuration-guard green;
- test output is execution evidence, not semantic proof by itself;
- maintain adversarial proof review for high-risk packets.

### 8. Stop-the-line debugging and recovery

The source's debugging workflow emphasizes reproduce -> localize -> reduce -> fix -> guard, with a stop-the-line posture when unexpected failure appears.

KEYFLOWOS adaptation:
- classify failures before continuing autonomous work;
- do not route around red checks, disable gates, or reframe partial success as completion;
- after a fix, add regression guard/evidence and reconcile the new behavior with canonical state;
- failure handling belongs in the same business/packet consequence model, not as an unrelated side system.

### 9. Security as a pervasive boundary contract

The security skill begins with threat modeling and explicitly treats LLM output and locally delivered values as potentially untrusted depending on who wrote them.

KEYFLOWOS adaptation:
- add trust-boundary provenance to KEY/agent tool inputs;
- treat external research, generated patches, provider callbacks, issue/PR text, CLI output, paths, and model-produced commands as data requiring policy/validation appropriate to their origin;
- preserve separate authorization for high-impact changes;
- strengthen destructive-path checks, secrets handling, SSRF protections, dependency provenance, and approval boundaries.

### 10. Documentation/ADR discipline

The source emphasizes recording why, alternatives, consequences, and supersession rather than just what code exists.

KEYFLOWOS adaptation:
- KEYFLOWOS already has richer canonical finding/contradiction/recommendation/decision artifacts than a conventional ADR system;
- do not introduce a parallel ADR taxonomy where canonical intelligence already owns the semantics;
- borrow the lifecycle property: decisions must be explicitly accepted/superseded/deprecated and historical rationale must remain recoverable.

### 11. Code simplification with Chesterton's Fence

The source warns against deleting or simplifying mechanisms without first understanding why they exist, and recommends behavior-preserving incremental simplification.

KEYFLOWOS adaptation:
- directly compatible with architecture-forensics and convergence work;
- classify a structure before removing it: core primitive, necessary specialization, projection, compatibility layer, redundant, accidental complexity, dead/low-value;
- use backward re-audit after simplification to detect broken hidden contracts.

### 12. Portable workflow core + host adapters

The repo separates shared workflow logic from host-specific integrations.

KEYFLOWOS adaptation:
- strong fit for ChatGPT + Claude Code + Kimi Code collaboration;
- canonical task/review/proof contracts should be tool-neutral;
- agent-specific wrappers should only translate those contracts into each host's native mechanism;
- do not let per-agent prompt files become independent sources of architectural truth.

## Patterns to *not* copy blindly

1. **Do not install all 25 skills wholesale into KEYFLOWOS and let them compete with existing governance.**
2. **Do not create a second lifecycle authority** beside current packets, control-plane admission, proof, and repository intelligence.
3. **Do not promote generic thresholds or heuristics to KEYFLOWOS law without local evidence.**
4. **Do not treat a model's adversarial review as proof.** It is hypothesis/finding generation until reconciled with code/tests/contracts.
5. **Do not duplicate KEYFLOWOS' canonical taxonomy with a new skill-specific registry.**
6. **Do not allow auto-routing to bypass explicit high-risk approval gates.**
7. **Do not confuse host adapter success with whole-system correctness.**

## Proposed convergence into the existing external-mining / R&D loop

External source ingestion should follow:

SOURCE DISCOVERY
-> provenance + license + revision capture
-> structure extraction
-> candidate pattern extraction
-> canonical anti-duplication classification
   (SAME / SPECIALIZATION / RELATED DISTINCT / IMPLEMENTATION ALIAS / HISTORICAL / GENUINELY NEW)
-> applicability map to KEYFLOWOS journeys/kernels/worker/control/proof systems
-> sandbox or bounded pressure test
-> candidate contract/recommendation
-> adversarial fresh-context review
-> cross-model review where warranted
-> reconciliation against repository evidence
-> backward re-audit
-> promote / reject / defer
-> write durable result back to docs/intelligence/
-> update task packet/context compiler only after acceptance.

This should be one loop, not a collection of independent research bots.

## Candidate concrete improvements

### A. Context-pack compiler
For every worker task, compile a bounded pack containing:
- packet/issue identity;
- current authoritative branch/head;
- affected journey/kernel/domain;
- source files and one analogous pattern;
- hard constraints and forbidden effects;
- unresolved contradictions;
- acceptance/proof obligations;
- exact verification commands;
- prior proof baseline;
- provenance and freshness for external guidance.

### B. Evidence-aware task state
Use explicit states such as:
DISCOVERED -> SCOPED -> PLANNED -> IMPLEMENTING -> VERIFYING -> ADVERSARIAL_REVIEW -> RECONCILING -> ADMITTED -> MERGE_ELIGIBLE -> MERGED

Transitions require evidence, not worker self-report.

### C. Fresh-context adversarial reviewer
Create a reusable review packet containing only:
- artifact/diff;
- target contract;
- relevant invariant/proof obligations;
- no author reasoning.

The reviewer must try to falsify the contract.

### D. Constraint ledger / anti-fake-green gate
Machine-enforce:
- required checks cannot be skipped silently;
- skipped != passed;
- configured-but-not-executed != passed;
- stale proof != current proof;
- partial success != completed;
- red blockers cannot be converted to green by reclassification without an explicit decision artifact.

### E. Source provenance registry
For mined repositories and external references capture:
- URL/repo;
- commit/tag/date;
- license;
- files/sections mined;
- extracted patterns;
- applicability;
- conflicts with current architecture;
- acceptance status;
- downstream packets/findings produced.

### F. Multi-agent adapter layer
One neutral contract, then adapters for:
- ChatGPT;
- Claude Code;
- Kimi Code;
- future agents.

Adapters may change syntax/tool invocation but not task semantics, proof obligations, or authority.

## Applicability to KEY

These patterns are not only development tooling. They are directly relevant to KEY as an autonomous operational agent:

- context packing -> KEY working memory selection;
- source-driven grounding -> evidence-aware reasoning;
- doubt cycle -> self/peer critique before consequential actions;
- constraints -> policy and business invariant enforcement;
- thin slices -> bounded execution;
- verification -> observable proof of completed effects;
- debugging/recovery -> failure consequence handling;
- provenance -> memory trust and source lineage;
- tool-neutral contracts -> expansion across apps/devices/providers.

KEY should therefore learn the **meta-process**: select the right workflow, gather bounded context, act under constraints, produce evidence, doubt non-trivial claims, reconcile failures, and write durable memory.

## Convergence verdict

**HIGH-VALUE SOURCE.**

Most individual engineering practices are not novel to KEYFLOWOS. The value is in how the repository packages them into portable, triggerable, verification-gated agent workflows.

The strongest import is therefore not "25 new skills". It is a design pattern:

> **Canonical engineering knowledge should be compiled into small, context-bounded, tool-neutral workflows with explicit triggers, hard gates, evidence requirements, fresh-context challenge, and durable writeback.**

That pattern should be folded into the existing KEYFLOWOS control/reconciliation/R&D architecture rather than added as a competing layer.
