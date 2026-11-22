# Product memory packets for KEY: proposal (KF-MEMORY-RND-001, deliverable 6, under D-254)

Status: **PROPOSAL ONLY.** Not in `docs/reconstruction/V1-PLAN-RECUT.json`; that file is not edited here. Under D-254 these
packets join the v1 plan only "once the owner approves the Track 2 design". Each entry below uses the plan's packet shape
(`id, title, kind, absorbs, bugs, journeys, step, lane, size, priority, depends_on, files, decisions, scope,
definition_of_done, r0_impact, fixture_prefix`) so that a rulings commit can copy it in.

Conventions honoured (from the plan and D-254):
- Each packet is small, tests-first ("RED on the base, then green"), real-database proof for server changes, and safe to
  merge alone (no packet leaves the product worse if the next one never lands).
- Each `scope` states, in a sentence starting **Scope rule:**, how its memory reads honour tenancy and revenue scope
  (D-100, D-128, D-226, D-227, D-234, D-238); **Schema:** names any schema change or says none; **Backfill:** says none,
  or that it is dry-run by default and applied only on owner authority, never against production by the packet.
- `fixture_prefix` is `null` here: the registry requires `v<NN><a-z>_` with a matching V1-NN, assigned when the packet is
  admitted.
- `step` is a proposal; the owner or orchestrator places the packets. Steps 3 to 8 are the ones the standing directive
  releases (D-222).
- `r0_impact` was checked only by searching `scripts/proof-admission/manifests/*.json` and `release0-*.json` for the file
  names each packet touches (at `5c17e7b4`): only `flow-orchestrator` appears (in action-001-negative-controls,
  contacts-patch-visibility, pay-link-token-gate, payments-actor and revenue-auth-001). A packet's worker re-checks at its
  base.
- None duplicates an existing packet. Related existing packets: W11-MEMORY-PROMOTE-SCOPE, W11-FLOW-PERCEPTION-SCOPE,
  W1F-MEMORY-COPIES, FU-MEMORY-COPIES-REWRITE, FU-KEY-MEMORY-MONEY-SIGHT, FU-KEY-CHAT-GENOME-MONEY-SIGHT,
  FU-KEY-GENOME-READS-RESIDUAL, FU-PROPOSAL-REVENUE-SIGHT (P0, edits key-cortex-prompt-context.service.ts),
  FU-PROPOSAL-MONEY-TAG, FU-KEY-EVENT-COLUMNS, FU-GENOME-REVENUE-CLASSIFIER, FU-GENOME-SURFACES-REVENUE, KEY-CRONS-FLAGS. Where a proposed packet touches the same file as
  an open one, it depends on it.

The evidence for each gap is in `PRIOR-RESEARCH-RECOVERED.md` section 4 (characterisation of the product at `5c17e7b4`;
items marked INFERRED there are reproduced RED by the packet before any fix).

## Summary

| Order | id | One line | Size | Priority | Schema |
|---|---|---|---|---|---|
| 1 | MEM-CENSUS | Census of every KEY memory read and write path with its tenant predicate and reader projection; a spec fails on an unregistered path | M | P1 | none |
| 2 | MEM-TEMPORAL-SCOPE | Temporal-flow memory updates and tags only touch the caller's business; the unscoped semantic delete is scoped | S | P0 | none |
| 3 | MEM-EXPIRED-NOT-SERVED | Unified retrieval stops serving expired memories; confidence 0 no longer scores like an unscored row | S | P1 | none |
| 4 | MEM-DOC-EXTRACTION-SIGHT | Document extractions in AI memory (provenance unknown) fail closed for readers without revenue read | M | P0 | none |
| 5 | MEM-SEMANTIC-SIGHT | The flow chat semantic-memory section and agent memory search pass every hit through the reader projection | M | P0 | none |
| 6 | MEM-SALIENCE-SIGHT | The salience feed in every chat prompt omits money-derived signals for readers without revenue read | S | P0 | none |
| 7 | MEM-CLASS-COLUMNS | Memory rows and embedding copies record data class and module scope at write, from provenance | M | P1 | additive columns |
| 8 | MEM-CLASS-BACKFILL | Classify legacy memory rows: dry-run report by default, apply on owner authority | S | P1 | none |
| 9 | MEM-CLASS-READ | One reader projection decides every memory read by data class; derived items inherit their sources' class | L | P1 | none |
| 10 | MEM-TEMPORAL-EMBED-DEDUP | One semantic copy per temporal summary; stale duplicates removed by a dry-run-first command | S | P2 | none |
| 11 | MEM-HONEST-RETRIEVAL | Memory retrieval reports channel failures distinctly from "nothing found", and KEY says "not recorded" | S | P2 | none |
| 12 | MEM-CONSOLIDATION-CHECKPOINT | Consolidation keeps a durable per-business nightly checkpoint, so restarts and replicas do not repeat it | S | P2 | new table |
| 13 | MEM-EVAL-SUITE | The memory leak suite and the KEY memory task suite, with recorded baselines | M | P1 | none |

Order rationale: 2, 3, 4 and 6 close existing exposure or serve-in-error with no schema change and can run in parallel
(with or before 1: open question Q4); 4 and 5 wait for FU-PROPOSAL-REVENUE-SIGHT (same prompt-context file) and 5 follows
4 (it reuses 4's rule for AiMemory copies); 7 to 9 make the scope rule structural; 10 to 12 are correctness; 13 gates the later design work (activation ranking, consolidation changes, procedures), which is **not** proposed as
packets yet because the design requires each to beat the baseline first.

## Entries

```json
[
  {
    "id": "MEM-CENSUS",
    "title": "Census of every KEY memory read and write path, with its tenant predicate and reader projection; a spec fails on an unregistered path",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "M",
    "priority": "P1",
    "depends_on": [],
    "files": [
      "apps/server/src/modules/key-cortex (new memory-path census spec and a registry file beside unified-memory-retrieval.service.ts)",
      "apps/server/src/modules/ai, temporal-flow, business-genome/key-genome (read only, to enumerate)"
    ],
    "decisions": [
      "D-100",
      "D-128",
      "D-227",
      "D-234",
      "D-238",
      "D-254"
    ],
    "scope": "The memory truth audit (#122 M0; plan phase 0) as a test, not a document. Enumerate every reader and writer of AiMemory, AiMemoryEmbedding, TemporalFlowMemory, CognitionMemory, KeyCortexMemory, GenomeMemoryEvent, CognitiveEvent and the stores UnifiedMemoryRetrievalService reads, plus every place their content reaches a prompt, API response, stream or cache (the census in PRIOR-RESEARCH-RECOVERED.md section 4 is the starting list). Record per path: tenant predicate in the query (yes/no), reader projection applied (readersOwnPromptMemory or other), data classes it can carry. A census spec scans the modules for Prisma calls on these models and raw SQL on their tables and fails when a path is not in the registry (the REST scope census pattern). Dormant paths are registered as DORMANT with the reason (no caller), including UnifiedMemoryWriterService.storePreference and KeyCortexConversationService.addMessage, which pass a userId that AiMemory cannot store (no live caller at 5c17e7b4, so no member-overwrite defect is reachable today; a census entry makes the first caller fail the spec until member scope is designed). Paths found without a tenant predicate or projection are listed, not fixed here: each becomes a RED in its own packet. Scope rule: read-only; changes no reader. Schema: none. Backfill: none. Coordinate with FU-KEY-GENOME-READS-RESIDUAL, which inventories genome reads; this census covers memory stores and references its genome rows rather than repeating them.",
    "definition_of_done": "RED: adding an unregistered prisma.aiMemory.findMany in a fixture module fails the census spec. GREEN: every current path is registered with its predicate and projection; the list of unprojected paths matches the packets MEM-TEMPORAL-SCOPE to MEM-SALIENCE-SIGHT (or names new ones); server tsc and lint ratchet clean; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence (a new spec and a registry file)",
    "fixture_prefix": null
  },
  {
    "id": "MEM-TEMPORAL-SCOPE",
    "title": "Temporal-flow memory updates and tags only touch the caller's business; the unscoped semantic delete is scoped",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "S",
    "priority": "P0",
    "depends_on": [],
    "files": [
      "apps/server/src/modules/temporal-flow/temporal-flow-memory.service.ts (updateMemory)",
      "apps/server/src/modules/key-cortex/adapters/temporal-adapter.service.ts (update_memory, tag_memory)",
      "apps/server/src/modules/ai/semantic-memory.service.ts (deleteForSource)"
    ],
    "decisions": [
      "D-254"
    ],
    "scope": "TemporalFlowMemoryService.updateMemory(memoryId, patch) finds and updates by id with no businessId; the KEY connector commands update_memory and tag_memory receive a businessId and drop it. Make updateMemory take businessId and update with a compound where (id and businessId), returning not-found for another tenant's id; pass the businessId through the adapter. tag_memory also mixes identifiers: it looks rows up by entityId = memoryId and then updates by id (temporal-adapter.service.ts ~76-82); make it look up and update the same memory id within the business. SemanticMemoryService.deleteForSource deletes without business_id and has no caller: give it a businessId parameter or remove it (prefer removal if still uncalled). Scope rule: every update and delete by id carries the tenant predicate in the query itself; a foreign id is indistinguishable from a missing one. Schema: none. Backfill: none.",
    "definition_of_done": "RED: through the KEY connector command update_memory, business A updates business B's temporal memory by id on a real database. GREEN: the update is refused as not found and B's row is unchanged; A's own update still works; tag_memory likewise, and tag_memory on a memory id tags that memory (not rows whose entityId equals it); temporal-flow suites green; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence",
    "fixture_prefix": null
  },
  {
    "id": "MEM-EXPIRED-NOT-SERVED",
    "title": "Unified retrieval stops serving expired memories, and a confidence-0 row no longer scores like an unscored row",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "S",
    "priority": "P1",
    "depends_on": [],
    "files": [
      "apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts"
    ],
    "decisions": [
      "D-254"
    ],
    "scope": "The AiMemory read in UnifiedMemoryRetrievalService does not filter expiresAt, so expired TTL rows (cerebellum corrections after 7 days, pattern rows) still reach prompts, while AiMemoryService.getAll and semantic search do filter. Add the same expiresAt filter. Relevance falls back to `row.confidence ? row.confidence*0.5+0.5 : 0.5` (unified-memory-retrieval.service.ts ~79), so a confidence-0 row gets the same 0.5 as a row with no confidence at all (#122 known defect 'zero-confidence fallback bug'): distinguish 0 from missing so a confidence-0 row scores lowest, leaving other rows' order unchanged. Scope rule: no change to which readers see which rows; this packet only removes rows that should never be served. Schema: none. Backfill: none. Flag: none needed (removes served-in-error rows only).",
    "definition_of_done": "RED: an AiMemory row with expiresAt in the past appears in buildMemoryContext output; a confidence-0 row's relevance equals an unscored row's 0.5. GREEN: the expired row is absent; the confidence-0 row scores below every row with positive confidence and below unscored rows; unexpired rows unchanged; retrieval and scoping specs green; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence",
    "fixture_prefix": null
  },
  {
    "id": "MEM-DOC-EXTRACTION-SIGHT",
    "title": "Document extractions in AI memory reach prompts and GET /ai/memory only for readers allowed to see that document",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "M",
    "priority": "P0",
    "depends_on": [
      "FU-PROPOSAL-REVENUE-SIGHT"
    ],
    "files": [
      "apps/server/src/modules/key-cortex/key-cortex-document.service.ts (storeDocumentExtraction caller)",
      "apps/server/src/modules/key-cortex/key-cortex-prompt-context.service.ts (readersOwnPromptMemory)",
      "apps/server/src/modules/ai/ai.controller.ts and ai-memory.service.ts (GET /ai/memory, /ai/memory/context)"
    ],
    "decisions": [
      "D-100",
      "D-128",
      "D-227",
      "D-234",
      "D-238"
    ],
    "scope": "KeyCortexDocumentService stores JSON.stringify of any uploaded document's extracted data as an AiMemory row (category document_extraction, key = documentId); AiMemory is not gated by the prompt projection and GET /ai/memory returns all rows to any member (AuthGuard and BusinessGuard only). An extracted invoice or statement therefore reaches members without revenue read. The document record (KeyDocument) carries only fileType: there is no document classifier and no per-document read rule, so the financial provenance of an extraction is unknown. Under D-234 ('Where provenance or classification is ambiguous, the row fails closed') every document_extraction row is therefore withheld from readers without revenue read and from memberless turns, in readersOwnPromptMemory and in the /ai/memory routes; owners and revenue readers keep them. Classifying documents so that non-financial extractions can be shown more widely is left to a later packet (it needs a schema change: open question Q4c). Scope rule: tenant predicate unchanged; revenue scope decided by the absence of provenance (fail closed), never by words in the extracted text. Schema: none. Backfill: none. Coordinate with FU-PROPOSAL-REVENUE-SIGHT, which edits the same prompt-context file.",
    "definition_of_done": "RED: a STAFF member without revenue read sees an extracted invoice's amounts in the KEY prompt and in GET /ai/memory. GREEN: no document_extraction row reaches that reader or a memberless turn; the owner and a revenue reader still see them; perception and memory suites green; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence (to re-check at base: ai.controller is not bound in any manifest at 5c17e7b4)",
    "fixture_prefix": null
  },
  {
    "id": "MEM-SEMANTIC-SIGHT",
    "title": "The flow chat semantic-memory section and agent memory search pass every hit through the reader projection",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "M",
    "priority": "P0",
    "depends_on": [
      "MEM-DOC-EXTRACTION-SIGHT",
      "FU-PROPOSAL-REVENUE-SIGHT"
    ],
    "files": [
      "apps/server/src/modules/ai/flow-orchestrator.service.ts (buildSemanticMemorySection)",
      "apps/server/src/modules/ai/agent.controller.ts (GET agent/memory/search)",
      "apps/server/src/modules/ai/semantic-memory.service.ts (hit metadata: sourceType, sourceId)"
    ],
    "decisions": [
      "D-100",
      "D-128",
      "D-227",
      "D-234",
      "D-238"
    ],
    "scope": "buildSemanticMemorySection injects the top 5 semantic hits of every source type (the live writers at 5c17e7b4 are AiMemory copies and temporal_memory; document chunks come only from dormant KnowledgeIngestion and the dormant writer indexSemantic path, but the reader must still handle every source type) into every flow-chat prompt with no reader or module projection; GET agent/memory/search returns hits to any member. Fix: resolve each hit's source (sourceType, sourceId) and apply the same rule as its source: AiMemory copies follow MEM-DOC-EXTRACTION-SIGHT and readersOwnPromptMemory; document chunks follow their KnowledgeSource or document; temporal_memory follows the summarised entity's module and, for summaries whose source events include money events, revenue read (taint, design 8.2); an unresolvable source fails closed. Withheld hits are dropped before the top-k cut and leave no count. Scope rule: tenant predicate unchanged; revenue and module scope from the hit's source provenance; filtered hits influence nothing returned. Schema: none. Backfill: none.",
    "definition_of_done": "RED: a STAFF reader without revenue read gets a semantic hit carrying an invoice amount in the flow chat prompt and from agent/memory/search. GREEN: absent for that reader and for a memberless turn; present for a revenue reader; the number of hits shown to the STAFF reader is the same whether the tenant holds 0 or 20 revenue hits; flow-chat semantic suites green; manifests binding flow-orchestrator (action-001-negative-controls, contacts-patch-visibility, pay-link-token-gate, payments-actor, revenue-auth-001) re-run green; proof:release0 MET.",
    "r0_impact": "KEEP: flow-orchestrator suites are bound in action-001-negative-controls.json, contacts-patch-visibility.json, pay-link-token-gate.json, payments-actor.json and revenue-auth-001.json; additive cases only, required cases unchanged; re-run them. A required case that expects a withheld hit is a CONTRADICTION to report.",
    "fixture_prefix": null
  },
  {
    "id": "MEM-SALIENCE-SIGHT",
    "title": "The salience feed in every chat prompt omits money-derived signals for readers without revenue read",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 3,
    "lane": "server",
    "size": "S",
    "priority": "P0",
    "depends_on": [],
    "files": [
      "apps/server/src/modules/key-cortex/key-cortex-salience.service.ts (describeForPrompt)",
      "apps/server/src/modules/key-cortex/cognitive-triage.service.ts (standingContext)",
      "apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts (describeForPrompt Basis lines carry the same counts)"
    ],
    "decisions": [
      "D-100",
      "D-234",
      "D-238"
    ],
    "scope": "describeForPrompt renders the top threats and momentum (counts of overdue invoices, invoices paid, payments received, bookings) as facts in every flow-chat system prompt via standingContext, with no reader check. Counts of overdue invoices, invoices paid and payments received are transaction-derived signals, which D-234 says 'need `revenue:read`' (and D-100: 'no money signals at all'); owner question Q5 asks only for confirmation. The endocrine service's describeForPrompt renders 'Basis:' lines with the same counts and is fixed here too; other readers of KeyCortexMemory concern rows are left to MEM-CENSUS. Fix: describeForPrompt takes the reader's revenue and module sight and renders only signals whose event types are within it; the selection of the top items happens after filtering, so a withheld signal does not change which others appear; endocrine levels derived from withheld signals are not described to that reader. Scope rule: tenant predicate unchanged; revenue and module scope from the signal's event type (a fixed map in the service, unknown types fail closed). Schema: none. Backfill: none.",
    "definition_of_done": "RED: a STAFF reader without revenue read sees 'overdue invoices' in the flow chat system prompt. GREEN: absent for that reader and for memberless turns; present for revenue readers; booking signals still shown to readers with the bookings module; salience specs green; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence",
    "fixture_prefix": null
  },
  {
    "id": "MEM-CLASS-COLUMNS",
    "title": "Memory rows and embedding copies record data class and module scope at write, from provenance",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 4,
    "lane": "server",
    "size": "M",
    "priority": "P1",
    "depends_on": [
      "MEM-CENSUS"
    ],
    "files": [
      "packages/db/prisma/schema.prisma (AiMemory, AiMemoryEmbedding, TemporalFlowMemory)",
      "a new additive migration",
      "every writer registered by MEM-CENSUS (unified-memory-writer, ai-memory, semantic-memory, temporal-flow-memory, cerebellum, consolidation, document service, knowledge ingestion)"
    ],
    "decisions": [
      "D-227",
      "D-234",
      "D-238",
      "D-254"
    ],
    "scope": "Design section 3.1 and 8.2: add nullable columns data_class (GENERAL, REVENUE, PERSONAL, SECRET_BEARING, UNCLASSIFIED) and module_scope (text array) to ai_memories, ai_memory_embeddings and temporal_flow_memories. Every writer sets them from what it knows structurally (its source table, event type, tool authority, document type), the pattern FU-PROPOSAL-MONEY-TAG proposes for proposals (that packet is still todo; this one does not depend on it); an embedding copy and a temporal summary take the most restrictive class and the union of module scopes of their sources. Readers are not changed in this packet (MEM-CLASS-READ does that), so behaviour is unchanged and the packet is safe alone. Scope rule: write-side only; no read changes. Schema: two additive nullable columns per table (data_class, module_scope), no default, no index change; migration is reversible by dropping them. Backfill: none here (MEM-CLASS-BACKFILL).",
    "definition_of_done": "RED: a census-driven spec asserts every registered writer sets data_class and fails on the base. GREEN: every writer sets both fields on a real database; copies inherit the restrictive class (a summary over one payment event is REVENUE); existing suites green; migration applies and reverts on a test database; proof:release0 MET on a migrated database.",
    "r0_impact": "KEEP: schema change is additive; proof:release0 is re-run on a migrated database; no required case changes.",
    "fixture_prefix": null
  },
  {
    "id": "MEM-CLASS-BACKFILL",
    "title": "Classify legacy memory rows: dry-run report by default, apply on owner authority",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 4,
    "lane": "server",
    "size": "S",
    "priority": "P1",
    "depends_on": [
      "MEM-CLASS-COLUMNS"
    ],
    "files": [
      "apps/server/scripts (a new memory-class backfill command)",
      "docs/DEPLOY_RUNBOOK.md (the command, dry-run first)"
    ],
    "decisions": [
      "D-254"
    ],
    "scope": "Rows written before MEM-CLASS-COLUMNS have data_class NULL. A command classifies them with the same provenance rules the writers use (category, source, sourceType, linked document or event), leaving UNCLASSIFIED where provenance is insufficient. Dry-run by default: it prints counts per table, class and tenant (no content) and writes nothing; --apply writes in batches, idempotently, with a resumable cursor. Not run against production by the packet: the apply needs owner authority (D-254). Scope rule: the command never reads across tenants into one output beyond counts; it changes no reader. Schema: none. Backfill: this packet is the backfill; dry-run first, apply on owner authority only.",
    "definition_of_done": "RED: the command does not exist. GREEN: on a test database with legacy rows, dry-run writes nothing and reports counts; apply classifies each fixture row as expected and is idempotent on a second run; an interrupted apply resumes; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence",
    "fixture_prefix": null
  },
  {
    "id": "MEM-CLASS-READ",
    "title": "One reader projection decides every memory read by data class; derived items inherit their sources' class",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 4,
    "lane": "server",
    "size": "L",
    "priority": "P1",
    "depends_on": [
      "MEM-CLASS-COLUMNS",
      "MEM-SEMANTIC-SIGHT",
      "MEM-SALIENCE-SIGHT",
      "FU-KEY-GENOME-READS-RESIDUAL",
      "FU-PROPOSAL-REVENUE-SIGHT"
    ],
    "files": [
      "apps/server/src/modules/key-cortex/key-cortex-prompt-context.service.ts (readersOwnPromptMemory)",
      "apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts (filter before rank)",
      "every memory read path registered by MEM-CENSUS"
    ],
    "decisions": [
      "D-100",
      "D-128",
      "D-226",
      "D-227",
      "D-233",
      "D-234",
      "D-238"
    ],
    "scope": "Replace the per-path word heuristics for memory stores with one projection that reads data_class and module_scope: REVENUE needs revenue read; module_scope needs every listed module; PERSONAL needs the owning member, on stores that record one (CognitionMemory, KeyCortexMemory; AiMemory has no member column). Rows with NULL data_class (written before MEM-CLASS-COLUMNS) are classified at read from their structure, with the same rules the backfill uses (AiMemory category and source, embedding sourceType and source row, temporal summary source events); only rows whose financial provenance is ambiguous after that fail closed (D-234), so ordinary legacy memory (tone, goals, priorities, corrections) stays visible and the packet is safe to merge before the backfill is applied. Filter before ranking and before any count, so a withheld item changes nothing a reader sees (design 6.1). The word heuristics stay as a fail-closed backstop. Memberless turns keep the D-226/D-238 proposal rendering as FU-PROPOSAL-REVENUE-SIGHT leaves it. Behind a flag (MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE, after #124's CONTEXT_GENOME_READ pattern): SHADOW logs where the new projection and the current one differ, without changing output, so the switch is measured before it is made. Scope rule: this packet is the scope rule for memory: one projection, provenance-based, filter-first. Schema: none. Backfill: none (MEM-CLASS-BACKFILL replaces read-time classification of legacy rows once applied).",
    "definition_of_done": "RED: the E-REV-DIRECT and E-REV-INDIRECT cases of EVALUATION-PLAN.md section 3 for each registered path, including a differential case (a STAFF reader's output is identical with 0 or 50 revenue items). GREEN on every path; revenue readers and owners unchanged; all perception, memory and money-sight suites green; proof:release0 MET.",
    "r0_impact": "KEEP: re-run the manifests binding flow-orchestrator suites (action-001-negative-controls, contacts-patch-visibility, pay-link-token-gate, payments-actor, revenue-auth-001); additive cases only. A required case that expects a now-withheld memory is a CONTRADICTION to report.",
    "fixture_prefix": null
  },
  {
    "id": "MEM-TEMPORAL-EMBED-DEDUP",
    "title": "One semantic copy per temporal summary; stale duplicates removed by a dry-run-first command",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 5,
    "lane": "server",
    "size": "S",
    "priority": "P2",
    "depends_on": [
      "MEM-TEMPORAL-SCOPE",
      "FU-MEMORY-COPIES-REWRITE"
    ],
    "files": [
      "apps/server/src/modules/temporal-flow/temporal-flow-memory.service.ts (createMemory update path)",
      "apps/server/src/modules/ai/semantic-memory.service.ts (copy door for temporal_memory)"
    ],
    "decisions": [
      "D-221",
      "D-254"
    ],
    "scope": "Each re-summary of a temporal memory above confidence 0.7 inserts another temporal_memory embedding for the same sourceId (non-memory copies have no dedup), so old summaries stay searchable after their text changed. Use the copy door pattern of W1F-MEMORY-COPIES/FU-MEMORY-COPIES-REWRITE: the update replaces that source's copy in the same transaction. A command removes duplicate and stale temporal_memory copies left before this change: dry-run by default (counts per tenant, no content), apply only on owner authority. Scope rule: tenant predicate on every delete; no reader change. Schema: none. Backfill: the cleanup command, dry-run first, owner authority to apply.",
    "definition_of_done": "RED: after three re-summaries a temporal memory has three embedding copies and search returns the first summary's text. GREEN: one copy, holding the current text; the command's dry-run lists duplicates and apply removes them on a test database, idempotently; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence",
    "fixture_prefix": null
  },
  {
    "id": "MEM-HONEST-RETRIEVAL",
    "title": "Memory retrieval reports channel failures distinctly from 'nothing found', and KEY says 'not recorded'",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 5,
    "lane": "server",
    "size": "S",
    "priority": "P2",
    "depends_on": [
      "MEM-CLASS-READ"
    ],
    "files": [
      "apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts",
      "apps/server/src/modules/ai/semantic-memory.service.ts (search failure path)",
      "apps/server/src/modules/key-cortex/key-cortex-prompt-context.service.ts (memory block header)"
    ],
    "decisions": [
      "D-254"
    ],
    "scope": "Semantic search logs and returns [] on failure, and each store read is caught to [] (#153 EMB-GAP-04, RAGAS-GAP-04: 'No relevant memory exists' and 'retrieval infrastructure failed' are different states). Return a per-channel status (MATCHES, NO_MATCH, INDEX_UNAVAILABLE, EMBEDDING_PROVIDER_FAILED) with the fragments; the memory block in the prompt carries one status line and, when nothing relevant was found, an explicit 'nothing recorded about this' line so the model answers 'not recorded' rather than inventing (EVALUATION-PLAN E-CONF, E-KOR). POLICY_BLOCKED is never surfaced as a count. Scope rule: status lines carry no count or hint of withheld items. Schema: none. Backfill: none. Flag: the status line is behind MEMORY_STATUS_LINE=OFF|ACTIVE so it can be rolled back without a deploy of code.",
    "definition_of_done": "RED: with the embedding provider failing, the prompt memory block is indistinguishable from 'no memories'. GREEN: the block says semantic search is unavailable and keyword retrieval still runs; with no relevant memory it says so; a STAFF reader's status line is identical whether revenue items were withheld or not; optional-services suites green; proof:release0 MET.",
    "r0_impact": "KEEP: if optional-services-fail-visibly.json binds a suite this touches, additive outage cases only; re-run it.",
    "fixture_prefix": null
  },
  {
    "id": "MEM-CONSOLIDATION-CHECKPOINT",
    "title": "Consolidation keeps a durable per-business nightly checkpoint, so restarts and replicas do not repeat it",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 5,
    "lane": "server",
    "size": "S",
    "priority": "P2",
    "depends_on": [],
    "files": [
      "packages/db/prisma/schema.prisma (new model)",
      "a new migration",
      "apps/server/src/modules/key-cortex/memory-consolidation.service.ts"
    ],
    "decisions": [
      "D-254"
    ],
    "scope": "MemoryConsolidationService tracks 'already consolidated today' in an in-process Map, so a restart repeats a night and two replicas both run it (Genome doc section 3.9; plan phase 8 exit proof 'restart/multi-replica execution does not duplicate effects'). Add a checkpoint row per (businessId, job, localDate) claimed atomically (insert-if-absent) before the run and marked complete after; a claimed but stale row (older than the run timeout) can be reclaimed. Scope rule: rows hold only ids, dates and status, no memory content. Schema: one new table (memory_job_checkpoints: id, business_id, job, local_date, status, claimed_at, completed_at; unique on business_id, job, local_date). Backfill: none.",
    "definition_of_done": "RED: two service instances run consolidation for the same business in the same local night and the decay step lowers an old cognition row's confidence twice (0.2 instead of 0.1; memory-consolidation.service.ts ~186). GREEN: exactly one run per business per night across instances and restarts (one 0.1 step); a crashed run is reclaimed after the timeout; parasympathetic-consolidation specs green; migration applies and reverts; proof:release0 MET on a migrated database.",
    "r0_impact": "KEEP: additive schema; proof:release0 re-run on a migrated database.",
    "fixture_prefix": null
  },
  {
    "id": "MEM-EVAL-SUITE",
    "title": "The memory leak suite and the KEY memory task suite, with recorded baselines",
    "kind": "new",
    "absorbs": [],
    "bugs": [],
    "journeys": [
      "K"
    ],
    "step": 4,
    "lane": "gate",
    "size": "M",
    "priority": "P1",
    "depends_on": [
      "MEM-CENSUS"
    ],
    "files": [
      "apps/server/test (memory leak integration suite)",
      "apps/server/src/modules/key-cortex/eval-harness.service.ts (task-suite fixtures and scorer)",
      "docs/intelligence/research/memory/EVALUATION-PLAN.md (baseline results appended)"
    ],
    "decisions": [
      "D-100",
      "D-226",
      "D-227",
      "D-234",
      "D-238",
      "D-254"
    ],
    "scope": "Build EVALUATION-PLAN.md section 3 (E-TEN, E-REV-DIRECT, E-REV-INDIRECT, E-MEMBERLESS, E-UNCLASS, E-MEMBER for cognition rows under D-130) as a real-database integration suite over every path in the MEM-CENSUS registry, two tenants, three readers. Cases for paths not yet fixed are recorded as it.todo with the owning packet id (never skipped silently). Build the section 5 task suite (about 50 questions on two fixture tenants, versioned) and the E-CONF unanswerable questions as an eval (stubbed model outputs in CI; a live-model run reported, never gating alone), and record the current baseline numbers (accuracy, false-answer rate, tokens per call split P/M/U, latency) in EVALUATION-PLAN.md. Scope rule: the suite is the proof of the scope rule; it reads nothing outside fixture tenants. Schema: none. Backfill: none.",
    "definition_of_done": "GREEN: the leak suite runs in the server suite with every unfixed path as a named it.todo; the eval runs locally and in CI with stubs; baseline numbers recorded with the commit sha and provider prices on the date; proof:release0 MET.",
    "r0_impact": "none: touches no required Release 0 case or closedBy evidence (new suites only)",
    "fixture_prefix": null
  }
]
```

## Dropped after review

MEM-MEMBER-PREFS (member preferences stored per member) was in the first draft. Review found that no live code path writes
a member preference (`storePreference` and `KeyCortexConversationService.addMessage` have no caller at `5c17e7b4`), so
the overwrite defect is not reachable, and replacing AiMemory's compound unique key would break about ten
`businessId_category_key` call sites. It is replaced by a DORMANT entry in MEM-CENSUS; member-scoped AI memory is designed
when a caller is first added.

## Not proposed yet (design work that must first beat the baseline)

Activation-based ranking (design 6.2; E-ABL-1), salience-ordered and regenerate-from-source consolidation (5.2-5.3;
E-ABL-2, E-ABL-4), replacing the nightly confidence decay of old cognition rows with activation decay (5.5; owner
question Q9), the ContextPack budget per task type (6.3; E-ABL-3), quarantine of external content (8.3), intentions (2),
procedure contracts (7), HNSW index and representation spec for embeddings (#153 Layer 5 says benchmark first), and the
Context Genome contracts of plan phases 1 and 4 (#123). Each becomes a packet after MEM-EVAL-SUITE records a baseline, so
that its definition of done can say what it must beat.
