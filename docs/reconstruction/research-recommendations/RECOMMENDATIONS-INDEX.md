# Research recommendations index (D-261, D-262)

Every architectural recommendation re-derived from the repository and its GitHub record, verified against code at **origin/main 2c4e4bf2** and the plan at **pkt/V1-RULINGS-3E f6f6e01e** (`docs/reconstruction/V1-PLAN-RECUT.json`, 234 packets). Method, counts and owner questions: `README.md`. Packets: `RR-PACKETS.json`. Worker notes cited as `worker-notes/notes-*.md` are the extraction workers' records (sources, evidence, sketches), committed for traceability; `worker-notes/MASTER.md` is the dedup merge table. RR-OWNER-RULINGS-RECORD is an admission helper (it records owner answers) and belongs to no row.

Status key: **a** done on main (file:line); **b** already a plan packet (id); **c** partly done (gap stated); **d** not done; **MEM** covered by the memory track (D-257, MEM-* packets); **MEM-deferred** memory-track material that no MEM packet covers yet (no packet; owner question); **ruled** decided by an owner ruling or the human-agency doctrine; **principle** a law with no concrete change (no packet). Line numbers are at 2c4e4bf2. Source abbreviations used inside blocks (expanded in the README): GC, MC, CV, OT, BR, BS, BG, CD, HL, EM, KNG, SFS, PD, BP, OA, R3, DOS, SYN, TR, FIG, MS, K (= apps/server/src/modules/key-cortex), S (= apps/server/src), CA (= docs/intelligence/KEYFLOWOS-CONTINUOUS-ASSURANCE-SECURITY-SURVEILLANCE-QUALITY-RESEARCH-001.md).

## Summary table

| Recommendation | Status | Packets |
|---|---|---|
| REC-SAFETY-FAIL-POLICY: KEY's input-safety check is an explicit policy: a missing or throwing checker fails closed (tools withheld), every finding class maps to an action, an | d | RR-KEY-SAFETY-POLICY (P2) |
| REC-GUARDRAIL-LIFECYCLE: versioned guardrail policy, detect-then-enforce rollout, classifier cascade | d | RR-KEY-SAFETY-POLICY (P2) |
| REC-UNTRUSTED-CONTENT-FENCE: tool/MCP/document/web/extracted content enters prompts as fenced untrusted data that cannot carry instructions or authority | c | RR-UNTRUSTED-CONTENT-FENCE (P1) |
| REC-STREAM-OUTPUT-BOUNDARY: a stream that ended in error or truncation triggers no effects; output policy before release | c | RR-STREAM-ERROR-NO-EFFECTS (P1) |
| REC-CONTENT-AWARE-REDACTION: PII/secret detection by content and destination, not only by field name; applied to model output before release | d | RR-REDACTION-BY-CONTENT (P2) |
| REC-PROMPT-CANARY: canary tokens in protected context detect prompt leakage; reviewed attack-signature store | d | RR-KEY-PROMPT-CANARY (P3) |
| REC-DURABLE-EFFECT-IDEMPOTENCY: SafetyShell idempotency survives restart and replicas (durable claim, not a process Set) | a | — |
| REC-MODEL-LIFECYCLE: retired models cannot be selected; requested vs resolved model recorded; defaults current | d | RR-MODEL-LIFECYCLE-GUARD (P1) |
| REC-RESOURCE-CATALOG: Ollama and OpenRouter are distinct resources (identity, health, circuit, cost), not one 'opensource' provider | d | RR-OPENSOURCE-PROVIDER-SPLIT (P3) |
| REC-SCHEDULER-SEAM: one model-selection seam; static provider maps collapse into it; capabilities gate eligibility | d | RR-MODEL-SELECTION-ONE-SEAM (P3) |
| REC-TYPED-PROVIDER-FAILURES: rate-limit/cancel/policy errors do not open the provider circuit; typed failures | d | RR-GATEWAY-TYPED-FAILURES (P2) |
| REC-ADMISSION-BACKPRESSURE: per-tenant admission control on model calls (replica-shared) and backpressure on the cortex event bus | c | RR-LLM-ADMISSION-CONTROL (P2), RR-CORTEX-BUS-BACKPRESSURE (P3) |
| REC-UNKNOWN-COST: unpriced model cost recorded as unknown, never $0; one price table | c | RR-UNKNOWN-COST-NOT-ZERO (P2) |
| REC-ONE-PROVIDER-SEAM: every model/embedding/vision/voice call goes through ModelGateway | c | RR-DIRECT-PROVIDER-CENSUS (P3) |
| REC-ANTHROPIC-TOOL-PARITY: toolChoice 'none' mapped for Anthropic; tool results as native tool_result blocks | d | RR-ANTHROPIC-TOOL-PARITY (P3) |
| REC-PROMPT-CACHE: cache-friendly prompt layout + provider prompt caching | c | RR-PROMPT-CACHE-PREFIX (P3) |
| REC-RESPONSE-FORMAT-HONEST: GatewayRequest.responseFormat is honoured (native JSON/schema) or removed | d | RR-RESPONSE-FORMAT-HONEST (P2) |
| REC-EXECUTABLE-CONTRACTS: one executable schema (Zod) per AI output contract deriving type, validator and provider schema | d | RR-AI-CONTRACT-ZOD-FIRST (P3) |
| REC-NO-MARKDOWN-STATE: stop regex-parsing markdown for machine state; typed result first | d | RR-CORTEX-TYPED-RESULT (P2) |
| REC-OUTPUT-PROVENANCE: output states strict/repaired/coerced/partial/invalid; contract violation distinct from provider failure | d | RR-STRUCTURED-PARSE-INVALID-STATE (P2) |
| REC-STRICT-TOOL-SCHEMAS: FLOW_TOOLS compiled to strict provider tool schemas; schema-valid args are not authorization | d | RR-TOOL-ARGS-MALFORMED-NEVER-RUN (P2), RR-STRICT-TOOL-SCHEMAS (P3) |
| REC-RUN-BUDGET: typed per-run budget (tool rounds, tokens, cost, wall clock), inheritance, one retry graph; attention as a budget | d | RR-KEY-RUN-BUDGET (P2) |
| REC-REAL-COMPENSATION: compensation really executes and verifies; never report undone work as undone | a | — |
| REC-EFFECT-CLASS: every capability declares effect class, idempotency, reversibility, version; writes in one model turn run in order, only independent reads in parallel | c | RR-TOOL-EFFECT-CLASS (P1), RR-TOOL-EFFECT-METADATA (P2), RR-TOOL-WRITES-SEQUENTIAL (P1) |
| REC-DISPATCH-EFFECT-SAFETY: ActionDispatcher: no blind retry of a write after a generic error; atomic durable claim before effect; outcome-unknown blocks a new attempt | c | RR-DISPATCH-NO-BLIND-RETRY (P1), RR-DISPATCH-ATOMIC-CLAIM (P1) |
| REC-MCP-TENANCY: MCP bridge tenant-bound (per-business config/credential/cache) or provably off in v1 | d | RR-MCP-TENANT-BOUND (P1) |
| REC-CONNECTOR-CONVERGENCE: one connector substrate / connected-account model (ConnectorRegistry vs KeyConnector) | c | RR-CONNECTOR-STACK-CENSUS (P3) |
| REC-CONNECTOR-CONFORMANCE: connectors pass a shared conformance + security harness (unverified != connected; no scope broadening) before activation | d | RR-CONNECTOR-CONFORMANCE (P2) |
| REC-WEBHOOK-INGRESS-ENVELOPE: one verified ingress envelope for webhooks (signature, replay/dedup, tenant from trusted mapping) | c | RR-WEBHOOK-INGRESS-CENSUS (P1) |
| REC-CAPABILITY-PAGING: task-scoped bounded tool selection; a missing allowlist never broadens | b | — |
| REC-NO-DUPLICATE-TOOL-LIST: IntentParser tool vocabulary derived from FLOW_TOOLS so allowlist/hide rulings apply | d | RR-INTENT-PARSER-ONE-TOOL-LIST (P2) |
| REC-LEGACY-CAPABILITY-DISPOSAL: classify the 14 legacy KeyToolRegistry tools vs FLOW_TOOLS, then remove the KeyCommand fallback | c | RR-LEGACY-TOOLS-CLASSIFY (P2), RR-LEGACY-FALLBACK-REMOVE (P2) |
| REC-GOAL-CONVERGENCE: converge AiGoal/BusinessGoal; goal provenance projection | c | RR-GOAL-WRITER-CENSUS (P3) |
| REC-HEALTH-TO-CONTROL: pure deriveControl: degraded health only tightens control; governance read failure fails closed; module/organ health as an input | d | RR-HEALTH-TIGHTENS-CONTROL (P2) |
| REC-SAFE-MODE: partial safe mode (reads + identity + audit stay; risky autonomy off), recorded entry/exit, recovery before resumption | c | RR-KEY-SAFE-MODE (P3) |
| REC-ACTION-UNDERSTANDING: one server projection per KEY action (proposed/approval/executed/verified/reversibility), rendered by web; no misleading copy | d | RR-ACTION-UNDERSTANDING-SERVER (P2), RR-ACTION-UNDERSTANDING-WEB (P2) |
| REC-ACTION-RECEIPT-COVERAGE: more consequential capabilities go through Capability -> Control -> Clearance -> Claim -> OutcomeEvidence | c | RR-ACTION-BOUNDARY-NEXT-CAPABILITY (P2) |
| REC-DURABLE-UNDO: reversibility class per tool; undo state durable (not a 5-minute in-process Map) | c | RR-MIGRATION-UNDO-TABLE (P3), RR-UNDO-DURABLE (P3) |
| REC-ROUTING-RISK-FLOOR: caller-supplied risk context sets effort-tier floors and grants no authority | c | RR-TRIAGE-RISK-FLOOR (P3) |
| REC-NO-SELF-PROMOTION: self-generated tuning stays a candidate until a human admits it | c | RR-SELFTUNE-CANDIDATE-ONLY (P3) |
| REC-LEARNING-SEMANTICS: tool success is not user acceptance, and acceptance does not calibrate factual confidence | d | RR-LEARNING-OUTCOME-SEMANTICS (P3) |
| REC-GOVERNED-LEARNING: learned signals only narrow autonomy, never widen it | a | — |
| REC-OUTCOME-WEIGHTED-TOOL-SELECTION: learned tool outcome scores automatically adjust tool-selection weights | d | — |
| REC-EVAL-ONLINE-CALIBRATION: evals get repeated-trial (stochastic) admission semantics, online evaluation rules and monitors, and a production-regression intake with human annotat | d | — |
| REC-EVAL-HONEST: eval suites cannot pass vacuously; NOT_RUN is distinct; the harness runs in CI | c | RR-EVAL-HARNESS-NO-VACUOUS (P2) |
| REC-COGNITIVE-TEST-DOUBLE: scripted fake model and trajectory assertions for KEY loops | c | RR-KEY-FAKE-MODEL-TRAJECTORY (P2) |
| REC-EVAL-LINEAGE: versioned eval datasets, evaluators and runs | d | RR-EVAL-RUN-LINEAGE (P3) |
| REC-ONE-COGNITIVE-RUNTIME: converge Flow, Deep Think and QueryPipeline into one runtime with depth modes | d | RR-COG-RUNTIME-ENTRY-CENSUS (P3) |
| REC-ONE-APPROVAL-MODEL: KeyActionProposal, AiApprovalItem and ApprovalRequest converge into one clearance flow | d | RR-APPROVAL-MODEL-CENSUS (P3) |
| REC-SPECIALIZATION-CONTRACT: role engine, triage, router, lens and autonomy classification as one typed contract | d | RR-ACTION-INTENT-ONE-CLASSIFIER (P2) |
| REC-REFLECTION-PERSIST: reflection hypotheses persist | c | RR-REFLECTION-HONEST (P3) |
| REC-EMOTION-ENDOCRINE: detected emotion and feedback feed endocrine state | c | — |
| REC-DOC-VOICE-ORGANS: document and voice as organ adapters emitting cortex events | d | — |
| REC-CASH-TARGET: owner-set cash-flow target with corrective suggestions, revenue-scoped | c | RR-MIGRATION-CASH-TARGET (P3), RR-CASH-TARGET (P3) |
| REC-AI-TRACE-SPINE: AI traces move off Langfuse's legacy ingestion to OTLP, failed attempts and fallbacks are traced under one trace with correlation ids, exporter failur | d | RR-LANGFUSE-INGESTION-CUTOVER (P2), RR-AI-TRACE-ATTEMPTS-CORRELATION (P3) |
| REC-SLO: SLOs and error budgets for critical services | d | RR-SLO-AVAILABILITY-LEDGER (P3) |
| REC-DEBUG-CAPSULE: serious failures emit a bounded capsule (sha, correlation id, class, replica) | c | RR-ERROR-CAPSULE (P3) |
| REC-SECURITY-SIGNALS: runtime aggregation of security signals | c | RR-SECURITY-SIGNAL-COUNTERS (P3), RR-WEBHOOK-INGRESS-CENSUS (P1) |
| REC-INTEGRITY-WATCHER: read-only runtime invariant monitor | c | RR-INTEGRITY-WATCH (P3) |
| REC-CRON-OCCURRENCE-CLAIM: crons take an occurrence claim so they cannot double-fire | c | RR-CRON-OCCURRENCE-LOCK (P3) |
| REC-JOB-TENANT-CONTEXT: every background job runs inside runWithTenant(businessId) | c | RR-JOB-TENANT-CONTEXT (P2) |
| REC-STATE-TRANSITION-COMMANDS: lifecycle status fields change only through transition commands, never generic PATCH | c | RR-STATUS-PATCH-CENSUS (P3), RR-CHANGE-ORDER-APPROVE-COMMAND (P2) |
| REC-ONE-EVENT-SUBSTRATE: one event substrate; audit publish-only / listen-only events | c | RR-DEAD-EVENT-CENSUS (P3) |
| REC-EFFECTIVE-AUTHORITY: the effective-authority resolver leaves shadow mode and enforces | c | RR-AUTHORITY-SHADOW-PARITY (P2) |
| REC-ARCH-FORWARDREF: no new forwardRef cycles; replace existing with events/facades | d | RR-FORWARDREF-RATCHET (P3) |
| REC-ARCH-WEB-CLIENT: retire apps/web/src/lib/client.ts in favour of lib/api/<domain>.ts | c | RR-WEB-CLIENT-RATCHET (P3) |
| REC-ARCH-KEY-CORTEX-SPLIT: split key-cortex into four modules with contracts | d | RR-KEY-CORTEX-SIZE-RATCHET (P3) |
| REC-ARCH-LEGACY-MODELS: mark or remove unused legacy Prisma models | d | RR-UNUSED-MODEL-CENSUS (P3) |
| REC-ARCH-SCANNER-CI: CI runs inventory.py and dependency_scan.py and reports/fails on map drift | c | RR-ARCH-SCAN-CI (P3) |
| REC-THROUGHPUT-METRIC: KEY actions-per-hour metric per business | d | — |
| REC-BANK-TOKEN-ENCRYPTION: BankConnection.accessToken is encrypted at rest. | c | RR-BANK-TOKEN-ENCRYPT (P1) |
| REC-CRYPTO-PROD-GUARD: packages/db token encryption must not use the in-repo dev fallback key in production. | c | RR-DB-CRYPTO-KEY-CENSUS (P1), RR-DB-CRYPTO-PROD-GUARD (P1) |
| REC-SERVICE-WRITE-REDACTION: BusinessEventService.emit, ContactAudit and the AI execution log redact at the service write. | c | RR-BUSINESS-EVENT-REDACT (P2) |
| REC-ERASURE-COMPLETENESS: contact erasure also scrubs BusinessEvent PII. | c | RR-ERASURE-BUSINESS-EVENTS (P1) |
| REC-ADMIN-SHELL-GATE: /admin pages gated server-side. | c | RR-ADMIN-SHELL-SERVER-GATE (P3) |
| REC-ADMIN-TOKEN: admin logout; admin JWT exp in seconds with iss/aud. | c | RR-ADMIN-LOGOUT (P1) |
| REC-HTTPONLY-SESSION: HttpOnly cookie sessions, no refresh tokens in localStorage. | d | RR-SESSION-STORAGE-CENSUS (P3) |
| REC-RETENTION-WORKER: scheduled retention for activity logs, export jobs and notification logs. | c | RR-RETENTION-EXPIRED-EXPORTS (P2) |
| REC-AUTH-FAIL-FAST: no DI fallback construction; an invalid bearer is marked, not silently anonymous. | c | — |
| REC-SOCIAL-OAUTH-STATE: social OAuth state and PKCE in Redis. | c | — |
| REC-CONSENT-UNIQUE: ConsentRecord unique (contact, channel, type) + upsert. | d | — |
| REC-OBJECT-STORAGE-PRIVATE: PutObject sets private ACL + SSE. | d | RR-OBJECT-STORAGE-POSTURE-CHECK (P2) |
| REC-OAUTH-PKCE: Google and Microsoft OAuth use PKCE | d | RR-OAUTH-PKCE-GOOGLE-MICROSOFT (P2) |
| REC-EXPORT-DELETED-CONTACT: a soft-deleted or forget-pending contact cannot be exported | d | RR-PRIVACY-DELETED-CONTACT-GATES (P2) |
| REC-EMAIL-DELETED-CONTACT: transactional email is not sent to a soft-deleted contact | d | RR-PRIVACY-DELETED-CONTACT-GATES (P2) |
| REC-FORGET-CANCEL-SOURCE: cancelling a forget request restores only what the forget deleted | d | RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE (P3) |
| REC-APPROVAL-EXECUTE-SCOPED-READ: the approval orchestrator's pre-execution snapshot uses a business-scoped read | d | — |
| REC-EXPORT-DOWNLOAD-RATE-LIMIT: the public contact-export download is rate limited | d | — |
| REC-CONTEXT-BUNDLE: each development agent gets a deterministic, source-bound context bundle per packet instead of re-reading the plan | c | RR-BUNDLE-RULING-CONFLICTS (P3) |
| REC-PROOF-PROFILES: a packet's change class selects its proof profile, and the proof class is declared | c | RR-BUNDLE-PROOF-PROFILE (P3) |
| REC-HOTSPOTS: an offline, deterministic git-history scanner for hotspots and co-change | d | RR-HOTSPOT-SCANNER (P3) |
| REC-COORDINATION-METRICS: measure review cycles, rework and handoffs from artifacts, not self-report | c | RR-STATUS-REVIEW-CYCLES (P3) |
| REC-STRUCTURED-CLAIMS: agents and reviewers exchange structured claims; dissent preserved; correlated evidence not double counted | c | — |
| REC-RND-LINEAGE: research-originated PRs carry optional rnd_lineage; every research result ends in a disposition | c | — |
| REC-SCOPE-GUARDS: a packet's allowed scope is enforced at edit time by hooks | c | RR-HOOK-PACKET-SCOPE (P3) |
| REC-GENERATED-INSTRUCTIONS: shared agent instructions generated from one source to stop drift | c | — |
| REC-ANTI-FAKE-GREEN: skipped or not-run is not passed in CI; shrink-only gate ledgers cannot grow across commits | c | RR-SCRIPT-SPECS-IN-CI (P2), RR-CI-REQUIRED-JOBS-AGGREGATE (P2), RR-GATE-LEDGER-MONOTONIC (P2), RR-GATE-LEDGER-CENSUS (P3) |
| REC-PROPERTY-TESTS: generative (property/fuzz/boundary/concurrency) tests for parsers, money, date/time, pagination, idempotency, state machines, authorization predicates | c | — |
| REC-TWO-KEY: catastrophic product actions need a second, independent act or approver | c | RR-ERASE-BUSINESS-TWO-STEP (P2) |
| REC-INDEX-COVERAGE: compare real query paths with tenant/time/status indexes | d | RR-INDEX-COVERAGE-REPORT (P3) |
| REC-AUTH-FAIL-CLOSED: an authority/autonomy-check error runs zero parsed commands, never "all parsed commands" | a | — |
| REC-FRESH-REVIEW: reviewers see only the diff, contract and invariants and try to falsify | a | — |
| REC-NEGATIVE-CONTROLS: every critical invariant has a negative control that restores the defect and must fail | a | — |
| REC-SECURITY-EVIDENCE: a green workflow does not claim every scanner passed; advisory results are reported as such | a | — |
| REC-NATIVE-DAST: DAST boots the real API on ephemeral Postgres/Redis; a 404 is not proof, 5xx/leakage fails | a | — |
| REC-THREAD-HARVEST: exported chat threads are harvested deterministically into a redacted corpus with dispositions | a | — |
| REC-TENANT-COVERAGE-GATE: CI fails when a new businessId model lacks tenant-isolation coverage | a | — |
| REC-GOAL-UPDATE-ISOLATION: goal updates are scoped by business id | a | — |
| REC-CONTEXT-CACHE: per-business context is cached instead of re-assembled every turn (glial support) | a | — |
| REC-SAGA-COMPENSATION: the saga executor compensates on failure | a | — |
| REC-TIMEZONE-RHYTHM: rhythm jobs run at each business's local time (circadian) | a | — |
| REC-GENOME-EVOLUTION-PERSIST: DNA evolution proposals persist and go through an approve workflow | a | — |
| REC-WATCHER-PERSIST: watcher signals are persisted, not dropped | a | — |
| REC-LIVE-CHAT-MEMORY: unified memory retrieval is wired into the live Flow chat | a | — |
| REC-PROGRAMME-TWIN: the programme compiles into a portable, machine-readable package another agent can continue from | a | — |
| REC-SEC-REGISTER-DONE: sixteen items of the architecture security register are already mitigated | a | — |
| REC-SELF-MODEL: KEY has a read-only operational self-model projected from existing owners, unknown when a source is unavailable | b | — |
| REC-FINANCE-TOOLS: safe-to-spend, cash-flow forecast and money moves are canonical read capabilities | b | — |
| REC-OPS-CONSOLE: an owner-only, read-only console with evidence-backed progress (reduced form of the Atlas Mission Control) | b | — |
| REC-KNOWLEDGE-REHOME: no second web-learning service; the dormant KnowledgeIngestionService is re-homed behind approved sources | b | — |
| REC-COGNITIVE-BLACKOUT: KEY and the product degrade honestly with AI providers down | b | — |
| REC-RESEARCH-LEDGER: the research ledger parses and every result has a recorded disposition | b | — |
| REC-HONEST-RETRIEVAL: retrieval and context report "not recorded", "retrieval failed", "policy blocked" distinctly, never [] for an outage | MEM | — |
| REC-RETRIEVAL-EVAL: retrieval evals measure real precision/recall and tenant/stale leakage with a negative control | MEM | — |
| REC-CONTEXT-GENOME: memory separates authority from confidence, valid from recorded time, with provenance and supersession (one evidence-grounded world model) | MEM | — |
| REC-REPRESENTATION-IDENTITY: every vector carries its representation identity (provider, model, revision, dimensions, index generation) | MEM-deferred | — |
| REC-LEARNING-STREAM: governed world-knowledge ingestion (sources, cursors, ETag polling, shadow first; external content untrusted) | MEM-deferred | — |
| REC-ADAPTIVE-RECEPTOR: one intake contract (source identity, tenant, provenance hash, trust state, observed/recorded time) writing observations in shadow | MEM-deferred | — |
| REC-DEEPTHINK-ACT: Deep Think (processConsciously) gets a path to act through the efferent bridge | ruled | — |
| REC-GENOME-AUTO-APPLY: low-risk DNA evolution proposals auto-apply after reflection | ruled | — |
| REC-AUTONOMY-FROM-VELOCITY: KEY's autonomy tier follows business velocity (actions/day) | ruled | — |
| REC-DEP-AUDIT-ENFORCE: new critical/high dependency advisories fail CI closed | ruled | — |
| REC-CLOSED-CONTROL-PLANE: atlas materializer, motif miner / native-capacity shadow, parallel-agent orchestration plan | ruled | — |
| REC-PROCEDURE-SPEC: repeated episodes become versioned, evaluated procedures through a promotion ladder; a procedure is never a permission | d | — |
| REC-SKILLS-BENCH: benchmark portable skills against task-specific prompts offline before any runtime change | d | — |
| REC-STALL-SIGNAL: the status report flags packets that stay ready without landing beyond a budget (liveness separate from safety) | d | RR-STATUS-STALL-REPORT (P3) |
| REC-DETERMINIZE-FIRST: resolve exact/derivable parts deterministically before any model call; re-validate model output at deterministic boundaries | principle | — |
| REC-HONEST-FAILURE-CLASSES: keep invalid input, denied authority, unavailable dependency, unknown outcome, transient and partial commit distinct | principle | — |
| REC-REACHABILITY-FIRST: prove a path is live (registered, injected, called, observable) before deep work | principle | — |

## 1. KEY safety and the trust boundary (prompt injection, untrusted content, redaction, model lifecycle)

### REC-SAFETY-FAIL-POLICY — KEY's input-safety check is an explicit policy: a missing or throwing checker fails closed (tools withheld), every finding class maps to an action, and a PII hit does not short-circuit the injection checks
- Sources: worker-notes/notes-A-genai.md QUERY-SAFETY-FAIL-OPEN (MC:469; GC:394-395; GC:620 proof obligation 13); worker-notes/notes-A-genai.md SAFETY-CHECK-ORDER-AND-PII (MC:470-471); worker-notes/notes-D-github.md INPUT-SAFETY-FAIL-POLICY (issue#153 comment 6010007429 2026-10-06 s.16, s.17, L10-GAP-02/03, L10-P02, L10-P07; 6009696796 2026-10-06 NEMO-GAP-01/02; 6009792035 2026-10-06 LG-GAP-02). (MC/GC = docs/intelligence/research/GENAI-RD-MASTER-CONTINUATION.md / GENAI-RD-GLOBAL-CONVERGENCE.md.)
- Dedup: the three blocks describe the same function pair (runSafetyCheck + checkSafety): fail-open on absent/throwing checker, and PII early return plus "only high blocks". One change.
- Status: d — key-cortex-quality.service.ts:59-71 returns {safe:false, severity:'medium'} on the first PII match before the keyword list (:73-96) and script check (:98-104); key-cortex-query-pipeline.service.ts:2272 returns undefined (proceed) with no checker; :2290-2294 swallows a throw; :2280 blocks only high. No plan packet (plan grep "safety"/"checkSafety" = 0). Correction to worker-notes/notes-D-github.md: the LLM second opinion (:106-140) does NOT receive a detected card number today, because the PII branch returns first; it would after the ordering fix, so the packet redacts before the classifier call.
- Packets: RR-KEY-SAFETY-POLICY (P2, M; merges the two MASTER ids RR-KEY-SAFETY-FAIL-CLOSED and RR-KEY-SAFETY-PII-ORDER: same two functions, one review). Priority P2 not P1: the path has no web client; the live chat path question is OQ-6.

### REC-GUARDRAIL-LIFECYCLE — versioned guardrail policy, detect-then-enforce rollout, classifier cascade
- Sources: worker-notes/notes-D-github.md GUARDRAIL-POLICY-LIFECYCLE (issue#153 comment 6010007429 2026-10-06 s.12-14, s.32, L10-GAP-07/08, SAFE-1, SAFE-4; 6009734842 2026-10-06 GRAI-GAP-01..04; 6009792035 2026-10-06 LG-GAP-01/03/07/08; 6009834485 2026-10-06 LAK-GAP-04/05/06/08).
- Dedup: single source; its first slice is the same table REC-SAFETY-FAIL-POLICY needs, so it is folded into that packet.
- Status: d — the only detector is key-cortex-quality.service.ts:50-147 (rules + optional LLM SAFE/LOW/MEDIUM/HIGH); `git grep GuardrailPolicy|DetectorRevision` = none; no plan packet.
- Packets: RR-KEY-SAFETY-POLICY (first slice: INPUT_SAFETY_POLICY_VERSION and per-class detect/enforce mode recorded on every decision). Later slices named in its scope, not packets now: revision persistence, calibration, classifier cascade.

### REC-UNTRUSTED-CONTENT-FENCE — tool/MCP/document/web/extracted content enters prompts as fenced untrusted data that cannot carry instructions or authority
- Sources: worker-notes/notes-A-genai.md INDIRECT-CONTEXT-ADMISSION (GC:391-392, GC:586-592, GC:233-234; MC:472, MC:483; CV:177-180; issue#153 comment 6010007429); worker-notes/notes-B-books-genome.md DATA-INSTRUCTION-AUTHORITY-SEPARATION (FIG/GENOME-V0.1-CONVERGENCE.md:133-137; FIG/TRANCHE-DECEPTION-SELF-CORRECTION-001.md:111-113, 126-128, 133-136; FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:101; MS/garrytan-gstack.md:110-115); worker-notes/notes-C-neuro-arch.md UNTRUSTED-CONTENT-ISOLATION (KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:600-610, :775-797; KEY-CONCURRENCY-...-001.md:573-591); worker-notes/notes-D-github.md INDIRECT-CONTEXT-ADMISSION (issue#153 comments 6010007429 s.19, s.20, L10-GAP-05, L10-P03..P05; 6009696796 NEMO-GAP-04/05; 6009834485 LAK-GAP-01/02/03; 6009953713 REB-GAP-01/05; 6009218421 s.17, L8-P10; 6010080039 P0.4 packet G; all 2026-10-06). (CV = GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md; FIG/MS paths as in worker-notes/notes-B-books-genome.md.)
- Dedup: four workers, one change: untrusted text entering a prompt is marked as data and cannot authorise anything. Authority side is already done (governToolCall + server-issued confirmation, flow-orchestrator.service.ts:3073 / 3320-3345 per worker-notes/notes-B-books-genome.md), so the packet is the fence.
- Status: c — exists: MCP output length cap with an "untrusted" comment (mcp-client-manager.service.ts:77-79); D-27 PENDING money inputs; outbound fetch guards in plan (FU-CONTRACT-FETCH-OUTBOUND-GUARD, FU-DOC-FETCH-BODY-CAP, TOF-WEBSITE-ENRICHMENT). Gap verified: buildAttachmentContext (flow-orchestrator.service.ts:1949-2003) concatenates raw extracted document text into the member's own user message (:2115-2116, :2562). Note: worker-notes/notes-A-genai.md/D cite tool results re-entering follow-ups (:2475-2487) as a gap; they already go in as role 'tool' messages (structurally separate), so the packet fences only free text from third parties (attachments, MCP output) and leaves internal tool results as they are.
- Packets: RR-UNTRUSTED-CONTENT-FENCE (P1, M). Later slices in its scope: semantic-memory section after MEM-SEMANTIC-SIGHT (D-257), KEY-PASTE-BOX text, enrichment, knowledge chunks.

### REC-STREAM-OUTPUT-BOUNDARY — a stream that ended in error or truncation triggers no effects; output policy before release
- Sources: worker-notes/notes-A-genai.md STREAM-ERROR-NO-EFFECTS (GC:394-395; GC:610-611 proof obligations 5-6); worker-notes/notes-D-github.md OUTPUT-SAFETY-RELEASE-BOUNDARY (issue#153 comments 6010007429 s.21, s.22, L10-GAP-06, L10-P14/P15; 6008603830 L7-GAP-07, L7-P08; 6009734842 GRAI-GAP-07; 6009792035 LG-GAP-06; 6010080039 P0.5; all 2026-10-06).
- Dedup: stream half (no effects from a failed stream) from both; output-policy half folded into REC-CONTENT-AWARE-REDACTION per MASTER.
- Status: c — flow streamChat already returns on an error chunk (flow-orchestrator.service.ts:2840-2843, control). Gaps verified: (1) new finding, not in the notes: ModelGatewayService.streamComplete falls back to the next provider after the failing one has already yielded deltas (model-gateway.service.ts:1123-1137 yield, :1164-1170 catch and continue), so the live member chat can splice two providers' answers and tool-call deltas (accumulator flow-orchestrator.service.ts:2825-2833); (2) cortex streamQuery yields the error and continues (key-cortex-query-pipeline.service.ts:1408-1413) then runs collected tool calls (:1416-1447). No plan packet.
- Packets: RR-STREAM-ERROR-NO-EFFECTS (P1, S). Truncation (finish reason on the done chunk) named as a later slice: truncated tool arguments fail JSON.parse today, so no effect runs.

### REC-CONTENT-AWARE-REDACTION — PII/secret detection by content and destination, not only by field name; applied to model output before release
- Sources: worker-notes/notes-D-github.md CONTENT-AWARE-PII-REDACTION (issue#153 comments 6010007429 L10-GAP-10/11, L10-P08/P09, SAFE-3; 6009885416 Presidio; 6009649322 s.25 export classes; all 2026-10-06) + output half of worker-notes/notes-D-github.md OUTPUT-SAFETY-RELEASE-BOUNDARY (sources as row 5).
- Dedup: single source plus the folded output half.
- Status: d — core/security/redaction.ts:13-32 field-name patterns only, deepRedact :47-63; value-based redaction exists only for email addresses in log lines (redactAddresses). No plan packet (plan "redact" hits W11-PROVIDER-OUTAGE-503 and FU-KEY-EVENT-COLUMNS, both unrelated to value detection).
- Packets: RR-REDACTION-BY-CONTENT (P2, S). Output-release policy for streamed replies is a named later slice (needs a stream-buffering design). Coordinates with G3's RR-BUSINESS-EVENT-REDACT (where redaction is called vs what it catches).

### REC-PROMPT-CANARY — canary tokens in protected context detect prompt leakage; reviewed attack-signature store
- Sources: worker-notes/notes-D-github.md THREAT-MEMORY-AND-CANARIES (issue#153 comments 6010007429 s.28-30, L10-GAP-09, SAFE-5; 6009953713 REB-GAP-02/03/04/06/07; 2026-10-06).
- Dedup: single source.
- Status: d — `git grep -i canary apps/server/src`: nothing for this purpose; the only reply check is enforceDoNotSay (flow-orchestrator.service.ts:8203). No plan packet.
- Packets: RR-KEY-PROMPT-CANARY (P3, S): canary at the end of the system prompt; a tool call carrying it is refused (the exfiltration-by-outbound-tool case), a reply echoing it is recorded. The attack-signature store is a later slice, not a packet (no honest RED without a review design).

### REC-DURABLE-EFFECT-IDEMPOTENCY — SafetyShell idempotency survives restart and replicas (durable claim, not a process Set)
- Sources: worker-notes/notes-A-genai.md SAFETYSHELL-DURABLE-IDEMPOTENCY (GC:388-389, GC:594-600; CV:103-109; MC:484-485); worker-notes/notes-D-github.md DURABLE-EFFECT-IDEMPOTENCY (issue#153 comments 6010007429 L10-GAP-13, L10-P19, SAFE-6; 6009696796 NEMO-GAP-09; 6006031473 P-DUR-01; 6010080039 P0.3 packet H; 6007335935 E6, P-RETRY-03; all 2026-10-06).
- Dedup: same Set, same caller.
- Status: a (premise false) — the Set exists (safety-shell.service.ts:36) but it is not the effect guard. Its only caller KeyActionExecutorService.execute (key-action-executor.service.ts:31, idempotencyKey = proposal.id) is reached only from KeyActionProposalService.execute (key-action-proposal.service.ts:435) after claimForExecution (:406-408, :536-577), a durable transactional conditional write APPROVED -> EXECUTING (V1-32, M46, landed). Two replicas cannot both execute one proposal; a restart cannot re-run an EXECUTED one. Other KEY effect paths: KeyIdempotencyService insert-claim (V1-19, D-103 lease) and the key-inbox claim (key-inbox.controller.ts:340-378). The Set is redundant defence in depth.
- Packets: none (no RED that fails on main: the duplicate-execution scenario is already refused by the durable claim). Optional hygiene left to the owner, not drafted: delete the Set or comment it as non-authoritative. Real compensation is row 9 (G2).

### REC-MODEL-LIFECYCLE — retired models cannot be selected; requested vs resolved model recorded; defaults current
- Sources: worker-notes/notes-D-github.md MODEL-LIFECYCLE-GUARD (issue #153 body, R&D-01A "capability/lifecycle-aware model catalog"; issue#153 comments 6005756178 2026-10-05 Gemini "configured default is shut down"; 6006031473 2026-10-06 P0.1, P0.2, P-MOD-01, invariant 8; 6006549000 2026-10-06 P0.2, P0.6, P-LIFE-01, P-PROV-01). Supporting evidence (not a repo source): Claude Code's bundled claude-api model reference (cached 2026-11-03) lists claude-3-5-sonnet-20241022 retired 2025-10-28 and claude-3-5-haiku-20241022 retired 2026-02-19.
- Dedup: single source.
- Status: d — model-gateway.service.ts:319-325 defaults (anthropic claude-3-5-sonnet-20241022, google gemini-2.0-flash); DEFAULT_ROUTING_TABLE from :386 uses both Claude 3.5 ids on most routes as primary or fallback; key-cortex-provider-selection.service.ts:24-63 repeats them; routing replaceable from DB (:3091-3111) and per request (:1933-1937); no lifecycle data anywhere; 195 model-id literals in non-spec server src. Resolved model and fallbackUsed are already recorded on the cost row (:1015-1041); the requested model is not (covered by fallbackUsed for the skip case). No plan packet.
- Packets: RR-MODEL-LIFECYCLE-GUARD (P1, S): owner-filled catalog, census, dispatch-time skip of retired ids. Replacement defaults: owner question OQ-3.

## 2. Model gateway (providers, admission, cost, structured output, tool schemas, run budget)

### REC-RESOURCE-CATALOG — Ollama and OpenRouter are distinct resources (identity, health, circuit, cost), not one 'opensource' provider
- Sources: issue#153 comment 6006549000 2026-10-06 (s.C1, C7, C8, Wave 1); 6006534541 2026-10-06; 6006177312 and 6006194487 2026-10-06 (Ollama); 6006480035 2026-10-06 (Vertex)
- Dedup: single source (D:COGNITIVE-RESOURCE-CATALOG)
- Status: d — model-gateway.service.ts:2742-2747 and :1740-1745 pick Ollama whenever OLLAMA_BASE_URL is set, else OpenRouter, under one AiProvider 'opensource' (:10); one configured flag (:770-772, :2023-2024), one circuit and one metrics row (ALL_PROVIDERS :317); unknown model cost 0 (:2769). Correction: the route is reachable only through the operator routing table (loadRoutingConfig :3091-3112) or providerOverride+modelOverride (:1933); no default route uses it, and the cortex map naming it has no production caller (see REC-SCHEDULER-SEAM). No plan packet (plan grep opensource/ollama/openrouter: 0).
- Packets: RR-OPENSOURCE-PROVIDER-SPLIT (P3, S)

### REC-SCHEDULER-SEAM — one model-selection seam; static provider maps collapse into it; capabilities gate eligibility
- Sources: issue#153 comment 6006031473 2026-10-06 (C2, C3, Wave 3, P-SCH-01); 6006549000 2026-10-06 (Wave 4 hard admission + utility score); 6008603830 2026-10-06 (s.8, L7-GAP-04, L7-P02); issue#153 body (R&D-01A "capability-based cognitive scheduling instead of model-name routing")
- Dedup: single source (D:SCHEDULER-CONVERGENCE)
- Status: d — Correction to the worker note: KeyCortexProviderSelectionService (key-cortex-provider-selection.service.ts:14-68) is injected (key-cortex-reasoning.service.ts:113) but DEAD: its only caller is the reasoning wrapper (:273-278), whose only caller is a spec (__tests__/key-cortex-reasoning.service.spec.ts:217-224). The live cortex paths call the gateway with no provider choice (key-cortex-query-pipeline.service.ts:646-659, :1347-1359), so the gateway routing table already is the single live router. The residual scatter is feature->model literals: AiUsageService forces provider openai whenever a model is named (ai-usage.service.ts:390-391); 21 non-test files outside the gateway and price table carry model-id literals. No plan packet.
- Packets: RR-MODEL-SELECTION-ONE-SEAM (P3, S; first slice: delete dead map + shrink-only model-id census; later slices named in scope)

### REC-TYPED-PROVIDER-FAILURES — rate-limit/cancel/policy errors do not open the provider circuit; typed failures
- Sources: issue#153 comment 6006549000 2026-10-06 (C3, P0.4/P0.5, P-HLT-01, P-CAP-01); 6006109752 2026-10-06 (vLLM: admission/saturation must not create false provider-health semantics)
- Dedup: single source (D:TYPED-PROVIDER-FAILURES)
- Status: d — recordProviderError increments the circuit on any error (model-gateway.service.ts:3201-3236), called per attempt (:2081) and per stream candidate (:1167); threshold 3 (:688) with MAX_RETRIES 2 (:686) means one complete() that gets three 429s opens the platform key's circuit for 5 minutes for every business on that key. isRetryable is a message-substring test (:3238-3249). Anthropic paths throw plain Errors with the status in text (:1376, :2328). core/utils/circuit-breaker.ts has no importer. Finding for the reviewer: the existing case model-gateway.service.spec.ts:758 drives "opens circuit after 3 consecutive failures" with new Error('rate limit exceeded') (:759); the packet re-points it to a 503 (not in any manifest's required list) and says so.
- Packets: RR-GATEWAY-TYPED-FAILURES (P2, S)

### REC-ADMISSION-BACKPRESSURE — per-tenant admission control on model calls (replica-shared) and backpressure on the cortex event bus
- Sources: issue#153 comment 6006095627 2026-10-06 (s.8 admission control, memory watermarking, continuous batching); 6006109752 2026-10-06 (A paged attention, B continuous batching/queueing, C admission control/congestion control, E2 saturation curve); 6006549000 2026-10-06 (P3.1 RuntimeCapacityEnvelope, P4.1 hard admission); docs/neuro-atlas-code-mapping.md:30; docs/intelligence/KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md:513-536, :583 (invariant "Backpressure is mandatory"); docs/intelligence/KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:786 (invariant 12)
- Dedup: D:LLM-ADMISSION-CONTROL and C:CORTEX-BUS-BACKPRESSURE share the law (bounded admission, saturation is a signal, never a fault) but are two code changes on two seams, so two packets.
- Status: c — model calls: AiUsageService.checkRateLimit (ai-usage.service.ts:302-321) is an in-process per-business requests-per-minute Map on AiUsageService paths only; the gateway has none; KEY chat routes carry @CrmRateLimit(120, 60_000) per IP+business (flow.controller.ts:31, :55), which bounds requests, not concurrent model calls, and background callers pass no guard. Bus: publish (key-cortex-event-bus.service.ts:125-188) starts two unawaited, unbounded ledger writes per event (:166-186); the domain bridge forwards matching events without awaiting (event-emitter-flow-bridge.service.ts:141-152), e.g. one contact.created per imported CSV row (crm.service.ts:989). Per-rule trigger cooldowns exist (key-cortex-trigger.service.ts createRule cooldownMinutes/maxDailyFirings), so the gap is the writes, not rule firing. No plan packet (plan grep backpressure/admission-on-AI: 0).
- Packets: RR-LLM-ADMISSION-CONTROL (P2, M), RR-CORTEX-BUS-BACKPRESSURE (P3, S; bounded writes only, nothing shed; shedding/coalescing needs OQ-8)

### REC-UNKNOWN-COST — unpriced model cost recorded as unknown, never $0; one price table
- Sources: issue#153 comment 6006031473 2026-10-06 (P0.5, F8, P-COST-01); 6006549000 2026-10-06 (C4, P0.3, P-COST-01/02); 6009291467 2026-10-06 (LS-GAP-04); 6009649322 2026-10-06 (L9-GAP-06, L9-P18)
- Dedup: single source (D:UNKNOWN-COST-NOT-ZERO)
- Status: c — partly done: priceFor (model-gateway.service.ts:378-384) bills an unknown model as gpt-4o and llm-cost-coverage.spec.ts fails the build for routable unpriced models. Remaining: native/opensource paths still price unknown models at 0 (:1708, :1789, :2702, :2769); LLMCostService.computeCost returns 0 (llm-cost.service.ts:100) and recordCost treats 0 as missing (:126-128); two tables disagree (gateway :355-367 gpt-4o 0.0025/1k vs llm-cost :40-62 gpt-4o 0.005/1k; mini and haiku also differ). No plan packet.
- Packets: RR-UNKNOWN-COST-NOT-ZERO (P2, S; raised from P3 because the two tables give different numbers for the same call today)

### REC-ONE-PROVIDER-SEAM — every model/embedding/vision/voice call goes through ModelGateway
- Sources: docs/intelligence/research/GENAI-RD-GLOBAL-CONVERGENCE.md:310, :619 (obligation 17); GENAI-RD-MASTER-CONTINUATION.md:242-256; issue#153 body (R&D-01A live repo gap); issue#153 comment 6006031473 2026-10-06 (F7); 6008240990 2026-10-06 (EMB-GAP-03); 6008318382 2026-10-06 (s.4); issue #137 body (CI-BLACKOUT hidden direct calls)
- Dedup: A:MODEL-CALLS-THROUGH-GATEWAY and D:DIRECT-PROVIDER-BYPASS name the same call sites and the same seam.
- Status: c — direct SDK use outside the gateway: ai-usage.service.ts:912, :976, :1057 (metered in AiUsageLog with credits); key-cortex-voice.service.ts:228, :241 (metered); key-cortex-document.service.ts:154, :167 with generateEmbedding :980-991 (indexing and question embeddings, NOT metered: no AiUsageLog, no credit); raw URLs in phone-voice/realtime-bridge.service.ts:5 and diagnostics/diagnostics.service.ts:380 (health probe). All honour keyDisabled() and the R0-07a 503 rule. Correction: semantic-memory.service.ts:120 is only a model constant; it embeds through AiUsageService.trackEmbedding (:447). Minor finding: key-cortex-document.service.ts:399 records model: response.provider (provider name in the model field).
- Packets: RR-DIRECT-PROVIDER-CENSUS (P3, S; census first; the "first move" of document embeddings charges credits, OQ-9)

### REC-ANTHROPIC-TOOL-PARITY — toolChoice 'none' mapped for Anthropic; tool results as native tool_result blocks
- Sources: issue#153 comment 6008938834 2026-10-06 (s.11, s.12); 6009218421 2026-10-06 (L8-GAP-06)
- Dedup: single source (D:ANTHROPIC-TOOL-PARITY)
- Status: d — model-gateway.service.ts:2307-2313 and :1355-1361 map auto/required/named only; tool messages flattened to user text (:2268-2272); assistant tool_calls dropped (:2273-2277, worker note missed this half); git grep tool_result: none. No caller sends 'none' today (intent-parser.service.ts:178, flow-orchestrator.service.ts:2364, :2799), so that half is parity.
- Packets: RR-ANTHROPIC-TOOL-PARITY (P3, S)

### REC-PROMPT-CACHE — cache-friendly prompt layout + provider prompt caching
- Sources: issue#153 body (R&D-01A); issue#153 comment 6006031473 2026-10-06 (Wave 4 P4.2)
- Dedup: single source (D:PROMPT-CACHE-LAYOUT)
- Status: c — correction: partly done. prompt-cacheability.spec.ts pins the Flow prompt's date to the hour through one helper so OpenAI's automatic prefix cache can hit. Missing: Anthropic cache_control (git grep cache_control: none; system sent as a string at model-gateway.service.ts:2297-2299) and reading cached tokens (git grep cached_tokens|prompt_tokens_details|cache_read_input_tokens: none), so cost ignores cache discounts.
- Packets: RR-PROMPT-CACHE-PREFIX (P3, S)

### REC-RESPONSE-FORMAT-HONEST — GatewayRequest.responseFormat is honoured (native JSON/schema) or removed
- Sources: docs/intelligence/research/GENAI-RD-GLOBAL-CONVERGENCE.md:404-406, :552-558, :322; GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md:71-80; GENAI-RD-MASTER-CONTINUATION.md:364-366; issue#153 comment 6008603830 2026-10-06 (L7-GAP-01, L7-P12, step 3); 6008593799 2026-10-06; 6010080039 2026-10-06 (P1.3, packet C); 6010442954 2026-10-06 (candidate C)
- Dedup: A:STRUCTURED-OUTPUT-HONESTY and D:RESPONSE-FORMAT-HONESTY are the same field and fix.
- Status: d — model-gateway.service.ts:69-70 declares it; git grep responseFormat|response_format in modules/ai: only :70. Flow Studio relies on json_object (key-cortex-flow-studio.service.ts:122) and then 400s on a non-JSON reply (:143-147); cortex sends {type:'text'} (key-cortex-query-pipeline.service.ts:658, key-cortex-tool-loop.service.ts:211).
- Packets: RR-RESPONSE-FORMAT-HONEST (P2, M)

### REC-EXECUTABLE-CONTRACTS — one executable schema (Zod) per AI output contract deriving type, validator and provider schema
- Sources: docs/intelligence/research/RD-03-LAYER-3-IMPLEMENTATION-PROOF-DESIGN.md:56-100, :253-258 (COG-P01..P03); RD-03-LAYER-3-BACKWARD-PRESSURE-TEST.md:481-484; RD-03-LAYER-3-ORCHESTRATION-CONVERGENCE-AUDIT.md:230-235; RD-03-CURRENT-STATE.yaml:52-54, :66-70; issue#153 comment 6008603830 2026-10-06 (L7-GAP-02, L7-P01); 6007335935 2026-10-06 (E1, E2, A, P-TYPE-01/02, P-TOOL-01); 6008412470 2026-10-06 (PCTRL-GAP-01); 6009734842 2026-10-06 (GRAI-GAP-05); 6008524408 2026-10-06 (BAML)
- Dedup: A:EXECUTABLE-COGNITIVE-CONTRACTS and D:OUTPUT-CONTRACT-SINGLE-SOURCE are the same change.
- Status: d — ai-output-contracts.ts: 15 interfaces (:1-245) + hand switch validator (:299-498); no zod import in modules/ai (zod ^3.24.0 already a server dependency, apps/server/package.json:87). Concrete drift: intent_parse validator requires 3 fields and does not check items (:311-319) while the parse_intent tool schema requires 7 with an enum and typed items (intent-parser.service.ts:24-66).
- Packets: RR-AI-CONTRACT-ZOD-FIRST (P3, S; intent_parse slice; later slices one contract each)

### REC-NO-MARKDOWN-STATE — stop regex-parsing markdown for machine state; typed result first
- Sources: issue#153 body (R&D-01A "schema-first"); issue#153 comment 6006031473 2026-10-06 (C6, F5); 6008603830 2026-10-06 (L7-GAP-03, step 6); 6008412470 2026-10-06 (PCTRL-GAP-05); 6009734842 2026-10-06 (GRAI-GAP-06)
- Dedup: single source (D:CORTEX-MARKDOWN-PARSE-RETIRE)
- Status: d — key-cortex-structured-output.service.ts:124-232 regex parser used at key-cortex-query-pipeline.service.ts:683 and :1641; duplicate at key-cortex-reasoning.service.ts:427. New concrete defect found while verifying: a missing Confidence section yields 70 (:131-140, parseConfidence :234-240), stored as metadata.confidence 0.7 (:726-729, :1657-1660), fed to learning (:770) and calibration (:1050-1052), so the context-based calculateConfidence is never reached.
- Packets: RR-CORTEX-TYPED-RESULT (P2, S; raised from P3 because a fabricated number feeds learning; first slice; typed-result-first is a later slice)

### REC-OUTPUT-PROVENANCE — output states strict/repaired/coerced/partial/invalid; contract violation distinct from provider failure
- Sources: issue#153 comment 6008603830 2026-10-06 (s.6 validation ladder, s.7, L7-GAP-05/06, L7-P05/P11/P14); 6008412470 2026-10-06 (PCTRL-GAP-03/04/06/07); 6009734842 2026-10-06 (GRAI-GAP-02/03)
- Dedup: single source (D:OUTPUT-PROVENANCE-STATES)
- Status: d — a contract violation in complete() throws inside the candidate try (model-gateway.service.ts:905-925), so the loop falls to the next provider (:932-937) and the paid call's cost is never recorded (:927-929 not reached); the final error is a plain Error; empty content skips the check and returns success (:909); coerceToContract swaps in a fallback and records nothing (ai-output-contracts.ts:500-510). The cortex markdown 'empty' shape is handled in #21.
- Packets: RR-STRUCTURED-PARSE-INVALID-STATE (P2, S; raised from P3: lost cost rows and a silent pass on empty output)

### REC-STRICT-TOOL-SCHEMAS — FLOW_TOOLS compiled to strict provider tool schemas; schema-valid args are not authorization
- Sources: issue#153 comment 6008603830 2026-10-06 (s.12, step 7); 6008938834 2026-10-06 (s.6); 6009218421 2026-10-06 (s.12)
- Dedup: single source (D:STRICT-TOOL-SCHEMAS)
- Status: d — getOpenAiToolDefinitions passes parameters through (flow-tool-registry.ts:6132-6141); no strict/additionalProperties; validateToolInput skips undeclared args (flow-orchestrator.service.ts:3598-3600); new findings: Flow JSON.parses tool arguments unguarded (:2411, :2879) and the cortex loop runs a tool with {} when arguments do not parse (key-cortex-tool-loop.service.ts:72-77). Related plan packet W11-KEY-TRANSFER-INTEGER (integer branch in the same validator) is a dependency, not an overlap.
- Packets: RR-TOOL-ARGS-MALFORMED-NEVER-RUN (P2, S; malformed arguments never run a tool: the cortex loop runs a tool with {} today, key-cortex-tool-loop.service.ts:72-77), RR-STRICT-TOOL-SCHEMAS (P3, M; closed schemas and strict provider mode, after a census of executeToolDirectly callers). Split by the packet-quality review.

### REC-RUN-BUDGET — typed per-run budget (tool rounds, tokens, cost, wall clock), inheritance, one retry graph; attention as a budget
- Sources: docs/intelligence/research/RD-03-LAYER-3-BACKWARD-PRESSURE-TEST.md:486-489; RD-03-LAYER-3-IMPLEMENTATION-PROOF-DESIGN.md:131-198 (COG-P06, COG-P09); RD-03-LAYER-3-ORCHESTRATION-CONVERGENCE-AUDIT.md:190-201; RD-03-CURRENT-STATE.yaml:56-57, :76; issue#153 comment 6007335935 2026-10-06 (E5, E7, E8, C Retry Domain + Retry Algebra, F Budget Inheritance, P-RETRY-01/02); 6008603830 2026-10-06 (L7-P09); docs/neuro-atlas-code-mapping.md:268
- Dedup: A:RETRY-BUDGET-INHERITANCE, D:COGNITIVE-EXECUTION-BUDGET and C:KEY-ATTENTION-BUDGET all ask for one bounded, inherited run budget; one packet chain.
- Status: d — iteration cap verified as asked: NOT missing in effect. Both loops are structurally one round: Flow makes one call with tools, runs that response's calls, then a follow-up with no tools (flow-orchestrator.service.ts:2333-2370 then :2489-2497; stream :2768-2800 then :3022-3031); the cortex loop likewise (key-cortex-tool-loop.service.ts:70-160 then :205-212 with no tools). The unbounded parts are the number of tool calls per response (Promise.all at :2470-2472 and :2993-2995; sequential at tool-loop :70; MAX_TOOLS 128 at :1844 caps the menu, not calls) and implicit model attempts (3 candidates x 3 attempts = 9 per complete(), model-gateway.service.ts:686, :2056-2093). No named budget object (git grep retryBudget|ancestor|runBudget: none). Consciousness pipeline has no attention budget (key-cortex-consciousness.service.ts, grep attention|budget: 0).
- Packets: RR-KEY-RUN-BUDGET (P2, S; first slice: per-response tool-call cap + pinned worst-case attempts; tokens/cost/wall-clock, inheritance and one retry graph are named later slices; depends on G2's RR-TOOL-WRITES-SEQUENTIAL, which edits the same Promise.all)

## 3. Capabilities, actions and connectors (effect classes, dispatcher, MCP, webhooks, action understanding, undo)

### REC-REAL-COMPENSATION — compensation really executes and verifies; never report undone work as undone
- Sources: issue#153 comment 6010007429 2026-10-06 (L10-GAP-14, L10-P20); issue#153 comment 6009696796 2026-10-06 (NEMO-GAP-08); docs/neuro-atlas-code-mapping.md:114, :360-363 (top-10 #7, saga); GC:594-600 and MC:484-485 (via A:SAFETYSHELL-DURABLE-IDEMPOTENCY, compensation half)
- Dedup: D:REAL-COMPENSATION and C:SAGA-AUTO-COMPENSATION are the same law (undo must really run and the record must not lie); A's compensation half folded in. The idempotency half of A's block is REC-DURABLE-EFFECT-IDEMPOTENCY (G1).
- Status: a for sagas, c for SafetyShell. Saga: compensation is recorded before each step (key-cortex/key-cortex-planner.service.ts:613-630 via KeyCortexCompensationService; key-cortex-tool-registry.service.ts:435-450), and a saga with no declared compensation is recorded 'compensation_unavailable', not 'compensated' (key-cortex-saga.service.ts:162-180). SafetyShell: rollback() refuses to report success for a non-empty list (key-autonomy/safety-shell.service.ts:74-125) and its only caller passes no rollback actions (key-action-executor.service.ts:31-37, :77), so nothing reports false undo today. No concrete RED exists: no caller needs SafetyShell rollback.
- Packets: none (no honest RED; the tripwire is already the honest state). Owner question OQ-12. Real per-capability undo is carried by RR-UNDO-DURABLE and RR-ACTION-BOUNDARY-NEXT-CAPABILITY.

### REC-EFFECT-CLASS — every capability declares effect class, idempotency, reversibility, version; writes in one model turn run in order, only independent reads in parallel
- Sources: GC:571-576; MC:402; CV:167-170; BP:41-53 (K5); KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:380-383 (COG-002); KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:224; KEY-CONCURRENCY-...-001.md:411-450; kernels/KF-KERNEL-005-CAPABILITY-FABRIC.md:134-147; 12-KERNEL-PROGRAMME.md:666-671; issue#153 comment 6008938834 2026-10-06 (s.7, s.8); issue#153 comment 6009218421 2026-10-06 (s.7, s.8, L8-GAP-04, L8-P07/P08/P09)
- Dedup: A:CAPABILITY-EFFECT-METADATA, C:ONE-CAPABILITY-REGISTRY (metadata half) and D:TOOL-CALL-EFFECT-SEQUENCING all ask for declared effect metadata; D adds the consumer (sequencing). C's "one registry" half is a later slice (named in RR-TOOL-EFFECT-CLASS scope, not a packet now).
- Status: c/d — FlowTool has family/riskLevel/riskTier/changedEntities/manualEquivalentRoute only (ai/flow-tool-registry.ts:23-43); chat and streamChat run all cleared calls with Promise.all (ai/flow-orchestrator.service.ts:2471-2473, 2993-2995); tier-1 writes, tier-2 at autonomy 4 and approved-tools reach that point without confirmation (ai/ai-oversight.service.ts:277-289). Plan grep effectClass/Promise.all/sequen: no overlap (KEY-TOOL-ALLOWLIST adds module family only).
- Packets: RR-TOOL-EFFECT-CLASS (P1, S; slice 1, effectClass READ/WRITE with strict defaults), RR-TOOL-EFFECT-METADATA (P2, M; idempotency, reversibility, contract version), RR-TOOL-WRITES-SEQUENTIAL (P1, S). Split by the packet-quality review.

### REC-DISPATCH-EFFECT-SAFETY — ActionDispatcher: no blind retry of a write after a generic error; atomic durable claim before effect; outcome-unknown blocks a new attempt
- Sources: BP:491-494; PD:168-198 (COG-P08); OA:249; R3:58-59, R3:75; GC:388-389 (G0-03); kernels/KF-KERNEL-011-RECOVERY-RELIABILITY.md:202-216; KF-KERNEL-009-INTEGRATION-EXTERNAL-REALITY.md:503-551; KF-KERNEL-010-FINANCIAL-TRUTH.md:382-421; 12-KERNEL-PROGRAMME.md:670-671; KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:1139-1157
- Dedup: A:DISPATCHER-EFFECT-AWARE-RETRY, C:ATOMIC-EXECUTION-CLAIM and C:OUTCOME-UNKNOWN-RECONCILE target the same seam (ActionDispatcherService.dispatch) and the same failure (a provider effect repeated). Split into two packets on that one file: retry policy first, then the claim.
- Status: c — 4xx/boundary answers are final (ai/action-dispatcher.service.ts:67-73, 203-215; W11-DISPATCH-REFUSAL-FINAL landed a3196eee); any other error is retried MAX_RETRIES=2 (:82, :139-157); idempotency is find-then-execute on AiExecutionLog (:112-118, :386-397), not a claim; BullMQ adds attempts (ai/queue.service.ts:148-160). The durable claim exists only for cortex tool calls (key-cortex/key-idempotency.service.ts:199, D-103 lease). Reconciliation from provider receipts: gap, later slice.
- Packets: RR-DISPATCH-NO-BLIND-RETRY (P1, S), RR-DISPATCH-ATOMIC-CLAIM (P1, S)

### REC-MCP-TENANCY — MCP bridge tenant-bound (per-business config/credential/cache) or provably off in v1
- Sources: MC:399; issue#153 comment 6009218421 2026-10-06 (s.11, L8-GAP-01, L8-P11); issue#153 comment 6008878520 2026-10-06 (MCP study)
- Dedup: A:MCP-TENANT-BINDING and D:MCP-TENANCY are the same file and the same false comment.
- Status: d — header claims per-business caching (mcp/mcp-client-manager.service.ts:19-25); code has one global Map (:29), ignores _businessId (:52), callTool has no business (:62), one env bearer per server (:118-121); FlowOrchestrator routes any mcp__* name to callTool without a business (ai/flow-orchestrator.service.ts:3957-3960); listing is not advertised (:1826-1842); dormant while MCP_REMOTE_SERVERS is empty (mcp/mcp.types.ts:24-26; .env.example:155 empty). Plan grep MCP: 0.
- Packets: RR-MCP-TENANT-BOUND (P1, S; becomes P0 if the owner confirms MCP_REMOTE_SERVERS is set in production). Safe either way: unset = no change; set but unbound = every bridged call refused. Owner question OQ-1.

### REC-CONNECTOR-CONVERGENCE — one connector substrate / connected-account model (ConnectorRegistry vs KeyConnector)
- Sources: GC:315, GC:411-412; MC:400-401; CV:319-326; issue#153 comment 6009218421 2026-10-06 (s.9, s.10, L8-GAP-02/03, L8-P04/P05/P06/P18); 6009194323 (Composio); 6009207249 (Arcade); 6010080039 (P1.5, packet E)
- Dedup: A:CONNECTOR-REGISTRY-CONVERGENCE and D:CONNECTOR-CONVERGENCE name the same two stacks.
- Status: c — core/connectors/connector-registry.service.ts (10 importers) and modules/key-connector/ (8 importers incl. key-cortex/organs/key-connector-adapter.service.ts) coexist; ~40 files touch prisma connectorStatus directly. Credential slices are plan (b): FU-DELIVERY-TOKEN-DECRYPT, W11-STORE-OWN-PAYMENT-KEYS, SWEEP-P0-FOLLOWUP. No unified connected-account model; plan grep KeyConnector/ConnectorRegistry = 0.
- Packets: RR-CONNECTOR-STACK-CENSUS (P3, S) — first slice; later slices (state model, merge) named in its scope.

### REC-CONNECTOR-CONFORMANCE — connectors pass a shared conformance + security harness (unverified != connected; no scope broadening) before activation
- Sources: KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md:498-513 (items 7, 10), :573-591; architecture-risks.md R63
- Dedup: single source (C:CONNECTOR-CONFORMANCE-HARNESS).
- Status: d — no shared harness (per-adapter specs only). New concrete finding this pass: Stripe, PayPal, Klaviyo, Mailchimp and QuickBooks report 'connected' on the platform's own env credential (implementations/stripe.connector.ts:48, 58-59, 91; paypal.connector.ts:42-43; klaviyo.connector.ts:45-51; mailchimp.connector.ts:60-66; quickbooks.connector.ts:51-53) and smokeTestConnector then writes ConnectorStatus 'connected' (core/connectors/connector-registry.service.ts:222-260), against the spirit of D-138.
- Packets: RR-CONNECTOR-CONFORMANCE (P2, S), gated on OQ-13 (state wording only; payments behaviour unchanged).

### REC-WEBHOOK-INGRESS-ENVELOPE — one verified ingress envelope for webhooks (signature, replay/dedup, tenant from trusted mapping)
- Sources: issue#153 comment 6009218421 2026-10-06 (s.15, L8-GAP-08, L8-P14/P15)
- Dedup: single source (D:EXTERNAL-OBSERVATION-INGRESS).
- Status: c (verified this pass) — per-provider verification exists (whatsapp.controller.ts:365-371 with tenant check assertMetaNumberIsBusiness :426-438; Twilio dedup claimTwilioDelivery :373-376; form-webhook.controller.ts:56-80 per-business secret; core/connectors/webhook-ingress-logger.service.ts redacts signatures); no common envelope (git grep ExternalObservation: none). Verified gap: POST /social/webhook/:businessId (social/social.controller.ts:143-175) trusts the path business after only the Meta app signature, while the shared /social/webhook resolves it from SocialConnection.platformId (:99-102). Plan: PR210-PAYPAL-STORE-REFUND, W1F-STORE-STRIPE-R0 cover payment webhooks; nothing covers social.
- Packets: RR-WEBHOOK-INGRESS-CENSUS (P1, S; raised from P2 at integration: live tenant-binding gap) — census + the social tenant fix; envelope type/storage is a later slice.

### REC-CAPABILITY-PAGING — task-scoped bounded tool selection; a missing allowlist never broadens
- Sources: issue #153 body (R&D-01A "capability paging"); issue#153 comment 6006031473 2026-10-06 (C4, Wave 4 P4.3/P4.5, P-TOOL-01); 6009218421 (s.6, L8-GAP-05, L8-P02); 6007335935 (E9 "Capability View")
- Dedup: single source (D:CAPABILITY-PAGING).
- Status: b — confirmed. The v1 surface reduction and "never broadens" are plan packets KEY-TOOL-ALLOWLIST (allowlist at prompt and dispatch), KEY-TOOL-DOMAIN-HIDE (per-business hidden families) and W11-OWNER-MAP-UNMAPPED-TOOLS (unmapped tools fail closed for an explicit owner map). Today's selection is lexical with MAX_TOOLS = 128 (ai/flow-orchestrator.service.ts:1844). The residual (semantic top-k with recall telemetry) has no honest RED until those land; it is post-v1 research follow-through, not a packet now. The one escape (the IntentParser list) is REC-NO-DUPLICATE-TOOL-LIST.
- Packets: none (b: KEY-TOOL-ALLOWLIST, KEY-TOOL-DOMAIN-HIDE, W11-OWNER-MAP-UNMAPPED-TOOLS)

### REC-NO-DUPLICATE-TOOL-LIST — IntentParser tool vocabulary derived from FLOW_TOOLS so allowlist/hide rulings apply
- Sources: BP:476-479; PD:102-129 (COG-P04, COG-P05); OA:92-106, OA:240; R3:50-51
- Dedup: single source (A:CAPABILITY-VIEW-NO-DUPLICATE-TOOL-LIST).
- Status: d — ai/intent-parser.service.ts:70-130 hand-lists 94 names (hidden families social_/projects_/community_/marketplace_/delegation_, and schedule_action, which is not a FLOW_TOOLS tool), injected at :155; served by ai.controller.ts:470-490 and graph-actions.controller.ts:965-990. KEY-TOOL-ALLOWLIST / KEY-TOOL-DOMAIN-HIDE do not name it (plan scope/DoD checked).
- Packets: RR-INTENT-PARSER-ONE-TOOL-LIST (P2, S, step 7 after KEY-TOOL-DOMAIN-HIDE)

### REC-LEGACY-CAPABILITY-DISPOSAL — classify the 14 legacy KeyToolRegistry tools vs FLOW_TOOLS, then remove the KeyCommand fallback
- Sources: FIG/packets/R1-B-CAPABILITY-FALLBACK-DISPOSAL-PACKET.md:1-67; FIG/implementation/R1-B-LEGACY-CAPABILITY-EXACT-EQUIVALENCE-MATRIX.md; FIG/control/R0-B-CAPABILITY-REGISTRY-EQUIVALENCE.md; FIG/audits/C3-CAPABILITY-OWNERSHIP-AUDIT.md; FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:25-30; FIG/ACTIVE-BLOCKERS-AND-ISSUES.md:205-221; DOS/SICP-COMPUTATIONAL-ABSTRACTION.md:13-23, 72-77; DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:39-49
- Dedup: single source (B:CAPABILITY-FALLBACK-DISPOSAL).
- Status: c — 14 tools registered (ai/key-tool-registry.service.ts:491-504); KeyCommand falls back (ai/key-command.service.ts:404, 510-520); KeyCortexActionsService injects it (key-cortex/key-cortex-actions.service.ts:120-121); unknown fails closed. Plan b for part: TOF-FINANCE-CANONICAL-TOOLS (finance tools), KEY-TOOL-ALLOWLIST (module classification). Not covered: the table and the removal.
- Packets: RR-LEGACY-TOOLS-CLASSIFY (P2, S), RR-LEGACY-FALLBACK-REMOVE (P2, M)

### REC-GOAL-CONVERGENCE — converge AiGoal/BusinessGoal; goal provenance projection
- Sources: FIG/packets/R1-A-GOAL-PROVENANCE-CONVERGENCE-PACKET.md:1-53; FIG/implementation/R1-A-GOAL-SYSTEM-EXACT-CONVERGENCE-MATRIX.md; FIG/control/R0-A-GOAL-SYSTEM-CLASSIFICATION.md; FIG/audits/C2-GOAL-COMMITMENT-DECISION-TRUTH-AUDIT.md; FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:18-23; FIG/TRANCHE-INSTITUTIONAL-INTELLIGENCE-001.md:73-74; FIG/CURRENT-STATE.md:227-241; FIG/ACTIVE-BLOCKERS-AND-ISSUES.md:223-226; PR #158 (tenant fix adopted, commit 5c988483)
- Dedup: B:GOAL-SYSTEM-CONVERGENCE; its done part is D:GOAL-TRACKER-ISOLATION (a).
- Status: c — tenant defects fixed (ai/goal-tracker.service.ts:112-118; key-cortex/key-cortex-planner.service.ts:152-161); both models live (packages/db/prisma/schema.prisma:7703 AiGoal with no provenance field, :8362 BusinessGoal); writers: key-cortex-planner.service.ts:172, 232; goal-tracker.service.ts:46, 116, 134, 198, 213, 298. /app/goals hidden in v1 (NAV-B-HIDE-2). No plan packet.
- Packets: RR-GOAL-WRITER-CENSUS (P3, S) — first slice; provenance projection and the convergence choice are later slices.

### REC-HEALTH-TO-CONTROL — pure deriveControl: degraded health only tightens control; governance read failure fails closed; module/organ health as an input
- Sources: FIG/packets/R1-C-HEALTH-TO-CONTROL-CONTRACT-PACKET.md:1-45; FIG/control/R0-C-HEALTH-TO-ACTION-SURFACE-MATRIX.md:23-39; FIG/audits/C5-COGNITIVE-HEALTH-ACTION-ADMISSION-AUDIT.md; FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:39-44; FIG/GENOME-V0.1-FOUR-AUDIT-CONVERGENCE.md:29, 53, 58; FIG/GENOME-V0.1-REPO-PRESSURE-TEST.md:137-149; FIG/GENOME-V0.1-CONVERGENCE.md:123-131; FIG/TRANCHE-COGNITIVE-LIFECYCLE-RESILIENCE-001.md:126-127; FIG/ACTIVE-BLOCKERS-AND-ISSUES.md:228-230; docs/neuro-atlas-code-mapping.md:219
- Dedup: B:HEALTH-TO-CONTROL and C:MODULE-HEALTH-VIA-ORGANS (organ health as the input); C's per-module health endpoint is a later input slice.
- Status: d — deriveControlRequirement has no health input (key-autonomy/action-boundary/control-clearance.ts:161-224; git grep health/homeosta/degrad over action-boundary: nothing); homeostasis (key-cortex/key-cortex-homeostasis.service.ts:175, 209) feeds only cognitive-triage; organ interface has healthy:boolean (key-cortex/organs/key-organ-adapter.interface.ts:22-23) unused for control. No plan packet.
- Packets: RR-HEALTH-TIGHTENS-CONTROL (P2, M)

### REC-SAFE-MODE — partial safe mode (reads + identity + audit stay; risky autonomy off), recorded entry/exit, recovery before resumption
- Sources: FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:46-50 (C6); FIG/GENOME-V0.1-FOUR-AUDIT-CONVERGENCE.md:30, 65; FIG/GENOME-V0.1-CONVERGENCE.md:123-131; FIG/TRANCHE-COGNITIVE-LIFECYCLE-RESILIENCE-001.md:60-92, 135-136; MS/garrytan-gstack.md:86-91; KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md:593-875; KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:1283-1304, 1508-1520; KEY-CONTINUOUS-LEARNING-...-001.md:533-558; issue #130 comment 5985219650 2026-10-04 (ASSURANCE-SAFE-MODE-001)
- Dedup: B:SAFE-MODE-CONTRACT, C:REGULATORY-PROGRAM-MODES and D:ASSURANCE-SAFE-MODE describe one partial-off state; the two-key half of D is REC-TWO-KEY (G4).
- Status: c — only all-or-nothing switches: KEY_DISABLED (core/config/env.ts:289-306, D-17) and plan KEY-CRONS-FLAGS. No partial mode (git grep SAFE_MODE/safeMode in apps/server/src: none).
- Packets: RR-KEY-SAFE-MODE (P3, S) — manual operator flag first; health-entered mode and recovery evidence are later slices.

### REC-ACTION-UNDERSTANDING — one server projection per KEY action (proposed/approval/executed/verified/reversibility), rendered by web; no misleading copy
- Sources: BR:253-321; BS:64-68; BG:182-198; CD:30, CD:82-85; TR/ACTION-UNDERSTANDING-TRACE-001.md:53-86, 88-182; DOS/NORMAN-DESIGN-EVERYDAY-THINGS.md:20-99; MS/garrytan-gstack.md:98-103, 141-142; FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:91; PR #156 body and comments 6011880236 / 6012018325 2026-10-06; issue#153 comment 6011887251 2026-10-06 (cluster 4)
- Dedup: A, B and D ACTION-UNDERSTANDING blocks are the same packet (KF-KEY-ACTION-UNDERSTANDING-001). Split server/web.
- Status: d — server serializes controlRequirement, failureReason and outcomeEvidence raw (key-autonomy/key-action-proposal.service.ts:725-778); no projection (git grep -i actionUnderstanding: nothing); web type lacks them (apps/web/src/lib/api/key-autonomy.ts:39); proposal-card.tsx:191-196 renders every BLOCKED as "blocked by KEY Genome readiness" though BLOCKED is written for boundary refusals (key-action-boundary.service.ts:835). Adjacent plan: W11-PROPOSAL-RESULT-READER-SCOPE, FU-PROPOSAL-REVENUE-SIGHT, FU-PROPOSAL-MONEY-TAG, TODAY-4BLOCK (none adds the projection).
- Packets: RR-ACTION-UNDERSTANDING-SERVER (P2, S), RR-ACTION-UNDERSTANDING-WEB (P2, S)

### REC-ACTION-RECEIPT-COVERAGE — more consequential capabilities go through Capability -> Control -> Clearance -> Claim -> OutcomeEvidence
- Sources: DOS/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:41-53, 131-133; TR/STRUCTURE-FUNCTION-STORAGE-TRACE-001.md:217-228; FIG/GENOME-V0.1-REPO-PRESSURE-TEST.md:96-106; FIG/GENOME-V0.1-FOUR-AUDIT-CONVERGENCE.md:64; FIG/ACTIVE-BLOCKERS-AND-ISSUES.md:228-230; TR/INFORMATION-VELOCITY-TRACE-001-DETERMINIZATION.md:225-228
- Dedup: single source (B:ACTION-BOUNDARY-COVERAGE).
- Status: c — boundary adopts one capability, BOUNDARY_CAPABILITIES = [HELPDESK_CREATE_TICKET] (key-autonomy/action-boundary/action-envelope.ts:21-27, comment: a second family is separately released work); other Flow writes use the bound confirmation (ai/flow-orchestrator.service.ts:3149, 3274-3405) with no outcome evidence. No plan packet extends adoption.
- Packets: RR-ACTION-BOUNDARY-NEXT-CAPABILITY (P2, M; commerce_send_invoice recommended, OQ-14)

### REC-DURABLE-UNDO — reversibility class per tool; undo state durable (not a 5-minute in-process Map)
- Sources: FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:71-74 (C10); FIG/GENOME-V0.1-CONVERGENCE.md:93-98; FIG/TRANCHE-INSTITUTIONAL-INTELLIGENCE-001.md:34-36, 70-71; DOS/NORMAN-DESIGN-EVERYDAY-THINGS.md:53-62; DOS/DECISION-ROUTING-KAHNEMAN-ALGORITHMS.md:93-106; TR/ACTION-UNDERSTANDING-TRACE-001.md:131
- Dedup: single source (B:REVERSIBILITY-CLASS); the class field lives in RR-TOOL-EFFECT-CLASS (REC-EFFECT-CLASS).
- Status: c — undo exists but in memory: ai/undo.service.ts:69-72 (Map, 5-minute window), :127-129 (setTimeout delete), process-local claim Set (~:73-81); writer action-dispatcher.service.ts:186-197; routes ai/agent.controller.ts ~262-300. No plan packet (plan "undo" hits are unrelated contact/stock undo).
- Packets: RR-MIGRATION-UNDO-TABLE (P3, S; the isolated migration, D-167, owner approval), RR-UNDO-DURABLE (P3, M; no backfill)

## 4. KEY cognition, learning and evaluation

### REC-ROUTING-RISK-FLOOR — caller-supplied risk context sets effort-tier floors and grants no authority
- Sources: A:COGNITIVE-ROUTING-RISK-FLOOR (BR:104-177; BS:59-62; BG:164-180; CD:31); B:COG-ROUTING-RISK-CONTEXT (TR/COGNITIVE-ROUTING-TRACE-001.md:37-134; DOS/DECISION-ROUTING-KAHNEMAN-ALGORITHMS.md:22-45,93-117; FIG/GENOME-V0.1-CONVERGENCE.md:116-121; FIG/TRANCHE-COGNITIVE-LIFECYCLE-RESILIENCE-001.md:39-44)
- Dedup: A and B propose the same change (risk input to CognitiveTriageService that only raises the tier); B adds the concrete context shape.
- Status: c — reflex is a whitelist of bare greetings that excludes confirmations (K/cognitive-triage.service.ts:207-209, :251-258); the standard/deliberate split is still text-score only (:134-153, :272); no risk input (signature :108; callers ai/flow-orchestrator.service.ts:2164, :2614). No plan packet (MEM-SALIENCE-SIGHT edits standingContext in the same file only).
- Packets: RR-TRIAGE-RISK-FLOOR (P3, S; after RR-ACTION-INTENT-ONE-CLASSIFIER and MEM-SALIENCE-SIGHT). Evidence-contradiction input left as a later slice: no deterministic source exists today.

### REC-NO-SELF-PROMOTION — self-generated tuning stays a candidate until a human admits it
- Sources: B:SELF-EVAL-NO-SELF-PROMOTION (DOS/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:55-74,147-148; DOS/SICP-COMPUTATIONAL-ABSTRACTION.md:58-62,76; FIG/GENOME-V0.1-CONVERGENCE.md:100-105,159-164; FIG/CURRENT-STATE.md:176-189)
- Dedup: single source.
- Status: c — K/key-cortex-evolution.service.ts:528-610 selfTune applies model-chosen adjustments directly (:589-599) through updatePreferences (:1875, :1887) and AiMemory 'evolution_tuning' (:1901-1909). `git grep selfTune` shows only the definition, so it is unreachable (a latent defect). Prompt-variant choice inside a fixed set (adaptive-router) is allowed bounded exploration.
- Packets: RR-SELFTUNE-CANDIDATE-ONLY (P3, XS): delete the dead path and add a structural spec. Removes a dormant AiMemory writer; coordinate with MEM-CENSUS's registry (D-257).

### REC-LEARNING-SEMANTICS — tool success is not user acceptance, and acceptance does not calibrate factual confidence
- Sources: B:ACCEPTANCE-NOT-CORRECTNESS (TR/EPISTEMIC-TRACE-001-EVIDENCE-GENOME-MEMORY-LEARNING.md:145-180,182-228; FIG/TRANCHE-NEGOTIATION-ECOLOGY-DISAGREEMENT-001.md:30-35; DOS/WEINBERG-PSYCHOLOGY-OF-COMPUTER-PROGRAMMING.md:32); D:LEARNING-OUTCOME-SEMANTICS (issue #151 body; issue#153 comment 6009649322 2026-10-06 L9-P02/L9-P14; issue #131 body)
- Dedup: both name the same line (recordOutcome maps tool success to accepted/rejected) and the same fix.
- Status: d — K/key-cortex-learning.service.ts:121-127 (userResponse success ? 'accepted' : 'rejected', confidence 0.85/0.4), called from K/key-cortex-tool-registry.service.ts:897; getAcceptanceRate :279-310 counts them; calibrateConfidence :317-340 used by K/key-cortex-query-pipeline.service.ts:1056. No plan packet (grep recordOutcome|calibrateConfidence|key-cortex-learning: none).
- Packets: RR-LEARNING-OUTCOME-SEMANTICS (P3, S; after MEM-CENSUS). MEM coordination: CognitionMemory is in MEM-CENSUS's store list; no MEM packet changes userResponse semantics (MEM-CLASS-COLUMNS covers AiMemory/AiMemoryEmbedding/TemporalFlowMemory only); the packet changes no read predicate, projection or member scope (D-130); memory-consolidation.service.ts:238 promotes only accepted rows at confidence >= 0.9, so tool rows (0.85) were never promoted.

### REC-GOVERNED-LEARNING — learned signals only narrow autonomy, never widen it
- Sources: A:GOVERNED-LEARNING-NARROWS-ONLY (BG:278-289; GC:242-260, GC:498-499)
- Dedup: single law. The neuro atlas's "feed scores into tool selection" (C:LEARNING-TO-TOOL-SELECTION) is a different change and now has its own row, REC-OUTCOME-WEIGHTED-TOOL-SELECTION (split by the fidelity review).
- Status: a — confirmed: apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts:302-330, where ToolOutcomeScore can only force supervised (<50%) or block (<30%, >=5 uses), never widen. C's gap is real: getToolScoreForBusiness has no caller outside the registry (K/key-cortex-tool-registry.service.ts:808; only internal uses at :878/:882). It stays post-v1: it conflicts with the static v1 allowlist (KEY-TOOL-ALLOWLIST), and learned preference may only re-rank, never change availability. Caveat, handled by the REC-LEARNING-SEMANTICS packet: the score counts execution success, not verified outcome.
- Packets: none (done on main; the consumer is post-v1 under KEY-TOOL-ALLOWLIST).


### REC-OUTCOME-WEIGHTED-TOOL-SELECTION — learned tool outcome scores automatically adjust tool-selection weights
- Sources: docs/neuro-atlas-code-mapping.md:44 (LTP/LTD: "learning output automatically adjusts tool-selection weights"); worker-notes/notes-C-neuro-arch.md (C:LEARNING-TO-TOOL-SELECTION)
- Dedup: split out of REC-GOVERNED-LEARNING by the fidelity review (a different change from the narrowing law).
- Status: d — ToolOutcomeScore is recorded and read per business (apps/server/src/modules/key-cortex/key-cortex-tool-registry.service.ts:677, :808) but getToolScoreForBusiness has no caller outside the registry (:878, :882); nothing weights tool selection by it.
- Packets: none. The score counts execution success, not outcome (key-cortex-tool-registry.service.ts:802-826), and using it to choose tools would reward what REC-LEARNING-SEMANTICS (RR-LEARNING-OUTCOME-SEMANTICS) is fixing; tool exposure is being reduced by plan packets KEY-TOOL-ALLOWLIST and KEY-TOOL-DOMAIN-HIDE first. Owner question OQ-38.

### REC-EVAL-ONLINE-CALIBRATION — evals get repeated-trial (stochastic) admission semantics, online evaluation rules and monitors, and a production-regression intake with human annotation and calibration
- Sources: issue#153 comment 6009649322 2026-10-06 (L9-GAP-10, L9-GAP-11, OBS-EVAL-4)
- Dedup: single source; added by the fidelity review (missing from the first pass). Its versioned-artifact half is REC-EVAL-LINEAGE.
- Status: d — no repeated-trial, online-monitor or annotation code (`git grep -n -i "repeatedTrial|onlineEval|annotation" 2c4e4bf2 -- apps/server/src/modules/key-cortex` finds nothing relevant); the eval harness itself is not yet honest (REC-EVAL-HONEST).
- Packets: none now: it needs RR-EVAL-HARNESS-NO-VACUOUS and RR-EVAL-RUN-LINEAGE first, and a production intake needs a privacy gate the source itself requires. Owner question OQ-39 (post-v1 or v1).
### REC-EVAL-HONEST — eval suites cannot pass vacuously; NOT_RUN is distinct; the harness runs in CI
- Sources: A:EVAL-HARNESS-HONEST-SUITES (GC:322-323, GC:408-409, GC:578-584; CV:82-93; MC:432-436; BG:241-256; KNG:606); D:EVAL-HARNESS-NO-FAKE-GREEN (issue #151 body E3/E5; issue#153 comments 6009649322 2026-10-06, 6006031473 2026-10-06, 6008383152 2026-10-06); C:KEY-EVAL-IN-CI (docs/neuro-atlas-code-mapping.md:375-378; KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:796-797, :851)
- Dedup: same file, same vacuous checks, same proof obligation (negative controls). C's CI half is MEM-EVAL-SUITE's.
- Status: c — K/eval-harness.service.ts:208 (`ruleTrace.length >= 0`), :243-245 (any step), :183-185 (shape only), :179/:201/:221/:240 (an unwired dependency reported as a plain FAIL); runSuite of an empty suite is green and allPass is `every(failed===0)` (K/key-cortex-audit.controller.ts:130); no workflow references the harness. MEM-EVAL-SUITE (b) covers the memory suites and the CI run, and edits the same file.
- Packets: RR-EVAL-HARNESS-NO-VACUOUS (P2, S). Land it before MEM-EVAL-SUITE. The retrieval suite is only relabelled INDETERMINATE; it is not rewritten (D-257).

### REC-COGNITIVE-TEST-DOUBLE — scripted fake model and trajectory assertions for KEY loops
- Sources: A:DETERMINISTIC-COGNITIVE-TEST-DOUBLE (PD:224-251 COG-P13/P14; OA:174-188; R3:74); D:DETERMINISTIC-MODEL-TEST-DOUBLE (issue#153 comment 6007335935 2026-10-06 E12/E13/G); D:COGNITIVE-TRACE-ASSERTION (6007335935 2026-10-06 E14/H; 6009649322 2026-10-06 s.21; issue #151 body E7)
- Dedup: the fake model and trajectory assertion are one harness; the no-network half is planned.
- Status: c — no-network half b (FU-UNIT-MOCK-ISOLATION, FU-UNIT-GUARD-CI; apps/server/test/helpers/unit-network-guard.js). No shared scripted model: each Flow spec hand-rolls an aiUsage stub (ai/flow-confirmation-binding.spec.ts:177-180). `git grep -i fakeModel|scriptedModel|trajectory` finds nothing under the KEY modules.
- Packets: RR-KEY-FAKE-MODEL-TRAJECTORY (P2, M; after FU-UNIT-MOCK-ISOLATION). Its RED is a negative control, because it pins correct behaviour.

### REC-EVAL-LINEAGE — versioned eval datasets, evaluators and runs
- Sources: D:EVAL-ARTIFACT-LINEAGE (issue#153 comments 6009649322, 6009634232, 6009565150, all 2026-10-06; issue #151 body E2/E6, deliverables 4-9)
- Dedup: single source.
- Status: d — K/eval-harness.service.ts:13-35 has no version, definition identity or commit; `git grep EvalDataset|EvaluatorRevision|ExperimentRun` finds nothing. MEM-EVAL-SUITE records baselines for memory only.
- Packets: RR-EVAL-RUN-LINEAGE (P3, XS; first slice). Later slices are run history, dataset revisions, repeated-trial admission and privacy-gated regression cases.

### REC-ONE-COGNITIVE-RUNTIME — converge Flow, Deep Think and QueryPipeline into one runtime with depth modes
- Sources: C:ONE-COGNITIVE-RUNTIME (KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md:375-378, :426-441; KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:223, :264-265; KEY-COGNITIVE-REACHABILITY-MAP-002.md:102-122, :316-374)
- Dedup: single source (C also folds the Deep Think efferent idea into it, which is ruled under D-208).
- Status: d — four runtimes start turns: Flow chat/streamChat (callers ai/flow.controller.ts:39, :76, :144; structure/staff-chat-bridge.service.ts:172; chatwoot/chatwoot.service.ts:128), processConsciously (K/key-cortex.controller.ts:4490, :4563; ai/flow-orchestrator.service.ts:1284), reasoning.processQuery (K/key-cortex.controller.ts:1882) into QueryPipeline (K/key-cortex-reasoning.service.ts:217). No inventory and no plan packet. **D-17 keeps both pipelines in v1**, so convergence itself conflicts with a ruling.
- Packets: RR-COG-RUNTIME-ENTRY-CENSUS (P3, S; read-only first slice). Later slices need the owner to revisit D-17 (see owner questions).

### REC-ONE-APPROVAL-MODEL — KeyActionProposal, AiApprovalItem and ApprovalRequest converge into one clearance flow
- Sources: C:ONE-APPROVAL-MODEL (kernels/KF-KERNEL-003-KEY-AUTHORITY-GOVERNANCE.md:207-222; 12-KERNEL-PROGRAMME.md:666-673)
- Dedup: single source.
- Status: d — packages/db/prisma/schema.prisma:1959 KeyActionProposal, :7495 AiApprovalItem, :10571/:10602 ApprovalRequest/ApprovalStep, plus a fifth the note missed: :12360 AiApprovalRequest, which no code references (dormant). Flow confirmations are IdempotencyKey rows (flow-orchestrator bindFlowConfirmation). Writers: 6 / 17 / 9 non-spec files. Plan only touches KeyActionProposal visibility (SWP-CENSUS-KEY-B, TODAY-AGGREGATE).
- Packets: RR-APPROVAL-MODEL-CENSUS (P3, M; read-only first slice). The clearance read model and migration are later slices.

### REC-SPECIALIZATION-CONTRACT — role engine, triage, router, lens and autonomy classification as one typed contract
- Sources: C:KEY-SPECIALIZATION-COMPILER (docs/neuro-atlas-code-mapping.md:370-373; KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:228, :261-262; KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md:236-267, :395-396; KEY-COGNITIVE-REACHABILITY-MAP-002.md:275-288, :304-314; KEY-CONCURRENCY-...-001.md:852-875)
- Dedup: single source.
- Status: d — the five services are independent (ai/role-engine.service.ts, K/cognitive-triage.service.ts, K/adaptive-router.service.ts, K/key-cortex-expertise-lens.service.ts, key-autonomy/autonomy-orchestrator.service.ts). New concrete evidence: six action-intent regexes disagree (ai/flow-orchestrator.service.ts:1243; K/adaptive-router.service.ts:244, :320; K/key-cortex-reasoning.service.ts:372; K/key-cortex-structured-output.service.ts:21; K/key-cortex-session.service.ts:395). On Cortex, "cancel / refund / pay / remove" get no actions layer (includeActions needs it, K/adaptive-router.service.ts:105-106).
- Packets: RR-ACTION-INTENT-ONE-CLASSIFIER (P2, S; first slice; **renamed from MASTER's RR-SPECIALIZATION-CENSUS** because it unifies the classifier rather than taking a census). The typed SpecializationVerdict is a later slice.

### REC-REFLECTION-PERSIST — reflection hypotheses persist
- Sources: C:REFLECTION-PERSISTENCE (docs/neuro-atlas-code-mapping.md:350-353; KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:240; KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:417)
- Dedup: single source.
- Status: c (the note said d; corrected) — sessions persist in KeyCortexMemory (persistSession; K/key-cortex-reflection-persistence.spec.ts), and validated or rejected hypotheses persist (K/key-cortex-reflection.service.ts:663, :670). The gaps:
  - new hypotheses live only in an unbounded in-process Map (:133, :1202);
  - validation can never confirm a hypothesis (:653-655);
  - maintenance reports work it did not do (:505-506, :523-524 against :1471-1474, :1485, :1492), and that report reaches consciousness through getLastReflectionSession (key-cortex-consciousness.service.ts:1138).
- Packets: RR-REFLECTION-HONEST (P3, S; after MEM-CENSUS): honest reporting and a bounded journal. Persisting new hypotheses is held back: the memory design (KEYFLOW-MEMORY-SYSTEM-DESIGN-001.md §3.3, branch docs/kf-memory-rnd-001) puts model-written reflections in the T3 HYPOTHESIS/AGENT_INFERRED store, which no v1 MEM packet builds (D-257). Owner question below.

### REC-EMOTION-ENDOCRINE — detected emotion and feedback feed endocrine state
- Sources: C:EMOTION-TO-ENDOCRINE (docs/neuro-atlas-code-mapping.md:100, :247, :254, :340-343)
- Dedup: single source.
- Status: c — endocrine.release is called from consciousness (:724), homeostasis (:199), immune (:259) and salience (:214); K/key-cortex-emotion.service.ts, K/key-cortex-mood-detection.service.ts and the KeyInteractionFeedback write (K/key-cortex-interaction.service.ts:149) never call it.
- Packets: none. No concrete, testable, human-agency-safe change exists:
  1. Endocrine state is per business (effortMultiplier(businessId), K/key-cortex-endocrine.service.ts:372-377), so one member's detected frustration would change KEY's effort and prompt framing for every other member. That is a cross-member signal, not a benefit.
  2. Triage deliberately refuses to weight the mood classifier because it measures phrasing, not stakes (K/cognitive-triage.service.ts:124-133).
  3. Dopamine from positive ratings is reward-shaping toward approval (sycophancy), and dopamine is already excluded from effort (:368-371).
  4. No user-visible improvement can be stated as a RED.
  MEM-SALIENCE-SIGHT also owns endocrine prompt text.

### REC-DOC-VOICE-ORGANS — document and voice as organ adapters emitting cortex events
- Sources: C:KEY-DOCUMENT-AND-VOICE-ORGANS (docs/neuro-atlas-code-mapping.md:79, :86, :355-358)
- Dedup: single source.
- Status: d — K/organs/ holds connector, genome, inbox, storelink and temporal-flow adapters only. The document path is K/key-cortex-document.service.ts plus ai/document-intelligence.service.ts:415, :430 (AiMemory document_extraction); voice is K/key-cortex-voice.service.ts. None publishes to the cortex bus. No plan packet.
- Packets: none now:
  1. No consumer of a `document.parsed` or `speech.heard` event exists, so the RED would only test the plumbing it adds.
  2. Document extractions already leak money to readers without revenue read through AiMemory. MEM-DOC-EXTRACTION-SIGHT (P0) closes that by failing closed under D-234. Broadcasting extractions onto the bus, which mirrors to CognitiveEvent memory, would add a second path ahead of that fix.
  3. A new event type fails closed under D-227 until classified (FU-KEY-EVENT-COLUMNS).
  Revisit after MEM-DOC-EXTRACTION-SIGHT and FU-KEY-EVENT-COLUMNS land, with a named consumer (owner question below).

### REC-CASH-TARGET — owner-set cash-flow target with corrective suggestions, revenue-scoped
- Sources: C:CASHFLOW-TARGET-CORRECTIVE (docs/neuro-atlas-code-mapping.md:282)
- Dedup: single source.
- Status: c — runway truth is planned (W11-GENOME-RUNWAY, W11-RUNWAY-LEDGER-CASH, W11-CASH-READERS-LEDGER). The only corrective move is hard-coded `runwayMonths < 3` (apps/server/src/modules/finance/money-moves.service.ts:139). `git grep -i cashTarget|cash_target|runwayTarget` finds nothing.
- Packets: RR-MIGRATION-CASH-TARGET (P3, XS; the isolated Business column migration, D-167, owner approval), RR-CASH-TARGET (P3, S; step 5; after W11-RUNWAY-LEDGER-CASH). It adds one nullable Business column (schema named). It is read under revenue read and written under revenue write (D-100, D-128, D-205, D-233, D-234), fails closed, is suggestion-only, and leaves the D-205 release0 test file unedited.

## 5. Observability, operations and architecture ratchets

### REC-AI-TRACE-SPINE — AI traces move off Langfuse's legacy ingestion to OTLP, failed attempts and fallbacks are traced under one trace with correlation ids, exporter failures are visible, and business id stops being sent as user id
- Sources: docs/intelligence/research/GENAI-RD-OTEL-LANGFUSE-PACKET-DERIVATION.md:1-291 (esp. :24-31 deadline 2026-11-16, :58, :159, :197, :224); GENAI-RD-MASTER-CONTINUATION.md:593-630, :698 (GC:399-400, :542-550, :614 obligation 10 per worker A); CV:152-155, :284-297; MC:427-437, :596-630; BP:501-514; PD:131-166 (COG-P07); OT:107-121, :137-144; issue#153 comments 6009369621 (2026-10-06, LF-GAP-01..10), 6009649322 (2026-10-06, s.3-8, s.25-29, L9-GAP-01..05/12/13, L9-P01..P07), 6010080039 (2026-10-06, P1.1), 6010232840 (2026-10-06, packet KF-ASSURANCE-OTEL-LANGFUSE-COMPAT-001), 6010564277 (2026-10-06), 6010442954 (2026-10-06, candidate B), 6009291467 (2026-10-06, LS-GAP-01/02/06/08), 6009595072 (2026-10-06, PHX-GAP-01..08), 6009634232 (2026-10-06, WEAVE-GAP-06); issue #130 body (ASSURANCE-OBS-001); issue #151 body (E4); KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:159-177, :790-791, :845, :1384-1398; architecture/target-architecture.md:117-118
- Dedup: A:LANGFUSE-OTEL-MIGRATION + A:TELEMETRY-EXPORTER-HEALTH + D:LANGFUSE-OTEL-COMPAT are the same cutover (endpoint, non-fatal visible exporter, metadata-only); A:OCCURRENCE-ATTEMPT-EFFECT-LINEAGE + D:AI-EXECUTION-TRACE-SPINE + C:CORRELATED-OBSERVABILITY are the attempt/correlation half. Split into two packets; the lineage beyond the gateway (queue attempt, claim, effect ids) and OTel SDK adoption are named later slices.
- Status: d — apps/server/src/modules/ai/langfuse.service.ts:127 POSTs `/api/public/ingestion`; failures warn only (:137-143); userId: input.businessId (:80); random trace id per call (:71); traced only from the cost recorders on success (model-gateway.service.ts:979, :1022), failed candidates only logged (:933-937, :1165-1170); GatewayRequest has no correlationId (model-gateway.service.ts:57-72); no @opentelemetry/openinference in apps or packages; plan grep langfuse|otel|opentelemetry|telemetry: no packet. Privacy default (metadata only, langfuse.service.ts:94-119) is already met. COST-LEDGER-001.md:69 records Release 0 as "off" for Langfuse.
- Packets: RR-LANGFUSE-INGESTION-CUTOVER (P2, S), RR-AI-TRACE-ATTEMPTS-CORRELATION (P3, S). Both: tests stub fetch, no real provider/Langfuse traffic; exporter failure stays non-fatal. Priority is P2 not P1 because Release 0 declares Langfuse off; it becomes P1 if the owner says keys are set in production (OQ-2).

### REC-SLO — SLOs and error budgets for critical services
- Sources: KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:179-187, :802-803
- Dedup: single source
- Status: d — .github/workflows/uptime-monitor.yml probes every 5 min; scripts/uptime-monitor.sh:9-10, :53-54 probes web /api/healthz and api /readyz and keeps only consecutive-failure counters (:87, :184-185); no SLO or error-budget artifact (git grep -i 'error budget|SLO' scripts .github: none); plan grep '\bSLO' hits only booking-slot text.
- Packets: RR-SLO-AVAILABILITY-LEDGER (P3, S). Availability only; latency/error SLOs need an APM (later), and "error budget modulates release and KEY autonomy velocity" is an owner question (2), not a packet.

### REC-DEBUG-CAPSULE — serious failures emit a bounded capsule (sha, correlation id, class, replica)
- Sources: KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:563-594, :793-794
- Dedup: single source
- Status: c — bounded, redacted ErrorRegistry exists (apps/server/src/core/observability/error-registry.ts:80-164; RecordedError :38-48 has no sha/replica/correlation); filter records 500s without the correlation id it holds (core/filters/http-exception.filter.ts:32, :79); release identity exists (packages/shared/src/release-version.ts:57, Dockerfile:131-139). Gap: capsule fields. Plan grep capsule|error-registry: none.
- Packets: RR-ERROR-CAPSULE (P3, S). Invariant/timeline/seed/flags are later slices.

### REC-SECURITY-SIGNALS — runtime aggregation of security signals
- Sources: KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:543-560, :1306-1322
- Dedup: single source
- Status: c — CI tripwires exist (apps/server/src/core/auth/public-surface.spec.ts, core/config/rest-scope-census.spec.ts, .github/workflows/hawkscan.yml, native-dast.yml, deploy-drift.yml); runtime sites only throw or warn: auth.middleware.ts:583, business.guard.ts:139, module-scope.guard.ts:78, business-member.guard.ts:30, webhooks.controller.ts:146-147, payments.service.ts:1393, form-webhook.controller.ts:93-95, inbound-communications.controller.ts:101. Gap: no counter/aggregation. Plan grep 'security signal': none.
- Packets: RR-SECURITY-SIGNAL-COUNTERS (P3, S). Coordinate with G2's RR-WEBHOOK-INGRESS-CENSUS (shared refusal point if it lands first).

### REC-INTEGRITY-WATCHER — read-only runtime invariant monitor
- Sources: docs/neuro-atlas-code-mapping.md:310; KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:614-621, :1306-1322
- Dedup: single source (two docs, one change)
- Status: c — deploy/migration drift watched (.github/workflows/deploy-drift.yml); W11-PLANTED-STOCK-CENSUS covers inventory_stocks cross-business rows only; no runtime check for child/parent business mismatch on Payment/Invoice/Booking (schema.prisma models Payment, Invoice, Booking carry both business_id and parent ids; no constraint ties them). Worker C's sample "duplicate settled payment per provider id" is FALSE as a gap: Payment.providerPaymentId is @unique, so it is dropped from the packet.
- Packets: RR-INTEGRITY-WATCH (P3, S). Ids/counts only, super-admin only; no amounts (D-238 not engaged); repairs are separate dry-run-first packets on owner authority.

### REC-CRON-OCCURRENCE-CLAIM — crons take an occurrence claim so they cannot double-fire
- Sources: kernels/KF-KERNEL-007-TEMPORAL-EVENT-WORKFLOW.md:502-540; KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:239; KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:416
- Dedup: single source (merged with the multi-replica cron defect note, worker C)
- Status: c — 29 @Cron handlers (17 in key-cortex); the only SET NX is identity-password.service.ts:503; no advisory lock/leader election; some jobs idempotent by construction (analytics-engine.service.ts:64 upsert; whatsapp.service.ts:893-897 row claim), ContractRenewalSweep emits per due contract each run (contract-renewal.sweep.ts:155); MEM-CONSOLIDATION-CHECKPOINT (b) covers consolidation only; production has one api service (docker-compose.production.yml:73), so latent.
- Packets: RR-CRON-OCCURRENCE-LOCK (P3, S). Intervals (29 safeInterval/@Interval sites) are a later slice.

### REC-JOB-TENANT-CONTEXT — every background job runs inside runWithTenant(businessId)
- Sources: architecture/target-architecture.md:96; architecture/migration-plan.md:41; architecture/architecture-risks.md R4
- Dedup: single source
- Status: c — runWithTenant (core/tenant/tenant-context.ts:14-20) used only at tenant.interceptor.ts:51 and key-cortex-audit.controller.ts:93; the Prisma tenant extension is inert without a context (packages/db/src/client.ts:9-18, :78; main.ts:68); readers treat no-context as SYSTEM (bookings.service.ts:843-847 and four others). Plan grep runWithTenant|'tenant context': none.
- Packets: RR-JOB-TENANT-CONTEXT (P2, M): helper with no user id + census + first adoption (homeostasis loop). Other jobs: later slices named in the census.

### REC-STATE-TRANSITION-COMMANDS — lifecycle status fields change only through transition commands, never generic PATCH
- Sources: kernels/KF-KERNEL-006-STATE-TRANSITION.md:157-163
- Dedup: single source
- Status: c (b for the covered domains; reclassified by the fidelity review) — covered: orders (W1F-ORDER-TRANSITIONS, W11-ORDER-CANCEL-RELEASE), invoices (PATCH restricted, commerce/dto/update-invoice.dto.ts:4-18, :79-85), procurement (decision statuses refused, procurement.service.ts:188-196), contact mass-assign (FU-DATAQUALITY-MASS-ASSIGN). VERIFIED residuals with no plan packet: change orders (change-order.controller.ts:76-85 status any string + client approvedBy/approvedAt, written unchecked at change-order.service.ts:115-131; web approves by PATCH, apps/web/src/app/app/change-orders/page.tsx:59) and contracts (update-contract.dto.ts:25-27, contracts.service.ts:169-190 any→any; TERMINATED→ACTIVE re-arms ContractRenewalSweep obligations, contract-renewal.sweep.ts:48, :93-96). Twelve Update*Dto classes carry a status field in total (listed in the census packet). Plan grep change.order|ChangeOrder|approvedBy|TERMINATED: only SWP-CENSUS-HIDDEN/NAV-B-HIDE-2 (scope guard / hiding, not transitions).
- Packets: RR-STATUS-PATCH-CENSUS (P3, S), RR-CHANGE-ORDER-APPROVE-COMMAND (P2, S; forged approver attribution). Contracts registered OPEN pending OQ-21.

### REC-ONE-EVENT-SUBSTRATE — one event substrate; audit publish-only / listen-only events
- Sources: KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:385-388 (COG-003); KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:225; architecture/target-architecture.md principle 3; architecture/architecture-risks.md:56 (R9), R58; architecture/migration-plan.md:88
- Dedup: C:ONE-EVENT-SUBSTRATE + C:DEAD-EVENT-AUDIT (the audit is the first slice of the convergence)
- Status: c — listen-only direction is ALREADY ratcheted (apps/server/src/core/event-bus/event-wiring.spec.ts:88 with shrink-only KNOWN_DEAD from :49, analyser apps/server/scripts/event-wiring.ts) — worker C's "no packet / d" missed this. Gap: publish-only direction (architecture/event-registry.yaml totals: 115 published-only) has no ratchet; onAny consumers (event-emitter-flow-bridge.service.ts:142-147, agent-trigger.service.ts:256-257) make some publish-only events live. Four buses coexist (key-cortex-event-bus, cognitive-event-bus, event-emitter-flow-bridge, flow-signal-bridge). Plan grep publish-only|dead event: none.
- Packets: RR-DEAD-EVENT-CENSUS (P3, S). Substrate convergence: later slices, not packets now.

### REC-EFFECTIVE-AUTHORITY — the effective-authority resolver leaves shadow mode and enforces
- Sources: kernels/KF-KERNEL-002-HUMAN-AUTHORITY-ORGANIZATION.md:206-214; KF-KERNEL-001-TENANT-GENESIS-IDENTITY.md:179-190; 12-KERNEL-PROGRAMME.md:98, :630, :666-667
- Dedup: single source
- Status: c — resolver exists (core/authority/effective-authority.resolver.ts), runs in shadow only (core/auth/module-scope.guard.ts:88-92, :113-144; mismatch is a warn line :131-137); shadow family pinned to AiSettingsController (core/authority/authority-shadow.spec.ts:185-199). Gap: no counted parity evidence; no cutover. Plan grep effective.authority|ShadowEffective: none.
- Packets: RR-AUTHORITY-SHADOW-PARITY (P2, S): evidence only. The cutover changes who may do what: OQ-22.

### REC-ARCH-FORWARDREF — no new forwardRef cycles; replace existing with events/facades
- Sources: architecture/architecture-risks.md:48 (R1); architecture/target-architecture.md:90, :139; architecture/migration-plan.md:55
- Dedup: single source
- Status: d — 196 `forwardRef(` in 95 non-spec server files (314 incl. specs); no ratchet. Plan grep forwardRef: only W11-RUNWAY-LEDGER-CASH (unrelated mention).
- Packets: RR-FORWARDREF-RATCHET (P3, XS).

### REC-ARCH-WEB-CLIENT — retire apps/web/src/lib/client.ts in favour of lib/api/<domain>.ts
- Sources: architecture/target-architecture.md:105-108, :141; architecture/migration-plan.md:66-80; architecture/architecture-risks.md R7
- Dedup: single source
- Status: c — 47 domain modules in apps/web/src/lib/api/; client.ts is 15,538 lines with 465 '@/lib/client' importers (483 any specifier); scripts/split-client.mjs and classify-client.mjs exist (earlier split tooling); no importer ratchet. FAILURE-KIT (b) explicitly leaves client.ts transport alone.
- Packets: RR-WEB-CLIENT-RATCHET (P3, XS). Migration itself: later slices.

### REC-ARCH-KEY-CORTEX-SPLIT — split key-cortex into four modules with contracts
- Sources: architecture/target-architecture.md:84-90, :140; architecture/migration-plan.md:49-63; architecture/architecture-risks.md:49 (R2)
- Dedup: single source
- Status: d — 264 .ts files (147 non-spec, 78,108 lines; key-cortex.controller.ts 4,811 lines); no ratchet, no plan packet.
- Packets: RR-KEY-CORTEX-SIZE-RATCHET (P3, XS). The split: later, must keep D-129 and D-208 routes.

### REC-ARCH-LEGACY-MODELS — mark or remove unused legacy Prisma models
- Sources: architecture/architecture-risks.md R11; architecture/target-architecture.md:101-103; architecture/migration-plan.md:98-110
- Dedup: single source
- Status: d — 441 models in packages/db/prisma/schema.prisma; heuristic accessor scan finds ~38 with no direct delegate use (e.g. FlowRoleSubscription, BusinessIdentityProfile, FounderProfile, *Profile family); no census; plan grep 'unused model|legacy model': none (MIGRATION-SET-A/B are additive).
- Packets: RR-UNUSED-MODEL-CENSUS (P3, S). Renames/drops are schema packets later, on owner authority.

### REC-ARCH-SCANNER-CI — CI runs inventory.py and dependency_scan.py and reports/fails on map drift
- Sources: architecture/migration-plan.md:25
- Dedup: single source
- Status: c — scanners exist, stdlib-only (.agents/skills/codebase-architect/scripts/inventory.py, dependency_scan.py); FU-ARCH-MAP-REFRESH (b) regenerates maps on owner authority; no workflow runs them (grep .github/workflows: none).
- Packets: RR-ARCH-SCAN-CI (P3, S), report-only, depends on FU-ARCH-MAP-REFRESH. Blocking mode: OQ-23 (a blocking gate collides with CLAUDE.md's "no programme-map refresh without explicit authority").

### REC-THROUGHPUT-METRIC — KEY actions-per-hour metric per business
- Sources: docs/neuro-atlas-code-mapping.md:163
- Dedup: single source
- Status: d — git grep actionsPerHour|metabolic|throughput (as a metric) in apps/server/src: none; KeyActionProposal has executedAt/status to count from (schema.prisma model KeyActionProposal); KeyCortexHomeostasisService VARIABLES (key-cortex-homeostasis.service.ts:79-109) is the natural host.
- Packets: none (OQ-24). Reasons: (1) no reader or decision uses the number, so no honest RED beyond "the endpoint exists"; (2) the natural host feeds KeyCortexEndocrineService.release (key-cortex-homeostasis.service.ts:175-205), i.e. KEY would modulate its own behaviour from its own throughput, which the human-agency doctrine (learning never grants itself authority) argues against without a ruling; (3) per-type counts of executed money actions are sales-derived (D-234) and would need revenue:read and fail-closed handling.

## 6. Security, tenancy and privacy register (architecture/architecture-risks.md, security-tenant-privacy-audit.md)

### REC-BANK-TOKEN-ENCRYPTION — BankConnection.accessToken is encrypted at rest.
- Sources: architecture/architecture-risks.md:63 (R16); architecture/security-tenant-privacy-audit.md:34, :53; worker-notes/notes-C-neuro-arch.md:292-296 (C:BANK-TOKEN-ENCRYPTION).
- Dedup: single source (C:BANK-TOKEN-ENCRYPTION).
- Status: c — ENCRYPTED_FIELDS covers Business, SocialConnection, ChannelConnection, Webhook only (packages/db/src/middleware/token-encryption.ts:91-112); BankConnection.accessToken (packages/db/prisma/schema.prisma:10217) is stored as given (S/modules/finance/bank-connection.service.ts:63-70, :82), stripped only from responses (:28-32). Routes live (S/modules/finance/finance.controller.ts:1647-1694, settings admin since SWEEP-P0-FOLLOWUP). The coverage gate misses it because SECRET_NAME is start-anchored (apps/server/test/token-encryption-coverage.integration.test.ts:44). Liveness: the v1 web never sends a token (apps/web/src/app/app/key-connect/components/banking-section.tsx:56-60; key-connect tiles except Gmail are hidden by NAV-B-HIDE) and no server code reads it back, so P1, not P0, unless production has non-null access_token rows (the packet's dry-run answers this). SWEEP-P0-FOLLOWUP only added the settings-admin gate; FU-DELIVERY-TOKEN-DECRYPT covers nested reads of already-encrypted models.
- Packets: RR-BANK-TOKEN-ENCRYPT (P1, S).

### REC-CRYPTO-PROD-GUARD — packages/db token encryption must not use the in-repo dev fallback key in production.
- Sources: architecture/architecture-risks.md:52 (R5); architecture/security-tenant-privacy-audit.md:84; worker-notes/notes-C-neuro-arch.md:287-290 (C:CRYPTO-FALLBACK-KEY-PROD-GUARD); S/modules/diagnostics/diagnostics.service.ts:243-275 (the held-guard witness); docs/system-map/02-server-core.md:373-374 (chain divergence).
- Dedup: single source.
- Status: c — packages/db/src/middleware/token-encryption.ts:50-55 falls back silently; the four other implementations throw in production (S/core/crypto/token-crypto.ts:15-21; S/core/connectors/connector-credentials.service.ts:179; S/modules/supplier/credentials.util.ts:15; packages/api/src/lib/credentials.ts:12). The guard is deliberately held until diagnostics reads pass in production. New finding: the witness only reports which env var is set now (tokenEncryptionKeySource, token-encryption.ts:29-31); it cannot see rows already written under the fallback, nor rows that core/crypto wrote under DRIVE_TOKEN_ENCRYPTION_SECRET, which is in core/crypto's chain (token-crypto.ts:13) and not in packages/db's (token-encryption.ts:15-19). So "pass" alone is not enough evidence. No plan packet.
- Packets: RR-DB-CRYPTO-KEY-CENSUS (P1, S; read-only, detects and reports), then RR-DB-CRYPTO-PROD-GUARD (P1, XS; held until the owner posts both pieces of evidence: see OQ-5).

### REC-SERVICE-WRITE-REDACTION — BusinessEventService.emit, ContactAudit and the AI execution log redact at the service write.
- Sources: architecture/architecture-risks.md:83 (R36), :84 (R37); architecture/security-tenant-privacy-audit.md:80, :81; worker-notes/notes-C-neuro-arch.md:309-313 (C:SERVICE-WRITE-REDACTION).
- Dedup: single source. The AI-execution-log half (R37) is a free-text string (S/modules/ai/ai-execution-log.service.ts:44-56 inputSummary), which a field-name policy cannot see. It belongs to G1's RR-REDACTION-BY-CONTENT (REC-CONTENT-AWARE-REDACTION) and is not duplicated here.
- Status: c — the interceptor redacts (S/modules/business-events/business-event.interceptor.ts:252-257). emit/emitBatch store before/after/metadata raw (S/modules/business-events/business-event.service.ts:24-48, :65-90), and the failure log prints 500 chars of the raw input (:55-58). ContactAuditService.writeOrThrow stores diffed values raw (S/modules/crm/privacy/contact-audit.service.ts:185-200). No live caller passing a secret-named key was found (grep of emit callers), so P2, not P1. FU-KEY-EVENT-COLUMNS and W11-PROVIDER-OUTAGE-503 redact specific fields only. Ten direct businessEvent.create writers bypass the service (device, flow-runner, key-cortex adapters, procurement, project-revenue listener). They are listed as out of scope and left to a follow-up census.
- Packets: RR-BUSINESS-EVENT-REDACT (P2, S).

### REC-ERASURE-COMPLETENESS — contact erasure also scrubs BusinessEvent PII.
- Sources: architecture/architecture-risks.md:69-72 (R22-R25), :70 (R23), :81 (R34); architecture/security-tenant-privacy-audit.md:37, :60; worker-notes/notes-C-neuro-arch.md:303-307 (C:GDPR-PURGE-COMPLETENESS).
- Dedup: single source. R22/R24(rows)/R25/R34 are already done on main (contact-privacy.service.ts:832-856 child rows, :858-880 audit scrub with ip/userAgent null, :88-94 retained basis).
- Status: c, live — the global interceptor (S/app.module.ts:273) writes every contact create/update with before = request body and after = response, subjectType 'contact' (business-event.interceptor.ts:205-240, :278-298), and only field-name redaction applies, so email, phone and name are stored. The purge (contact-privacy.service.ts:758-930) never touches business_events (git grep businessEvent in S/modules/crm/privacy: 0). D-25 puts the purge in v1. P1 (privacy; not cross-tenant). TOF-CONTACT-AUDIT-* and FU-CONTACT-AUDIT-RESIDUAL cover contact_audit_entries only. Additional finding: ContactMedia rows are deleted but the object at ContactMedia.url (client-supplied mediaUrl, S/modules/crm/crm-import.service.ts:706-713) is not. It is not put in the packet: the URL is client-supplied and objects are not business-prefixed, so deleting by URL could remove another tenant's object (OQ-27).
- Packets: RR-ERASURE-BUSINESS-EVENTS (P1, S).

### REC-ADMIN-SHELL-GATE — /admin pages gated server-side.
- Sources: architecture/architecture-risks.md:66 (R19); architecture/security-tenant-privacy-audit.md:56; worker-notes/notes-C-neuro-arch.md:298-301 (C:ADMIN-SHELL-SERVER-GATE).
- Dedup: single source.
- Status: c — apps/web/src/middleware.ts:143-145 matches /app/:path* only; apps/web/src/app/admin/layout.tsx is "use client" and gates by isSuperAdmin. The admin APIs are guarded (S/modules/admin-platform/admin-user.controller.ts:14-15 AuthGuard + AdminGuard), so only page structure leaks: P3. OPS-CONSOLE-READONLY (D-237) builds a page in this area but does not gate the shell.
- Packets: RR-ADMIN-SHELL-SERVER-GATE (P3, XS).

### REC-ADMIN-TOKEN — admin logout; admin JWT exp in seconds with iss/aud.
- Sources: architecture/architecture-risks.md:77 (R30), :88 (R41); architecture/security-tenant-privacy-audit.md:73, :85; worker-notes/notes-C-neuro-arch.md:315-318 (C:ADMIN-LOGOUT-AND-TOKEN-CLAIMS).
- Dedup: single source, two halves.
- Status: c (logout half), live and worse than the notes say. The web has no admin sign-out (git grep -i logout apps/web/src/app/admin: 0), and nothing in apps/web ever removes kf_admin_token (the user sign-out clearStoredBusinessId, apps/web/src/lib/workspace.ts:293-309, removes kf_token/kf_refresh_token/kf_auth_mode only). getAuthHeaders prefers kf_admin_token over the user token on every call (apps/web/src/lib/api.ts:100-106). On a shared browser, the next user to sign in sends the SUPER_ADMIN bearer for up to 24h (apps/web/src/app/admin/login/page.tsx:43-50). The server logout exists (S/modules/admin-auth/admin-auth.controller.ts:56-63). Raised to P1. Claims half: S/core/auth/admin-token.util.ts:42-47, :72 uses millisecond exp consistently on both sides with a comment explaining it, and has no iss/aud. No second issuer signs with ADMIN_JWT_SECRET, so iss/aud would add defence in depth only, and changing exp units invalidates every issued token for no security gain.
- Packets: RR-ADMIN-LOGOUT (P1, S). Claims half: none (consistent and tested as built; no second issuer exists, so there is no honest RED with impact; can be folded into any later admin-auth packet).

### REC-HTTPONLY-SESSION — HttpOnly cookie sessions, no refresh tokens in localStorage.
- Sources: architecture/architecture-risks.md:78 (R31); architecture/security-tenant-privacy-audit.md:75; worker-notes/notes-C-neuro-arch.md:320-323 (C:HTTPONLY-SESSION-COOKIES).
- Dedup: single source.
- Status: d — kf_token and kf_refresh_token live in localStorage (apps/web/src/lib/workspace.ts:10-11). The only HttpOnly mention is the comment at apps/web/src/lib/oauth-state.ts:34 ("intentionally not used"). No plan packet. The full move is M+ (a BFF route handler, CSRF, Supabase refresh through the server) and is an architecture decision, so it goes to the owner (OQ-25).
- Packets: RR-SESSION-STORAGE-CENSUS (P3, XS; the first safe slice is a ratchet). The move itself: OQ-25.

### REC-RETENTION-WORKER — scheduled retention for activity logs, export jobs and notification logs.
- Sources: architecture/architecture-risks.md:85 (R38); architecture/security-tenant-privacy-audit.md:82; worker-notes/notes-C-neuro-arch.md:325-328 (C:RETENTION-WORKER).
- Dedup: single source.
- Status: c — only RISC retention (S/modules/risc/risc-retention.service.ts) and a manual ActivityService.deleteOldLogs (S/modules/activity/activity.service.ts:161-166, reached only by the KEY activity adapter) exist. New, concrete: expired contact export bundles (full personal data, JSON + ZIP) are never deleted from storage or the database outside a forget purge (S/modules/crm/privacy/contact-privacy.service.ts:262-300 writes, :339 refuses after expiry, deletes only at :839-843/:956). Deleting already-dead links needs no new retention ruling. Activity, notification-log and session periods do need one.
- Packets: RR-RETENTION-EXPIRED-EXPORTS (P2, S; renamed from the planned RR-RETENTION-ACTIVITY-LOGS because activity-log periods need OQ-26 first).

### REC-AUTH-FAIL-FAST — no DI fallback construction; an invalid bearer is marked, not silently anonymous.
- Sources: architecture/architecture-risks.md:90 (R43), :95 (R48); worker-notes/notes-C-neuro-arch.md:330-333 (C:AUTH-MIDDLEWARE-FAIL-FAST).
- Dedup: single source, two halves.
- Status: c, but not live. The fallback (S/core/auth/auth.middleware.ts:508-517) is unreachable while the constructor injects SupabaseAuthService with an explicit @Inject (:502-506). An invalid bearer logs a warning and continues (:581-583). On every AuthGuard route that is already a 401 'Authentication required' (S/core/auth/auth.guard.ts:10). On OptionalAuthGuard routes (identity, community; S/core/auth/optional-auth.guard.ts) anonymous gets nothing a valid user would not. No exposure, and changing the auth middleware or AuthGuard body risks Release 0 identity cases for no user-visible gain.
- Packets: none (no honest RED with an effect; the one-line dead-code removal can ride the next auth-middleware packet).

### REC-SOCIAL-OAUTH-STATE — social OAuth state and PKCE in Redis.
- Sources: architecture/architecture-risks.md:91 (R44); worker-notes/notes-C-neuro-arch.md:335-338 (C:SOCIAL-OAUTH-STATE-STORE).
- Dedup: single source.
- Status: c, not a security hole and not live in v1. State is in a process Map (S/modules/social/social-connections.service.ts:30, :53-61), but it is random, single-use, expires in 10 minutes and is bound to business and platform at the callback (S/modules/social/social.controller.ts:424-430). PKCE is used for Twitter (:391-394), the only one of these providers that requires it. The gap is availability across replicas and restarts. /app/social is hidden by NAV-B-HIDE-2 (D-152).
- Packets: none (module hidden in v1; revisit when social returns in V1.x, reusing a Redis-backed state store).

### REC-CONSENT-UNIQUE — ConsentRecord unique (contact, channel, type) + upsert.
- Sources: architecture/architecture-risks.md:99 (R52); worker-notes/notes-C-neuro-arch.md:340-343 (C:CONSENT-RECORD-UNIQUE).
- Dedup: single source.
- Status: d as stated, but the recommendation conflicts with the design. ConsentRecord (packages/db/prisma/schema.prisma ConsentRecord, @@index only) is an append-only ledger: recordConsent always creates (S/modules/communications/consent.service.ts:37-50), and checkConsent reads the latest by createdAt (:58-61). History is the legal evidence of when consent was given or withdrawn, and a unique key plus upsert would overwrite it. Two real but small issues: the latest-wins order has no tie-break (createdAt only), and KeyCortexEthicsService counts any 'granted' row with revokedAt null (S/modules/key-cortex/key-cortex-ethics.service.ts:398-405, :442-449), so a grant later superseded by a 'revoked' row still counts. The writer is omnichannel.controller.ts:236-252 (/communicate is hidden by NAV-B-HIDE-2).
- Packets: none (OQ-28). No schema change is proposed, so no duplicate census is needed. If the owner nevertheless wants the unique key, a read-only duplicate census comes first and any merge is dry-run only.

### REC-OBJECT-STORAGE-PRIVATE — PutObject sets private ACL + SSE.
- Sources: architecture/architecture-risks.md:103 (R56); architecture/security-tenant-privacy-audit.md:107; worker-notes/notes-C-neuro-arch.md:345-348 (C:OBJECT-STORAGE-PRIVATE-SSE).
- Dedup: single source.
- Status: d — no ACL/ServerSideEncryption on any PutObjectCommand (S/core/object-storage/objectStorage.ts:286, :309-314; S/modules/crm/privacy/contact-privacy.service.ts:271-285). The provider is configurable (.env.example:129-133). Adding ACL headers blindly can break uploads (AWS buckets with ACLs disabled refuse non-owner ACL headers), and some S3-compatible providers do not implement SSE headers. Whether objects are exposed depends on bucket policy, which the code cannot see. So the first slice is detect and report.
- Packets: RR-OBJECT-STORAGE-POSTURE-CHECK (P2, S). Upload headers wait for OQ-29.


### REC-OAUTH-PKCE — Google and Microsoft OAuth use PKCE
- Sources: architecture/architecture-risks.md:73 (R26); architecture/security-tenant-privacy-audit.md
- Dedup: single source; added by the fidelity review.
- Status: d — the Google Suite authorize URL and token exchange carry no code_challenge/code_verifier (apps/server/src/core/connectors/google-suite.service.ts:175-185, :212-221); Microsoft likewise (apps/server/src/modules/connect/microsoft-oauth.service.ts:60-69, :104-117); only Twitter uses PKCE (apps/server/src/modules/social/social.controller.ts:392-393). No plan packet (plan grep pkce/code_verifier: 0).
- Packets: RR-OAUTH-PKCE-GOOGLE-MICROSOFT (P2, S)

### REC-EXPORT-DELETED-CONTACT — a soft-deleted or forget-pending contact cannot be exported
- Sources: architecture/architecture-risks.md:82 (R35)
- Dedup: shares a packet with REC-EMAIL-DELETED-CONTACT (same rule, "a deleted contact is not served", at two seams).
- Status: d — collectBundle reads the contact with no deletedAt condition (apps/server/src/modules/crm/privacy/contact-privacy.service.ts:1005-1009, called from exportContact :244), and requestForget sets deletedAt (:427-431), so a forget-pending contact is exportable. No plan packet.
- Packets: RR-PRIVACY-DELETED-CONTACT-GATES (P2, S)

### REC-EMAIL-DELETED-CONTACT — transactional email is not sent to a soft-deleted contact
- Sources: architecture/architecture-risks.md:100 (R53)
- Dedup: see REC-EXPORT-DELETED-CONTACT.
- Status: d — the send gate reads only doNotContact (apps/server/src/modules/notifications/transactional-email.service.ts:420-433). No plan packet.
- Packets: RR-PRIVACY-DELETED-CONTACT-GATES (shared)

### REC-FORGET-CANCEL-SOURCE — cancelling a forget request restores only what the forget deleted
- Sources: architecture/architecture-risks.md:101 (R54)
- Dedup: single source.
- Status: d — requestForget overwrites deletedAt (contact-privacy.service.ts:405-431) and cancelForget clears it unconditionally (:495-506), so a contact deleted normally comes back live after a forget request is cancelled.
- Packets: RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE (P3, S)

### REC-APPROVAL-EXECUTE-SCOPED-READ — the approval orchestrator's pre-execution snapshot uses a business-scoped read
- Sources: architecture/architecture-risks.md:97 (R50)
- Dedup: single source.
- Status: d — executeApproved reads the proposal with the unscoped getById (apps/server/src/modules/key-cortex/key-cortex-approval-orchestrator.service.ts:202; key-action-proposal.service.ts:161-167) before the scoped execute; it is live (key-action-proposal.controller.ts:117, key-cortex-executor.service.ts:1627).
- Packets: none. No data leaves: a foreign id makes the scoped execute throw before the snapshot is used, and both paths answer the same NotFound, so there is no observable RED. It is one-line hygiene (use the scoped get(businessId, proposalId)) for whichever packet next edits that orchestrator.

### REC-EXPORT-DOWNLOAD-RATE-LIMIT — the public contact-export download is rate limited
- Sources: architecture/architecture-risks.md:98 (R51)
- Dedup: single source.
- Status: d — the public download handler has no rate-limit guard (apps/server/src/modules/crm/privacy/contact-privacy.controller.ts:124-140).
- Packets: none. The token is 32 random bytes (contact-privacy.service.ts:264) and the handler refuses short tokens (:131-133), so guessing is infeasible and a limit adds no measurable protection; owner question OQ-40 if wanted as hardening.
## 7. Engineering process and tooling

### REC-CONTEXT-BUNDLE — each development agent gets a deterministic, source-bound context bundle per packet instead of re-reading the plan
- Sources: A:CONTEXT-BUNDLE-LIVE: BR:25-100; BS:55-58, BS:109-116; HL:32-34, HL:64-83; EM:205-216; BG:71-91 (LAW B1); docs/intelligence/research/contracts/CONTEXT-BUNDLE-SCHEMA.yaml. B:CONTEXT-COMPILER: TR/DEVELOPMENT-SPEED-TRACE-004-CONTEXT-ASSEMBLY.md:77-185; TR/DEVELOPMENT-SPEED-TRACE-004B..004E; TR/CONTEXT-COMPILER-LIVE-TRACE-001.md:51-59, 138-168; TR/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:247-258; DOS/HERMANS-PROGRAMMERS-BRAIN.md:47-68; DOS/OUSTERHOUT-PHILOSOPHY-SOFTWARE-DESIGN.md:42-53; DOS/PRAGMATIC-PROGRAMMER.md:54-60; DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:127-134; MS/mattpocock-skills.md:62-66; MS/garrytan-gstack.md:48-55, 146-147. D:DEV-CONTEXT-COMPILER: issue#153 comments 6021579475 and 6011887251 (2026-10-06); PR #154; PR #156. C:PROGRAMME-EXPORTABLE-TWIN: docs/intelligence/15-EXPORTABLE-DIGITAL-TWIN-SPEC.md:7-40, 220-306.
- Dedup: all four describe the same per-packet compiled context (C's exportable twin is the programme-level form of it); merged. B's REACHABILITY-GATE gap (reachability_checks empty) is folded into REC-PROOF-PROFILES, B's hotspots gap into REC-HOTSPOTS.
- Status: c — done: scripts/agent-memory/bundle.mjs + lib.mjs buildBundle (lib.mjs:405-491), named in CLAUDE.md; health VALID/DEGRADED, rulings with source lines, write set, exclusions. Gap: authority.conflicts and unresolved.contradictions are the constant [] (lib.mjs:438, :457; departure :482); authority.current names D-222/D-241 but not D-239, which supersedes D-222's merge clause (BUILD-MAP-001.md:1246); FU-KEY-CHAT-GENOME-MONEY-SIGHT cites D-128 but not D-234, which widens it. Owners/execution_paths stay empty (not packeted: no deterministic source maps a packet to an owner without a refreshed architecture map, FU-ARCH-MAP-REFRESH). Worker-prompt injection: not needed, PACKET-WORKER-BRIEF already points workers at the bundle.
- Packets: RR-BUNDLE-RULING-CONFLICTS (P3, S).

### REC-PROOF-PROFILES — a packet's change class selects its proof profile, and the proof class is declared
- Sources: A:PROOF-CLASS-DECLARATION: BR:377-418; BS:72-76; CD:40, CD:87-91; docs/intelligence/research/contracts/PROOF-PROFILES.yaml; HL:31. B:PROOF-PROFILE-SELECTION: DOS/ENGINEERING-PRACTICE-CLEAN-REFACTOR-TDD.md:24-36, 115-136; DOS/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:121-129; TR/DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:126-176, 314-343; TR/DEVELOPMENT-SPEED-TRACE-002-BEHAVIORAL-HOTSPOTS.md:101-123; TR/DEVELOPMENT-SPEED-TRACE-002B-CROSS-DOMAIN-EVOLUTION.md:186-219, 271-272; TR/DEVELOPMENT-SPEED-TRACE-004C-TENANT-CONTEXT-REPLICATION.md:154-171; TR/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:172-198, 276-279; SYN/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:107-137. B:REACHABILITY-GATE (folded): TR/DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:243-268; TR/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:224-243, 280-282; TR/DEVELOPMENT-SPEED-TRACE-002B-CROSS-DOMAIN-EVOLUTION.md:121-136, 268-269; DOS/PRAGMATIC-PROGRAMMER.md:13-17; SYN/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:99-105.
- Dedup: A's declared proof class and B's profile selection both choose the proof from the kind of change; merged. A's "weaker class never overrides a stronger failing one" is already the plan's practice (every DoD: RED first, real-DB proof, proof:release0).
- Status: c — profiles exist research-only (PROOF-PROFILES.yaml:3 authority RESEARCH_ONLY; profiles at :9, :44, :75; parses with scripts/agent-control/lib/yaml.mjs); prototype selector scripts/agent-control/research/compile-context.mjs:91-117 (needs every class, so selects nothing on plan metadata). Gap: the live bundle's proof_context.reachability_checks/fastest_falsification are [] (lib.mjs:450-451) and change_classes are plan metadata (:426). No proof_class field anywhere (git grep proof_class / EXACT_FORMAL / INTEGRATION_STATE in scripts and .github: none); adding one to RETURN files or briefs is left out because a brief changes only with its ruling (docs/development/agent-memory/README.md section 4) and the plan DoD already fixes the proof.
- Packets: RR-BUNDLE-PROOF-PROFILE (P3, S).

### REC-HOTSPOTS — an offline, deterministic git-history scanner for hotspots and co-change
- Sources: A:BEHAVIORAL-HOTSPOT-SCANNER: BR:181-249; BS:69-71, BS:109-112; BG:225-239 (LAW B9); CD:36; HL:30; SFS:356-373, SFS:316-354 (step 11). B:DEV-ORGANISM-METRICS (hotspot half): DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:18-37, 111-125; SYN/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:12-21, 66-75, 179-193; TR/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:200-222, 284-299; TR/DEVELOPMENT-SPEED-TRACE-002-BEHAVIORAL-HOTSPOTS.md:187-207; TR/DEVELOPMENT-SPEED-TRACE-002B-CROSS-DOMAIN-EVOLUTION.md:221-255; TR/DEVELOPMENT-SPEED-TRACE-004-CONTEXT-ASSEMBLY.md:243-276; DOS/WEINBERG-PSYCHOLOGY-OF-COMPUTER-PROGRAMMING.md:30; MS/garrytan-gstack.md:34-47, 143-144.
- Dedup: A's scanner and B's Repository Evolution Analyzer are the same tool (churn, co-change, correction density); merged. Ownership concentration and per-agent capability models are dropped on purpose: B's own source says never as agent performance scores.
- Status: d — `git ls-files | grep -iE 'hotspot|change-coupling|co-change'` finds only the manual sample TR/DEVELOPMENT-SPEED-TRACE-002-BEHAVIORAL-HOTSPOTS.md; bundle hotspots is the constant [] (lib.mjs:446). Data is there: 742 non-merge commits; flow-orchestrator.service.ts has 31 commits, 22 of them fixes. Not the atlas materializer or the motif miner (D-141): no generated committed map, no #80 mining.
- Packets: RR-HOTSPOT-SCANNER (P3, S).

### REC-COORDINATION-METRICS — measure review cycles, rework and handoffs from artifacts, not self-report
- Sources: A:COORDINATION-COST-METRICS: BG:200-223 (LAW B8); CD:33; EM:218-222; KNG:495-507. B:DEV-ORGANISM-METRICS (coordination half): same list as REC-HOTSPOTS (DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:18-37, 111-125; SYN/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:12-21, 66-75, 179-193; TR/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:200-222, 284-299).
- Dedup: both ask for coordination cost derived from git/PR/issue artifacts; merged.
- Status: c — docs/development/agent-memory/MEASUREMENT.md sections 1-4 measure brief and bundle sizes and say what to record next; scripts/agent-memory/status.mjs derives done-status from commit evidence (lib.mjs:33-42, :52-90). Gap: rework is uncounted although main carries it ("... W11-OWNER-MAP-UNMAPPED-TOOLS review repair ...", "... FU-KEY-EVENT-COLUMNS review repair ...", "(Codex P2 on #216)"). Handoff counts and timings: not packeted (no local-git source; would need GitHub reads, which status.mjs deliberately avoids).
- Packets: RR-STATUS-REVIEW-CYCLES (P3, S).

### REC-STRUCTURED-CLAIMS — agents and reviewers exchange structured claims; dissent preserved; correlated evidence not double counted
- Sources: B:STRUCTURED-AGENT-CLAIMS: FIG/packets/R1-E-STRUCTURED-AGENT-CLAIM-PROTOCOL-PACKET.md:1-51; FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:32-37 (C4); FIG/GENOME-V0.1-CONVERGENCE.md:107-114 (O10); FIG/TRANCHE-NEGOTIATION-ECOLOGY-DISAGREEMENT-001.md:54-70, 99, 102-104; FIG/TRANCHE-DECEPTION-SELF-CORRECTION-001.md:41-44, 83-89; DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:136-142; MS/mattpocock-skills.md:57-61; MS/garrytan-gstack.md:133-135.
- Dedup: single source.
- Status: c (not d as MASTER has it) — the protocol sits in docs/development/KF-AGENT-PARALLEL-ORCHESTRATION-PLAN-001.md:360-407, a plan D-141 kept as a dated record and never adopted (BUILD-MAP (e) #149). The live D-222/D-241 process already has the substance: two reviews from separate fresh sessions, one per lens, never given the worker's conclusions (ACCEPTANCE-REVIEW-BRIEF.md); each finding carries file:line, a scenario and how it was verified ("read" or "ran <command>") (ACCEPTANCE-REVIEW-BRIEF.md:47-56); a REJECT stands while any CRITICAL/MAJOR stands, and owner questions are carried separately. Reviews are prose replies in sessions and PR bodies, not files, so a claim validator would have nothing live to validate.
- Packets: none (no honest RED on a live artifact; the envelope comes from a plan D-141 left unadopted, and building it would re-open that adoption). Revisit only if reviews become files.

### REC-RND-LINEAGE — research-originated PRs carry optional rnd_lineage; every research result ends in a disposition
- Sources: B:RND-LINEAGE-METADATA: FIG/control/R0-E-RND-LINEAGE-METADATA-PROPOSAL.md:11-42; FIG/GENOME-V0.1-CANDIDATE-ROUTING.md:59-64 (C8); FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:49-72, 158-174; FIG/TRANCHE-INSTITUTIONAL-INTELLIGENCE-001.md:76-77.
- Dedup: single source.
- Status: c — PR metadata absent (`git grep rnd_lineage` finds only the proposal; .github/pull_request_template.md has no lineage or research field). The mandatory form was ruled out: #152 (an unlock YAML required on every PR to main) is one of the eight control-plane experiments D-141 closed (BUILD-MAP (e) #152, PRS-M50). The disposition half is being done now: D-261/D-262 give every recommendation a disposition (this index), and FU-RESEARCH-CORPUS-YAML (b) makes the research ledger parse.
- Packets: none (an optional PR-template section has no consumer and no RED; lineage for RR-* work is carried by the plan record and this index, which name each packet's recommendation and sources).

### REC-SCOPE-GUARDS — a packet's allowed scope is enforced at edit time by hooks
- Sources: B:EXECUTABLE-SCOPE-GUARDS: MS/garrytan-gstack.md:56-71, 137-139 (F6, F7); MS/mattpocock-skills.md:27-31; DOS/BROOKS-PEOPLEWARE-DEVELOPMENT-ORGANISM.md:136-138.
- Dedup: single source.
- Status: c — .claude/hooks/session-guard.mjs (wired in .claude/settings.json, Edit|Write and Bash matchers) enforces the cross-session claim registry and blocks repo-global destructive git (.claude/hooks/README.md); scripts/agent-control/lib/admission.mjs refuses scope changes without authority for impl/* returns. Gap: modeEdit (session-guard.mjs:504-552) never reads the packet write set; the rule is prose (PACKET-WORKER-BRIEF.md:32) and the D-239 scope ledger is re-verified by hand (WAVE-RUNBOOK.md:130). The hook warns rather than asks by default, because D-241 child sessions run unattended.
- Packets: RR-HOOK-PACKET-SCOPE (P3, M).

### REC-GENERATED-INSTRUCTIONS — shared agent instructions generated from one source to stop drift
- Sources: B:GENERATED-AGENT-INSTRUCTIONS: MS/garrytan-gstack.md:92-97, 152-153 (F11, adaptation 7); MS/mattpocock-skills.md:32-36; DOS/HERMANS-PROGRAMMERS-BRAIN.md:39-45.
- Dedup: single source.
- Status: c — instructions are already short and centralized (AGENTS.md 201 lines, CLAUDE.md 89; briefs in docs/development/agent-memory/; V1-STATUS generated by status.mjs). Drift check run for this index: every backticked repo path in CLAUDE.md and AGENTS.md exists at 2c4e4bf2 (only build outputs .turbo/cache/ and apps/server/dist/main.js are absent, as expected), and every ruling id cited in CLAUDE.md, AGENTS.md and the seven agent-memory briefs resolves; where D-222 is cited for merging, D-239 is cited beside it.
- Packets: none (no drift to make a RED from; a generator would rewrite procedural files that change only with their ruling, README section 4). The superseded-ruling check that would catch future drift is the relation extractor in RR-BUNDLE-RULING-CONFLICTS, reusable later.

### REC-ANTI-FAKE-GREEN — skipped or not-run is not passed in CI; shrink-only gate ledgers cannot grow across commits
- Sources: A:ANTI-FAKE-GREEN-GATES: EM:233-240; HL:37-47; BG:241-256 (LAW B10). C:GATE-LEDGER-MONOTONIC: architecture/os/OS.md:61-73, :89-124; CA:856-875 (invariants 1-4).
- Dedup: both defend the gates themselves against reading green when they did not hold (A: skipped/not-run jobs; C: a red gate "fixed" by growing its ledger); kept as one recommendation, four packets.
- Status: c — existing: lint split out so a ratchet cannot skip security suites (.github/workflows/ci-cd.yml:130-153); mutation controls (scripts/agent-control/proof-mutation.mjs, scripts/agent-control/negative-controls.yaml, scripts/proof-admission/negative-controls.mjs); in-tree shrink-only ledgers (e.g. tenant-model-list.spec.ts:147, :238-262) and the cardinality reader scripts/os/ledger-sizes.mjs:20-41 (runs clean today). Gaps verified: (1) four *.spec.mjs files are run by no workflow, including scripts/agent-memory/tests/lib.spec.mjs (14 passing tests gating nothing); (2) main has no branch protection and no required checks (GET branches/main/protection: 404 "Branch not protected"; the only branch rule is copilot_code_review) while the D-239 merge condition says "every required check finished" (WAVE-RUNBOOK.md:128), and four jobs needs: lint-and-typecheck (:387, :526, :590, :649) so they go grey "skipped" on a type-check failure; (3) nothing compares ledgers across commits (ledger-sizes' only comparer, the OS truth cycle, is HALTED: OS.md:1-30; no workflow runs it); (4) 19 of 27 files declaring shrink-only ledgers are unregistered, including cast-call-integrity.spec.ts:129-131 and the lint ceilings (ci-cd.yml:198-221).
- Packets: RR-SCRIPT-SPECS-IN-CI (P2, S), RR-CI-REQUIRED-JOBS-AGGREGATE (P2, S), RR-GATE-LEDGER-MONOTONIC (P2, S), RR-GATE-LEDGER-CENSUS (P3, S).

### REC-PROPERTY-TESTS — generative (property/fuzz/boundary/concurrency) tests for parsers, money, date/time, pagination, idempotency, state machines, authorization predicates, webhook payloads, imports, control-plane YAML, connector descriptors and memory lineage
- Sources: C:PROPERTY-FUZZ-MUTATION-PROOF: CA:211-239, :787-788; architecture/os/OS.md:61-73 (negative-control rule).
- Dedup: single source (its mutation half is already a: scripts/proof-admission/negative-controls.mjs and manifests).
- Status: c (corrected by the fidelity review: the source CA:211-228 names twelve areas; only money is covered) — money is covered (the C note's "no property tests" is false: there is no library, but there are seeded property tests): apps/server/src/modules/commerce/money.spec.ts:205-279 (mulberry32, 2000 random documents, expected cents computed independently in integers) and apps/server/src/modules/commerce/balance-arithmetic.spec.ts:101-156 (2000 seeded row sets). For this index I also ran a 200,000-case seeded fuzz of ten further money.ts invariants (cent round trip, sum order independence, sum/subtract inverse, nearest-cent, line amount bound, remaining/overpaid exclusivity and sum, legacy one-cent band, document identity, no negative zero) against money.ts at 2c4e4bf2: no counterexample. Parsers/tenancy: no named defect to make a RED from.
- Packets: none (no RED on main for money; for the other eleven areas no defect was found to write a RED from, and generative tests are a technique each packet uses inside its own proof, as RR-KEY-FAKE-MODEL-TRAJECTORY and RR-STRICT-TOOL-SCHEMAS do). Owner question OQ-37 asks whether to open a first-slice packet (authorization predicates or webhook payload parsing). Dependency note: fast-check would be a new devDependency during the D-175 freeze (S0-DEPENDABOT-FREEZE: no non-security dependency PR merges before GATE-JOURNEY-RUN). The seeded mulberry32 pattern already in money.spec.ts needs no dependency, so no owner question is needed now.

### REC-TWO-KEY — catastrophic product actions need a second, independent act or approver
- Sources: C:TWO-KEY-CATASTROPHIC-ACTIONS: CA:1324-1347, :1538-1540. Related, not merged into a packet: D:ASSURANCE-SAFE-MODE, issue #130 comment 5985219650 (2026-10-04) (two-key rules within a safe-mode doctrine).
- Dedup: single source for the product action; D's safe-mode doctrine is broader and stays out.
- Status: c — engineering side done (two independent reviews and owner/CI merge: D-222, D-239; production deploy owner-only). Product side: the one irreversible catastrophic action is whole-business GDPR erasure, POST api/admin/businesses/:businessId/gdpr-delete (apps/server/src/modules/admin-platform/admin-business.controller.ts:100-104): one SUPER_ADMIN (admin.guard.ts), one call, immediate, no durable record (gdpr-purge.service.ts:146, :162 log lines only). Bulk contact delete is not catastrophic (soft delete, at most 100, audited, restorable: crm.controller.ts:764-775, crm.service.ts:1925-1986), so the MASTER id RR-TWO-PERSON-BULK-DELETE is renamed to the action that is catastrophic.
- Packets: RR-ERASE-BUSINESS-TWO-STEP (P2, M), drafted; depends on OQ-30, nothing built before the answer.

### REC-INDEX-COVERAGE — compare real query paths with tenant/time/status indexes
- Sources: A:STORAGE-ACCESS-PATH-AUDIT: SFS:285-298, SFS:340-341 (step 8).
- Dedup: single source.
- Status: d — no audit script or census (git grep 'index coverage' / pg_stat_statements in scripts and apps/server: none). Verified now by parsing schema.prisma against BUSINESS_ID_MODELS: four tenant models have no businessId-led index (Cohort, CommunityComment, AiPlanResult, KeyInteractionFeedback); CommunityComment is listed by businessId in the trash (trash.controller.ts:716, :744, :772).
- Packets: RR-INDEX-COVERAGE-REPORT (P3, S), first static slice; later slices (the migration inside an owner-approved set under D-167; a production pg_stat_statements read, owner-run) are named in its scope, not packeted.

## 8. Recommendations with no new packet: done, planned, memory track, ruled, principle

#### Already done on main (status a)

### REC-AUTH-FAIL-CLOSED — an authority/autonomy-check error runs zero parsed commands, never "all parsed commands"
- Sources: docs/intelligence/research/GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md:44-54, :196-282; GENAI-RD-GLOBAL-CONVERGENCE.md:382-383, :534-540; GENAI-RD-MASTER-CONTINUATION.md:468, :670-704; BOOK-GENAI-CURRENT-STATE.md:98-107; issue#153 comments 6010007429, 6009696796, 6010080039, 6010209031, 6010442954, 6010546028 (all 2026-10-06)
- Dedup: A:AUTONOMY-FAIL-CLOSED and D:AUTH-FAIL-CLOSED are the same rule (packet KF-EXEC-AUTH-FAIL-CLOSED-001).
- Status: a — apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts:462 and :1884 ("failing closed: 0/N"); key-cortex-actions.service.ts:386; key-cortex-executor.service.ts:628; negative control __tests__/key-cortex-query-pipeline.service.spec.ts:2427 (with :1471, :2052).
- Packets: none (done)

### REC-FRESH-REVIEW — reviewers see only the diff, contract and invariants and try to falsify
- Sources: docs/intelligence/research/EXTERNAL-MINING-ADDYOSMANI-AGENT-SKILLS-2026-10-07.md:224-231; syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md:93-108 (LAW B2)
- Dedup: single source family.
- Status: a — docs/development/agent-memory/ACCEPTANCE-REVIEW-BRIEF.md (two fresh reviewers, never the worker's conclusions); D-222/D-241 two independent reviews per packet.
- Packets: none

### REC-NEGATIVE-CONTROLS — every critical invariant has a negative control that restores the defect and must fail
- Sources: research/traces/DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:120-143; DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:102-124; dossiers/ENGINEERING-PRACTICE-CLEAN-REFACTOR-TDD.md:60-70; dossiers/PRAGMATIC-PROGRAMMER.md:36-39, :47-52; dossiers/DECISION-ROUTING-KAHNEMAN-ALGORITHMS.md:117; KEYFLOWOS-CONTINUOUS-ASSURANCE-SECURITY-SURVEILLANCE-QUALITY-RESEARCH-001.md:211-239 (mutation half); architecture/os/OS.md:61-73
- Dedup: B:MUTATION-NEGATIVE-CONTROLS plus the mutation half of C:PROPERTY-FUZZ-MUTATION-PROOF (the property/fuzz half is REC-PROPERTY-TESTS).
- Status: a — scripts/agent-control/negative-controls.yaml (run in .github/workflows/agent-control-worker-proof.yml:68); scripts/proof-admission/negative-controls.mjs:1-30 with ~46 manifests in scripts/proof-admission/manifests/.
- Packets: none

### REC-SECURITY-EVIDENCE — a green workflow does not claim every scanner passed; advisory results are reported as such
- Sources: research/traces/DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:270-301; issue #130 comment 6476808659 (2026-10-28) (secret scan half)
- Dedup: B:SECURITY-EVIDENCE-SEMANTICS and the secret-scan half of D:CI-SECURITY-TRUTH (the dependency-audit half is REC-DEP-AUDIT-ENFORCE, ruled).
- Status: a — .github/workflows/ci-cd.yml:223-228, :333-338 (pinned TruffleHog, blocking, D-22); :276, :377-378 record the audit as "recorded, not enforced".
- Packets: none

### REC-NATIVE-DAST — DAST boots the real API on ephemeral Postgres/Redis; a 404 is not proof, 5xx/leakage fails
- Sources: PR #116 (superseded by #114); KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md (DAST section)
- Dedup: single source.
- Status: a — scripts/security/native-dast.mjs, .github/workflows/native-dast.yml (the required-gate swap is build-map queue item V1-30-SEC-DAST-GATE-SWAP, BUILD-MAP-001.md:186, not a V1-PLAN-RECUT packet).
- Packets: none

### REC-THREAD-HARVEST — exported chat threads are harvested deterministically into a redacted corpus with dispositions
- Sources: PR #163
- Dedup: single source.
- Status: a — scripts/intelligence/project_thread_harvester.py (+ test); its CI run is plan packet TOF-CI-PYTHON-HARVESTER (b).
- Packets: none

### REC-TENANT-COVERAGE-GATE — CI fails when a new businessId model lacks tenant-isolation coverage
- Sources: architecture/target-architecture.md:97; architecture/architecture-risks.md R21
- Dedup: single source.
- Status: a — apps/server/src/core/prisma/tenant-model-list.spec.ts (shrink-only ACKNOWLEDGED_UNSCOPED); packages/db/src/client.ts BUSINESS_ID_MODELS + NEVER_SCOPE.
- Packets: none

### REC-GOAL-UPDATE-ISOLATION — goal updates are scoped by business id
- Sources: PR #158; PR #208; docs/intelligence/research/fictional-intelligence-genome/audits/C2-GOAL-COMMITMENT-DECISION-TRUTH-AUDIT.md
- Dedup: D:GOAL-TRACKER-ISOLATION; the convergence half is REC-GOAL-CONVERGENCE.
- Status: a — apps/server/src/modules/ai/goal-tracker.service.ts:86, :112-118 (`where: { id: goalId, businessId }`); key-cortex-planner.service.ts:152-161 refuses a cross-tenant parent goal.
- Packets: none

### REC-CONTEXT-CACHE — per-business context is cached instead of re-assembled every turn (glial support)
- Sources: docs/neuro-atlas-code-mapping.md:23
- Status: a — apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts:274 (TTL 120 s), :291-295 (redis key per business).
- Packets: none

### REC-SAGA-COMPENSATION — the saga executor compensates on failure
- Sources: docs/neuro-atlas-code-mapping.md:114, :360-363 (top-10 #7)
- Status: a — apps/server/src/modules/key-cortex/key-cortex-saga-executor.service.ts:21-22 (compensateOnFailure default true), :35-36, :72.
- Packets: none (the SafetyShell rollback half is REC-REAL-COMPENSATION)

### REC-TIMEZONE-RHYTHM — rhythm jobs run at each business's local time (circadian)
- Sources: docs/neuro-atlas-code-mapping.md:149, :233, :365-368 (top-10 #8)
- Status: a — apps/server/src/modules/key-cortex/key-cortex-circadian.service.ts:47-88; consumed at key-proactive-engine.service.ts:77, :120, :147.
- Packets: none

### REC-GENOME-EVOLUTION-PERSIST — DNA evolution proposals persist and go through an approve workflow
- Sources: docs/neuro-atlas-code-mapping.md:177
- Status: a — packages/db/prisma/schema.prisma:1196 (GenomeEvolutionProposal); apps/server/src/modules/business-genome/genome-evolution.service.ts:68, :136, :165.
- Packets: none

### REC-WATCHER-PERSIST — watcher signals are persisted, not dropped
- Sources: docs/neuro-atlas-code-mapping.md:345-348 (top-10 #4)
- Status: a — apps/server/src/modules/key-cortex/watchers/invoice-overdue-watcher.service.ts:47 publishes; key-cortex-event-bus.service.ts:8, :59-65, :125, :167 persists every event.
- Packets: none

### REC-LIVE-CHAT-MEMORY — unified memory retrieval is wired into the live Flow chat
- Sources: docs/neuro-atlas-code-mapping.md:330-333 (top-10 #1); docs/intelligence/KEY-COGNITIVE-REACHABILITY-MAP-002.md:298-302
- Status: a — apps/server/src/modules/ai/flow-orchestrator.service.ts:112, :1321 (getUnifiedMemory); its scope fixes are plan packets W11-FLOW-PERCEPTION-SCOPE and MEM-* (D-257).
- Packets: none

### REC-PROGRAMME-TWIN — the programme compiles into a portable, machine-readable package another agent can continue from
- Sources: docs/intelligence/15-EXPORTABLE-DIGITAL-TWIN-SPEC.md:7-40, :220-306
- Status: a (as reshaped) — docs/reconstruction/V1-PLAN-RECUT.json plus scripts/agent-memory/{bundle,status}.mjs (CLAUDE.md); the research ledger half is plan FU-RESEARCH-CORPUS-YAML.
- Packets: none (bundle gaps are REC-CONTEXT-BUNDLE)

### REC-SEC-REGISTER-DONE — sixteen items of the architecture security register are already mitigated
- Sources: architecture/architecture-risks.md R17, R18, R20, R27, R28, R29, R32, R33, R39, R40, R42, R45, R46, R47, R49, R55; architecture/security-tenant-privacy-audit.md
- Status: a — R18: apps/server/src/modules/identity/identity.controller.ts:632; R20: apps/server/src/modules/key-cortex/key-cortex.gateway.ts:461-490; R27/R28: apps/server/src/modules/api-keys/api-keys.controller.ts:5-11; R33: packages/db/src/client.ts:218; R39: apps/server/src/modules/security-audit/security-audit.service.spec.ts:96-119; R42: scripts/configure-risc.ts; R45: apps/server/src/modules/google-drive/google-drive.service.ts:216; R46: apps/server/src/core/guards/public-rate-limit.guard.ts:64-75; R47: apps/web/src/lib/api.ts:82-84, :162; R49: apps/server/src/core/tenant/tenant.interceptor.ts:19-21; R17/R29/R32/R55 marked MITIGATED in the register. R40: apps/server/src/core/seed/seed.service.ts:128 (random dev password unless KEYFLOW_DEV_PASSWORD) and the native fallback key is now the explicit "no-key-required" for keyless local endpoints (model-gateway.service.ts:1659, :2675). R26, R35, R50, R51, R53, R54 now have their own rows in section 6 (added by the fidelity review).
- Packets: none

#### Already planned (status b)

### REC-SELF-MODEL — KEY has a read-only operational self-model projected from existing owners, unknown when a source is unavailable
- Sources: PR #162; fictional-intelligence-genome/packets/R1-D-KEY-SELF-MODEL-READ-PROJECTION-PACKET.md:1-43; control/R0-D-KEY-SELF-MODEL-SOURCE-MATRIX.md:36-40; audits/C9-KEY-IDENTITY-SELF-MODEL-OWNERSHIP-AUDIT.md; GENOME-V0.1-CANDIDATE-ROUTING.md:66-69 (C9; The Doctor, EDI, Lain: identity across substrates); CURRENT-STATE.md:158-174; dossiers/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:135-137
- Dedup: B:SELF-MODEL-READ-PROJECTION and D:OPERATIONAL-SELF-MODEL.
- Status: b — TOF-KEY-SELF-MODEL (owner-only, D-129; service file absent on main).
- Packets: none (planned)

### REC-FINANCE-TOOLS — safe-to-spend, cash-flow forecast and money moves are canonical read capabilities
- Sources: PR #161
- Status: b — TOF-FINANCE-CANONICAL-TOOLS.
- Packets: none (planned)

### REC-OPS-CONSOLE — an owner-only, read-only console with evidence-backed progress (reduced form of the Atlas Mission Control)
- Sources: architecture/atlas/MISSION-CONTROL-INTEGRATION.md:59-185, :202-246; architecture/atlas/README.md:32-53; KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:805-824; KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:666-690; issue #129; PRs #141-#146
- Dedup: C:ATLAS-MISSION-CONTROL and D's Mission Control item.
- Status: b (reduced) — OPS-CONSOLE-READONLY (D-237). The Atlas materializer itself was closed by D-141 (BUILD-MAP-001 rows #142-#146): not re-proposed.
- Packets: none

### REC-KNOWLEDGE-REHOME — no second web-learning service; the dormant KnowledgeIngestionService is re-homed behind approved sources
- Sources: docs/intelligence/KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:31-43, :264-300, :692-756
- Status: b (first step) — TOF-KNOWLEDGE-UPLOAD (approved documents only); the world-stream half is REC-LEARNING-STREAM.
- Packets: none

### REC-COGNITIVE-BLACKOUT — KEY and the product degrade honestly with AI providers down
- Sources: issue #137 body (CI-BASELINE-001, CI-BLACKOUT-001, cognition ladder), #138, #140 (2026-10-05); PR #139; issue#153 comment 6008383152 (2026-10-06)
- Status: b — GATE-HARNESS / GATE-JOURNEY-RUN run journeys A-L under AI_DISABLED and KEY_DISABLED (apps/server/src/core/config/env.ts:305 keyDisabled()); the dependency scanner (PR #139) was closed by D-141; the direct-provider census is RR-DIRECT-PROVIDER-CENSUS.
- Packets: none

### REC-RESEARCH-LEDGER — the research ledger parses and every result has a recorded disposition
- Sources: docs/intelligence/research/RESEARCH-CORPUS.yaml; fictional-intelligence-genome/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:49-72, :158-174; owner ruling D-261
- Status: b — FU-RESEARCH-CORPUS-YAML; the PR-lineage half is REC-RND-LINEAGE.
- Packets: none

#### Covered by the memory track (D-257, MEM-*)

### REC-HONEST-RETRIEVAL — retrieval and context report "not recorded", "retrieval failed", "policy blocked" distinctly, never [] for an outage
- Sources: syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md:71-91 (LAW B1, Hermans); BOOK-GENAI-IMPLEMENTATION-READINESS.md:57-63; kernels/EPISTEMIC-KERNEL-RND.md:42-43; kernels/KNOWING-GRAVITY-NEGATIVE-SPACE-KERNEL-RND.md:603-609; issue#153 comments 6008318382, 6008240990, 6009425710, 6009649322 (2026-10-06)
- Dedup: A:CONTEXT-FAILURE-TAXONOMY and D:RETRIEVAL-FAILURE-HONESTY.
- Status: MEM — MEM-HONEST-RETRIEVAL (gap evidence apps/server/src/modules/ai/semantic-memory.service.ts:393-401).
- Packets: none

### REC-RETRIEVAL-EVAL — retrieval evals measure real precision/recall and tenant/stale leakage with a negative control
- Sources: issue#153 comments 6009649322, 6009425710, 6008318382 (2026-10-06)
- Status: MEM — MEM-EVAL-SUITE.
- Packets: none

### REC-CONTEXT-GENOME — memory separates authority from confidence, valid from recorded time, with provenance and supersession (one evidence-grounded world model)
- Sources: GENAI-RD-GLOBAL-CONVERGENCE.md:402-403, :560-569; GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md:56-69, :299-308; BOOK-GENAI-IMPLEMENTATION-READINESS.md:325-337; syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md:145-162 (LAW B5); kernels/EPISTEMIC-KERNEL-RND.md:22-36; architecture/memory/KEY-MEMORY-CONTEXT-GENOME.md:261-616; KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md:390-393; KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:226
- Dedup: A:CONTEXT-GENOME-M1 and C:MEMORY-CONTEXT-GENOME.
- Status: MEM — MEM-CLASS-COLUMNS/BACKFILL/READ, MEM-EXPIRED-NOT-SERVED, MEM-TEMPORAL-EMBED-DEDUP, MEM-CONSOLIDATION-CHECKPOINT; the full genome is DEFER V1+ (BUILD-MAP-001 row #148).
- Packets: none

### REC-REPRESENTATION-IDENTITY — every vector carries its representation identity (provider, model, revision, dimensions, index generation)
- Sources: issue#153 comments 6008318382, 6008240990, 6008343664 (2026-10-06)
- Status: MEM-deferred (no MEM packet covers it; corrected by the fidelity review) — (flag to the memory track) — deletion propagation and class are planned (W1F-MEMORY-COPIES, FU-MEMORY-COPIES-REWRITE, MEM-TEMPORAL-EMBED-DEDUP, MEM-CLASS-COLUMNS); representation identity itself is absent (model is a constant: semantic-memory.service.ts:120, key-cortex-document.service.ts:121). README owner question OQ-32: add it to the MEM track or not.
- Packets: none here

### REC-LEARNING-STREAM — governed world-knowledge ingestion (sources, cursors, ETag polling, shadow first; external content untrusted)
- Sources: issue #131 body (2026-10-04); KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:152-262
- Status: MEM-deferred (no MEM packet covers it; corrected by the fidelity review) — / deferred — KnowledgeIngestionService registered but uncalled (apps/server/src/modules/key-cortex/key-cortex.module.ts:496, :680; listed in core/config/unreachable-provider.spec.ts:56); depends on the context genome, DEFER V1+ (row #148).
- Packets: none

### REC-ADAPTIVE-RECEPTOR — one intake contract (source identity, tenant, provenance hash, trust state, observed/recorded time) writing observations in shadow
- Sources: issue #125 body (2026-10-04)
- Status: MEM-deferred (no MEM packet covers it; corrected by the fidelity review) — / deferred — no receptor contract (only metaphor comments, key-cortex-homeostasis.service.ts:26, :257); depends on the context genome (row #148).
- Packets: none

#### Decided by an owner ruling or a standing law (no packet)

### REC-DEEPTHINK-ACT — Deep Think (processConsciously) gets a path to act through the efferent bridge
- Sources: docs/neuro-atlas-code-mapping.md:335-338 (top-10 #2); KEY-COGNITIVE-REACHABILITY-MAP-002.md:265-273
- Status: ruled — D-208 keeps Deep Think owner-only and read-only in v1 (W1F-KEY-EVIDENCE-WRITE); consciousness service has no executor call (verified by C). Folded into REC-ONE-COGNITIVE-RUNTIME for later.
- Packets: none

### REC-GENOME-AUTO-APPLY — low-risk DNA evolution proposals auto-apply after reflection
- Sources: docs/neuro-atlas-code-mapping.md:324
- Status: ruled (conflict) — contradicts the human-agency doctrine (docs/canon/01-CONSTITUTION-AND-EXECUTIVE-DOCTRINE.md:34-42) and the later research laws (KEY-PROCEDURAL-MORPHOGENESIS-RESEARCH-001.md:213-232 laws 2, 16; KEY-CONTINUOUS-LEARNING-WORLD-STREAM-RESEARCH-001.md:790). No auto-apply exists (genome-evolution.service.ts). README owner question OQ-33.
- Packets: none

### REC-AUTONOMY-FROM-VELOCITY — KEY's autonomy tier follows business velocity (actions/day)
- Sources: docs/neuro-atlas-code-mapping.md:296
- Status: ruled (conflict) — "resource escalation does not imply authority escalation" (KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md:866) and the human-agency doctrine. Not built (autonomy-orchestrator.service.ts, core/authority/approval-tier.ts).
- Packets: none

### REC-DEP-AUDIT-ENFORCE — new critical/high dependency advisories fail CI closed
- Sources: issue #130 body and comment 6476808659 (2026-10-28)
- Status: ruled — D-22 keeps the dependency audit recorded, not enforced (.github/workflows/ci-cd.yml:274-277, :377-378). README owner question OQ-34 (re-open or not).
- Packets: none

### REC-CLOSED-CONTROL-PLANE — atlas materializer, motif miner / native-capacity shadow, parallel-agent orchestration plan
- Sources: issue #129; PRs #139-#146, #149; issue#153 comment 6243355172 (2026-10-17)
- Status: ruled — closed or ported as history by D-141 (BUILD-MAP-001 section e). The surviving liveness idea of 6243355172 is REC-STALL-SIGNAL below.
- Packets: none

### REC-PROCEDURE-SPEC — repeated episodes become versioned, evaluated procedures through a promotion ladder; a procedure is never a permission
- Sources: issue #135 body and comment 5995945104 (2026-10-05); PR #136; PR #167; docs/intelligence/KEY-PROCEDURAL-MORPHOGENESIS-RESEARCH-001.md:76-88
- Status: d, no packet — only the schema exists (docs/architecture/key-cognition/procedure-spec.v0.schema.json); the auto-triggering skill was dropped by D-149; the pilot (docs/intelligence/KEY-SKILLS-FIRST-HARNESS-PILOT-20261010.json) is NOT_RUN. A procedure runtime is a new subsystem with no small first slice and no honest RED today. README owner question OQ-35.
- Packets: none

### REC-SKILLS-BENCH — benchmark portable skills against task-specific prompts offline before any runtime change
- Sources: docs/intelligence/KEY-SKILLS-FIRST-HARNESS-RD-20261010.md:15-35
- Status: d, no packet — the doc itself grants zero implementation credit (line 3); it is a research experiment, not a product change. Joins README owner question OQ-35.
- Packets: none

#### Engineering-process recommendation handled by the orchestrating worker

### REC-STALL-SIGNAL — the status report flags packets that stay ready without landing beyond a budget (liveness separate from safety)
- Sources: issue#153 comment 6243355172 (2026-10-17)
- Dedup: surviving half of D's "safe-but-stuck loop" item; the rest is ruled (REC-CLOSED-CONTROL-PLANE).
- Status: d — readyList (scripts/agent-memory/lib.mjs:141-163) records no age; `git grep -i stall scripts/agent-memory` empty.
- Packets: RR-STATUS-STALL-REPORT

#### Principles with no concrete change (appendix B, no packet)

### REC-DETERMINIZE-FIRST — resolve exact/derivable parts deterministically before any model call; re-validate model output at deterministic boundaries
- Sources: research/traces/INFORMATION-VELOCITY-TRACE-001-DETERMINIZATION.md:137-147, :266-298, :314-337, :350-357; dossiers/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:22-39
- Status: principle — the trace's own recommendation is "promote the law, not a new runtime" (:350-357); islands exist (cognitive-triage.service.ts:120-163; plan TOF-FINANCE-CANONICAL-TOOLS, W11-CASH-READERS-LEDGER). Its concrete forms are packets elsewhere (RR-RESPONSE-FORMAT-HONEST, RR-AI-CONTRACT-ZOD-FIRST).
- Packets: none

### REC-HONEST-FAILURE-CLASSES — keep invalid input, denied authority, unavailable dependency, unknown outcome, transient and partial commit distinct
- Sources: syntheses/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:139-151; dossiers/ENGINEERING-PRACTICE-CLEAN-REFACTOR-TDD.md:72-81; dossiers/OUSTERHOUT-PHILOSOPHY-SOFTWARE-DESIGN.md:13-25; traces/DEVELOPMENT-SPEED-TRACE-002B-CROSS-DOMAIN-EVOLUTION.md:73-99
- Status: principle — applied per path (communications/adapters/channel-adapter.interface.ts:10-27; MEM-HONEST-RETRIEVAL; TOF-KEY-SELF-MODEL; RR-GATEWAY-TYPED-FAILURES; RR-STRUCTURED-PARSE-INVALID-STATE).
- Packets: none

### REC-REACHABILITY-FIRST — prove a path is live (registered, injected, called, observable) before deep work
- Sources: traces/DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:243-268; DEVELOPMENT-SPEED-TRACE-001-META-ANALYSIS.md:224-243, :280-282; DEVELOPMENT-SPEED-TRACE-002B-CROSS-DOMAIN-EVOLUTION.md:121-136; dossiers/PRAGMATIC-PROGRAMMER.md:13-17; syntheses/DEVELOPMENT-SPEED-SIMPLICITY-AND-VERIFICATION.md:99-105
- Status: principle — the plan's definition of done already binds real-DB integration and journey proof (GATE-HARNESS, GATE-JOURNEYS-G-L, GATE-JOURNEY-RUN; NAV-B-LINKS-KEY, SWP-CENSUS-*).
- Packets: none


## Appendix A — metaphor-only or no proposed change (no packet)

Each line: idea — citation — why no packet. Paths without a prefix are under docs/intelligence/research/ (KNG = kernels/KNOWING-GRAVITY-NEGATIVE-SPACE-KERNEL-RND.md, SFS = kernels/STRUCTURE-FUNCTION-STORAGE-OPTIMIZATION-KERNEL-RND.md, BG = syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md, GC = GENAI-RD-GLOBAL-CONVERGENCE.md, MC = GENAI-RD-MASTER-CONTINUATION.md, CD = CORPUS-IMPLEMENTATION-DISPOSITION.md, EM = EXTERNAL-MINING-ADDYOSMANI-AGENT-SKILLS-2026-10-07.md, DOS = dossiers/, SYN = syntheses/, TR = traces/, FIG = fictional-intelligence-genome/, MS = docs/intelligence/mined-sources/).

### GenAI and research kernels
- Gravity classes (semantic, data, authority, ... coordination gravity) — kernels/KNOWING-GRAVITY-NEGATIVE-SPACE-KERNEL-RND.md:124-238 — a research lens for prioritising, no code change.
- Negative-space taxonomy NS1-NS12 and true/false/unknown/dangerous negative space — KNG:239-493 — classification method for audits; concrete parts already land as MEM-HONEST-RETRIEVAL ("not recorded") and EVAL-HARNESS-HONEST-SUITES (KNG-I09).
- Research coordinate model C={time,structure,knowing,gravity,negative_space} — KNG:526-574 — explicitly "not a proposal for one universal runtime schema" (KNG:574).
- Autonomous R&D reflex triggers/dispositions — KNG:495-524 — research-process note.
- Epistemic frame SUBJECT -> CLAIM -> EVIDENCE -> BELIEF (Observation/Claim/Inference/Fact/Decision) — kernels/EPISTEMIC-KERNEL-RND.md:22-36 — "conceptual only. Do not create a universal database table" (:36); memory parts covered by MEM-*.
- Structure-function laws SFS-L1..L12, ST-L1..L5 (biology, lattices, origami, DNA storage) — SFS:48-218, SFS:412-437 — design heuristics; anti-duplication list SFS:300-314 forbids new engines.
- Fibonacci / fractal / sacred geometry — SFS:375-389 — explicitly evidence-gated metaphor.
- Simplicity as semantic compression (LAW B11) — BG:258-276 — metrics list, no change named.
- "Hide mechanism, not truth" (LAW B3, Ousterhout) — BG:110-124 — design principle; its concrete form is ACTION-UNDERSTANDING-PROJECTION and CAPABILITY-EFFECT-METADATA.
- "Representation is a tool, not truth" (LAW B4) — BG:126-143 — restates existing rulings (pgvector projection etc.); finding, not change.
- Development Organism as homologue of KEY architecture — GC:510-512; MC:192-196 — framing.
- Book dispositions METAPHOR_ONLY / RESEARCH_ONLY: GEB, Logicomix, Hardy, Wisdom Codes, Tao of Programming, Happiness Hypothesis, Constructing the Universe, I Ching, Sefer Yetzirah, Power of Kabbalah, Fibonacci Codex, Algorithmic Kabbalah, Pāṇini (DSL precedence, "owner strengthening" only), Flow (Csikszentmihalyi), Kahneman beyond routing — CD:37-53.
- Multi-agent adapter layer (one neutral contract, per-agent adapters) — EM:254-261 — already the AGENTS.md/agent-memory brief arrangement; no product change.
- Source provenance registry for mined repos — EM:242-252 — research-process (RESEARCH-CORPUS.yaml is the registry; plan FU-RESEARCH-CORPUS-YAML keeps it parsing).
- Freshness/PR-coverage/revalidation laws FR-1..FR-10 and footprint invalidation — RND-FRESHNESS-PR-COVERAGE-REVALIDATION-CONTRACT.md:33-99 — research-process; nearest code is plan FU-ARCH-MAP-REFRESH.
- External-runtime posture (MCP/A2A adapters only; reject Rebuff, second workflow/tool registry/memory store; specialised vector DB only after benchmark) — GC:435-481; MC:320-330 — negative rulings ("do not add"), already respected (no such deps found).
- Layer roadmaps for fine-tuning/PEFT, GraphRAG, A2A, computer use, local-model sovereignty, threat memory/canaries, multimodal safety — GC:416-433; MC:331-340, MC:219-256 — P2/P3 directions with no bounded change named; model-gateway already has an Ollama path (model-gateway.service.ts:1741).

### Books, philosophy, symbolic traditions, fiction, traces
- System 1 / System 2 as KEY architecture — DOS/DECISION-ROUTING-KAHNEMAN-ALGORITHMS.md:22-31,119-133 — explicitly rejected as anthropomorphic labels; only effort tiers survive (already live).
- Explore/exploit, optimal stopping, scheduling/caching ideas — DOS/DECISION-ROUTING-KAHNEMAN-ALGORITHMS.md:46-82 — mechanism-level heuristics, no named change.
- Pāṇini's Aṣṭādhyāyī generative rules; rule order and conflict — DOS/FORMAL-PROOF-SELF-REFERENCE-RULE-SYSTEMS.md:76-109 — lesson is "make rule precedence explicit"; no specific rule engine named (AutonomyOrchestrator/GuardrailPolicy mentioned only as already-required).
- Hofstadter strange loops / self-reference — FORMAL-PROOF-...:55-74 — only its "self-model != authority" law survives (SELF-EVAL-NO-SELF-PROMOTION).
- Symbolic/mystical sources: I Ching, Sefer Yetzirah, Kabbalah/gematria, sacred geometry, Fibonacci Codex — SYN/FORMAL-SYSTEMS-SELF-REFERENCE-AND-SYMBOLIC-TRADITIONS.md:61-80,89-100; DOS/FORMAL-PROOF-...:139-141 ("DO NOT ALLOCATE"); FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:155 — metaphor/historical only. Note: the synthesis's evidence classes (SYN/FORMAL-SYSTEMS-...:12-21: FORMAL, EMPIRICAL, HISTORICAL, PHILOSOPHICAL, RELIGIOUS/MYSTICAL, METAPHOR/ANALOGY, SPECULATIVE, UNVERIFIED) are defined but no source in the matrix is yet tagged; status line says "QUEUED / SOURCE-VERIFICATION IN PROGRESS" and "No item above is an accepted architectural requirement" (:113). GEB, Strange Loop, Logicomix, Little Prover, Mathematician's Apology, Happiness Hypothesis, Wisdom Codes, Tao of Programming: all candidate questions only (:25-87).
- Flow (Csikszentmihalyi) / Peopleware interruption — SYN/DEVELOPMENT-SPEED-...:66-75; DOS/BROOKS-...:79-88 — AI analogue is operational continuity; folded into CONTEXT-COMPILER/metrics, no change of its own.
- Clean Code vs Ousterhout tiny-functions debate, DRY semantics before syntax — DOS/ENGINEERING-PRACTICE-...:83-95; DOS/PRAGMATIC-PROGRAMMER.md:30-34 — design guidance, no change.
- SICP time models / state vs procedure separation / higher-order composition — DOS/SICP-COMPUTATIONAL-ABSTRACTION.md:25-56 — principles; explicitly rejects a new interpreter runtime.
- Weinberg chapter translations and "KEY as institutional cognitive architecture" hypothesis — DOS/WEINBERG-...:8-43 — verdict list, "not yet accepted architecture"; nine candidates converge into workstreams, no change named.
- Neuroscience and optics claims (Ca2+ release, reflex arcs, gap junctions, caffeine, c as bound, modulation, coherent detection, zero rest mass, virtual photons, photosynthetic coherence) — TR/INFORMATION-VELOCITY-TRACE-001-DETERMINIZATION.md:34-123 — triaged; N4, P4, P5, P6 rejected; the rest only motivate laws IV-1..IV-6.
- Inhibitory propagation / signal admission (DROP / STORE_ONLY / ... / ESCALATE), delta cognition, verified-path compilation — TR/INFORMATION-VELOCITY-...:149-198 — verdict CANDIDATE / later-stage, no packet.
- Protein, DNA, lattices, origami, biological modularity/robustness, fractal transport, phyllotaxis — TR/STRUCTURE-FUNCTION-STORAGE-TRACE-001.md:14-155 — analogies; hypotheses H1-H5 (:255-285) are falsifiable but name no change; "derive indexes from observed access paths" (:244-253) is a direction without a target.
- Fictional organs O2/O4/O5/O9/O11 as subsystems; Cognitive Immune System; relationship graph; negotiation (private/public state, reservation boundary, agreement as contract state); ecological planning; curiosity/question generation; institutional values/precedent/stewardship — FIG/GENOME-V0.1-CONVERGENCE.md:34-121,176-181; FIG/TRANCHE-NEGOTIATION-...:12-111; FIG/TRANCHE-INSTITUTIONAL-...:12-45; FIG/TRANCHE-COGNITIVE-LIFECYCLE-...:12-36 — all "EXTRACTED -> CROSS-CONVERGENCE IN PROGRESS, no implementation authority" or NEEDS_EVIDENCE; the ledger defers negotiation/social pending a product journey (FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:97).
- Anti-architecture list (no GoalV2, CapabilityRegistryV2, policy engine V2, multi-agent runtime, HomeostasisV2, identity DB, universal relationship graph, brain service) — FIG/RESEARCH-CONTRIBUTION-ADOPTION-LEDGER.md:116-129; FIG/GENOME-V0.1-FOUR-AUDIT-CONVERGENCE.md:34-39 — a constraint, not a change; currently respected.
- CI type-check fan-out and repeated setup cost — TR/DEVELOPMENT-SPEED-TRACE-003-PROOF-FUNNEL.md:58-101 — "measure before changing"; Windows worker content-addressed proof (:303-312) "No recommendation yet".
- mattpocock F4 spec -> dependency graph -> ready frontier, F5 feedback rate, F7 continuous architecture survey — MS/mattpocock-skills.md:37-56 — already the plan DAG / FU-ARCH-MAP-REFRESH; no new change.
- gstack F8 browser QA evidence, F9 daemon state law (ALIVE/RESPONSIVE/HEALTHY/BUSY/STALE) — MS/garrytan-gstack.md:72-85,149-150 — the first is covered by GATE-HARNESS Playwright journeys; the second targets the Windows worker, no concrete owner today.

### Neuroscience atlas, KEY research, architecture
- Neuron/axon/synapse/neurotransmitter mappings (sections 1,3,4,6,7) — docs/neuro-atlas-code-mapping.md:11-58 — describe existing code, no change ("Recommendation: —").
- Glossary of biological→code terms — docs/neuro-atlas-code-mapping.md:382-416 — naming only.
- Sections with "Recommendation: —" (cerebral cortex, prefrontal, hypothalamus, pituitary, HPA, etc.) — docs/neuro-atlas-code-mapping.md:46-320 — mapping only.
- "Biological services are mechanisms, not top-level organs" — KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:185-207, :398-399 (COG-006) — classification guidance, no code change.
- "One KEY identity; multiplicity is topology" / Genome is not KEY's mind — KEY-COGNITIVE-ARCHAEOLOGY-...-001.md:105-140, :401-406 — vocabulary rule.
- K1-K7 kernel taxonomy and computational realizability matrix (COG-COMP-001) — KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md:250-259 — research classification.
- Immune / military doctrine parallels (mission command, ISR, combined arms, deception, wargaming, AAR) — KEYFLOWOS-CONTINUOUS-ASSURANCE-...-001.md:876-1490 — lenses; concrete parts captured above (two-key, safe mode, tripwires, causation ids).
- Morphogenesis / phenotype / mycelial transport — KEY-PROCEDURAL-MORPHOGENESIS-RESEARCH-001.md:91-138 — analogy; the procedure promotion ladder (:76-88) is post-v1 governance, no code target.
- Subject/attestation separation — KEY-PROCEDURAL-MORPHOGENESIS-RESEARCH-001.md:178-194 — "research target for the successor control architecture".
- Interface discovery engine / descriptor normalizer / connector compiler / active sensing / deep OS interoception — KEY-CONCURRENCY-...-001.md:498-571 — speculative R0-R7 research sequence, no bounded change.
- World-learning stream modes L1-L6, scholarly APIs, horizon scanning — KEY-CONTINUOUS-LEARNING-...-001.md:152-262 — memory/learning research (D-257 territory).
- Standards/innovation method, anti-normalization, freshness rule — 14-STANDARDS-RESEARCH-INNOVATION-METHOD.md (whole) — research-process only.
- System-dynamics feedback classes and innovation list (adaptive friction, blast-radius simulation, authority graph) — 16-SYSTEM-DYNAMICS-QUALITY-DIMENSIONS.md:64-220,330-370 — evaluation method/aspirations, no concrete change.
- Kernel dossier schema, finding lifecycle, recommendation discipline — 12-KERNEL-PROGRAMME.md:585-700 — documentation process.
- K12 engineering control plane target (restricted run controller → trusted evaluator → human integration) — kernels/KF-KERNEL-012-ENGINEERING-CONTROL-PLANE.md:112-118 — already the agent-control process (.github/workflows/agent-control-*.yml).
- Atlas layers L0-L8 / views — architecture/atlas/atlas.yaml, README.md — never-materialized design record (D-141).
- OS cycles (truth/audit/burndown/reflect) — architecture/os/OS.md:1-33 — HALTED by owner 2026-09-12.
- Platform target (Vercel, immutable images, PITR, IaC) — target-architecture.md:110-138 — inactive successor programme, not authorized.

### Issue #153 and research PRs
- PagedAttention as OS virtual memory — issue#153 comment 6006109752 2026-10-06 (A) — analogy only; disposition "use through vLLM, absorb the resource lesson"; KEY runs no self-hosted inference. The actionable part is LLM-ADMISSION-CONTROL.
- Continuous batching as work-conserving queueing — 6006109752 2026-10-06 (B) — analogy; no GPU scheduling in Nest ("do not pull runtime scheduling into business logic", 6006549000 C9).
- Type system as receptor specificity; DI as operating-room setup; retry layers as nested control loops — 6007335935 2026-10-06 (s.26) — metaphors; the concrete parts are OUTPUT-CONTRACT-SINGLE-SOURCE and COGNITIVE-EXECUTION-BUDGET.
- Retain Postgres + pgvector; do not add a vector DB without a benchmark — 6008343664 2026-10-06 (s.4, s.9) — a "keep what works" decision, no change.
- Fine-tuning ladder / adapters are not memory / no per-tenant adapters — 6008383152 2026-10-06 — KEY does no fine-tuning; rule for the future only.
- Computer use as last-mile fallback via a trusted local agent — 6009055442 2026-10-06 (CU-GAP-01..06), 6009218421 (s.14) — no product computer-use exists; rule for when it is built.
- A2A for external agents only; remote completion needs evidence — 6008959914 2026-10-06, 6009218421 (s.13) — no A2A in product.
- Reject Composio/Arcade/LangGraph/second runtime; "no second gateway/eval stack/memory store" — 6009218421 (s.18), 6009649322 (s.30), 6010080039 (external-runtime posture) — anti-duplication rules, nothing to build.
- Morphogenesis, mycelial routing, tissue/organ composition, VSM recursion — issue #135 body — biological metaphors; concrete residue is PROCEDURE-SPEC.
- Immune system / mission command / wargaming doctrine — issue #130 comment 5985219650 2026-10-04 — doctrine; concrete residue is ASSURANCE-SAFE-MODE.
- Kubernetes controllers, Temporal histories, Lamport safety vs liveness — issue#153 comment 6243355172 2026-10-17 — mined semantics for a retired control plane.
- GENAI-RD-MAP-001 inventory/gap map — 6008214484 2026-10-06 — research-process bookkeeping.
- Old "consciousness / JARVIS 7 layers / organs" PRs #27, #30, #31, #38, #54, #55, #57 — implementation PRs with neuro-metaphor names, not research; no recommendation extracted.
- Need-to-know response disclosure and a model rollback branch — docs/intelligence/research/fictional-intelligence-genome/TRANCHE-DECEPTION-SELF-CORRECTION-001.md:71, :79 — the tranche grants "No implementation authority"; its concrete law (data is not instruction is not authority) is REC-UNTRUSTED-CONTENT-FENCE (added after the fidelity review).
