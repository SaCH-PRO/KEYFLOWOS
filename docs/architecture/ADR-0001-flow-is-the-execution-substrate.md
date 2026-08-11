# ADR-0001 — Flow is the single execution substrate; Cortex is advisory

- **Status:** Accepted (2026-08-11)
- **Context source:** `docs/audits/KEY_EFFECTIVENESS_RATING.md` (the two-stack duplication is the #1 structural liability)
- **Decision owner:** product/architecture (direction chosen: *Flow is the substrate*)

## Context

KeyFlowOS runs **two parallel AI stacks** that duplicate the same responsibilities:

| Concern | `ai/` — "Flow" | `key-cortex/` — "Cognition" |
|---|---|---|
| Orchestrator | `flow-orchestrator` (6586 L) | `key-cortex-reasoning` + `key-cortex-query-pipeline` |
| Tool registry | `flow-tool-registry` (~282 tools) | `key-cortex-tool-registry` (**already proxies FLOW tool names**) |
| Executor | `plan-executor` / `code-executor` | `key-cortex-executor` + `saga-executor` |
| Approvals | `ai-oversight` (enforced, fails closed) | `key-cortex-approval-orchestrator` |
| Memory | `ai-memory` + `semantic-memory` | `key-cortex-memory` + `unified-memory-*` |
| Sandbox | `code-executor` (E2B + local, hard timeout) | `key-cortex-sandbox` (regex-blocklist isolation) |
| Capability catalog | `flow-tool-registry` + `capability-map` | `key-cortex-capability-registry` |

They **coexist rather than compose**: the seam (`CORTEX_TOOL_BRIDGE`, `flow-tool-registry.ts:6031`) wires only **4 tools**. Governance is genuinely enforced and fails closed *only* on the Flow side (`flow-orchestrator.ts:1766` → `ai-oversight.ts:321`); the cortex sandbox isolation is weaker; the cortex chat path (`key-cortex.controller.ts:920`) does not pass through the Flow governance gate.

## Decision

**`ai/` (Flow) is the single execution and governance substrate. `key-cortex/` is demoted to an advisory cognition provider** — deliberation, capability catalog, and memory retrieval — that Flow may call **behind** its governance gate. Cortex may *propose*; it may not *execute*.

This keeps the strongest-tested, actually-governed code as the core and removes duplication over time, without a risky big-bang merge.

### Invariants (the boundary contract)

1. **All tool execution flows through `flow-orchestrator` and is gated by `ai-oversight` before it runs.** No execution path may bypass this gate.
2. **Cortex is proposal-only.** Cortex services may return proposals/analysis; they must not dispatch tools, move money, or mutate business data directly.
3. **One tool source of truth: `FLOW_TOOLS`.** The cortex tool registry becomes a thin adapter over FLOW tool names (it already resolves to them), not a second catalog.
4. **One capability model:** `docs/architecture/capability-map` (the M0 seed). The cortex capability registry is reconciled into it, not maintained in parallel.
5. **New code must not import cortex execution/sandbox/approval services for execution.** Advisory (reasoning/memory-retrieval/capability-catalog) imports are allowed.

## Migration ledger

Evidence-based, ordered by **safety first** (fewest external consumers → most). Each item is a separate PR with tests. Nothing below is deleted while a live consumer remains.

| # | Item | Flow winner | Cortex twin | Live consumers of the twin | Class | Effort | Risk |
|---|---|---|---|---|---|---|---|
| 1 | **Sandbox** | `code-executor` (E2B+local) | `key-cortex-sandbox` | `key-cortex.controller.ts` — 5 endpoints: `sandbox/generate`, `/execute`, `/auto`, `/templates`, `/apply` | **Unify the *isolation backend* onto `code-executor` (stronger than the cortex regex-blocklist); keep cortex's codegen/template layer on top.** Not a swap — cortex-sandbox has surface `code-executor` lacks. | M | Med |
| 2 | **Tool registry** | `flow-tool-registry` | `key-cortex-tool-registry` | Flow + cortex internals; **already proxies FLOW names** | Make cortex registry a thin adapter; single source = `FLOW_TOOLS` | S–M | Low |
| 3 | **Capability catalog** | `capability-map` seed | `key-cortex-capability-registry` | `key-cortex-connector.service.ts` only | Reconcile into the M0 capability model; keep as advisory read | S | Low |
| 4 | **Executor** | `plan-executor` / orchestrator | `key-cortex-executor` + `saga-executor` | cortex reasoning, gateway, command-execution | Route execution through Flow; keep saga-compensation *concept* | M | Med |
| 5 | **Reasoning / chat** | `flow-orchestrator` | `key-cortex-reasoning` + `query-pipeline` | `key-cortex.controller.ts:920` (**live chat endpoint**) | Keep reasoning as an *advisory deliberation* provider Flow calls; route the cortex `/chat` endpoint through Flow's governed loop | M | Med |
| 6 | **Approvals** | `ai-oversight` (fails closed) | `key-cortex-approval-orchestrator` | `ai.controller`, `pro-auto-monitor`, `approvals/approval-request`, cortex controller | Single verdict source = `ai-oversight`; approval-orchestrator becomes a proposal-*router* only | L | High |
| 7 | **Memory** | `ai-memory` + `semantic-memory` | `key-cortex-memory` + `unified-memory-*` | cortex internals | One retrieval interface; dedupe writers; keep richer retrieval behind it | M | Med |

**Sequencing rationale:** items 2–3 are near-zero-consumer and reduce surface immediately, so they now lead. Item 1 (sandbox) turned out larger than first scoped — the cortex sandbox exposes a codegen/template layer (`generate`/`auto`/`templates`/`apply`) beyond `code-executor`'s execute-only surface — so it is a *backend unification behind the existing endpoints*, not a deprecation. Item 6 (approvals) is last: it has the most consumers and touches the governance gate, so it moves only once the others have shrunk the cortex execution surface. Item 5 must preserve the live cortex `/chat` behaviour — migrate the endpoint, don't drop it.

**Recommended first PR:** item 2 (tool-registry adapter) — lowest risk, and the cortex registry *already* resolves FLOW tool names, so collapsing to a single source of truth is mostly deletion of a parallel catalog, not new behaviour. Then item 3, then a CI import-boundary guard (invariant 5).

## Consequences

- **Positive:** one governed execution path; the fail-closed gate becomes the *only* gate; duplication shrinks item by item; the M0 capability model has a single substrate to bind to.
- **Cost:** cortex's richer cognition is deliberately subordinated to Flow's governance — some "autonomous cortex" ambitions are explicitly deferred behind the gate.
- **Non-goal:** deleting cortex. Its deliberation, memory retrieval, and capability catalog remain — as advisory providers, invoked behind Flow, never as a second executor.

## Enforcement

- This ADR is the reference for reviews. A PR that adds a new execution/approval path in `key-cortex/`, or imports a cortex executor/sandbox into `ai/` for execution, contradicts invariants 1–2 and 5 and should be rejected or reworked.
- Follow-up: a CI import-boundary check encoding invariant 5 (allowlist the existing bridge, block new violations) — tracked as a ledger-adjacent task, added once item 1 lands so the allowlist is minimal.
