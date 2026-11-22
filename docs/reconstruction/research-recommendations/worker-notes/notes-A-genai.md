# Worker A (GenAI / Book x GenAI / RD-03 / kernels): research recommendations vs origin/main 2c4e4bf2

Abbreviations for sources (all under docs/intelligence/research/):
GC = GENAI-RD-GLOBAL-CONVERGENCE.md; CV = GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md;
MC = GENAI-RD-MASTER-CONTINUATION.md; OT = GENAI-RD-OTEL-LANGFUSE-PACKET-DERIVATION.md;
BR = BOOK-GENAI-IMPLEMENTATION-READINESS.md; BS = BOOK-GENAI-CURRENT-STATE.md; BG = syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md;
CD = CORPUS-IMPLEMENTATION-DISPOSITION.md; HL = HARDENING-LEDGER.md; EM = EXTERNAL-MINING-ADDYOSMANI-AGENT-SKILLS-2026-10-07.md;
BP = RD-03-LAYER-3-BACKWARD-PRESSURE-TEST.md; PD = RD-03-LAYER-3-IMPLEMENTATION-PROOF-DESIGN.md; OA = RD-03-LAYER-3-ORCHESTRATION-CONVERGENCE-AUDIT.md;
R3 = RD-03-CURRENT-STATE.yaml; SFS = kernels/STRUCTURE-FUNCTION-STORAGE-OPTIMIZATION-KERNEL-RND.md; KNG = kernels/KNOWING-GRAVITY-NEGATIVE-SPACE-KERNEL-RND.md.
Issue #153 is the durable ledger for these (comment ids listed in MC:632-666; e.g. global convergence 6010080039, validation 6010209031, OTel derivation 6010232840, Layer-10 convergence 6010007429). Plan = scratchpad plan-3e.json.

Headline: apart from the autonomy fail-closed fix (done) and the memory items (MEM-*), almost none of the GenAI architecture recommendations are in the 234-packet plan. Keyword scan of plan id/title/scope/DoD: "safety" 0, "MCP" 0, "telemetry" 0, "SafetyShell" 0, "compensat" 0, "canary" 0, "KeyConnector"/"ConnectorRegistry" 0, "langfuse"/"otel" 0, "responseFormat"/"structured output" 0.

---

### AUTONOMY-FAIL-CLOSED  (KF-EXEC-AUTH-FAIL-CLOSED-001, Candidate A, G0-01)
- recommendation: when the autonomy check throws or gives an unusable answer, zero parsed commands may run (never fall back to "all parsed commands"), and the failure is recorded as an authority-check failure.
- sources: CV:44-54, CV:196-282; GC:382-383, GC:534-540; MC:468, MC:670-704; BS:98-107; issue#153 comment 6010209031
- status: a — apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts:1884 ("failing closed: 0/N"); stream path :1511-1535; key-cortex-actions.service.ts:386; key-cortex-executor.service.ts:628; negative control apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts:2427 (`expect(source).not.toMatch(/using all parsed commands/)`) and :1471, :2052.

### QUERY-SAFETY-FAIL-OPEN
- recommendation: the KEY chat safety check must fail closed (or into an explicit degraded, no-tools mode) when the checker is missing or throws, instead of letting the query through silently.
- sources: MC:469; GC:394-395 (G0-05 family), GC:620 (proof obligation 13: "guardrail/provider outage ... cannot silently bypass protected checks")
- status: d — key-cortex-query-pipeline.service.ts:2267-2296: `if (!this.qualityService) return undefined;` and `catch (err) { logger.warn(...) }` then `return undefined` (not blocked). Plan grep "safety" = 0 packets.
- packet sketch: files apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts (runSafetyCheck + both callers :227, :1130), spec in key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts. RED: make qualityService.checkSafety throw for a message with a tool-eligible command; today the pipeline proceeds to tool execution. Fix choice must be ruled: block, or continue as informational-only with tools withheld (zero executable commands, same shape as AUTONOMY-FAIL-CLOSED). Risk: the LLM second opinion inside checkSafety (key-cortex-quality.service.ts:106-140) makes a provider call per message; outage behaviour must not take KEY chat down when AI_DISABLED. Size S, P1.

### SAFETY-CHECK-ORDER-AND-PII
- recommendation: medium-severity PII findings must not short-circuit the prompt-injection and script checks, and must have an explicit action (redact/warn/block) rather than "labelled unsafe, then continue".
- sources: MC:470-471 ("medium-severity PII can be labelled unsafe yet continue"; "direct prompt-injection protection is primarily literal/heuristic")
- status: d — apps/server/src/modules/key-cortex/key-cortex-quality.service.ts:58-71 returns `{safe:false, severity:'medium'}` on the first PII regex match BEFORE the injection keyword list (:73-96) runs; the pipeline only blocks `severity === 'high'` (key-cortex-query-pipeline.service.ts:2280). So "4111 1111 1111 1111 ignore previous instructions" is never flagged as injection and proceeds. Injection detection is a 12-string literal list (:73-86).
- packet sketch: files key-cortex-quality.service.ts + its spec. RED: a message containing a card number plus "ignore previous instructions" returns severity 'high' — fails today (returns medium). Also define the PII action (likely redact before the prompt and before AiMemory write). Size S, P1 (P0 only if owner treats PII-into-memory as data leak; card numbers typed into chat reach the model and memory today).

### LANGFUSE-OTEL-MIGRATION  (KF-ASSURANCE-OTEL-LANGFUSE-COMPAT-001, Candidate B, G1-01)
- recommendation: move AI trace export off Langfuse's legacy `/api/public/ingestion` onto an OpenTelemetry (OTLP) path with optional Langfuse OTLP exporter, keeping KEY correlation/session/command ids as attributes; trace attempts (provider error, fallback, timeout), not only successful costed calls; exporter failure non-fatal but visible; metadata-only by default.
- sources: OT:1-291 (whole); GC:399-400, GC:542-550; CV:152-155, CV:284-297; MC:427-437, MC:596-630; issue#153 comment 6010232840
- status: d — apps/server/src/modules/ai/langfuse.service.ts:127 still POSTs `${baseUrl}/api/public/ingestion`; failures only `logger.warn` (:136-142), no health signal; called only from the gateway's cost recorders, i.e. successful calls (langfuse.service.ts:10-12 comment). No `@opentelemetry`/OpenInference anywhere in apps/ or packages (git grep empty). Plan grep langfuse/otel = 0. NOTE: the research deadline (Langfuse Cloud legacy ingestion removal 2026-11-16, GC:399) has PASSED as of 2026-11-22, so if LANGFUSE_* keys are set in production the traces are probably being rejected now (warn-only). Privacy default is already met: payload is metadata only (langfuse.service.ts:96-120) — that part is a.
- packet sketch: files apps/server/src/modules/ai/langfuse.service.ts, langfuse.service.spec.ts, model-gateway.service.ts (attempt/fallback hooks), ai.module.ts; package.json only if OTel SDK admitted (dependency ruling needed; alternative: OTLP/HTTP JSON by hand like today's shim). RED: spec asserting the exporter URL is the OTLP endpoint (`/api/public/otel/v1/traces`) fails today (langfuse.service.spec.ts:69 pins the legacy URL); spec asserting a provider error produces an exported attempt span fails. First step for the owner: check whether LANGFUSE_* is set in production at all — if not, this is P3. Size M, P2 (P1 if keys are set).

### STRUCTURED-OUTPUT-HONESTY  (Candidate C, G1-03, Layer-7 finding)
- recommendation: make `GatewayRequest.responseFormat` real — lower it to each provider's native JSON/schema mode where supported, keep independent post-hoc validation, record repair/fallback provenance — or delete the field so it stops claiming support.
- sources: GC:404-406, GC:552-558, GC:322; CV:71-80; MC:364-366 ("declared response-format surface is not currently backed"); issue#153 comment 6008603830
- status: d — apps/server/src/modules/ai/model-gateway.service.ts:69-70 declares `responseFormat?: { type: string }`; no other reference in model-gateway.service.ts and no `response_format`/`json_schema` in any provider dispatch (only voice TTS at key-cortex-voice.service.ts:292). Callers still send it: key-cortex-flow-studio.service.ts:122 (`json_object`, silently ignored), key-cortex-query-pipeline.service.ts:658, key-cortex-tool-loop.service.ts:211. Post-hoc validation exists: apps/server/src/modules/ai/ai-output-contracts.ts.
- packet sketch: model-gateway.service.ts provider branches (OpenAI-compatible clients :1231, :1499.., Anthropic fetch :1364/:2316), provider-choice.spec.ts / model-gateway.service.spec.ts. RED: a spec that captures the OpenAI request body for a call with `responseFormat: {type:'json_object'}` and expects `response_format` — fails today. Size M, P2. Merge with EXECUTABLE-COGNITIVE-CONTRACTS if both are scheduled.

### EXECUTABLE-COGNITIVE-CONTRACTS  (KF-EXEC-COGNITION-001 / COG-001, COG-L3-02)
- recommendation: replace the hand-written TypeScript interfaces plus separate hand-written validators in ai-output-contracts.ts with one Zod schema per contract, deriving the TS type, the runtime validator and the provider JSON-schema from it.
- sources: PD:56-100, PD:253-258 (COG-P01..P03); BP:481-484; OA:230-235; R3:52-54, R3:66-70
- status: d — apps/server/src/modules/ai/ai-output-contracts.ts:1-187 is `export interface ...Contract` (12+ interfaces) with no Zod import; only 2 files in apps/server/src import zod. Not in plan.
- packet sketch: ai-output-contracts.ts + its consumers (model-gateway.service.ts, business-genesis.service.ts, market-strategy-ai-generator.service.ts). RED: characterization fixture "malformed nested enum payload rejected" plus "schema field added to contract appears in provider projection" (fails: no projection exists). Size M, P3 (quality, no user-visible defect proven).

### CAPABILITY-VIEW-NO-DUPLICATE-TOOL-LIST  (COG-002, COG-L3-01)
- recommendation: delete the static `IntentParserService.AVAILABLE_TOOLS` list and derive the intent parser's tool vocabulary from FLOW_TOOLS / CapabilityContractService, so allowlist/hide rulings apply to it too.
- sources: BP:476-479; PD:102-129 (COG-P04, COG-P05); OA:92-106, OA:240; R3:50-51
- status: d — apps/server/src/modules/ai/intent-parser.service.ts:70-130 hand-lists ~100 tools (incl. hidden-module families social_*, projects_*, community_*, marketplace_*) and injects them into the prompt at :155; used by ai.controller.ts:221. Plan packets KEY-TOOL-ALLOWLIST and KEY-TOOL-DOMAIN-HIDE build the allowlist "where the member-chat tool list is built and at dispatch" — neither scope nor DoD mentions intent-parser/AVAILABLE_TOOLS (checked plan-3e.json), so this list escapes both rulings at prompt level (dispatch still refuses).
- packet sketch: intent-parser.service.ts (+ spec), read from the same family classification KEY-TOOL-ALLOWLIST creates (packages/shared/src/v1-modules.ts per plan). RED: add a tool to FLOW_TOOLS / hide a family; the intent-parser prompt must change — fails today. Best done as an amendment to KEY-TOOL-DOMAIN-HIDE. Size S, P2.

### DISPATCHER-EFFECT-AWARE-RETRY  (COG-004, COG-L3-04)
- recommendation: ActionDispatcher must not blindly retry a write tool after a generic exception (timeout/5xx) because the effect may already have happened; retry only read/idempotent tools or when the effect is known absent; OUTCOME_UNKNOWN blocks a new attempt.
- sources: BP:491-494; PD:168-198 (COG-P08); OA:249; R3:58-59, R3:75 (no_generic_retry_after_possible_external_effect); GC:388-389 (G0-03)
- status: c — what exists: boundary refusals and tool 4xx are final (apps/server/src/modules/ai/action-dispatcher.service.ts:203-215, W9-DISPATCH-CIRCUIT), and plan packet W11-DISPATCH-REFUSAL-FINAL extends that to 400/non-retryable 409. Gap: any other thrown error is retried up to MAX_RETRIES=2 (:82, :139-147) by calling `flowOrchestrator.executeToolDirectly` again with the same args and no idempotency key passed through (ctx.idempotencyKey is only logged, :172). Communications adapters already classify OUTCOME_UNKNOWN (apps/server/src/modules/communications/adapters/channel-adapter.interface.ts:10) but the dispatcher does not read it.
- packet sketch: action-dispatcher.service.ts + spec; needs per-tool effect class (see CAPABILITY-EFFECT-METADATA) or a conservative rule "family read/draft only". RED: a write tool whose fake throws a timeout AFTER recording a side effect gets called 3 times — today it does. Tenancy n/a; data integrity (double send / double invoice). Size S-M, P1.

### CAPABILITY-EFFECT-METADATA  (Candidate E, Layer-8)
- recommendation: give every FLOW_TOOLS entry declared effect class (none/internal/external), idempotency semantics, reversibility/compensation and a version, so retry, parallelism and undo decisions read declared metadata instead of guessing.
- sources: GC:571-576; MC:402; CV:167-170; BP:41-53 (K5)
- status: c — apps/server/src/modules/ai/flow-tool-registry.ts:23-42 FlowTool has family, riskLevel, riskTier, changedEntities, manualEquivalentRoute; no effect/idempotency/reversibility/version field. KEY-TOOL-ALLOWLIST (plan) adds a module-family classification only.
- packet sketch: flow-tool-registry.ts (+ a census spec that every tool declares effectClass), consumers action-dispatcher.service.ts, key-cortex-tool-registry.service.ts. RED: census spec "every FLOW_TOOLS entry has effectClass" fails today. Size M, P2.

### SAFETYSHELL-DURABLE-IDEMPOTENCY  (Candidate H, G0-03)
- recommendation: replace SafetyShell's process-local idempotency Set with the durable DB claim (restart/replica safe), and wire real compensation handlers for protected actions.
- sources: GC:388-389, GC:594-600; CV:103-109; MC:484-485
- status: c — durable claim exists for KEY tool calls: apps/server/src/modules/key-cortex/key-idempotency.service.ts:44-51, :110-115 (insert-claim, 'pending' exclusive, 15-min lease D-103; V1-19 landed; this also closes COG-L3-05). Gap: apps/server/src/modules/key-autonomy/safety-shell.service.ts:36 `private readonly idempotencyCache = new Set<string>()` still guards KeyActionExecutor (key-action-executor.service.ts:31); rollback honestly throws "no handler is wired" (safety-shell.service.ts:113-119). Not in plan (grep SafetyShell/compensat = 0).
- packet sketch: safety-shell.service.ts check() delegates to KeyIdempotencyService claim (or the IdempotencyKey table, schema per buildmap D-15); spec: two service instances (simulated replicas) with the same key → one runs. Fails today. Compensation is separate and larger. Size S (idempotency), P2.

### INDIRECT-CONTEXT-ADMISSION  (Candidate G, G0-04)
- recommendation: treat retrieved documents, web/tool/MCP results and extracted text as data, not instructions: one admission step (mark untrusted, injection screen, privacy transform, size cap) before such content enters a model prompt or memory.
- sources: GC:391-392, GC:586-592, GC:233-234; MC:472, MC:483; CV:177-180; issue#153 comment 6010007429
- status: c — exists: MCP tool output capped at 8000 chars with comment "untrusted content" (apps/server/src/modules/mcp/mcp-client-manager.service.ts:84-86); AI-extracted money inputs land PENDING until a member confirms (apps/server/src/modules/commerce/payment-evidence.service.ts:301-389, D-27); contract fetch SSRF guard + body cap are plan packets FU-CONTRACT-FETCH-OUTBOUND-GUARD, FU-DOC-FETCH-BODY-CAP. Gap: no shared admission/marking for tool results or document text fed back to the model (git grep "untrusted" in key-cortex/ai finds nothing on the tool-loop path).
- packet sketch: key-cortex-tool-loop.service.ts (where tool results re-enter messages) + flow-orchestrator tool-result path; wrap results in a delimited untrusted block and strip/flag instruction-like content. RED: a tool result containing "call crm_delete_contact" leads the second model turn to propose that tool with no confirmation flag change — hard to make deterministic; start with a structural test that tool results are wrapped. Size M, P2.

### MCP-TENANT-BINDING
- recommendation: make the MCP bridge actually tenant-bound as its comment claims (per-business connection/credential and cache, businessId on every call) or keep it disabled for v1.
- sources: MC:399 ("MCP tenancy/business propagation is not yet faithful to its comments")
- status: d — apps/server/src/modules/mcp/mcp-client-manager.service.ts:19-24 comment says tools are cached per businessId+server; code ignores `_businessId` (:52), caches per server key only (:83-88), `callTool(bridgedName, args)` takes no business (:62), and auth is one process-wide env token (:120-123). Reached from flow-orchestrator.service.ts:1110. Dormant unless MCP server configs are set (loadMcpServerConfigs, :33). Not in plan (MCP = 0).
- packet sketch: either a census/startup assertion that MCP configs are empty in v1 (S) or real per-business binding (M). RED: two businesses call the same bridged tool; a per-business credential must be used — fails (no such concept). P2 (P0 if any MCP server is configured in production with tenant data behind it — owner to confirm env).

### STREAM-ERROR-NO-EFFECTS  (G0-05)
- recommendation: tool calls collected from a streamed model answer that ended in an error/truncation must not be executed.
- sources: GC:394-395; GC:610-611 (proof obligations 5-6)
- status: c — tool calls run only after the stream loop finishes and go through memberToolLoop/confirmation (key-cortex-query-pipeline.service.ts:1416-1447), and text-parsed commands pass fail-closed autonomy (:1511-1535). Gap: a chunk.error is yielded and the loop continues (:1408-1413); collected tool calls are then executed with no check that the stream completed cleanly.
- packet sketch: key-cortex-query-pipeline.service.ts streamQuery; RED: fake stream emits a tool_call delta then `{error}`; expect toolLoopService.handleToolCalls not called — called today. Size S, P2.

### EVAL-HARNESS-HONEST-SUITES  (Candidate F, G1-04)
- recommendation: fix vacuous eval suites (memory-retrieval-precision checks only "is an array with numbers"; explanation-quality accepts an empty rule trace via `length >= 0`), add protected cases with expected answers, evaluator negative controls, and run them in CI.
- sources: GC:322-323, GC:408-409, GC:578-584; CV:82-93; MC:432-436; BG:241-256 (LAW B10); KNG:606 (KNG-I09 green over empty input)
- status: c — apps/server/src/modules/key-cortex/eval-harness.service.ts:172-190 (precision = `Array.isArray && every rankScore is number`), :194-213 (`ruleTrace.length >= 0`, always true). Only exposed via key-cortex-audit.controller.ts:40; not in CI. Plan MEM-EVAL-SUITE (memory leak + KEY memory task suites with baselines) covers the memory part only; nothing fixes explanation-quality.
- packet sketch: eval-harness.service.ts + __tests__/eval-harness.service.spec.ts. RED: mutation control — make AutonomyOrchestrator return `ruleTrace: []`; explanation-quality must fail — passes today. Size S, P3 (no user-facing harm; honesty of a dev tool). Coordinate with MEM-EVAL-SUITE.

### PROOF-CLASS-DECLARATION  (KF-ASSURANCE-PROOF-CLASS-001, BG-5)
- recommendation: each packet proof obligation declares its class (exact/deterministic, integration-state, external-effect, semantic-eval) and a weaker class can never override a stronger failing one; missing required class blocks green.
- sources: BR:377-418; BS:72-76; CD:40, CD:87-91; contracts/PROOF-PROFILES.yaml (vocabulary); HL:31
- status: c — plan DoD already mandates "Tests first with a recorded RED ... real-DB integration proof on Postgres for every server change" (plan-3e.json definition_of_done, e.g. W11-DISPATCH-REFUSAL-FINAL) and mutation controls exist (scripts/agent-control/proof-mutation.mjs, scripts/agent-control/negative-controls.yaml). Gap: no proof_class field anywhere (git grep INTEGRATION_STATE|EXACT_FORMAL|proof_class in scripts/.github = none).
- packet sketch: process/docs: add proof class to the packet RETURN template (.agent-control/claude-return.yaml shape) and ACCEPTANCE-REVIEW-BRIEF.md. Size S, P3.

### CONTEXT-BUNDLE-LIVE  (KF-META-CONTEXT-COMPILER-LIVE-001, BG-1, EM "A. Context-pack compiler")
- recommendation: give each development agent a deterministic, source-bound context bundle per packet (authority class, freshness, exclusions, DEGRADED when authority missing) instead of re-reading the plan.
- sources: BR:25-100; BS:55-58, BS:109-116; HL:32-34, HL:64-83; EM:205-216; BG:71-91 (LAW B1); contracts/CONTEXT-BUNDLE-SCHEMA.yaml
- status: a/c — done in spirit: scripts/agent-memory/bundle.mjs (CLAUDE.md now tells agents to use it) with authority_class/freshness/health VALID|DEGRADED (scripts/agent-memory/lib.mjs:376-436) following CONTEXT-BUNDLE-SCHEMA.yaml (lib.mjs:376, :528). Gaps vs BR:49-63: no conflict detection ("authority.conflicts ... always empty", lib.mjs:482) and no failure taxonomy (KNOWLEDGE_ABSENT/RETRIEVAL_FAILURE/...). The research prototype scripts/agent-control/research/compile-context.mjs is not used by it.
- packet sketch (gap only): lib.mjs ruling-conflict detection (two rulings naming the same packet/decision with different outcomes). Size S, P3.

### COGNITIVE-ROUTING-RISK-FLOOR  (KF-COG-ROUTING-HONESTY-001, BG-2, LAW B6)
- recommendation: cheap ("reflex") routing must never handle destructive, money, confirmation/cancellation or authority-pending messages just because the text is short; risk metadata can raise the tier but never grant authority.
- sources: BR:104-177; BS:59-62; BG:164-180; CD:31
- status: c — reflex is now a strict whitelist of bare greetings, explicitly excluding confirmations and "ok delete ..." (apps/server/src/modules/key-cortex/cognitive-triage.service.ts:172-195, :237-263). Gap: standard vs deliberate is still a text-complexity score (:140-153, :272); no action-risk/pending-effect/contradiction input. Low residual risk (tools are available on standard).
- packet sketch: cognitive-triage.service.ts + spec; RED: "refund all of them" (simple text, money effect) routes 'standard'; expect 'deliberate'. Size S, P3.

### ACTION-UNDERSTANDING-PROJECTION  (KF-KEY-ACTION-UNDERSTANDING-001, BG-4, LAW B7)
- recommendation: one server-built projection per KEY action separating observed / proposed / approval required / approved-denied / executed / verified-unknown-failed, with reversibility, so the UI can never show a proposal as done or an authorised action as verified.
- sources: BR:253-321; BS:64-68; BG:182-198; CD:30, CD:82-85; traces/ACTION-UNDERSTANDING-TRACE-001.md:53-86 (web drift)
- parallel/lens: Don Norman (signifiers, feedback)
- status: d — server writes outcomeEvidence (apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts:719-740, failure :853), but the web contract apps/web/src/lib/api/key-autonomy.ts:39 `interface KeyActionProposal` has no outcomeEvidence (grep empty), so the web cannot show verified vs merely executed. No ActionUnderstanding projection anywhere (git grep empty). Not in plan.
- packet sketch: server projection in key-autonomy (read-only, from existing rows, tenant-scoped like the source action — note FU-PROPOSAL-REVENUE-SIGHT/W11-PROPOSAL-RESULT-READER-SCOPE already project result per reader; build on that), web apps/web/src/lib/api/key-autonomy.ts + app/app/key-autonomy/components/proposal-card.tsx. RED: web unit test "an EXECUTED proposal whose outcomeEvidence.status is FAILED renders as failed" fails today. Size M, P2 (v1 KEY may be hidden/disabled; check KEY-* rulings).

### BEHAVIORAL-HOTSPOT-SCANNER  (KF-META-BEHAVIORAL-ARCH-001, BG-3, LAW B9)
- recommendation: an offline deterministic script over git history producing hotspots, co-change coupling, churn and ownership concentration as a DERIVED_PROJECTION JSON for review prioritisation.
- parallel/lens: Tornhill, Software Design X-Rays
- sources: BR:181-249; BS:69-71, BS:109-112; BG:225-239; CD:36; HL:30; SFS:356-373 (metrics), SFS:316-354 step 11
- status: d — no such script (git grep -i "co-change|temporal coupling" in scripts finds only unrelated list-open-impl-prs/ledger-sizes); docs/intelligence/generated/behavioral-architecture.json absent; only a manual sample in docs/intelligence/research/traces/DEVELOPMENT-SPEED-TRACE-002-BEHAVIORAL-HOTSPOTS.md. Plan FU-ARCH-MAP-REFRESH regenerates static maps only.
- packet sketch: scripts/architecture/behavioral-hotspots.mjs + node --test spec on a fixture repo (HOT-P01..P08). RED: fixture history with one high-churn file — expected top hotspot. Size S, P3 (dev tooling; does not serve v1 gate).

### COORDINATION-COST-METRICS  (LAW B8, EM "B. Evidence-aware task state")
- recommendation: measure the development organism's coordination cost (handoffs, context reconstruction size, review cycles, rework after stale authority) and derive task state from evidence, not worker self-report.
- sources: BG:200-223; CD:33; EM:218-222; KNG:495-507
- status: c — docs/development/agent-memory/MEASUREMENT.md measures brief/first-read sizes and one real run; scripts/agent-memory/status.mjs:22-23 derives done-status from commit evidence on main. Gap: review-cycle/rework counts not recorded.
- packet sketch: none needed beyond MEASUREMENT.md section 4 ("what to record on the next packets"). P3.

### FRESH-CONTEXT-ADVERSARIAL-REVIEW  (EM "C")
- recommendation: reviews get only the diff, contract and invariants (no author reasoning) and try to falsify.
- sources: EM:224-231; BG:93-108 (LAW B2: shared artifacts outrank agent identity)
- status: a — docs/development/agent-memory/ACCEPTANCE-REVIEW-BRIEF.md (two fresh reviewers per lens, "never the worker's ... conclusions"); standing directive two independent reviews per packet (CLAUDE.md, D-222/D-241).

### ANTI-FAKE-GREEN-GATES  (EM "D", LAW B10, HL:37-47)
- recommendation: machine-enforce skipped != passed, configured-but-not-run != passed, stale proof != current; mutation-sensitive negative controls for critical invariants.
- sources: EM:233-240; HL:37-47; BG:241-256
- status: a/c — mutation controls exist (scripts/agent-control/proof-mutation.mjs, scripts/agent-control/negative-controls.yaml); lint split out so a ratchet failure cannot skip the security suites (.github/workflows/ci-cd.yml:130-150); plan TOF-WORKER-CURSOR-PROOF turns a silently-skipping proof into a CI run. Residual: no generic "required job skipped => red" aggregator found (only comments at ci-cd.yml:135-137, :190-204). Low priority.

### MODEL-CALLS-THROUGH-GATEWAY
- recommendation: route every model/provider call (embeddings, document Q&A, voice) through ModelGateway so budgets, BYOK, kill switches, cost and tracing apply uniformly.
- sources: GC:310; GC:619 (obligation 17); MC:242-256 (LLMOps)
- status: c — direct `new OpenAI(...)` outside the gateway: apps/server/src/modules/ai/ai-usage.service.ts:912, :976, :1057 (embeddings/images, but with credits+rate limit :905-909), apps/server/src/modules/key-cortex/key-cortex-document.service.ts:13, :154, :167 (document embeddings/Q&A; honours keyDisabled()), key-cortex-voice.service.ts:292, phone-voice/realtime-bridge.service.ts. They respect AI kill switches per comments, so the gap is uniform cost/trace accounting rather than safety.
- packet sketch: census spec listing allowed direct-SDK files with a shrinking allow-list (pattern used elsewhere in the plan, e.g. W11-PAGING-TOTAL-ORDER). Size S, P3.

### CONNECTOR-REGISTRY-CONVERGENCE  (G1-05, Candidate E)
- recommendation: converge the core ConnectorRegistry and the newer KeyConnector stack into one connector/connected-account/credential substrate.
- sources: GC:315, GC:411-412; MC:400-401; CV:319-326
- status: d — both exist: apps/server/src/core/connectors/connector-registry.service.ts and apps/server/src/modules/key-connector/key-connector.service.ts (+ ai-gateway/ai-gateway.service.ts, health/health-check.service.ts). Plan grep KeyConnector/ConnectorRegistry = 0 (provider-outage packets W11-PROVIDER-OUTAGE-* touch clients only).
- packet sketch: first a read-only census of which v1 journeys read each (Gmail/Drive/WhatsApp tokens; see FU-DELIVERY-TOKEN-DECRYPT) before any merge. Size M+, P3 for v1 (post-gate).

### RETRY-BUDGET-INHERITANCE  (COG-003/004, COG-L3-03, OA "Delegation law")
- recommendation: nested retries (gateway provider fallback, ActionDispatcher, BullMQ, plan queue) and delegated child runs share one ancestor budget for cost/tokens/retries/effects; a child can never get more budget or authority than its parent has left.
- sources: BP:486-489; PD:131-198 (COG-P06, COG-P09); OA:190-201; R3:56-57, R3:76
- status: d — independent retry configs: action-dispatcher.service.ts:82-83 (MAX_RETRIES 2), model-gateway fallback chain, BullMQ attempts; no shared budget object (git grep for "retryBudget|ancestor" finds none). Not in plan.
- packet sketch: research-sized; start with a characterization test counting worst-case provider calls for one plan step. Size M, P3.

### OCCURRENCE-ATTEMPT-EFFECT-LINEAGE  (COG-003, COG-L3-06, COG-L3-08)
- recommendation: keep correlation/session/command ids and link (not merge) model attempt, provider request, queue attempt, execution claim and effect id so one action's trace can be rebuilt from logs/events.
- sources: BP:501-514; PD:131-166 (COG-P07); OT:107-121; GC:614 (obligation 10)
- status: c — correlation ids exist (key-cortex-query-pipeline.service.ts:1884 logs correlationId; executor :628 traceId); LlmTraceInput carries businessId/sessionId but no correlationId/commandId (langfuse.service.ts:146-161). Overlaps LANGFUSE-OTEL-MIGRATION; do together.

### DURABLE-INTERRUPT-REVALIDATE-ON-RESUME  (COG-005, COG-L3-07)
- recommendation: when an approved/suspended action resumes, re-check current capability version, authority, parameters fingerprint and claim state; an old approval does not make stale work executable.
- sources: PD:200-222 (COG-P11, COG-P12); BP:506-509
- status: c — plan_queue awaiting_approval exists (action-dispatcher.service.ts:227-229 AWAITING disposition) and action envelope/fingerprint exist (apps/server/src/modules/key-autonomy/action-boundary/action-envelope.ts:116); V1-31-KEY-FLOW-CONFIRM-BIND in the build map binds confirmations. Generic resume revalidation not proven. Not separately in plan. P3.

### DETERMINISTIC-COGNITIVE-TEST-DOUBLE  (K12-COG-006)
- recommendation: a scripted fake model (valid/invalid/corrected output, tool proposal, retryable/non-retryable failure, fallback) so the full KEY loop is tested with no network, with assertions on the path (tool, authority, effect), not just final prose.
- sources: PD:224-251 (COG-P13, COG-P14); OA:174-188; R3:74
- status: b/c — plan FU-UNIT-MOCK-ISOLATION ("Unit runs can never reach a real provider SDK") and FU-UNIT-GUARD-CI ("CI unit runs refuse non-loopback network calls") cover the no-network half. Path-assertion harness not planned.

### GOVERNED-LEARNING-NARROWS-ONLY  (LAW B12, GC section I)
- recommendation: learned signals (outcome scores, routing, procedures) may propose or narrow, never self-authorise wider autonomy or promotion.
- sources: BG:278-289; GC:242-260, GC:498-499
- status: a for the live learner — apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts:301-330: ToolOutcomeScore can only downgrade to supervised (<50%) or block (<30%), never widen. Caveat (KNG:111 "EXECUTION SUCCESS != BUSINESS OUTCOME"): the score counts execution success (key-cortex-tool-registry.service.ts:802-826), not verified outcome. No new packet.

### TELEMETRY-EXPORTER-HEALTH
- recommendation: exporter failures are counted and surfaced (health/readyz or admin), not only warn-logged.
- sources: MC:437; OT:137-144
- status: d — langfuse.service.ts:136-142 warn only. Fold into LANGFUSE-OTEL-MIGRATION.

### CONTEXT-FAILURE-TAXONOMY  (LAW B1)
- recommendation: KEY distinguishes "not known", "retrieval failed", "context overloaded", "representation failure", "reasoning failure" and answers accordingly, instead of adding more context.
- parallel/lens: Hermans, The Programmer's Brain
- sources: BG:71-91; BR:57-63; CD:26; EP kernels/EPISTEMIC-KERNEL-RND.md:42-43; KNG:603-609 (KNG-I07 UNOBSERVED != NONEXISTENT)
- status: b (partial) — covered by MEM-HONEST-RETRIEVAL ("Memory retrieval reports channel failures distinctly from 'nothing found', and KEY says 'not recorded'"). Rest is covered by MEM-*.

### CONTEXT-GENOME-M1  (Candidate D, G1-02)
- recommendation: authority vs confidence separation, valid vs recorded time, provenance, supersession, retrieval status for memory.
- sources: GC:560-569, GC:402-403; CV:56-69, CV:299-308; BR:325-337; BG:145-162 (LAW B5); EPISTEMIC-KERNEL-RND.md:22-36; SFS:253-262
- status: covered by MEM-* (MEM-CLASS-COLUMNS / MEM-CLASS-READ for provenance-based class; MEM-EXPIRED-NOT-SERVED for validity; MEM-HONEST-RETRIEVAL for status). Not re-derived here (D-257).

### STORAGE-ACCESS-PATH-AUDIT  (SFS 5.6)
- recommendation: for each high-volume entity compare real query paths against tenant/time/status indexes and fix mismatches.
- sources: SFS:285-298, SFS:340-341 (step 8)
- status: d (weak) — no audit script; the plan's paging census packets (W11-PAGING-TOTAL-ORDER-A/B/C) address ordering, not index coverage. Concrete only as a method; would need a pg_stat_statements read on production (owner-run, like USAGE-COUNT-SCRIPT). P3.

---

## Metaphor-only / not a recommendation (no packet)
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

## Read log
Read fully: GENAI-RD-GLOBAL-CONVERGENCE.md; GENAI-RD-CONVERGENCE-VALIDATION-AND-PACKET-DERIVATION.md; BOOK-GENAI-IMPLEMENTATION-READINESS.md (25-418); BOOK-GENAI-CURRENT-STATE.md; syntheses/BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md (69-389); CORPUS-IMPLEMENTATION-DISPOSITION.md; RD-03-CURRENT-STATE.yaml; RD-03-LAYER-3-IMPLEMENTATION-PROOF-DESIGN.md (22-289); kernels/EPISTEMIC-KERNEL-RND.md; RND-FRESHNESS-PR-COVERAGE-REVALIDATION-CONTRACT.md (33-138); HARDENING-LEDGER.md (20-83).
Read in part (headings + recommendation/gap sections): GENAI-RD-MASTER-CONTINUATION.md (151-500, 632-704); GENAI-RD-OTEL-LANGFUSE-PACKET-DERIVATION.md (56-165); RD-03-LAYER-3-BACKWARD-PRESSURE-TEST.md (474-578); RD-03-LAYER-3-ORCHESTRATION-CONVERGENCE-AUDIT.md (186-265); EXTERNAL-MINING-ADDYOSMANI (180-289); kernels/KNOWING-GRAVITY (85-124, 495-622); kernels/STRUCTURE-FUNCTION-STORAGE (220-448); RESEARCH-CORPUS.yaml (1-60 + grep); contracts/PROOF-PROFILES.yaml (1-60).
Headings only / not read: MASTER-CONTINUATION Layers 1-3 (17-150) and method (273-299); BACKWARD-PRESSURE-TEST candidate sections 112-473; ORCHESTRATION-AUDIT 1-185; KNG 1-84, 124-494 (gravity/negative space bodies skimmed by heading), 622-816 (PR cross-reference, stale); contracts/CONTEXT-BUNDLE-SCHEMA.yaml and CONTEXT-BUNDLE-TENANT-EXAMPLE.yaml (checked only that bundle.mjs implements the schema). Issue #153 comments not read (cited by id from MC).
Code read: langfuse.service.ts; mcp-client-manager.service.ts; key-cortex-quality.service.ts:45-140; key-cortex-query-pipeline.service.ts (2260-2300, 1340-1535 parts); action-dispatcher.service.ts:75-230; eval-harness.service.ts:165-230; cognitive-triage.service.ts:140-275; intent-parser.service.ts:60-155; flow-tool-registry.ts:23-60; redaction.ts:1-46; autonomy-orchestrator.service.ts:295-335; safety-shell.service.ts (grep); key-idempotency.service.ts (grep); scripts/agent-memory/lib.mjs (grep).
