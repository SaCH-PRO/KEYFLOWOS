# KEYFLOWOS Continuous Assurance, Security, Surveillance, Quality & Adaptation — Research Pass 001

Status: **RESEARCH / ARCHITECTURE CONVERGENCE — NO PRODUCTION CUTOVER AUTHORIZED**  
Live implementation reference: main@110532883411007787f62de35e0a951aa1c16cfa

Companion work:
- #97 KF-TEST-ARCH-001 — risk-based verification architecture
- #113 / PR #114 — proof integrity / no fake green
- #115 — native DAST
- #117 — dependency remediation
- #129 — Mission Control dashboard
- PR #120 — live state reducer / control-plane admission
- PR #127 / #122 — Memory M0 truth audit
- PR #128 — KEY cognitive convergence

## 1. Research question

How should KEYFLOWOS continuously establish confidence that:
1. software and infrastructure are secure;
2. claimed proof actually ran and supports the claim;
3. runtime behavior is observable enough to detect hidden failure;
4. quality is preserved across ordinary, adversarial, concurrent and rare-edge conditions;
5. failures can be debugged and reproduced quickly;
6. the system adapts after evidence without hiding defects or destabilizing itself;
7. KEY/AI behavior is evaluated with stronger standards than ordinary deterministic software where required?

"Surveillance" in this document means **authorized surveillance of KEYFLOWOS itself**: runtime state, security controls, agent actions, infrastructure, proof, workflows and system behavior. It does not mean covert surveillance of users.

## 2. Anti-duplication classification

This research does not propose another testing stack.

- **#97 Risk-Based Verification Architecture** — SAME CORE PROBLEM. Retain as the operational test/proof structure.
- **#113 / PR #114 Proof Integrity** — SPECIALIZATION. Makes evidence truthful.
- **#115 Native DAST** — SPECIALIZATION. Dynamic application-security proof.
- **#117 Dependency Remediation** — SPECIALIZATION. Supply-chain vulnerability response.
- **proof-admission evaluator** — CORE CANDIDATE for exact proof admission.
- **proof-mutation.mjs** — CORE CANDIDATE for anti-vacuity / negative-control proof.
- **ErrorRegistry / ErrorDigest** — IMPLEMENTATION PRECURSOR for runtime surveillance, not sufficient as final observability architecture.
- **EvalHarnessService / KEY quality/eval specs** — AI/KEY TEVV PRECURSORS.
- **#129 Mission Control** — READ MODEL / VISUALIZATION of assurance state, not the assurance engine.

The unifying concept in this document is an **Assurance Fabric**: a cross-cutting contract over existing verification, observability, security, debugging and adaptation mechanisms. It should not become one mega-service.

## 3. External research synthesis

### 3.1 NIST SSDF — security belongs in the lifecycle

NIST SP 800-218 treats secure software development as practices integrated into the SDLC rather than a late scanner.

KEYFLOWOS implication:
- security obligations derive before mutation;
- security proof is packet risk-dependent;
- root causes should feed future prevention, not only one-off fixes;
- design, implementation, verification and operational controls need one lineage.

### 3.2 OWASP ASVS + WSTG + API Security — verification requirements must be explicit and surface-aware

ASVS provides testable application-security requirements; WSTG provides practical web testing scenarios; API Security Top 10 highlights API-specific risks such as object-level authorization, authentication, resource exhaustion, function-level authorization, SSRF, misconfiguration, inventory drift and unsafe third-party API consumption.

KEYFLOWOS implication:
- security claims should bind to explicit requirement IDs/checks where useful;
- API route inventory and tenant/object authorization require first-class proof;
- connector growth increases "unsafe consumption of APIs" risk;
- deprecated/debug/orphaned endpoints are security inventory defects, not only cleanup debt.

### 3.3 OWASP CI/CD Security — the development control plane is a security boundary

CI/CD risk includes weak flow controls, IAM, dependency-chain abuse, poisoned pipeline execution, insufficient pipeline access controls, credential hygiene, insecure configuration, third-party service governance, artifact integrity and insufficient logging.

KEYFLOWOS implication:
- Issue #80/control-plane authority is security-critical;
- ChatGPT/Claude/Kimi workers are supply-chain functionaries;
- packet authority, worker identity, exact head, branch, proof and merge admission require audit;
- a compromised or stale worker must not manufacture an admissible green artifact.

### 3.4 SLSA + in-toto + Sigstore + TUF — proof needs provenance, identities, freshness and anti-rollback

SLSA formalizes software provenance: where, when and how artifacts were produced. in-toto uses signed layouts and step metadata to prove authorized supply-chain steps. Sigstore provides identity-linked, auditable artifact signing. TUF emphasizes role separation, signed metadata, versions, expiration, snapshot consistency and rollback/freeze resistance.

KEYFLOWOS implication:
- exact-head proof should evolve into an explicit attestation graph;
- every proof artifact needs source SHA, producer identity, workflow/run id, inputs, outputs, time and expiry/freshness;
- acceptance should reject rollback to older "green" evidence;
- proof lineage should distinguish source -> build -> test -> review -> admission -> deployment;
- the current exact-head / stale-report rules are already moving in this direction.

### 3.5 Assurance cases / GSN — "tests passed" is not the same as "claim proven"

Safety/assurance-case practice structures:
- claim;
- argument/rationale;
- evidence;
- context/assumptions;
- defeaters/counterarguments.

KEYFLOWOS implication:
Every material packet should ultimately produce a **Claim-Evidence Graph**, not merely a list of green jobs.

Example:

```text
CLAIM
Business A cannot mutate Business B's invoice
   |
   +-- argument: route guard + service ownership + DB scope
   |
   +-- evidence:
       static route inventory
       tenant integration test
       IDOR dynamic probe
       mutation removing guard -> proof fails
       exact-head CI receipt
```

This directly strengthens the no-fake-green model.

### 3.6 NIST AI RMF + TEVV — KEY needs continuous AI-specific evaluation

AI RMF organizes risk work around GOVERN, MAP, MEASURE and MANAGE. Its MEASURE function emphasizes rigorous, repeatable TEVV, uncertainty, benchmarks, independent review and continued measurement in operation. NIST's 2026 TEVV-Athlon draft extends this toward agentic and multimodal systems.

KEYFLOWOS implication:
ordinary software tests are not enough for KEY.

Need to evaluate:
- task success;
- tool correctness;
- permission compliance;
- hallucinated completion;
- evidence discipline;
- uncertainty calibration;
- long-horizon drift;
- adversarial prompt/tool inputs;
- memory poisoning;
- instruction hierarchy;
- agent coordination;
- repeated-action/idempotency safety;
- model/provider variation;
- refusal/approval correctness;
- regression across model changes.

### 3.7 NIST adversarial ML — AI attack surfaces differ from ordinary code

NIST's adversarial ML taxonomy covers evasion, poisoning, privacy, misuse and model/lifecycle attacks.

KEYFLOWOS implication:
KEY-specific adversarial tests should include:
- prompt injection from connectors/documents;
- memory poisoning;
- malicious tool output;
- compromised external source;
- jailbreak attempts to exceed authority;
- data exfiltration prompts;
- conflicting instructions;
- poisoned training/evaluation examples if adaptive learning is introduced.

### 3.8 OpenTelemetry — surveillance should correlate traces, metrics and logs

OpenTelemetry's core signal model includes traces, metrics, logs and baggage/context.

KEYFLOWOS implication:
move from isolated logs toward correlation:

```text
user/worker request
 -> trace
 -> packet/workflow/session id
 -> tool/model/database calls
 -> logs
 -> metrics
 -> external effect
 -> outcome
```

Every important action should be debuggable as a connected causal trail.

### 3.9 Google SRE — monitor what users experience and govern change with error budgets

SRE emphasizes latency, traffic, errors and saturation, with error budgets linking reliability to change velocity.

KEYFLOWOS implication:
- define SLOs for critical surfaces;
- reliability problems can temporarily reduce deployment/autonomy velocity;
- adaptation should be governed by measured health, not vague "system seems stressed";
- alert on user/business impact and actionable conditions rather than raw noise.

### 3.10 Chaos Engineering — prove resilience by disturbing assumptions

Chaos Engineering starts with a measurable steady state, injects realistic failures and looks for violation while minimizing blast radius.

KEYFLOWOS implication:
for R4/systemic packets, controlled failure injection should cover:
- Redis unavailable;
- DB slow/unavailable;
- provider timeout;
- duplicate webhook;
- queue delay/reorder;
- worker death;
- lease expiry;
- partial network failure;
- rate-limit exhaustion;
- stale cache;
- clock skew;
- one replica degraded;
- downstream malformed response.

Production experiments are **not automatically authorized**. Begin in ephemeral/staging environments and move to tightly bounded production-safe experiments only under explicit authority.

### 3.11 Property-based + fuzz testing — humans do not enumerate the edge state space well

Property-based systems generate inputs to test invariants, including edge cases. Coverage-guided fuzzing evolves inputs that reach new code paths.

KEYFLOWOS implication:
use generative testing for:
- parsers;
- money calculations;
- date/time logic;
- pagination;
- idempotency;
- state machines;
- authorization predicates;
- webhook payloads;
- file/import parsers;
- control-plane YAML/events;
- connector descriptors;
- memory evidence/lineage structures.

### 3.12 Mutation testing — prove the tests can detect the defect

Mutation testing deliberately alters code to see whether tests fail.

KEYFLOWOS already implements a strong native form in `proof-mutation.mjs`.

Research reinforces the principle:
> A proof that still passes when its target defect is restored is not evidence for that claim.

Expand selectively on critical invariants rather than chasing a global mutation score.

### 3.13 Jepsen/TLA+ lessons — concurrency requires model-based safety/liveness verification

Jepsen tests concurrent histories under network, clock and partial failures against declared consistency models. TLA+'s TLC model checker can check safety and liveness properties of state-machine specifications.

KEYFLOWOS implication:
the multi-agent control plane should test both:
- **safety** — bad things never happen;
- **liveness** — good things eventually happen.

Candidate control-plane invariants:
- at most one active semantic writer per packet unless explicitly delegated;
- stale authority cannot supersede newer authority;
- exact-head proof cannot become valid for a different head;
- independent packets cannot shadow each other;
- a valid released packet eventually becomes dispatchable;
- a dead worker lease eventually becomes recoverable;
- join/convergence eventually resolves or exposes a typed contradiction.

Use executable/model tests where the state space justifies them; do not formalize trivial CRUD.

### 3.14 Risk-based software assurance

FDA's 2026 Computer Software Assurance guidance is useful outside its regulated scope as an engineering analogy: testing rigor should follow intended use and risk, and records should preserve objectives, results, issues and conclusions rather than maximizing paperwork.

This aligns closely with #97's R0-R4 model.

## 4. Target model — Continuous Assurance Loop

```text
                 DESIGN / PLAN
                      |
                      v
             THREAT + RISK MODEL
                      |
                      v
            PROOF OBLIGATION COMPILER
                      |
                      v
IMPLEMENT -----> PRE-MERGE VERIFICATION
  |                   |
  |                   +-- static / type / schema
  |                   +-- unit / property / mutation
  |                   +-- integration / contract
  |                   +-- auth / tenant / DAST
  |                   +-- fuzz / edge / concurrency
  |                   +-- AI TEVV
  |                   +-- resilience where risk demands
  |                   |
  |                   v
  |             CLAIM-EVIDENCE GRAPH
  |                   |
  |                   v
  |               ADMISSION
  |                   |
  v                   v
DEPLOY ----------> RUNTIME SURVEILLANCE
                      |
                      +-- traces / metrics / logs
                      +-- SLOs / error budget
                      +-- security signals
                      +-- external-effect reconciliation
                      +-- drift / anomaly / quality
                      |
                      v
                INCIDENT / DEFECT?
                  /          \
                no            yes
                |              |
                v              v
          continued        DEBUG / REPLAY
          operation           |
                              v
                       ROOT-CAUSE CLASSIFY
                              |
                              v
                         ADAPT / REPAIR
                              |
                              v
                       NEW REGRESSION PROOF
                              |
                              +-------> loop
```

The loop is continuous. "Done" means proven at a declared scope and monitored after release, not proven forever.

## 5. Assurance planes

### A1 — Preventive Security & Threat Modeling
Owns:
- attack-surface inventory;
- trust boundaries;
- STRIDE-style threat discovery where useful;
- secure defaults;
- least privilege;
- tenant isolation;
- secrets;
- dependency/supply-chain policy;
- connector/tool threat models;
- AI-specific attack surfaces.

### A2 — Verification & Proof Integrity
Owns:
- R0-R4 proof derivation;
- exact-head binding;
- required-case manifests;
- skipped/partial/unknown semantics;
- negative controls;
- proof freshness;
- producer identity;
- claim/evidence linkage;
- independent review.

### A3 — Runtime Assurance Surveillance
Owns:
- traces;
- metrics;
- logs;
- error registry;
- health/readiness;
- queue/worker metrics;
- security/audit events;
- external provider certainty;
- model/tool latency/error/cost;
- SLOs;
- anomaly signals;
- freshness of monitors themselves.

### A4 — Edge, Adversarial & Failure Testing
Owns techniques:
- boundary/equivalence;
- property-based;
- fuzzing;
- malformed inputs;
- adversarial auth/tenant cases;
- concurrency races;
- time/clock tests;
- partial failure;
- chaos/fault injection;
- load/stress/spike/soak;
- retry/idempotency;
- replay/out-of-order;
- unusual browser/device/network state.

### A5 — Debugging & Forensics
Owns:
- correlation IDs;
- request/packet/workflow trace;
- deterministic seed capture;
- failing-input retention;
- relevant state snapshot;
- exact code/config/model version;
- logs/traces/metrics around failure;
- causal event chain;
- replay harness;
- bisect support;
- incident timeline;
- root-cause and contributing-factor record.

### A6 — Product & Quality Assurance
Owns:
- functional correctness;
- critical E2E journeys;
- accessibility;
- compatibility;
- usability/UAT;
- latency;
- data correctness;
- empty/error/loading/degraded states;
- documentation/contracts;
- regression and reachability;
- "registered vs reachable" checks.

### A7 — Adaptation, Recovery & Release Safety
Owns:
- feature flags;
- canary/shadow mode;
- gradual rollout;
- circuit breakers;
- kill switches;
- rollback;
- degraded mode;
- error budget;
- recovery verification;
- learning from incidents;
- safe promotion of temporary fixes.

### A8 — KEY / AI TEVV
Owns:
- benchmark/eval datasets;
- scenario suites;
- adversarial AI tests;
- calibration;
- tool-use correctness;
- authority compliance;
- memory epistemics;
- multi-agent/specialization behavior;
- model/provider regression;
- nondeterministic repeated trials;
- long-horizon tasks;
- safety/reliability thresholds.

These planes are logical ownership categories, not eight new services.

## 6. Assurance Claim contract

Every high-risk requirement should be representable as:

```ts
interface AssuranceClaim {
  claimId: string;
  packetId: string;
  statement: string;
  risk: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  scope: string[];
  assumptions: string[];
  threats: string[];
  requiredEvidence: EvidenceRequirement[];
  counterEvidence: EvidenceRef[];
  verdict: 'PROVEN' | 'PARTIAL' | 'NOT_RUN' | 'NOT_APPLICABLE' |
           'HUMAN_GATED' | 'FAILED' | 'UNKNOWN' | 'STALE';
  sourceHead: string;
  validUntil?: string;
}
```

Evidence itself needs:
- evidence id;
- type;
- producer identity;
- exact source head/build;
- environment;
- command/test identity;
- inputs/config hashes;
- run id;
- started/finished timestamps;
- result;
- artifacts;
- applicability scope;
- freshness;
- signature/attestation where available.

## 7. Proof obligation compiler

Extend #97 from a static risk matrix into deterministic proof derivation.

Inputs:

```text
risk tier
changed paths
affected modules
authority surface
tenant/data sensitivity
money/payment effect
external effect
migration/schema change
connector change
agent/AI change
concurrency change
runtime/infrastructure change
UI/user journey change
```

Output:

```text
mandatory static checks
mandatory test suites
required security probes
required negative controls
required AI evals
required failure tests
required post-deploy checks
required independent review
required human/UAT gates
```

A packet cannot self-declare lower proof after seeing an inconvenient test requirement.

## 8. Edge-state matrix

For every material state machine/API/workflow, generate tests across axes rather than hand-selecting a few cases.

Candidate axes:
- minimum / maximum / zero / negative / overflow / precision;
- missing / null / blank / malformed / duplicate;
- unauthorized / expired / revoked / wrong tenant;
- first / middle / last / empty page;
- past / now / future / timezone / DST / clock skew;
- single / duplicate / replay / out-of-order / delayed;
- success / timeout / 4xx / 5xx / malformed provider response;
- DB available / slow / transient failure / unavailable;
- queue healthy / delayed / duplicate / poison message;
- worker alive / crash / lease expired / restart;
- one replica / multiple replicas / leader conflict;
- model/provider success / refusal / timeout / malformed tool call;
- user cancels / retries / double-clicks / refreshes mid-action;
- browser online / offline / reconnect;
- schema old / current / forward-compatible extra fields.

Use pairwise/combinatorial generation where full Cartesian products are infeasible.

## 9. Security surveillance

Continuously watch for:
- auth failures and unusual privilege transitions;
- cross-tenant access attempts;
- secret-redaction failures;
- dependency advisories;
- new public routes/endpoints;
- changed guards/scopes;
- unexpected outbound destinations;
- connector scope expansion;
- repeated denied actions;
- suspicious AI/tool invocation patterns;
- webhook signature failures/replay;
- anomalous data export volume;
- runtime configuration drift;
- CI/control-plane authority anomalies.

Signals are evidence for investigation, not automatic proof of compromise.

## 10. Debug Evidence Capsule

Every serious failure should produce a bounded machine-readable capsule:

```text
incident_id
correlation_id
packet/workflow/session
source_sha / build / deploy
model/provider/version if AI
tenant/scope identifiers (redacted as required)
trigger
expected invariant
observed violation
event timeline
relevant logs
trace ids
metric window
state-machine state
external provider evidence
input hash / replay fixture
random seed
feature flags/config
worker/replica identity
dependency versions
first_seen / last_seen
reproducibility
suspected causal chain
```

The capsule should enable:
`DETECT -> REPRODUCE -> LOCALIZE -> FIX -> REGRESSION PROVE -> VERIFY RECOVERY`.

## 11. Runtime surveillance hierarchy

### Level 0 — health
Process up, DB/Redis reachable.

### Level 1 — golden signals
Latency, traffic, errors, saturation.

### Level 2 — business/semantic health
Examples:
- invoice/payment reconciliation;
- webhook backlog;
- stale obligations;
- failed external effects;
- memory ingestion lag;
- worker queue lag;
- unreviewed agent actions.

### Level 3 — invariant monitors
Examples:
- cross-tenant impossible-state detector;
- duplicate financial effect detector;
- stale authority detector;
- double execution detector;
- contradictory state projection;
- proof artifact mismatch.

### Level 4 — predictive/anomaly
Statistical/AI anomaly detection.

Higher levels do not replace lower deterministic monitors.

## 12. Adaptability without self-deception

Adaptation must follow:

```text
OBSERVE
 -> DIAGNOSE
 -> CONTAIN
 -> CHOOSE bounded adaptation
 -> APPLY reversibly
 -> VERIFY
 -> MONITOR
 -> PROMOTE or ROLLBACK
```

Possible adaptations:
- reduce concurrency;
- change retry/backoff;
- fail over provider;
- enter degraded mode;
- increase logging/sampling;
- activate a regulatory response program;
- route to stronger model;
- require additional evidence;
- temporarily lower autonomy;
- change polling rate;
- disable a faulty connector;
- roll back a release.

Hard rule:

> adaptation may change operating configuration; it may not redefine the success criterion that exposed the failure.

This directly preserves "a failing gate is information."

## 13. Quality state is multidimensional

Never collapse quality to "tests green".

Candidate dimensions:
- functional correctness;
- security;
- tenant isolation;
- data integrity;
- financial correctness;
- reliability;
- resilience;
- performance;
- observability;
- accessibility;
- usability;
- compatibility;
- maintainability;
- proof integrity;
- AI calibration;
- external-effect certainty.

Mission Control (#129) should visualize these independently where material.

## 14. AI / agent-specific test families

KEY needs suites for:

### Identity / authority
- instruction hierarchy;
- user/tenant boundaries;
- approval requirements;
- tool scope;
- attempted privilege escalation.

### Epistemics
- unsupported claims;
- stale memory;
- conflicting sources;
- repeated rumor vs independent evidence;
- confidence calibration;
- evidence eligibility.

### Tool use
- exact schema;
- wrong tool;
- missing tool;
- unsafe argument;
- hallucinated completion;
- partial provider success;
- external effect not observed;
- idempotent replay.

### Long-horizon agency
- goal drift;
- forgotten constraints;
- retry loops;
- duplicated subtasks;
- worker disagreement;
- stale plan after world change;
- cancellation;
- budget exhaustion.

### Adversarial
- prompt injection in email/document/web page;
- malicious tool output;
- connector poisoning;
- memory poisoning;
- exfiltration request;
- instruction conflict;
- multi-agent collusion/confirmation bias.

### Adaptation
- model/provider switch;
- new skill/receptor;
- procedure promotion;
- memory consolidation;
- learning after failure;
- rollback after degraded eval.

## 15. Release policy candidates

### R0/R1
Fast proof, no heavy runtime experiment unless affected surface requires it.

### R2
Integration/contract/regression + targeted runtime checks.

### R3
Security/tenant, dynamic probes, negative controls, critical E2E, exact-head proof, post-deploy verification.

### R4
All applicable R3 proof plus:
- concurrency/state-machine proof;
- fault injection/resilience;
- observability proof;
- recovery/rollback proof;
- independent semantic review;
- post-deploy canary/health;
- incident/debug capsule readiness.

## 16. Immediate implementation packets

### ASSURANCE-MAP-001 — inventory and coverage map
Map current:
- tests;
- CI checks;
- DAST;
- negative controls;
- security scanners;
- observability;
- health endpoints;
- runtime monitors;
- AI evals;
- deployment verification.

Output: capability/coverage matrix with reachable vs dormant vs missing.

### ASSURANCE-CLAIMS-001 — Claim-Evidence schema
Add machine-readable assurance claim + evidence receipt contracts, initially read-only/CI-generated.

### ASSURANCE-COMPILER-001 — proof obligation compiler
Compile R0-R4 + affected surfaces into mandatory proof manifest.

### ASSURANCE-EDGE-001 — edge/fault generation
Add reusable property/fuzz/boundary/concurrency fixtures for high-risk parsers, auth, tenancy, money, idempotency and control-plane state.

### ASSURANCE-OBS-001 — correlated observability
Design and then implement trace/metric/log correlation. Prefer open standards; do not onboard an external SaaS merely to claim observability.

### ASSURANCE-DEBUG-001 — debug evidence capsule
Generate reproducible evidence packages for failed CI/runtime invariants.

### ASSURANCE-AI-TEVV-001 — KEY eval matrix
Map K1-K7 to functional, adversarial, calibration, tool-use, memory, authority and long-horizon evals.

### ASSURANCE-RESILIENCE-001 — failure/chaos harness
Ephemeral/staging fault injection first; production-safe experiments only later under explicit authorization.

### ASSURANCE-RUNTIME-001 — SLO/error-budget policy
Define critical service SLOs and use error-budget state to modulate release/autonomy velocity.

## 17. Integration with Mission Control (#129)

Add an Assurance view:
- proof truth;
- security posture;
- observability freshness;
- open incidents;
- error budget;
- coverage by R0-R4;
- exact-head stale proof;
- mutation controls live/vacuous;
- DAST route coverage;
- unresolved vulnerabilities;
- KEY TEVV trend;
- edge/fuzz findings;
- top recurring runtime signatures;
- recovery confidence.

Progress bars must remain evidence-backed:
- "58/63 required security requirements proven", not "security 92%" without a defined denominator.

## 18. Current repo strengths

Current main already contains important foundations:
- unit/smoke/integration/e2e categorization;
- shuffled unit-test order;
- test-config coverage gates;
- skip-as-failure expectation;
- proof-admission evaluator;
- stale-report rejection;
- negative/mutation proof runner;
- native DAST work in progress;
- attack-focused tenant/connector/webhook integration tests;
- uptime/runtime playbook history;
- bounded error registry/digest;
- KEY quality/eval tests.

The research direction is therefore **convergence and expansion**, not replacement.

## 19. Current gaps to verify before implementation

- no evidence of a repo-wide OpenTelemetry implementation on current main;
- existing ErrorRegistry is in-process and bounded, so multi-instance/durable correlation remains limited;
- Playwright E2E is documented as not in CI;
- the historical StackHawk DAST path was soft/dormant; native DAST work is intended to replace required dependence on it;
- risk-derived automatic proof selection from #97 is not yet admitted;
- supply-chain attestations/signatures are not yet a canonical admission input;
- broad property/fuzz/chaos infrastructure is not yet a project-wide standard;
- KEY TEVV is fragmented across eval/quality specs and services;
- production audit playbook is currently explicitly halted and must not be silently revived.

## 20. Hard invariants

1. No fake green.
2. Missing proof is not passing proof.
3. Stale proof is not current proof.
4. A test that cannot fail its target defect is not proof of that defect.
5. Security scanning cannot substitute for authorization/tenant tests.
6. Observability cannot substitute for correctness.
7. Monitoring failure must itself be visible.
8. Runtime adaptation cannot weaken the invariant that detected failure.
9. A rollback must have evidence that the rollback state is acceptable.
10. More telemetry is not inherently better; collect what is useful, authorized and privacy-safe.
11. AI confidence is not proof.
12. Independent agreement is evidence only when sources are genuinely independent.
13. Production experiments require bounded blast radius and explicit authority.
14. Supply-chain evidence needs identity, provenance and freshness.
15. Every high-impact action must remain causally traceable from authority -> execution -> external effect -> outcome.
16. Security/quality findings are preserved until fixed, explicitly accepted, superseded or proven false; never hidden by a green aggregate.


## 21. Defensive doctrine parallel — immune systems, mission command, cyber defense and fault-tolerant engineering

This section treats immune systems, military command-and-control, defensive cyber doctrine and aerospace fault management as **engineering analogies for defensive resilience and coordinated response**. It does not authorize offensive action against third-party systems.

### 21.1 Immune-system parallel

The strongest immune-system mapping is not "find enemy -> destroy enemy". It is:

```text
BARRIER
  -> RECOGNIZE
  -> CLASSIFY
  -> CONTAIN
  -> SIGNAL
  -> ESCALATE
  -> TARGET
  -> REMEMBER
  -> RESOLVE
  -> RESTORE HOMEOSTASIS
```

Useful parallels:

| Immune concept | KEYFLOWOS assurance interpretation |
|---|---|
| epithelial/barrier defense | auth, validation, sandboxing, schema boundaries, rate limits |
| pattern-recognition receptors | deterministic invariant/anomaly detectors |
| PAMP/DAMP-style danger signals | external threat signals + internal damage/failure signals |
| innate immunity | fast generic deterministic containment |
| complement/cytokine signaling | event/alert/regulatory-program propagation |
| adaptive immunity | targeted learned countermeasures and precise regression proof |
| clonal expansion | temporary up-regulation of relevant workers/receptors/tests |
| immune memory | incident signatures, regression tests, defensive procedures, known-bad patterns |
| trained immunity | reversible short/medium-term defensive priming after an incident |
| regulatory T cells/tolerance | false-positive control, self/non-self discipline, prevention of autoimmune overreaction |
| inflammation | incident mode: heightened observability/containment at a real resource cost |
| resolution/homeostasis | de-escalation, repair, reconciliation, return to normal |
| tissue repair | recovery, data repair, reprocessing, compensation |
| quarantine/apoptosis analogy | isolate or disable a compromised component while preserving the wider system |

#### Critical lesson — defense needs tolerance

A system that treats every novelty as hostile becomes autoimmune.

Therefore:
- UNKNOWN != MALICIOUS;
- ANOMALY != COMPROMISE;
- DISAGREEMENT != ATTACK;
- NEW CONNECTOR != TRUSTED;
- FAILED PROBE != SYSTEM-WIDE INCIDENT by itself.

Escalation should require corroborating evidence, persistence, severity or high-confidence invariant violation.

#### Immune memory hierarchy

```text
single weak anomaly
    -> transient signal

repeated anomaly
    -> trained defensive posture

confirmed incident
    -> durable incident memory + regression test

repeated confirmed class
    -> promoted defensive procedure / detector

constitutional lesson
    -> policy change only through governed acceptance
```

Temporary defensive priming must decay unless evidence supports promotion.

### 21.2 Military command-and-control parallel

Army mission-command doctrine emphasizes shared understanding, clear intent, disciplined initiative, prudent risk and subordinate freedom of action within commander's intent. Marine doctrine emphasizes friction, uncertainty, disorder and the impossibility of perfect information.

The useful KEYFLOWOS translation is:

```text
COMMANDER'S INTENT
    =
constitutional invariants + objective + end state

MISSION ORDERS
    =
bounded packets/contracts

DISCIPLINED INITIATIVE
    =
worker autonomy inside authority + risk + scope

COMMAND AND CONTROL
    =
project/control-plane authority + telemetry + state reducer

FOG / FRICTION
    =
missing, stale, contradictory or delayed information

UNITY OF EFFORT
    =
different workers/systems converge on one objective without requiring one process
```

Implication for ChatGPT/Claude/Kimi/KEY workers:
- central authority should specify purpose, non-negotiable constraints and end state;
- workers should not need micro-orders for every local decision;
- workers may adapt locally when the plan meets reality;
- local initiative never permits rewriting constitutional or safety boundaries;
- uncertainty is expected and must be represented, not fabricated away.

### 21.3 Defense in depth and layered security

NIST cyber-resiliency engineering emphasizes the ability to anticipate, withstand, recover from and adapt to adverse conditions. It also explicitly discusses redundancy, diversity, layering and partitioning.

KEYFLOWOS should treat security as overlapping independent defenses:

```text
IDENTITY / AUTH
      |
LEAST PRIVILEGE / SCOPES
      |
INPUT / MESSAGE HARDENING
      |
TENANT / OBJECT AUTHORIZATION
      |
SANDBOX / ISOLATION
      |
RUNTIME INVARIANT MONITORS
      |
AUDIT / TELEMETRY
      |
EFFECT VERIFICATION
      |
RECOVERY / ROLLBACK
```

No single layer is allowed to claim the system secure.

### 21.4 Compartmentalization and fault-containment regions

Military compartmentalization, zero trust and aerospace fault-containment all point to the same engineering rule:

> compromise/failure should be prevented from automatically becoming system-wide compromise/failure.

Candidate containment boundaries:
- tenant;
- connector;
- credential/grant;
- workflow;
- packet;
- worker;
- tool;
- model provider;
- database transaction;
- queue;
- deployment replica;
- memory scope;
- business domain.

A failing compartment should:
1. stop or degrade locally;
2. preserve evidence;
3. prevent propagation;
4. retain communication/control path;
5. request recovery/escalation when needed.

### 21.5 Defensive reconnaissance / ISR parallel

Military intelligence, surveillance and reconnaissance maps to **authorized system awareness**:

- logs;
- traces;
- metrics;
- health checks;
- audit events;
- connector/provider status;
- dependency/security advisories;
- branch/CI state;
- worker heartbeat;
- business-semantic invariants;
- external-effect reconciliation.

The principle is not "collect everything".

Collect information that improves:
- detection;
- localization;
- decision quality;
- recovery;
- proof.

Overcollection increases noise, cost and privacy risk.

### 21.6 Rules of engagement

Military rules of engagement map cleanly to KEY action policy:

```text
WHAT action is allowed?
WHO may authorize it?
UNDER WHAT evidence?
AGAINST WHICH scoped object?
WITH WHAT risk ceiling?
FOR HOW LONG?
WHAT requires human approval?
WHAT happens when the situation changes?
```

For KEY:
- tool availability != permission;
- model recommendation != authorization;
- emergency mode does not imply unlimited authority;
- uncertain target identity must fail closed for high-impact actions.

### 21.7 Reserves, redundancy and diversity

A resilient force does not commit every resource continuously; NIST/NASA similarly support redundancy and diversity.

KEYFLOWOS needs strategic reserve:
- spare worker capacity;
- provider failover;
- queue capacity;
- database/Redis recovery options;
- alternate connector binding;
- rollback artifacts;
- human override;
- emergency compute budget.

Redundancy should not be homogeneous only. If every fallback shares one failure mode, it is false redundancy.

Examples:
- multiple identical AI calls are not independent review;
- two replicas with the same poisoned config are not meaningful diversity;
- two proof jobs reading the same stale artifact are not two proofs.

### 21.8 Combined-arms / multi-capability defense

Military planning integrates multiple warfighting functions rather than assuming one arm solves every problem.

KEYFLOWOS equivalent:

```text
SECURITY
+ PROOF
+ OBSERVABILITY
+ RUNTIME RESILIENCE
+ DATA INTEGRITY
+ HUMAN AUTHORITY
+ AI TEVV
+ RECOVERY
= ASSURANCE
```

Security scanner alone is not defense.
Tests alone are not assurance.
Observability alone is not correctness.
AI reviewer alone is not proof.

The power comes from coordinated, partially independent layers.

### 21.9 Battle damage assessment / external-effect certainty

After an action, a military system needs to know what actually happened. KEYFLOWOS already has the analogous external-reality problem.

Maintain:

```text
INTENDED EFFECT
 !=
COMMAND / REQUEST SENT
 !=
PROVIDER ACCEPTED
 !=
EXTERNAL REALITY OBSERVED
 !=
BUSINESS OUTCOME
```

The assurance system should perform the equivalent of battle-damage assessment as **effect reconciliation**, without assuming API success equals outcome success.

### 21.10 Wargaming / red teaming

Wargaming is valuable because plans are tested against uncertainty and opposing behavior before reality forces the lesson.

KEYFLOWOS equivalents:
- threat modeling;
- adversarial review;
- chaos experiments;
- fault injection;
- tabletop incident exercises;
- simulated hostile/malformed connector input;
- prompt-injection exercises;
- multi-agent race scenarios;
- recovery drills;
- rollback drills;
- dependency outage scenarios.

The red team should attempt to falsify the assurance claim, not merely verify the happy path.

### 21.11 Tempo and readiness

Military doctrine recognizes that high tempo cannot be sustained indefinitely. Immune systems likewise pay a cost for prolonged activation.

KEYFLOWOS should explicitly manage defensive/operational tempo:

```text
NORMAL
HEIGHTENED
INCIDENT
CONTAINMENT
RECOVERY
```

Each readiness state can modulate:
- sampling/telemetry;
- worker concurrency;
- proof depth;
- autonomy;
- tool availability;
- review strictness;
- deployment velocity;
- retention;
- human escalation.

Prolonged heightened state contributes to allostatic/operational load and must not become silent normality.

### 21.12 Logistics is part of assurance

Military operations fail without logistics. KEYFLOWOS security/quality also depend on:

- compute;
- tokens/model quota;
- API rate limits;
- storage;
- bandwidth;
- CI minutes;
- worker slots;
- database capacity;
- credential lifecycle;
- human reviewer attention;
- recovery time.

The Assurance Fabric should model these as finite resources. A defense that exhausts the system can become a failure mechanism itself.

### 21.13 Mission-critical vs survival-critical functions

NASA fault-management practice distinguishes levels of criticality and uses redundancy, fault containment, graceful degradation and safe states.

KEYFLOWOS should classify functions such as:

**Survival / constitutional**
- identity/auth;
- tenant isolation;
- data integrity;
- audit/provenance;
- safe shutdown/hold;
- operator control;
- recovery path.

**Mission-critical**
- core business workflows;
- control-plane coordination;
- memory/world-model consistency;
- payment/accounting correctness;
- connector effect certainty.

**Degradable**
- optional analytics;
- cosmetic UI;
- non-critical recommendations;
- background enrichment.

When resources/faults force a choice, preserve survival/constitutional capabilities first.

### 21.14 Fail-safe, fail-secure, fail-operational and graceful degradation

One failure response is not correct for every subsystem.

#### FAIL-SAFE
Move to the state with least unacceptable harm.

Example:
- destructive KEY action becomes blocked pending review.

#### FAIL-SECURE
Preserve security even if availability suffers.

Example:
- auth/tenant proof unavailable -> deny access rather than infer permission.

#### FAIL-OPERATIONAL
Continue essential service through one or more faults.

Example:
- one model provider fails -> approved alternate provider serves low-risk work.

#### GRACEFUL DEGRADATION
Preserve a smaller mission set rather than crash or falsely claim normality.

Example:
- connector outage -> read cached last-known state with STALE marker; disable writes; continue unrelated domains.

The correct mode must be declared per function/risk.

### 21.15 Safe mode / survival kernel

Borrowing directly from spacecraft fault management, KEYFLOWOS should define a minimal **survival kernel**.

If systemic uncertainty is high, the platform should be able to enter a safe sustainable state that preserves:
- authentication;
- tenant boundaries;
- durable data;
- audit/evidence;
- read-only diagnostics;
- operator communication;
- rollback/recovery;
- critical financial integrity.

Temporarily suspend or constrain:
- autonomous high-risk actions;
- unverified external writes;
- self-modification;
- nonessential background tasks;
- aggressive concurrency.

Safe mode must be recoverable, observable and explicitly exited.

### 21.16 Watchdogs, tripwires and canaries

Defensive tripwires should detect failure before large damage:

- stale worker heartbeat;
- duplicate semantic writer;
- unexpected new public route;
- secret exposure canary;
- cross-tenant impossible-state monitor;
- duplicate financial effect detector;
- exact-head proof mismatch;
- deployment drift;
- connector scope expansion;
- anomalous outbound destination;
- sustained queue saturation.

A tripwire triggers investigation/containment according to severity; it does not itself prove hostile intent.

### 21.17 Two-key / multi-party control for catastrophic actions

High-impact operations can borrow the logic of independent authorization.

Candidate use:
- production destructive migration;
- mass deletion;
- broad credential rotation;
- disabling tenant/security boundaries;
- self-modifying control-plane policy;
- financial bulk action;
- emergency override.

For extreme-risk actions:

```text
PROPOSER
   !=
SECOND INDEPENDENT AUTHORIZER
   !=
EXECUTION RECEIPT
```

The second key must be genuinely independent, not another model call with the same authority/context.

### 21.18 Tactical utility / response selection

Defense should be proportional and useful.

Every response option can be scored on:

```text
expected harm prevented
+ information gained
+ reversibility
+ containment value
- collateral operational cost
- false-positive cost
- resource consumption
- recovery difficulty
```

This prevents maximum-force responses to low-confidence anomalies.

Candidate response ladder:

```text
OBSERVE
 -> VERIFY
 -> INCREASE SENSING
 -> RATE-LIMIT
 -> REQUIRE EXTRA AUTH
 -> ISOLATE COMPONENT
 -> HOLD EFFECTS
 -> FAILOVER
 -> ROLLBACK
 -> SAFE MODE
 -> HUMAN EMERGENCY CONTROL
```

### 21.19 Friendly-fire / self-generated-effect control

The system must distinguish its own actions from external threats.

Every internally generated effect should carry:
- causation id;
- initiating actor;
- packet/workflow id;
- expected affected resources;
- expected telemetry signatures;
- expiry.

This lets surveillance identify expected self-generated change versus unexplained change.

It also prevents KEY from interpreting its own automated actions as a new external incident.

### 21.20 Defensive deception and canarying

Defensive deception can be used narrowly for detection:
- honeytokens;
- canary records;
- unused sentinel credentials;
- decoy endpoints inside controlled environments;
- impossible-state markers.

Any access/use creates a high-signal alert.

These are defensive tripwires only. They must not be used to interfere with third-party systems.

### 21.21 After-action review and doctrine evolution

Every material incident, failed rollout, escaped defect or successful recovery should yield:

```text
WHAT WAS EXPECTED?
WHAT ACTUALLY HAPPENED?
WHY?
WHAT SIGNALS WERE MISSED?
WHAT CONTAINMENT WORKED?
WHAT FAILED?
WHAT SHOULD CHANGE?
WHAT SHOULD NOT CHANGE?
WHAT NEW TEST / MONITOR / PROCEDURE IS JUSTIFIED?
```

Lessons then move through:

```text
incident evidence
 -> finding
 -> regression proof
 -> procedure
 -> repeated evidence
 -> policy/doctrine proposal
 -> governed acceptance
```

One incident should not rewrite doctrine automatically.

### 21.22 Proposed Defense Coordination Kernel contract

Do not create a new sovereign service immediately. Conceptually, the Assurance Fabric needs a coordinator that can compile a threat/failure situation into a bounded response program.

Candidate:

```ts
interface DefensiveResponseProgram {
  id: string;
  triggerEvidence: EvidenceRef[];
  incidentClass: string;
  confidence: number;
  affectedScopes: string[];
  readinessState: 'NORMAL' | 'HEIGHTENED' | 'INCIDENT' | 'CONTAINMENT' | 'RECOVERY';
  missionCriticality: 'DEGRADABLE' | 'MISSION_CRITICAL' | 'SURVIVAL_CRITICAL';
  containment: ResponseAction[];
  receptorModulation: Modulation[];
  authorityModulation: Modulation[];
  concurrencyModulation: Modulation[];
  proofEscalation: EvidenceRequirement[];
  failMode: 'FAIL_SAFE' | 'FAIL_SECURE' | 'FAIL_OPERATIONAL' | 'GRACEFUL_DEGRADATION';
  fallbackState?: string;
  ttl: string;
  exitCriteria: EvidenceRequirement[];
  recoveryPlan: ResponseAction[];
}
```

This should compose with the Regulatory Program architecture already defined for KEY rather than duplicating it.

### 21.23 Defensive invariant summary

1. Detect early, but do not confuse detection with proof.
2. Contain locally before escalating globally when safe.
3. Preserve a command/control and recovery channel.
4. Maintain strategic reserve.
5. Prefer layered partially independent defenses.
6. Treat uncertainty as real state.
7. Let bounded workers exercise disciplined initiative.
8. Never let local initiative override constitutional intent.
9. Match response force to confidence, severity and reversibility.
10. Recover deliberately; do not remain permanently inflamed.
11. Convert confirmed incidents into memory/tests, not reflexive permanent restrictions.
12. Protect against autoimmunity/false positives as seriously as underreaction.
13. Preserve mission-essential/survival functions under degradation.
14. Require stronger fault tolerance as consequence severity rises.
15. Every action needs after-action/effect reconciliation.

## 22. Research-derived additions to the Assurance programme

Add the following to #130 execution planning:

### ASSURANCE-DEFENSE-MAP-001
Map current mechanisms to:
- barrier;
- detector;
- containment;
- escalation;
- adaptive response;
- memory;
- tolerance;
- recovery.

Find immune/security gaps where detection has no containment, or containment has no recovery.

### ASSURANCE-SAFE-MODE-001
Define KEYFLOWOS survival kernel, safe-mode entry/exit and degraded-operation contracts.

### ASSURANCE-FAULT-TOLERANCE-001
Assign required fault tolerance by criticality:
- degradable;
- mission-critical;
- survival-critical.

Identify single points of failure and false/homogeneous redundancy.

### ASSURANCE-READINESS-001
Integrate NORMAL / HEIGHTENED / INCIDENT / CONTAINMENT / RECOVERY readiness into the Regulatory Program framework.

### ASSURANCE-WARGAME-001
Create repeatable tabletop/simulation scenarios against:
- control plane;
- memory;
- connectors;
- payment/financial effects;
- AI authority;
- tenant boundaries;
- deployment/runtime.

### ASSURANCE-AAR-001
Standardize after-action evidence and promotion of lessons into tests/procedures/policy proposals.

### ASSURANCE-TACTICAL-UTILITY-001
Create proportional response selection based on severity, confidence, reversibility, blast radius, information value and resource cost.

### ASSURANCE-INDEPENDENT-CONTROL-001
Define multi-party/two-key rules for catastrophic operations and prove independence of authorizers.


## 23. Reference set

Primary/authoritative sources:
- NIST SP 800-218 SSDF — https://csrc.nist.gov/pubs/sp/800/218/final
- NIST SP 800-137 ISCM — https://csrc.nist.gov/pubs/sp/800/137/final
- NIST AI RMF 1.0 — https://www.nist.gov/itl/ai-risk-management-framework
- NIST TEVV-Athlon draft — https://www.nist.gov/artificial-intelligence/ai-research/tevv-athlon-framework-evaluating-ai-systems
- NIST AI 100-2e2025 — https://csrc.nist.gov/pubs/ai/100/2/e2025/final
- OWASP ASVS — https://owasp.org/projects/asvs
- OWASP WSTG — https://owasp.org/projects/web-security-testing-guide
- OWASP API Security Top 10 — https://api-security.owasp.org/
- OWASP CI/CD Security Risks — https://owasp.org/projects/top-10-cicd-security-risks
- OWASP Top 10:2025 — https://top10.owasp.org/2025/en/
- SLSA 1.2 — https://slsa.dev/spec/v1.2/
- in-toto — https://in-toto.io/
- Sigstore — https://docs.sigstore.dev/
- TUF — https://theupdateframework.io/docs/
- OpenTelemetry — https://opentelemetry.io/docs/concepts/signals/
- Google SRE Monitoring — https://sre.google/sre-book/monitoring-distributed-systems/
- Google SRE Error Budgets — https://sre.google/workbook/error-budget-policy/
- Principles of Chaos Engineering — https://principlesofchaos.org/
- OSS-Fuzz — https://google.github.io/oss-fuzz/
- LLVM libFuzzer — https://llvm.org/docs/LibFuzzer.html
- Hypothesis property-based testing — https://hypothesis.readthedocs.io/
- TLA+ TLC tools — https://lamport.azurewebsites.net/tla/tools.html
- Jepsen distributed-systems safety testing — https://jepsen.io/
- Pact contract testing — https://docs.pact.io/
- GSN assurance cases — https://scsc.uk/gsn-standard
- FDA Computer Software Assurance (risk-based testing analogy) — https://www.fda.gov/regulatory-information/search-fda-guidance-documents/computer-software-assurance-production-and-quality-management-system-software


Additional defensive-doctrine references:
- NIST SP 800-160 Vol. 2 Rev. 1 cyber resiliency — https://csrc.nist.gov/pubs/sp/800/160/v2/r1/final
- NIST SP 800-207 Zero Trust Architecture — https://csrc.nist.gov/pubs/sp/800/207/final
- MITRE D3FEND — https://d3fend.mitre.org/
- U.S. Army ADP 6-0 Mission Command (2019) — https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN34403-ADP_6-0-000-WEB-3.pdf
- U.S. Marine Corps MCDP 1 Warfighting — https://www.marines.mil/portals/1/publications/mcdp%201%20warfighting.pdf
- NASA fault detection/recovery handbook guidance — https://swehb.nasa.gov/
- NASA NPR 8705.4B risk/fault-tolerance guidance — https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_8705_004B_&page_name=AppendixD
- Innate immunological memory review — https://pmc.ncbi.nlm.nih.gov/articles/PMC7067670/
- Trained immunity review — https://pmc.ncbi.nlm.nih.gov/articles/PMC5087274/
- Regulatory T cells / immune tolerance review — https://pmc.ncbi.nlm.nih.gov/articles/PMC10842646/
- PAMP/DAMP danger signaling review — https://pmc.ncbi.nlm.nih.gov/articles/PMC5554486/
