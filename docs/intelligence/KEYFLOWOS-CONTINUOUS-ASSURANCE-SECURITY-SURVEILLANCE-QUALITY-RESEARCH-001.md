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

## 21. Reference set

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
