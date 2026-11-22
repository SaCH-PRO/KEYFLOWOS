# Research recommendations re-derived for v1 (D-261, D-262)

Owner rulings D-261 ("every architectural recommendation in the owner's research index joins v1 as a packet, unless it is already done on main or already a plan packet") and D-262 ("rebuild the list from the repo, not from the owner's workbook") are recorded in `docs/reconstruction/BUILD-MAP-001.md` on `pkt/V1-RULINGS-3E`. This directory is the research worker's output. It proposes packets. The orchestrator admits them: nothing here edits `V1-PLAN-RECUT.json` or `BUILD-MAP-001.md`.

- `RECOMMENDATIONS-INDEX.md`: every recommendation with its sources, how duplicates were merged, its verified status, and its packet ids. Appendix A lists the metaphor-only ideas.
- `RR-PACKETS.json`: 97 proposed packets in the plan's exact JSON shape. `fixture-prefix-rows.json`: the fixture-prefix table rows for those packets. `worker-notes/`: the extraction notes and merge table that the index cites.
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
2. **What counts as a recommendation.** A concrete change to code, data, security, AI behaviour or engineering process. A metaphor counts only where its source names such a change. Metaphor-only ideas, research-process notes and "keep what works" decisions go to Appendix A (66 entries).
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
6. **Validation** (re-run before each push). `RR-PACKETS.json` parses, has 97 ids, none duplicated and none colliding with a plan id. Every `depends_on` names a plan packet or an RR packet. Every packet has the exact 17 keys in plan order, `kind: "new"`, `fixture_prefix: null`, and a definition of done that starts with `RED:`.

## 2. Counts

There are 136 recommendations (index rows), plus 3 principles that name no concrete change (index section 8, no packet).

| Status | Rows | With an RR packet | Without |
|---|---|---|---|
| a, done on main | 19 (one row groups 16 security-register items) | 0 | 19 |
| b, already a plan packet | 7 | 0 | 7 |
| MEM, covered by MEM-* packets (D-257) | 3 | 0 | 3 |
| MEM-deferred, memory-track material no MEM packet covers | 3 | 0 | 3 |
| ruled, decided by ruling or doctrine | 5 | 0 | 5 |
| c, partly done | 51 | 44 | 7 |
| d, not done | 48 | 39 | 9 |
| **Total** | **136** | **83** | **53** |

- **New packets: 97.** By priority: P1 14, P2 36, P3 47, P0 none. By size: XS 10, S 72, M 15.
  - 96 packets belong to an index row.
  - RR-OWNER-RULINGS-RECORD is an admission helper that records the owner's answers.
- **No P0 is proposed.** Two packets become P0 on an owner answer: RR-MCP-TENANT-BOUND (OQ-1) and RR-BANK-TOKEN-ENCRYPT (OQ-4).
- **Metaphor-only entries:** 66, in Appendix A of the index.
- **Comparison with the owner's index.** It counted 60 recommendations; this pass has 136. The lists are not expected to match line for line (D-262). The difference comes from:
  - this pass includes the architecture security register (29 rows, one of which groups 16 items already done);
  - it keeps the neuro-atlas "top 10" items as separate rows;
  - it splits the architecture ratchets into five rows;
  - it lists done and ruled items as rows.
  - Restricted to rows that cite the research corpus proper (`docs/intelligence/research/**`, issue #153 or the research issues and PRs) with status c or d, the first pass counted 54 (from the index's Sources lines). The review added 2 more such rows.

**Not-done rows without a packet (19).** D-261 asks for a packet unless a recommendation is done or planned. Each of these is therefore an owner question or confirmation in section 6, and each states its reason in the index:

| Row | Reason |
|---|---|
| REC-EMOTION-ENDOCRINE | Per-business endocrine state would let one member's mood change KEY for everyone; reward-from-rating pushes KEY toward telling users what they want to hear (OQ-18). |
| REC-DOC-VOICE-ORGANS | No consumer; it would open a money-sight path before MEM-DOC-EXTRACTION-SIGHT (OQ-17). |
| REC-THROUGHPUT-METRIC | Nothing reads it (OQ-24). |
| REC-OUTCOME-WEIGHTED-TOOL-SELECTION | It would reward execution success, not outcome (OQ-38). |
| REC-EVAL-ONLINE-CALIBRATION | It needs the honest harness and lineage first (OQ-39). |
| REC-AUTH-FAIL-FAST | Unreachable fallback; invalid tokens already get 401. |
| REC-SOCIAL-OAUTH-STATE | Module hidden in v1; state is single-use and bound. |
| REC-CONSENT-UNIQUE | Append-only legal ledger (OQ-28). |
| REC-APPROVAL-EXECUTE-SCOPED-READ | No observable leak; one-line hygiene. |
| REC-EXPORT-DOWNLOAD-RATE-LIMIT | 256-bit token (OQ-40). |
| REC-STRUCTURED-CLAIMS | The plan D-141 left unadopted; no live artifact. |
| REC-RND-LINEAGE | No reader. |
| REC-GENERATED-INSTRUCTIONS | No drift found. |
| REC-PROPERTY-TESTS | Money is covered; no RED elsewhere (OQ-37). |
| REC-REPRESENTATION-IDENTITY | MEM-deferred (OQ-32). |
| REC-LEARNING-STREAM | MEM-deferred (OQ-41). |
| REC-ADAPTIVE-RECEPTOR | MEM-deferred (OQ-41). |
| REC-PROCEDURE-SPEC | New subsystem with no small slice (OQ-35). |
| REC-SKILLS-BENCH | Research-only by its own doc (OQ-35). |

## 3. Packets by priority

Each line is `id (size, step, lane): title`. The full scope, premises with file:line and definition of done are in `RR-PACKETS.json`.

**P1 (14)**
- RR-UNTRUSTED-CONTENT-FENCE (M, step 3, server): Document extractions and MCP tool output enter KEY's prompts inside a fenced untrusted-data block that cannot be closed from inside and carries no authority
- RR-STREAM-ERROR-NO-EFFECTS (S, step 3, server): A model stream that failed part-way never splices a fallback answer onto it and never runs the tool calls it collected
- RR-MODEL-LIFECYCLE-GUARD (S, step 3, server): A model lifecycle catalog the owner maintains: every routed model id must be in it, and a model marked retired is never dispatched to
- RR-TOOL-EFFECT-CLASS (S, step 3, server): Every FLOW_TOOLS entry declares an effect class: READ only when provably read-only, unknown tools never READ (census spec)
- RR-TOOL-WRITES-SEQUENTIAL (S, step 3, server): Flow chat runs the writes of one model turn one at a time in model order; only reads run in parallel
- RR-DISPATCH-NO-BLIND-RETRY (S, step 3, server): Plan queue never re-runs a write after a generic error: the step is recorded OUTCOME_UNKNOWN for a person to check
- RR-DISPATCH-ATOMIC-CLAIM (S, step 3, server): Plan queue takes an atomic durable claim on the idempotency key before running a step (no find-then-execute)
- RR-MCP-TENANT-BOUND (S, step 3, server): MCP bridge is tenant-bound or off: a bridged call carries the business and runs only for a business the server config names
- RR-WEBHOOK-INGRESS-CENSUS (S, step 3, server): Inbound webhook census (verification, replay, tenant source) and the per-business social webhook bound to the business's own page
- RR-BANK-TOKEN-ENCRYPT (S, step 3, server): BankConnection.accessToken is encrypted at rest like every other provider token column, and the secret-column census can no longer miss an *AccessToken column
- RR-DB-CRYPTO-KEY-CENSUS (S, step 3, server): Read-only census of which key every enc:v1: value was encrypted under, so the production key guard can be landed on evidence
- RR-DB-CRYPTO-PROD-GUARD (XS, step 3, server): packages/db token encryption refuses the in-repo fallback key in production (lands only on the owner's evidence)
- RR-ERASURE-BUSINESS-EVENTS (S, step 3, server): The GDPR forget purge also scrubs the person's data from business_events (D-25)
- RR-ADMIN-LOGOUT (S, step 3, web): Platform admin sign-out exists, and no sign-out leaves the admin bearer behind (it outranks every user token)

**P2 (36)**
- RR-OWNER-RULINGS-RECORD (XS, step 3, docs): Record the owner's answers to the research-recommendation owner questions that hold packets (OQ-5, OQ-13, OQ-19, OQ-30) and the two RR migration approvals
- RR-KEY-SAFETY-POLICY (M, step 3, server): KEY cortex input-safety check becomes an explicit, versioned policy: every rule class is evaluated, each finding class maps to an action, and a missing or throwing checker withholds tools instead of passing the query
- RR-REDACTION-BY-CONTENT (S, step 3, server): Redaction detects card numbers and secret-shaped tokens by value, not only by field name
- RR-GATEWAY-TYPED-FAILURES (S, step 3, server): Model gateway classifies provider failures: a rate limit, a caller abort or a bad request does not open the provider circuit
- RR-LLM-ADMISSION-CONTROL (M, step 3, server): Per-business admission control on model calls: a bounded number in flight per business, shared across replicas, with a typed capacity refusal
- RR-UNKNOWN-COST-NOT-ZERO (S, step 3, server): One model price table; an unpriced model's cost is marked unpriced, never written as $0
- RR-RESPONSE-FORMAT-HONEST (M, step 3, server): GatewayRequest.responseFormat is honoured: provider-native JSON mode where supported, prompted fallback otherwise, and the strategy used is recorded
- RR-CORTEX-TYPED-RESULT (S, step 3, server): KEY cortex stops inventing a 70% confidence when its markdown answer has no Confidence section, and records whether the answer was parsed
- RR-STRUCTURED-PARSE-INVALID-STATE (S, step 3, server): Gateway contract violations are typed and costed, never a silent provider failure or a silent pass on empty output
- RR-TOOL-ARGS-MALFORMED-NEVER-RUN (S, step 3, server): KEY tool calls with unparseable arguments never run a tool: that call gets a visible refusal and the rest of the turn proceeds
- RR-KEY-RUN-BUDGET (S, step 3, server): A typed per-turn run budget for KEY: a cap on tool calls executed per model response, and pinned worst-case model attempts per turn
- RR-TOOL-EFFECT-METADATA (M, step 3, server): FLOW_TOOLS declare idempotency, reversibility and contract version, and WRITE is refined into INTERNAL_WRITE, EXTERNAL_EFFECT, MONEY or DESTRUCTIVE (census spec)
- RR-CONNECTOR-CONFORMANCE (S, step 3, server): Connector conformance harness: a platform env key or a stored row is not 'connected'; failed smoke tests write no status; unimplemented sync is never success
- RR-INTENT-PARSER-ONE-TOOL-LIST (S, step 7, server): IntentParser offers the model the same per-business v1 tool set as chat, derived from FLOW_TOOLS, not a hand-written list
- RR-LEGACY-TOOLS-CLASSIFY (S, step 3, server): Classify the 14 legacy KeyToolRegistry tools against FLOW_TOOLS in a checked-in equivalence table; route the SAME/ALIAS ones canonically
- RR-LEGACY-FALLBACK-REMOVE (M, step 3, server): Remove KeyCommand's legacy-registry fallback and KeyToolRegistryService once every legacy tool is canonical or retired
- RR-HEALTH-TIGHTENS-CONTROL (M, step 3, server): Pure health-to-control step: degraded or unreadable health only tightens a KEY action's control requirement, adopted at the action boundary
- RR-ACTION-UNDERSTANDING-SERVER (S, step 4, server): Server ActionUnderstanding projection on every KEY proposal: phase, authority, outcome verified only from outcome evidence, reversibility
- RR-ACTION-UNDERSTANDING-WEB (S, step 5, web): Web renders KEY proposals from the server's ActionUnderstanding: real block reason, 'done' vs 'verified', confirm vs approve
- RR-ACTION-BOUNDARY-NEXT-CAPABILITY (M, step 4, server): Adopt a second capability (commerce_send_invoice) into the action boundary so it leaves a fingerprint-bound outcome-evidence receipt
- RR-ACTION-INTENT-ONE-CLASSIFIER (S, step 3, server): One action-intent classifier for KEY: the six divergent action-verb regexes become one exported function, so 'cancel', 'refund', 'pay' and 'remove' open the actions layer on the Cortex path as they do on Flow
- RR-EVAL-HARNESS-NO-VACUOUS (S, step 3, server): KEY's eval harness cannot pass vacuously: a suite proves it fails on its target defect, NOT_RUN and INDETERMINATE are distinct from PASS, and an empty suite or empty run is not green
- RR-KEY-FAKE-MODEL-TRAJECTORY (M, step 3, server): A scripted fake model and a trajectory recorder for KEY's Flow turn, so tests assert which tools were offered, what the model proposed, the authority decision and the effect, with no network
- RR-LANGFUSE-INGESTION-CUTOVER (S, step 3, server): AI trace export leaves Langfuse's legacy /api/public/ingestion for OTLP/HTTP traces; exporter failures are counted and visible; business id is no longer sent as the user id
- RR-JOB-TENANT-CONTEXT (M, step 4, server): Per-business background work runs inside a tenant context so the Prisma tenant extension scopes it; a census lists every background entry point's tenancy mode
- RR-CHANGE-ORDER-APPROVE-COMMAND (S, step 4, both): Change orders are approved and rejected through commands that record the real approver; PATCH can no longer set a decision status or a client-chosen approvedBy
- RR-AUTHORITY-SHADOW-PARITY (S, step 4, server): Evidence for the effective-authority cutover: a base-envelope parity matrix against the legacy guard on Postgres, and shadow mismatches counted, not only warn-logged
- RR-BUSINESS-EVENT-REDACT (S, step 3, server): BusinessEventService.emit/emitBatch and ContactAuditService redact secret-named fields at the write, as the interceptor already does
- RR-RETENTION-EXPIRED-EXPORTS (S, step 3, server): Expired or consumed contact export bundles are deleted from storage on the privacy scheduler, not kept forever
- RR-OBJECT-STORAGE-POSTURE-CHECK (S, step 7, server): Diagnostics reports whether the object-storage bucket is public and whether default encryption is on, before any upload header changes
- RR-SCRIPT-SPECS-IN-CI (S, step 3, gate): Every scripts/** node:test spec runs in a workflow, or is exempt with a reason (the agent-memory tests run nowhere today)
- RR-CI-REQUIRED-JOBS-AGGREGATE (S, step 3, gate): One 'CI verdict' job that is red when any gating CI job failed, was skipped or was cancelled
- RR-GATE-LEDGER-MONOTONIC (S, step 3, gate): CI compares every registered shrink-only ledger and floor ratchet between base and head and goes red when one moves the wrong way
- RR-ERASE-BUSINESS-TWO-STEP (M, step 3, server): Whole-business GDPR erasure needs a second, deliberate act and leaves a durable record (form set by the owner's answer)
- RR-OAUTH-PKCE-GOOGLE-MICROSOFT (S, step 4, server): Google Suite and Microsoft OAuth use PKCE (S256), with the verifier derived from the signed state so no new store is needed
- RR-PRIVACY-DELETED-CONTACT-GATES (S, step 4, server): A soft-deleted or forget-pending contact is neither exported nor emailed

**P3 (47)**
- RR-KEY-PROMPT-CANARY (S, step 3, server): A per-turn canary marker in KEY's system prompt: a tool call whose arguments carry it is refused, and a reply that echoes it is recorded
- RR-CORTEX-BUS-BACKPRESSURE (S, step 7, server): KEY cortex event bus bounds its in-flight ledger writes and reports saturation instead of starting unbounded concurrent writes
- RR-OPENSOURCE-PROVIDER-SPLIT (S, step 7, server): Ollama and OpenRouter become two gateway resources with their own identity, health, circuit and cost, not one 'opensource' provider
- RR-MODEL-SELECTION-ONE-SEAM (S, step 7, server): One model-selection seam: delete the dead cortex provider-selection map and ratchet model ids outside the gateway
- RR-DIRECT-PROVIDER-CENSUS (S, step 7, server): Census of model-provider calls that bypass the gateway: a shrink-only spec fails on a new direct SDK or provider URL
- RR-ANTHROPIC-TOOL-PARITY (S, step 7, server): Anthropic path keeps tool semantics: toolChoice 'none' honoured, assistant tool calls sent as tool_use and results as tool_result blocks
- RR-PROMPT-CACHE-PREFIX (S, step 7, server): Provider prompt caching: Anthropic system prefix marked cacheable, cached input tokens read from usage and priced
- RR-AI-CONTRACT-ZOD-FIRST (S, step 7, server): First executable AI contract: intent_parse becomes one Zod schema deriving its type, its validator and the parse_intent tool schema
- RR-STRICT-TOOL-SCHEMAS (M, step 7, server): KEY tool calls: advertised schemas are closed (no undeclared arguments) and strict where the provider supports it, after a census of the callers that send extra keys
- RR-CONNECTOR-STACK-CENSUS (S, step 3, server): Census ratchet of the two connector stacks (ConnectorRegistry and KeyConnector): every importer is listed with its v1 journey, a new one fails
- RR-GOAL-WRITER-CENSUS (S, step 3, server): Goal writer census: every writer of AiGoal and BusinessGoal listed with its provenance source; a new writer fails
- RR-KEY-SAFE-MODE (S, step 3, server): KEY_SAFE_MODE: a partial, operator-set safe mode where KEY reads and answers but runs no write and no autonomous action
- RR-MIGRATION-UNDO-TABLE (S, step 3, server): Isolated migration: the key_undoable_actions table for durable KEY undo records, proven on a fresh database
- RR-UNDO-DURABLE (M, step 3, server): KEY undo records are durable (database, business-scoped, atomic claim) instead of a 5-minute in-process Map
- RR-TRIAGE-RISK-FLOOR (S, step 3, server): Cognitive triage takes an optional risk context that can only raise the effort tier; a money or destructive request gets the deliberate budget on the tool path and never grants authority
- RR-SELFTUNE-CANDIDATE-ONLY (XS, step 3, server): Remove KEY's unreachable self-tuning path that applies model-chosen changes to AI preferences directly, and pin that no service writes AI preferences or tuning memory from a model response
- RR-LEARNING-OUTCOME-SEMANTICS (S, step 3, server): A tool's execution result is recorded as execution, not as the user's acceptance, and confidence calibration counts only real user responses
- RR-EVAL-RUN-LINEAGE (XS, step 3, server): Every eval run records the suite version, a definition hash and the commit it ran on, and a suite whose assertions change without a version bump fails a ratchet
- RR-COG-RUNTIME-ENTRY-CENSUS (S, step 3, server): Census of every entry that starts a KEY cognitive turn or offers tools to a model, with its runtime, who may reach it and its authority path; a spec fails on an unregistered entry
- RR-APPROVAL-MODEL-CENSUS (M, step 3, server): Census of every writer of KEY proposals, AI approval items, approval requests and Flow-bound confirmations, with what each approval gates and who may clear it; a spec fails on an unregistered writer
- RR-REFLECTION-HONEST (S, step 3, server): KEY's reflection maintenance stops reporting work it did not do, and the in-process dream journal is bounded and labelled unpersisted
- RR-MIGRATION-CASH-TARGET (XS, step 3, server): Isolated migration: Business.cashRunwayTargetMonths (nullable Float), proven on a fresh database
- RR-CASH-TARGET (S, step 5, server): Owner-set cash runway target: the 'Protect cash runway' money move fires against the business's own target instead of a hard-coded three months, revenue-scoped and suggestion-only
- RR-AI-TRACE-ATTEMPTS-CORRELATION (S, step 3, server): The model gateway traces every attempt, including the failed and fallen-back ones, under one trace id per gateway call, with the caller's correlation id when it has one
- RR-SLO-AVAILABILITY-LEDGER (S, step 7, gate): Written availability objectives for the two probed endpoints, and the uptime monitor reports 30-day availability and remaining error budget against them
- RR-ERROR-CAPSULE (S, step 7, server): Every recorded server failure carries a small reproduction capsule: release sha, replica, last correlation id and failure class
- RR-SECURITY-SIGNAL-COUNTERS (S, step 4, server): Runtime counters for security signals (bearer verification failures, cross-business refusals, webhook signature failures), visible to the platform super-admin
- RR-INTEGRITY-WATCH (S, step 7, server): Read-only integrity check for impossible cross-business states between a row and its parent, served on demand to the platform super-admin
- RR-CRON-OCCURRENCE-LOCK (S, step 7, server): A scheduled job occurrence is claimed once across replicas and restarts; a census fails on any new @Cron that is neither claimed nor registered as idempotent
- RR-STATUS-PATCH-CENSUS (S, step 3, server): Census of every generic update route that can write a lifecycle status, each registered as transition-checked, decision-refused or free label; a new unregistered one fails
- RR-DEAD-EVENT-CENSUS (S, step 3, server): The event-wiring ratchet covers the other direction: no new event may be emitted with nothing listening, bridged or registered as intentionally publish-only
- RR-FORWARDREF-RATCHET (XS, step 3, server): forwardRef ratchet: the count of forwardRef module/provider cycles in server source may fall, never rise, and no new file may introduce one
- RR-WEB-CLIENT-RATCHET (XS, step 3, web): lib/client.ts ratchet: no new web file may import the monolithic client; the importer list may only shrink
- RR-KEY-CORTEX-SIZE-RATCHET (XS, step 3, server): key-cortex size ratchet: its source file count and largest-file line counts may fall, never rise
- RR-UNUSED-MODEL-CENSUS (S, step 3, server): Census of Prisma models no code reads or writes; the list may shrink, and a new model with no reader or writer fails
- RR-ARCH-SCAN-CI (S, step 7, gate): CI runs the deterministic architecture scanners on each PR and reports the map diff (report-only; blocking needs an owner ruling)
- RR-ADMIN-SHELL-SERVER-GATE (XS, step 7, web): /admin pages are refused at the edge without an unexpired admin session cookie (the API stays the authority)
- RR-SESSION-STORAGE-CENSUS (XS, step 7, web): Census of every browser-readable place the web app stores a credential; a spec fails on a new one
- RR-GATE-LEDGER-CENSUS (S, step 3, gate): Every file that declares a shrink-only ledger or ratchet is registered in ledger-sizes.mjs, or exempt with a reason
- RR-BUNDLE-RULING-CONFLICTS (S, step 3, docs): The context bundle reports rulings that supersede, refine or widen the rulings a packet cites
- RR-BUNDLE-PROOF-PROFILE (S, step 3, docs): The context bundle attaches the matching research proof profile (fastest falsification, adversarial cases) by recorded rules, or says none matched
- RR-HOTSPOT-SCANNER (S, step 3, docs): Offline git-history hotspots (churn, fix density, co-change) computed per packet write set and shown in the bundle
- RR-STATUS-REVIEW-CYCLES (S, step 3, docs): V1-STATUS counts the review-repair and post-merge fix commits each packet needed, as far as main shows them
- RR-HOOK-PACKET-SCOPE (M, step 3, gate): Edits outside a packet's write set are flagged at edit time on pkt/V1-* branches, and a scope report lists them for the merge check
- RR-INDEX-COVERAGE-REPORT (S, step 3, server): Census: every tenant model has an index led by businessId, or is acknowledged in a shrink-only list (first slice of the access-path audit)
- RR-STATUS-STALL-REPORT (S, step 3, gate): V1-STATUS reports packets that have been ready for longer than a budget without landing (stall signal from main alone)
- RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE (S, step 4, server): Cancelling a forget request restores only what the forget request deleted

**Shared files and fixture prefixes.** Many packets edit the same few files: `model-gateway.service.ts`, `flow-orchestrator.service.ts`, `scripts/agent-memory/lib.mjs`, `.github/workflows/ci-cd.yml` and `apps/server/test/helpers/fixture-prefixes.json`. Only real ordering needs are recorded as `depends_on`. When admitting, the orchestrator should give these packets file-order edges or lanes, as the plan's "File-order edges" section does.

Each of the 27 packets that adds a new `*.integration.test.ts` has a prefix allocated in its scope: `v72a_` to `v72z_`, then `v73a_`. The registry rule at 2c4e4bf2 accepts only `v<NN><a-z>_` tied to a V1-NN number, so this assumes the RR series takes the unused numbers V1-72 and V1-73. Renumbering the series means renumbering the prefixes. The rows for the plan's `fixture_prefix_table` are in `fixture-prefix-rows.json`.

**Owner-gated packets.** These depend on RR-OWNER-RULINGS-RECORD, so status tooling does not show them as ready:
- RR-ERASE-BUSINESS-TWO-STEP (OQ-30);
- RR-DB-CRYPTO-PROD-GUARD (OQ-5);
- RR-CONNECTOR-CONFORMANCE (OQ-13);
- the two migration packets RR-MIGRATION-UNDO-TABLE and RR-MIGRATION-CASH-TARGET (D-167: owner approval).

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
- **Heuristic counts.** About 38 Prisma models have no direct accessor. 19 shrink-only ledger hits are unregistered. The census packets resolve both.
- **Fixture-prefix series.** V1-72/V1-73 for the RR prefixes is an assumption (see section 3).
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
| OQ-37 | Generative (property/fuzz) tests beyond money | first-slice packet (authorization predicates or webhook payload parsing) / leave to each packet's own proof | Leave to each packet. No defect to write a RED from. |
| OQ-38 | Weight tool selection by learned outcome scores (neuro atlas) | post-v1, after RR-LEARNING-OUTCOME-SEMANTICS / never | Post-v1, and only on verified outcomes |
| OQ-39 | Online eval monitors, repeated-trial admission, production regression intake (issue #153 L9) | post-v1 / v1 after RR-EVAL-RUN-LINEAGE | Post-v1. Production intake needs a privacy gate. |
| OQ-40 | Rate limit the public contact-export download (R51)? | add as hardening / leave | Leave. The 32-byte token makes guessing infeasible. |
| OQ-41 | World-knowledge learning stream and adaptive receptor intake | memory-track follow-on post-v1 / v1 packet | Post-v1 with the context genome (BUILD-MAP row #148) |

## 7. Reviews

Two fresh subagent reviews ran on the first version (ca4eaa98). Each reviewer was given the files and the requirements, not this worker's conclusions. Every finding below was applied.

**1. Fidelity: traceability, nothing invented, dedup, statuses.** About 30 rows were checked against their sources, the code and the plan. All the done (a) and planned (b) statuses checked held, as did the code citations opened. Findings and fixes:
- **Seven security-register items had no row** (R26, R35, R40, R50, R51, R53, R54). Six rows were added:
  - R26, R35, R53 and R54 got packets RR-OAUTH-PKCE-GOOGLE-MICROSOFT, RR-PRIVACY-DELETED-CONTACT-GATES and RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE;
  - R40 is done and was added to REC-SEC-REGISTER-DONE;
  - R50 and R51 got rows without a packet, with reasons.
- **REC-PROPERTY-TESTS was overstated as done.** The source names twelve areas; it is now status c.
- **REC-GOVERNED-LEARNING hid a second change.** The neuro-atlas tool-selection weighting is now REC-OUTCOME-WEIGHTED-TOOL-SELECTION (d).
- **Three "MEM" rows have no MEM packet.** They are now MEM-deferred and counted separately.
- **REC-STATE-TRANSITION-COMMANDS was miscounted.** It is now status c.
- **Missing #153 Layer-9 items** were added as REC-EVAL-ONLINE-CALIBRATION.
- **A Book-genome tranche item was missing** and was added to Appendix A.
- **README errors** were fixed: the priority split, the register count and a dangling pointer.
- **Worker-local references were mapped.** Owner-question labels now use the OQ-n numbers, and row numbers became REC ids. The extraction notes cited as sources are committed under `worker-notes/`.
- **The summary table showed dependencies as packets.** It now lists only the packets each row owns.

**2. Packet quality: shape, size, tests-first, premises, rulings, dependencies.** All 13 P1 packets and 12 others were deep-checked; most premises held. Mechanical validation passed apart from what is fixed below.
- **Two dependencies ran against step order.** RR-SECURITY-SIGNAL-COUNTERS moved from step 7 to 4. RR-STRICT-TOOL-SCHEMAS moved to step 7, after RR-ANTHROPIC-TOOL-PARITY.
- **RR-TOOL-EFFECT-CLASS was a hidden L** (286 tools x 4 fields) gating three P1 packets. It was split:
  - slice 1, P1 S, effectClass with strict defaults;
  - RR-TOOL-EFFECT-METADATA, P2 M.
  - The P1 packets now depend on slice 1 only.
- **RR-STRICT-TOOL-SCHEMAS was a hidden L.** It was split into RR-TOOL-ARGS-MALFORMED-NEVER-RUN (P2, the real safety defect) and closed schemas (P3).
- **r0_impact understated Release 0 contact.** RR-MODEL-LIFECYCLE-GUARD is now AMEND, naming the optional-services-fail-visibly routing cases (only if OQ-3 confirms a retirement). Others name their manifests. New cases go in new spec files. 15 more packets note that mutation-control find strings in their files stay byte-identical.
- **New integration suites had no fixture prefixes.** All 27 now have one (section 3).
- **Schema changes were bundled into feature packets** (handoff rule 9, D-167). They are split into RR-MIGRATION-UNDO-TABLE and RR-MIGRATION-CASH-TARGET.
- **RR-KEY-SAFE-MODE missed the Cortex tool loop.** It is now gated there too, with a RED case through cortex chat.
- **RR-UNDO-DURABLE's write set was incomplete.** It now includes ai.controller.ts, and canUndo becomes async at its callers.
- **RR-DISPATCH-ATOMIC-CLAIM had a false premise.** KeyIdempotencyService is already exported.
- **RR-ERASURE-BUSINESS-EVENTS missed events written after the purge.** The interceptor writes outside the purge transaction; it now writes no subject data for a forget-pending or purged contact, with a DoD case.
- **RR-RETENTION-EXPIRED-EXPORTS deleted export records.** It now keeps them and deletes only the objects, recorded in the audit log. Nulling the required key columns would need a migration, so it was left out.
- **Owner-gated packets looked ready to the tooling.** They now depend on RR-OWNER-RULINGS-RECORD.
- **RR-ADMIN-LOGOUT's third change named no file.** It now names the user sign-in token setters.
- **Priorities checked.** No P1 needs to be P0 today.

**Left open after the reviews:**
- RR-BANK-TOKEN-ENCRYPT edits two existing integration suites: the coverage gate's list and the backfill CLI suite. The orchestrator should confirm at admission that this is acceptable or move the cases.
- The fixture-prefix series number (above).
