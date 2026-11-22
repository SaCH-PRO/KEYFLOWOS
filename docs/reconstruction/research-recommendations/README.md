# Research recommendations re-derived for v1 (D-261, D-262)

Owner rulings D-261 ("every architectural recommendation in the owner's research index joins v1 as a packet, unless it is already done on main or already a plan packet") and D-262 ("rebuild the list from the repo, not from the owner's workbook") are recorded in `docs/reconstruction/BUILD-MAP-001.md` on `pkt/V1-RULINGS-3E`. This directory is the research worker's output. It proposes packets. The orchestrator admits them: nothing here edits `V1-PLAN-RECUT.json` or `BUILD-MAP-001.md`.

- `RECOMMENDATIONS-INDEX.md`: every recommendation with its sources, how duplicates were merged, its verified status, and its packet ids. Appendix A lists the metaphor-only ideas.
- `RR-PACKETS.json`: 89 proposed packets in the plan's exact JSON shape.
- This README covers method, counts, what could not be verified, owner questions and review results.

Base: code at **origin/main 2c4e4bf2**; plan at **pkt/V1-RULINGS-3E f6f6e01e** (234 packets).

## 1. Method

1. **Sources read.** Four extraction workers each covered one area.
   - `docs/intelligence/research/**`: the GenAI R&D series, Book x GenAI, RD-03, the kernels, the contracts, the 10 book dossiers, the syntheses (including the symbolic-traditions source matrix), the 15 traces and the 27-file fictional-intelligence genome.
   - `docs/intelligence/mined-sources/*`.
   - The KEY research docs at the top of `docs/intelligence/` (cognitive archaeology, crosswalk, reachability map, concurrency/receptor, world stream, morphogenesis, skills-first, continuous assurance), plus docs 12, 14, 15 and 16 and the 12 kernel docs.
   - `docs/neuro-atlas-code-mapping.md`.
   - `architecture/**`: target architecture, migration plan, the risk register R1-R63, the security/tenant/privacy audit, the atlas, the memory genome and the OS.
   - Issue #153: the body and all 94 comments. The ten layer convergences, the global and packet-derivation comments, the context-compiler checkpoint and the stall-loop comment were read in full. Per-subject comments were read through their GAP lines.
   - The research-related issues and PRs: 12 issues and 26 PRs, matched by research, genome, atlas, cognition, intelligence, philosophy, parallel, R&D, neuro and book in the title or labels.
   - Not covered: memory research (branch `docs/kf-memory-rnd-001`, D-257) and issue #80. The 08*/09*/10* finding, contradiction and recommendation registers are the audit backlog, which the build map's coverage ledger already absorbed; they were left out as not research.
2. **What counts as a recommendation.** A concrete change to code, data, security, AI behaviour or engineering process. A metaphor counts only where its source names such a change. Metaphor-only ideas, research-process notes and "keep what works" decisions go to Appendix A (65 entries).
3. **Deduplication.**
   - About 180 raw items from the four workers were merged into one master list. Two blocks were merged only when they propose the same change at the same code seam.
   - Typical merges: the GenAI corpus, issue #153 and the genome all propose "untrusted content is data, not instruction". The Norman dossier, the Book x GenAI packet KF-KEY-ACTION-UNDERSTANDING-001 and PR #156 all propose action understanding. The vLLM admission-control comment and the neuro atlas's event-bus backpressure became one recommendation with two packets.
   - Each index block has a **Dedup** line that names the merged blocks.
   - Big recommendations were not split into several recommendations. Five architecture ratchets were kept separate because the architecture plan lists them separately.
4. **Verification.**
   - Every status was checked against code at 2c4e4bf2 with `git grep` and file:line. Every "already planned" status was checked against the scope and definition of done of the 234 plan packets.
   - The packet writers then re-opened every code premise. That second pass reversed several worker claims; see section 5.
5. **Packets.**
   - Seven packet writers drafted the packets in the plan's shape.
   - Each packet is S, XS or M. There are no L packets: big convergences get a first slice, usually a census spec that fails on a new unregistered path.
   - Every definition of done starts with a concrete RED test that fails on main.
   - Every packet cites D-261 and D-262 and every ruling it must respect: D-100/D-128/D-233/D-234/D-238 for money and sales sight, D-226/D-227, D-257, D-208, D-129, D-17, D-22, D-103, D-141 and the human-agency doctrine (`docs/canon/01-CONSTITUTION-AND-EXECUTIVE-DOCTRINE.md:34-42`).
6. **Validation** (re-run before each push). `RR-PACKETS.json` parses, has 89 ids, none duplicated and none colliding with a plan id. Every `depends_on` names a plan packet or an RR packet. Every packet has the exact 17 keys in plan order, `kind: "new"`, `fixture_prefix: null`, and a definition of done that starts with `RED:`.

## 2. Counts

There are 128 recommendations (index rows), plus 3 principles that name no concrete change (index section 8, no packet).

| Status | Rows | With an RR packet | Without |
|---|---|---|---|
| a, done on main | 20 (one row groups 11 security-register items) | 0 | 20 |
| b, already a plan packet | 8 | 1 (REC-STATE-TRANSITION-COMMANDS: residual change-order fix) | 7 |
| MEM, covered by the memory track | 6 | 0 | 6 |
| ruled, decided by ruling or doctrine | 5 | 0 | 5 |
| c, partly done | 49 | 43 | 6 |
| d, not done | 40 | 35 | 5 |
| **Total** | **128** | **79** | **49** |

- **New packets: 89.** By priority: P1 12, P2 34, P3 43, P0 none. By size: XS 8, S 66, M 15.
- **No P0 is proposed.** Two packets become P0 on an owner answer: RR-MCP-TENANT-BOUND (if MCP servers are configured in production) and RR-BANK-TOKEN-ENCRYPT (if production has non-null bank access tokens). See OQ-1 and OQ-4.
- **Metaphor-only entries:** 65, in Appendix A of the index.
- **Comparison with the owner's index.** It counted 60 recommendations; this pass has 128. The two lists are not expected to match line for line (D-262). The difference comes from:
  - this pass includes the architecture security register (23 rows, 11 of them already done);
  - it keeps the neuro-atlas "top 10" items as separate rows;
  - it splits the architecture ratchets into five rows;
  - it lists done and ruled items as rows instead of dropping them.
  - Restricted to rows that cite the research corpus proper (`docs/intelligence/research/**`, issue #153 or the research issues and PRs) and counting only status c and d, the figure is 54 (computed from the index's Sources lines).

**c and d rows without a packet (11), each with its reason in the index:**

| Row | Reason |
|---|---|
| REC-EMOTION-ENDOCRINE | Endocrine state is per business, so one member's mood would change KEY for everyone; rating-as-reward pushes KEY toward telling users what they want to hear. |
| REC-DOC-VOICE-ORGANS | Nothing consumes the events. Broadcasting document extractions would open a money-sight path before MEM-DOC-EXTRACTION-SIGHT lands. |
| REC-THROUGHPUT-METRIC | Nothing reads the number, so there is no honest RED. |
| REC-AUTH-FAIL-FAST | The DI fallback is unreachable, and an invalid token already gets 401 on every guarded route. |
| REC-SOCIAL-OAUTH-STATE | The state is random, single-use, expires in 10 minutes and is bound to the business; the module is hidden in v1. |
| REC-CONSENT-UNIQUE | The ledger is append-only by design, and a unique key would destroy legal history. |
| REC-STRUCTURED-CLAIMS | Its envelope comes from the plan D-141 left unadopted, and reviews are prose, so there is no artifact to test. |
| REC-RND-LINEAGE | An optional template field has no reader. The disposition half is done by D-261/D-262 and this index. |
| REC-GENERATED-INSTRUCTIONS | No drift was found. |
| REC-PROCEDURE-SPEC | A new subsystem with no small first slice. |
| REC-SKILLS-BENCH | Research-only by its own doc. |

All 11 are owner questions or confirmations below.

## 3. Packets by priority (one line each)

**P1 (12)**
- RR-UNTRUSTED-CONTENT-FENCE (M): attachment text, tool output and MCP output enter KEY prompts fenced as data that carries no instructions.
- RR-STREAM-ERROR-NO-EFFECTS (S): a stream that errors mid-answer no longer appends a fallback provider's text, or runs collected tool calls.
- RR-MODEL-LIFECYCLE-GUARD (S): an owner-filled model catalog. Retired models are never sent a request, and a census spec fails on an uncatalogued model id.
- RR-TOOL-WRITES-SEQUENTIAL (S): writes in one model turn run in order; only reads stay parallel (today `Promise.all`).
- RR-DISPATCH-NO-BLIND-RETRY (S): the plan-queue dispatcher stops retrying writes after a generic error; such a write ends OUTCOME_UNKNOWN for a person to check.
- RR-DISPATCH-ATOMIC-CLAIM (S): the dispatcher takes an atomic, per-business durable claim (KeyIdempotencyService, D-103) before any effect.
- RR-MCP-TENANT-BOUND (S): bridged MCP calls carry the business, and each server config must list its businesses. Nothing changes when MCP is unset. P0 if it is configured in production.
- RR-WEBHOOK-INGRESS-CENSUS (S): a census of public webhook routes, plus a tenant fix. `/social/webhook/:businessId` currently ingests a Meta-signed body naming another business's page.
- RR-BANK-TOKEN-ENCRYPT (S): BankConnection.accessToken is encrypted at rest (it is plaintext today), with a dry-run-first backfill.
- RR-DB-CRYPTO-KEY-CENSUS (S): a read-only count of values encrypted under the current key, the fallback key, the core chain, plaintext, or undecryptable.
- RR-DB-CRYPTO-PROD-GUARD (XS): packages/db refuses the dev fallback key in production. It lands only on owner evidence (OQ-5).
- RR-ERASURE-BUSINESS-EVENTS (S): a contact forget-purge also scrubs the business_events rows that hold the contact's request and response bodies.
- RR-ADMIN-LOGOUT (S, web): an admin sign-out control. Every sign-out clears the super-admin token, which today outlives the session and is preferred by `getAuthHeaders`.

**P2 (34)**
- RR-KEY-SAFETY-POLICY (M): the cortex input-safety check becomes a versioned finding-to-action table. A PII hit no longer skips the injection checks, and a missing or throwing checker withholds tools.
- RR-REDACTION-BY-CONTENT (S): `deepRedact` also catches card numbers and secret-shaped values, not only by field name.
- RR-GATEWAY-TYPED-FAILURES (S): 429, cancel and policy errors no longer open the shared provider circuit.
- RR-LLM-ADMISSION-CONTROL (M): a per-business, Redis-backed limit on model calls in flight, answering 429 `ai_capacity` when reached.
- RR-UNKNOWN-COST-NOT-ZERO (S): unpriced model cost is recorded as unknown, never $0; one price table.
- RR-RESPONSE-FORMAT-HONEST (M): `responseFormat` is honoured per provider, or refused when the provider cannot meet it.
- RR-CORTEX-TYPED-RESULT (S): the parser stops inventing confidence 70 when the answer has no Confidence section.
- RR-STRUCTURED-PARSE-INVALID-STATE (S): a contract violation is a distinct state. Cost is recorded, and empty output is not success.
- RR-STRICT-TOOL-SCHEMAS (M): tool arguments are validated strictly. Unparseable arguments are refused, not run as `{}`, and undeclared arguments are rejected.
- RR-KEY-RUN-BUDGET (S): at most 8 tool calls per model response; calls over the cap get a visible "not run" result.
- RR-TOOL-EFFECT-CLASS (M): every FLOW_TOOLS entry declares effect class, idempotency, reversibility and version, enforced by a census.
- RR-CONNECTOR-CONFORMANCE (S): a shared connector harness. A connector working only on the platform env key is not reported as "connected" (OQ-13).
- RR-INTENT-PARSER-ONE-TOOL-LIST (S): the intent parser uses the chat's per-business tool list, not a hand list that includes hidden families.
- RR-LEGACY-TOOLS-CLASSIFY (S): a table classifies the 14 legacy KeyToolRegistry tools; aliases route to the canonical tool.
- RR-LEGACY-FALLBACK-REMOVE (M): remove KeyCommand's legacy fallback and the legacy registry.
- RR-HEALTH-TIGHTENS-CONTROL (M): degraded health, or a failed health read, only ever tightens the action boundary's control requirement.
- RR-ACTION-UNDERSTANDING-SERVER (S): a pure projection per proposal (phase, authority, executed, verified from outcome evidence, reversibility), applied after the reader-scope and money-tag projections.
- RR-ACTION-UNDERSTANDING-WEB (S): the proposal card shows the real reason and "done" versus "done and confirmed". This replaces the misleading copy "blocked by KEY Genome readiness".
- RR-ACTION-BOUNDARY-NEXT-CAPABILITY (M): `commerce_send_invoice` becomes the action boundary's second governed capability, with a receipt bound to its fingerprint.
- RR-ACTION-INTENT-ONE-CLASSIFIER (S): the six disagreeing action-verb regexes become one classifier.
- RR-EVAL-HARNESS-NO-VACUOUS (S): eval checks can no longer pass vacuously. Results are PASS/FAIL/NOT_RUN/INDETERMINATE/ERROR, with negative controls.
- RR-KEY-FAKE-MODEL-TRAJECTORY (M): a scripted model double plus trajectory assertions (tool, authority, effect) on real-DB Flow cases.
- RR-LANGFUSE-INGESTION-CUTOVER (S): the trace exporter leaves the legacy ingestion API, its failures become visible, and business id stops being sent as user id (P1 if the Langfuse keys are set: OQ-2).
- RR-JOB-TENANT-CONTEXT (M): a `runForTenant` helper, a census of background entry points, and a first adoption.
- RR-CHANGE-ORDER-APPROVE-COMMAND (S): change orders are approved or rejected by commands with compare-and-set and audit. PATCH no longer accepts client-supplied `approvedBy`/`approvedAt`.
- RR-AUTHORITY-SHADOW-PARITY (S): shadow mismatches are counted, plus a Postgres parity matrix. The cutover itself is not in this packet.
- RR-RETENTION-EXPIRED-EXPORTS (S): expired or consumed contact export bundles, which hold full personal data, are deleted.
- RR-OBJECT-STORAGE-POSTURE-CHECK (S): diagnostics reads the bucket's public-access, policy and encryption state, changing nothing.
- RR-BUSINESS-EVENT-REDACT (S): BusinessEvent emit and the ContactAudit diff redact secret-named fields at the write.
- RR-SCRIPT-SPECS-IN-CI (S): every script spec runs in CI or is exempt with a reason. Four specs, including agent-memory's, run nowhere today.
- RR-CI-REQUIRED-JOBS-AGGREGATE (S): a CI verdict job that is red when a gating job failed, was skipped or was cancelled.
- RR-GATE-LEDGER-MONOTONIC (S): CI compares the shrink-only ledgers between base and head and goes red when one grows. There is no override.
- RR-ERASE-BUSINESS-TWO-STEP (M): whole-business GDPR erasure becomes request, cooling-off, then confirm, with surviving records. It waits on OQ-30.

**P3 (43)**
- KEY safety and gateway:
  - RR-KEY-PROMPT-CANARY: a per-turn canary marker in the system prompt; a tool call carrying it is refused.
  - RR-CORTEX-BUS-BACKPRESSURE: bus ledger writes run with a bounded concurrency and drop nothing.
  - RR-OPENSOURCE-PROVIDER-SPLIT: Ollama and OpenRouter become distinct resources.
  - RR-MODEL-SELECTION-ONE-SEAM: delete the dead provider-selection service; census of model-id literals.
  - RR-DIRECT-PROVIDER-CENSUS: census of provider calls outside the gateway; document embeddings are not metered today.
  - RR-ANTHROPIC-TOOL-PARITY: map tool choice 'none', send native tool_result blocks, keep the assistant's tool calls.
  - RR-PROMPT-CACHE-PREFIX: Anthropic `cache_control` and cached-token pricing.
  - RR-AI-CONTRACT-ZOD-FIRST: first contract is `intent_parse`, whose validator and tool schema disagree today.
- Capabilities:
  - RR-CONNECTOR-STACK-CENSUS: census of the two connector stacks.
  - RR-GOAL-WRITER-CENSUS: census of AiGoal and BusinessGoal writers.
  - RR-KEY-SAFE-MODE: KEY_SAFE_MODE; reads still answer, non-read tools are refused, KEY crons stop.
  - RR-UNDO-DURABLE: undo state in a table with an atomic claim, replacing the in-process 5-minute Map.
- Cognition:
  - RR-TRIAGE-RISK-FLOOR: a risk context can only raise triage's effort tier.
  - RR-SELFTUNE-CANDIDATE-ONLY: delete the unreachable selfTune, which applies model-chosen changes.
  - RR-LEARNING-OUTCOME-SEMANTICS: tool success is no longer recorded as user "accepted".
  - RR-EVAL-RUN-LINEAGE: eval runs record suite version and definition hash.
  - RR-COG-RUNTIME-ENTRY-CENSUS: census of the runtime entry points.
  - RR-APPROVAL-MODEL-CENSUS: census of the five approval models.
  - RR-REFLECTION-HONEST: maintenance stops reporting work it never did; the dream journal is capped.
  - RR-CASH-TARGET: an owner-set runway target in months, revenue-scoped, suggestions only.
- Operations:
  - RR-AI-TRACE-ATTEMPTS-CORRELATION: failed and fallback attempts become spans under one trace.
  - RR-SLO-AVAILABILITY-LEDGER: SLO document plus a 30-day error-budget figure.
  - RR-ERROR-CAPSULE: release sha, replica, correlation id and failure class on each error entry.
  - RR-SECURITY-SIGNAL-COUNTERS: bounded counters on a super-admin route.
  - RR-INTEGRITY-WATCH: read-only checks for child rows whose business differs from the parent's.
  - RR-CRON-OCCURRENCE-LOCK: Redis occurrence claim plus a cron census.
  - RR-STATUS-PATCH-CENSUS: registry of Update DTOs that carry a status field.
  - RR-DEAD-EVENT-CENSUS: publish-only events.
- Architecture ratchets:
  - RR-FORWARDREF-RATCHET.
  - RR-WEB-CLIENT-RATCHET.
  - RR-KEY-CORTEX-SIZE-RATCHET.
  - RR-UNUSED-MODEL-CENSUS.
  - RR-ARCH-SCAN-CI: report-only.
- Security:
  - RR-ADMIN-SHELL-SERVER-GATE: an edge gate on /admin.
  - RR-SESSION-STORAGE-CENSUS: ratchet on browser-readable credential writes.
- Process:
  - RR-GATE-LEDGER-CENSUS: register the 19 unregistered shrink-only ledgers.
  - RR-BUNDLE-RULING-CONFLICTS: the bundle shows supersedes/widens links between rulings.
  - RR-BUNDLE-PROOF-PROFILE: research proof profiles attached to the bundle, tagged research-only.
  - RR-HOTSPOT-SCANNER: churn, fix density and co-change from git.
  - RR-STATUS-REVIEW-CYCLES: review-repair counts per packet, labelled as a lower bound.
  - RR-HOOK-PACKET-SCOPE: warns on edits outside the packet's write set; never denies.
  - RR-INDEX-COVERAGE-REPORT: 4 tenant models lack an index led by businessId.
  - RR-STATUS-STALL-REPORT: V1-STATUS flags packets that have been ready longer than a budget; informational only.

**Shared files.** Many packets edit the same few files: `model-gateway.service.ts` (14 packets), `flow-orchestrator.service.ts` (10), `scripts/agent-memory/lib.mjs` (6), `.github/workflows/ci-cd.yml` (5) and `apps/server/test/helpers/fixture-prefixes.json`. Only real ordering needs are recorded as `depends_on`. When admitting, the orchestrator should give these packets file-order edges or lanes, as it did in the plan's "File-order edges" section, and pre-allocate fixture prefixes in the plan's prefix table.

## 4. What could not be verified

- **Production facts.** None of these could be read from here:
  - whether MCP_REMOTE_SERVERS is set;
  - whether the LANGFUSE_* keys are set;
  - whether any BankConnection has a non-null access_token;
  - whether production ever encrypted under the fallback key;
  - the object-storage provider and its bucket policy;
  - whether the platform Stripe/PayPal keys are set (this decides how many businesses see a false "connected");
  - whether Meta delivers to the per-business social route;
  - the production routing_table row.
- **Provider facts.** No external traffic was sent, so these are unverified:
  - model retirement dates; the Anthropic dates come from a bundled reference cached 2026-11-03, and no other provider's were checked;
  - that Langfuse removed `/api/public/ingestion` on 2026-11-16 (the date comes from the research doc only) and that its OTLP endpoint accepts JSON;
  - Anthropic `tool_choice: none`, cache minimums, OpenAI strict mode and `response_format` support.
  - Each affected packet says to verify at build time, and to stop with a CONTRADICTION if a fact is wrong.
- **Line numbers.** Research-doc line numbers and issue #153 comment ids were taken from the extraction workers' reads. Code citations were re-opened by the packet writers; research-doc citations were not all re-opened.
- **Security register items not re-verified:** R26, R35, R40, R50, R51, R53, R54.
- **Heuristic counts.** About 38 Prisma models have no direct accessor. 19 shrink-only ledger hits are unregistered. The census packets resolve both.
- **The owner's own index.** Its 378 parallels, 210 V1 work items and 3,941 comments are not visible to this worker. Section 2 explains why the counts differ.

## 5. Corrections found during verification

The writers' second look reversed or reshaped these worker claims:

- **SafetyShell durable idempotency → status a.** Its only caller runs after the durable claimForExecution of V1-32.
- **KEY safety-check packet re-targeted.** The web chat uses Flow, not the cortex query pipeline (flow-orchestrator.service.ts:663-668).
  - The cortex fix stays at P2 under D-17.
  - Flow member chat has no input check at all: OQ-6.
- **A defect the notes missed.** `ModelGateway.streamComplete` appends a fallback provider's answer to a stream that already started (model-gateway.service.ts:1123-1137). RR-STREAM-ERROR-NO-EFFECTS covers it.
- **Run budget.** Flow and cortex loops are structurally one tool round. What is unbounded is the number of tool calls per response.
- **Dead code.** KeyCortexProviderSelectionService has no caller except its spec.
- **Prompt cache → status c.** OpenAI prefix stability is already tested.
- **Dead-event audit → status c.** The listen-only ratchet already exists (core/event-bus/event-wiring.spec.ts:88).
- **False integrity premise.** The duplicate-payment gap was false: `Payment.providerPaymentId` is @unique.
- **Money property tests already exist** (money.spec.ts:205-279, balance-arithmetic.spec.ts:101-156). A 200,000-case seeded fuzz found no counterexample, so there is no packet.
- **Reflection → status c.** Reflection sessions and validated hypotheses already persist. What remains is maintenance reporting work it never did.
- **Three new defects** surfaced while verifying:
  - the social webhook tenant binding;
  - the admin token outliving sign-out;
  - change-order approval through a generic PATCH with client-supplied approver.

## 6. Open questions for the owner

Each question gives options and a recommendation. A packet that depends on an answer says so in its scope and keeps the safe default until the owner answers. Production-fact questions come first because they set priorities.

| # | Question | Options | Recommendation |
|---|---|---|---|
| OQ-1 | Is `MCP_REMOTE_SERVERS` set in production or staging, and for which businesses? | set (RR-MCP-TENANT-BOUND becomes P0, and each server needs `businessIds` at deploy) / unset (P1, no runtime change) | Answer first. The packet is safe either way. |
| OQ-2 | Are `LANGFUSE_*` keys set in production? | (a) yes: the cutover runs at P1 now, since exports are probably rejected since 2026-11-16; (b) no, tracing wanted later: keep P2; (c) no and not wanted: delete the exporter instead | Answer first. Use (b) while unknown (COST-LEDGER-001.md:69 records Release 0 as off). |
| OQ-3 | Model catalog: the status of each routed model id, and replacements for retired defaults | A like-for-like replacement per provider / B remove the provider from the default table until chosen | A for Anthropic now: both routed ids are listed as retired, and the current ids are claude-sonnet-5-5 and claude-haiku-5-5. B for any provider id the owner cannot confirm. Add prices for new ids in the same change. |
| OQ-4 | Does production have non-null `BankConnection.access_token` rows? | yes: RR-BANK-TOKEN-ENCRYPT becomes P0 on the security lane (D-174) / no: P1 | Run the packet's dry-run to answer. |
| OQ-5 | Production key evidence for RR-DB-CRYPTO-PROD-GUARD | A land the guard when the diagnostics key source passes and the census shows zero fallback, core-chain or undecryptable values / B re-encrypt first (dry-run, then apply on authority), then land / C keep held | A, or B when needed. Never land on the diagnostics reading alone. Unify packages/db with the core/crypto key chain in a separate packet after the census. |
| OQ-6 | Should Flow member chat get an input-safety check? | A none (the fence covers third-party text) / B rules in detect mode, logged, never blocking / C enforce | B as a small follow-up once RR-KEY-SAFETY-POLICY lands. A as fallback. Not C. |
| OQ-7 | Model-call admission when Redis is down, and the defaults | fail closed / per-process counter / no limit | Per-process counter. 6 calls in flight per business, 2 s wait. |
| OQ-8 | May the cortex bus coalesce or shed low-importance events? | never / coalesce low or normal events (never high or critical) / drop | Never in v1. Revisit after MEM-CENSUS. |
| OQ-9 | Meter and charge document-indexing embeddings? | meter and charge / meter at 0 credits / leave | Meter at 0 credits. Charging is a pricing decision. |
| OQ-10 | KEY run budget: at most 8 tool calls per model response? | confirm / other number | Confirm 8. |
| OQ-11 | Which price set is right (the gateway and llm-cost tables disagree)? | re-verify against providers at build time | Use verified current prices. No history rewrite. |
| OQ-12 | SafetyShell compensation | A no packet / B delete the dead rollback plumbing / C wire it with no caller | A |
| OQ-13 | Connectors page when only the platform env key exists | A not "connected", credential source "platform" / B "disconnected" / C keep "connected" | A. Payment behaviour is unchanged (D-138). |
| OQ-14 | Second capability for the action boundary | commerce_send_invoice / payment reminder / booking cancel | commerce_send_invoice |
| OQ-15 | Dream hypotheses | persist now / wait for the memory design's hypothesis store / remove the feature | Wait. Validation cannot confirm one today. |
| OQ-16 | Converge the cognitive runtimes against D-17? | census only in v1 / amend D-17 | Census only |
| OQ-17 | Document and voice organ events | no packet in v1 / packet once a consumer exists | No packet in v1 |
| OQ-18 | Detected emotion into endocrine state | confirm "no packet" | Confirm no packet |
| OQ-19 | Unit of the owner cash target | runway months / cash amount / both | Runway months |
| OQ-20 | May SLO error-budget state slow releases or KEY? | never / releases only, by a person / automatic KEY throttle | Never in v1. An automatic throttle conflicts with human authority. |
| OQ-21 | Which contract status moves may a PATCH make? (Today TERMINATED can be patched back to ACTIVE, which re-arms the renewal sweep.) | transition table plus a renew command / leave free / defer | Transition table, as a follow-up to RR-STATUS-PATCH-CENSUS |
| OQ-22 | When does effective authority leave shadow mode? | per controller family after parity / after a positions and grants review / post-v1 | Review first, then one family per packet |
| OQ-23 | Should architecture-map drift ever block a PR? | never / block, with standing map-refresh authority / block only on new cross-module edges | Never in v1. New-edge blocking later. |
| OQ-24 | KEY throughput metric | drop / totals on super-admin diagnostics / feed homeostasis | Drop, or totals only. Never fed to KEY. |
| OQ-25 | HttpOnly session cookies | localStorage plus ratchet in v1 / server-held HttpOnly refresh cookie later / now | Ratchet now, HttpOnly in V1.x |
| OQ-26 | Retention periods for activity logs, notification logs and sessions | owner sets periods, dry-run first / keep everything in v1 | Set periods, with a dry-run count before any delete |
| OQ-27 | ContactMedia files survive a forget-purge (client URL, objects not business-prefixed) | prefix uploads then delete on purge / accept as a known gap with a visible note | Visible note now. Prefix-and-delete after the v1 security packets. |
| OQ-28 | Consent ledger | latest-wins tie-break and latest-only counting / unique key plus upsert (R52) / nothing in v1 | Nothing in v1 (/communicate is hidden). The tie-break when it returns. Not R52. |
| OQ-29 | Object-storage upload headers | per-object SSE/ACL headers / bucket-level settings | Bucket-level, with per-object headers only where the posture check shows a need |
| OQ-30 | Whole-business GDPR erase (one SUPER_ADMIN, one irreversible call today) | A second admin confirms / B request, cooling-off, then confirm, cancellable, with surviving records / C add the record only / D not in v1 | B: works with one admin, keeps a manual path, no schema change. Nothing changes until answered. |
| OQ-31 | Do the new CI verdict and ledger jobs count as "CI green" under D-239? (main has no required checks today) | A yes / B report only / C yes, and make them required on main | A now, C later. B until answered. |
| OQ-32 | Representation identity per vector (provider, model, revision, dimensions) | add to the MEM track / leave | Add to the MEM track as a follow-up of MEM-TEMPORAL-EMBED-DEDUP |
| OQ-33 | Neuro-atlas auto-apply of low-risk genome evolution, and autonomy tier from velocity | confirm closed under the human-agency doctrine / rule to allow | Confirm closed |
| OQ-34 | Fail-closed CI on new critical/high dependency advisories (D-22 keeps it recorded only) | keep D-22 / re-open | Keep D-22 for v1 |
| OQ-35 | Procedure specs and the skills-first benchmark | post-v1 research / a v1 packet | Post-v1. There is no small slice and no RED. |
| OQ-36 | POST eval/run is open to any member and may call a model (cost and abuse surface, found by G2b) | owner-only plus a rate limit / leave | Owner-only. This could be added to RR-EVAL-HARNESS-NO-VACUOUS on admission. |

## 7. Reviews

Two fresh subagent reviews were run before the report:

1. **Fidelity:** every recommendation traceable, nothing invented, duplicates merged correctly, statuses verified.
2. **Packet quality:** small, tests-first, premises cited, consistent with rulings, dependencies valid.

Their findings, and what was changed, are recorded below.

(see section 7a, written after the reviews)
