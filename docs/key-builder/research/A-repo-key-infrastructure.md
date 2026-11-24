# Research A: what the product already has for Builder KEY

Read-only survey of the worktree at `scratchpad/wt-key` (2026-11-24), written for `docs/key-builder/KEY-BUILDER-DESIGN-001.md`.
All paths below are relative to the repository root. `S` = `apps/server/src/modules`.

## 0. Headline findings

1. **No builder capability exists in the product today.** There is no GitHub, Octokit, git, pull-request, repository or
   codegen code in `apps/server/src`, `apps/web/src`, `apps/voice-agent` or `packages/*`. The hits for "github" are
   a secret-shape regex (`S/key-cortex/key-cortex-event.service.ts:104`), a social-link regex
   (`S/connect/signature-parser.service.ts:21`), a docs URL (`apps/server/src/core/connectors/implementations/webhook-form.connector.ts:30`) and tests.
   KB-010 therefore starts green and pins a negative.
2. **Business KEY reaches tools through four registries and one wildcard prefix, not one.** A boundary spec that only
   reads `FLOW_TOOLS` misses three of them (section 2).
3. **Business KEY already writes and runs code.** `execute_custom_logic` (`S/ai/flow-tool-registry.ts:4880`) has the
   model write JavaScript that `CodeExecutorService` runs (`S/ai/code-executor.service.ts`). The default `local` backend
   is a child process on the API host with no OS-level isolation. KB-010 has to say whether this counts as a
   "code-writing action". It also means **Builder KEY's credentials and checkouts must never be on a host that runs
   the product API** (section 5).
4. **A coding-agent orchestrator already exists outside the product.** `scripts/agent-control/` (about 3,000 lines:
   `orchestrate.mjs`, `auto-merge-admitted.mjs`, `claude-worker.ps1`, `lib/adapters.mjs`, `lib/semantic-review.mjs`,
   `lib/merge-grant.mjs`) and three `.github/workflows/agent-control-*.yml` (one on an hourly cron) are still wired.
   The design names only `scripts/agent-memory/`. Before KB-002 to KB-006 are written, the owner should decide whether
   to reuse this code or retire it.
5. **The product's spend caps are soft.** When every provider is over budget, `ModelGatewayService` logs a warning and
   sends the request anyway with "degraded routing" (`S/ai/model-gateway.service.ts:889`, `:1113`). Builder KEY needs
   hard caps that stop the call, so it cannot copy these semantics.
6. **Every AI table is keyed to a tenant.** `AiUsageLog`, `AiExecutionLog`, `AiPlan`, `AgentMessage` and
   `AiApprovalItem` all have a required `businessId` with a `Business` foreign key
   (`packages/db/prisma/schema.prisma:4813, 7451, 7495, 7978, 8248`). Builder data has no tenant. Reusing these tables
   would mean a fake "platform business", which mixes builder state with customer state. Reuse the patterns, not the
   tables.

## 1. Module survey

Maturity is shown as src files / spec files / source lines (no specs counted), plus who calls the module.

| Module | What it does | Maturity | For Builder KEY |
| --- | --- | --- | --- |
| `S/ai/model-gateway.service.ts` (3,320 loc) | Multi-provider LLM gateway with routing table per task category, fallbacks, retries, circuit breakers, BYOK per business (encrypted with `BYOK_ENCRYPTION_SECRET`), monthly budget caps per business and provider, streaming with tool calls for OpenAI, Anthropic (raw `fetch`, `:1334`, tools mapped to `input_schema`), xAI, Kimi, Google (OpenAI-compatible endpoint, `:2646`), native and OpenRouter/Ollama. `KEY_DISABLED` kill switch (`:853`). Output contracts (`expectedContract`). | Hot path of every KEY turn. Specs throughout `S/ai`. | **Reuse the design, not the class.** It is business-scoped (`GatewayRequest.businessId` required, preferences and spend read per business), has stale model ids (`claude-3-5-sonnet-20241022`, `gpt-4o`, `moonshot-v1-*`, `gemini-2.0-flash`), single-turn (no agent loop), and soft caps. Good ideas to copy: provider-neutral `GatewayRequest/Response`, circuit breaker per provider, fallback list, refusal shape when no provider is configured, kill-switch check before anything is read. |
| `S/ai/llm-cost.service.ts` | `TOKEN_COST_PER_1K` price table and a cost recorder per call. | Used by the gateway. | **Pattern only.** The table is stale and tenant-keyed. Builder needs its own price table for current models. |
| `S/ai/ai-usage.service.ts` (1,387 loc) | Plan credits per business (`checkCredits` `:513`, `assertCreditsFor` `:501`), in-memory rate limit per business (`checkRateLimit` `:302`), usage history and summaries. | Widely used. | **Pattern only.** Credits come from tenant subscriptions. The hard-refusal shape of `assertCreditsFor` (ForbiddenException before the call) is the semantics Builder caps need. |
| `S/ai/ai-usage-admin.controller.ts` | `api/admin/ai-usage/*`, SUPER_ADMIN only (local `assertSuperAdmin`). | Backs web `/admin/ai-usage`. | **Precedent** for an admin-only spend view at M3. |
| `S/ai/langfuse.service.ts` | Optional, env-gated (`LANGFUSE_*`) tracing over raw HTTP, fire-and-forget. | Called from the gateway's cost recorders. | **Reusable idea.** Builder runs could trace to a separate Langfuse project. Never the product's keys. |
| `S/ai/ai-execution-log.service.ts` | Writes `AiExecutionLog` rows per tool call (tool, tier, actor, input/output summary, duration, plan ids). | Called from `FlowOrchestratorService.executeTool`. | **Pattern only** (tenant FK). The row shape is a good template for a builder run log. |
| `S/ai/ai-oversight.service.ts` (883 loc) | Tier governance: `getToolTier` `:164`, `evaluate` `:179` (role, envelope, autonomy settings, blocked tools/modules, approval levels). | Every chat tool call. | **Boundary asset.** This is where a global builder deny would sit at runtime (section 2). Not reused by Builder. |
| `S/ai/ai-approvals.*`, `S/ai/approval-routing.service.ts`, `S/approvals/` | Approval inbox for AI actions; routing of an approval to a member by delegation rule or job role over WhatsApp/SMS/email; generic multi-step approval requests. | Tenant feature. 2 specs in approvals. | **Keep apart.** Builder approvals are owner rulings on #80 (and later the admin page). Wiring merges into a tenant approval inbox would put a builder action one step from a customer-facing surface. |
| `S/ai/agent-bus.service.ts` | Pub/sub between "agents" over EventEmitter, persisted in `AgentMessage` (tenant FK), 24h TTL. | 9 callers. | **Keep apart.** Tenant-scoped, in-process. |
| `S/ai/agent-state-machine.service.ts` | State of an `AiPlan` (idle, planning, executing, paused, stalled ...). | Plans. | **Pattern only** for run states and checkpoint/resume (Builder's run file in git). |
| `S/ai/agent-trigger.service.ts` | Business automation triggers, with the creator recorded so a plan runs as that member (D-73/D-93). | Tenant feature. | Keep apart. |
| `S/ai/action-dispatcher.service.ts`, `S/ai/queue.service.ts`, `S/ai/plan-executor.service.ts` | Plan steps dispatched through BullMQ (`bullmq` 5.x) with idempotency keys, retries, circuit, "awaiting approval" stops. | Core of KEY plans. | **Pattern only.** BullMQ plus Redis is the product's only durable job runner. There is no Temporal.io, Inngest or similar. Builder's M2 run store can follow the idempotency-key and step-awaiting-approval ideas without sharing the product's queues or Redis. |
| `S/ai/ai-memory.service.ts`, `semantic-memory.service.ts` | Business memory (goals, tone, corrections ...) with embeddings. | Tenant. | Keep apart. Builder memory is git (`docs/development/agent-memory/`). |
| `S/ai/ai-output-contracts.ts` | Typed JSON contracts for model output (intent parse, workflow plan ...) with a validator. | Used by gateway `expectedContract`. | **Reusable pattern** for the machine-readable yaml blocks (CLAIM/RETURN/REVIEW) and reviewer verdicts. A copy, not an import. |
| `S/ai/untrusted-content.ts` | `fenceUntrusted` puts third-party text into a fenced block with an id derived from a content hash and neutralises look-alike markers (D-261). | Used for attachments and MCP output. | **Reusable as a copy.** Builder reviewers read issue comments and repository text. The same fence, around #80 bodies and web pages, is cheap prompt-injection hygiene. It is pure and has no imports to drag in. |
| `S/ai/code-executor.service.ts` + `code-executor.controller.ts` | Runs model-written JS for `execute_custom_logic`. Backends: `local` (child process, `env: {}`, 128 MB, 15 s, `:282`) or E2B microVM when `E2B_API_KEY` and `PUBLIC_API_URL` are set (`:141`, `:203`), with a public token-authenticated tool bridge `POST /code-executor/tool-bridge`. | Reached from the `operator` role. | **Boundary risk** (section 5). E2B (`@e2b/code-interpreter` is already a dependency) is a possible sandbox for Builder reviewers that need no repo, but on Builder's own account. |
| `S/ai/flow-orchestrator.service.ts` (8,854 loc) | The chat runtime: tool menu, model call, governance, dispatch switch over 286 tools. | The core of Business KEY. | **Boundary.** See section 2. |
| `S/ai/role-engine.service.ts` | Roles (`sales` `:228` ... `executive` `:423`), each an `approvedTools` list of names and **wildcards** (`crm_*`, `governance_*`, `automations_*`, `drive_*`, `documents_*`, `fetch_*`). `isToolAllowed` `:728`. | Every turn. | **Boundary risk:** any future tool whose name matches a wildcard is granted silently (section 2). |
| `S/key-autonomy/` (28 src / 14 specs, 5.7k loc) | Action boundary (`action-boundary/`: envelope, fingerprint, control clearance, confirmation TTL, `EXECUTION_SURFACES` `control-clearance.ts:27`), proposals, autonomy levels, safety shell with rollback. | Behind every adopted KEY capability. | **Pattern to copy:** a fingerprinted action envelope, then a clearance decision, then execution, with a refusal code and no side effects on refusal. This maps well onto `kf gate` / merge (D-239). `EXECUTION_SURFACES` is also the list KB-010 must cover. |
| `S/key-cortex/` (147 src / 124 specs, 78.7k loc) | KEY's "brain": its own organ tool registry (`key-cortex-tool-registry.service.ts`), tool loop (`key-cortex-tool-loop.service.ts`), sagas, compensation, idempotency, audit (`CortexActionLog`), WebSocket gateway, plus many cognitive services. Also `key-cortex-sandbox.service.ts` (SQL/JS/Python executor; its execute and auto routes now answer 410, `key-cortex.controller.ts:3366-3400`) and `key-cortex-safe-database.service.ts` (`cortex.query_business_data` / `cortex.update_record`, `:212`, `:238`). | Heavily tested. | **Boundary.** It is a second tool registry reachable by tenant KEY (section 2). The sandbox is closed now and pinned by `key-cortex-code-execution.spec.ts`. Reusable pattern: `key-idempotency.service.ts` (request fingerprint, replay). |
| `S/key-connector/` (12 src / 2 specs) | Business integrations (`providers/provider-registry.service.ts`: Google, Outlook, WhatsApp, Stripe, WiPay, Typeform, Jotform, Mailchimp, SendGrid, Slack, Zapier) and a keyword "AI gateway" that routes commands to modules. Exposed to KEY as a cortex organ. | Lightly tested. | **Boundary risk:** a third registry. A GitHub "provider" must never be added here, because it would become a KEY organ. |
| `S/key-inbox/` | Unified business inbox with intelligence, reply sender, and actions bridged into KEY (`inbox_*` via `CORTEX_TOOL_BRIDGE`). | Tenant. | Keep apart. It is one of the doors untrusted customer text comes through. |
| `S/keyflow-command/` (5 src / 0 specs) | `api keyflow`: notes and voice command surface. | Tenant. | Keep apart. |
| `S/flow/` (17 src / 2 specs), `S/flow-signal/` (8 / 4) | Business automation engine (flows, runner, templates, cross-module agent) and signal routing to roles. | Tenant. | Keep apart. No outbound HTTP or webhook action found in these paths (`fetch(` / `axios` grep empty), so automations cannot call GitHub today. |
| `S/mcp/` (3 src / 1 spec) | **MCP client only.** Static allowlist of remote Streamable-HTTP servers from `MCP_REMOTE_SERVERS` (`mcp.types.ts`), each bound to `businessIds` (D-261/D-262). Tools are named `mcp__{key}__{tool}`. `callTool(businessId, ...)` `:158`, `listBridgedTools` `:144`. The chat menu deliberately does not advertise MCP tools (`flow-orchestrator.service.ts` ~`:1916`), but `executeToolAction` routes any `mcp__*` name before its switch (`:4130`). `MCP_REMOTE_SERVERS` is empty in every environment (owner question OQ-1). No MCP *server* exists in the product. | Uses `@modelcontextprotocol/sdk` 1.29. | **Boundary risk (highest config risk).** Setting `MCP_REMOTE_SERVERS` to a GitHub MCP server bound to one business would give that tenant's KEY repository tools through plan steps and graph actions, with no code change. KB-010 should pin this (section 2). Not reusable by Builder: Builder talks to tools through its CLI and runners, not the product. |
| `S/autopilot/` (5 / 3) | Delegation loops (payment recovery, lead reactivation ...). | Tenant. | Keep apart. |
| `S/governance/` (4 / 0) | Business **risk register** (`governance_*` tools). Not AI governance. | Tenant. | Keep apart. Its `governance_*` wildcard is granted to the `general` and `operations` roles. |
| `S/temporal/`, `S/temporal-flow/` | Time-based business overview and a timeline event store. **Not Temporal.io.** | Tenant. | Not a durable workflow engine. Nothing to reuse. |
| `S/keystore/` | "KeyStore" service marketplace (listings, orders, deliveries) behind `AuthGuard, BusinessGuard`. | Tenant. | Unrelated (name clash only). |
| `S/api-keys/` (3 / 0) | Per-business API keys (`kf_` + 32 random bytes, hashed, prefix, scopes). `validateKey` exists but **no guard consumes it**: there is no API-key auth path today. | Tenant settings. | Keep apart. Builder gets its own credentials (GitHub App) per the design. |
| `S/admin-auth/` (3 / 1) | Admin local login (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`), HMAC admin token, Redis revocation cutoff. `AuthMiddleware` accepts it and re-reads the User row's role every request (`core/auth/auth.middleware.ts:554-580`). | Used by web `/admin/login`. | **Reuse at M3** for owner sign-in. |
| `S/admin-platform/`, `S/admin-analytics/` | `api/admin/{businesses,users,events,analytics}`, all `@UseGuards(AuthGuard, AdminGuard)`. GDPR purge. | No specs in admin-platform. | **Reuse at M3:** the guard pair and route prefix `api/admin/*`. |
| `S/feature-flags/` (3 / 0) | `FeatureFlag` (key, label, comingSoon, bypassEmails) with admin CRUD at `api/admin/feature-flags` (SUPER_ADMIN check inline). | Web `/admin/feature-flags`. | **Reusable** to hide the M3 Builder nav item until it ships. Not a security control. |
| `S/diagnostics/` (3 / 0) | SUPER_ADMIN `api/diagnostics/run|infrastructure`: DB, Supabase, storage, queues, and live provider checks (`checkOpenAI` calls the real OpenAI API, `checkStripe`, `checkPayPal` ...). | Web `/admin/system`. | **Guard against:** Builder must never call it. It sends real provider traffic. Worth adding to `kf gate` check 6 (forbidden targets). |

## 2. The tool registry Business KEY uses, and where KB-010 goes

### 2.1 The registries a tenant turn can reach

| # | Registry | Where | How a tenant turn reaches it |
| --- | --- | --- | --- |
| R1 | `FLOW_TOOLS` (286 tools, canonical per ADR-0001) | `S/ai/flow-tool-registry.ts:81`; helpers `getOpenAiToolDefinitions` `:6132`, `getToolByName` `:6143` | Chat menu `FlowOrchestratorService.selectToolsForRequest` (`flow-orchestrator.service.ts:1863`), then `governToolCall` `:3244`, `executeTool` `:3667`, `executeToolByName` `:3798` (phone stream, custom-logic inner calls), and the dispatch switch `executeToolAction` `:4119` |
| R2 | `CORTEX_TOOL_BRIDGE` (4 `inbox_*` names) | `flow-tool-registry.ts:6121` | The `default:` of the switch, `flow-orchestrator.service.ts:8012`, then `executeBridgedCortexTool` `:8052` |
| R3 | `KeyCortexToolRegistryService` (organ tools) | `S/key-cortex/key-cortex-tool-registry.service.ts` (`register` `:349`, `registerMany` `:389`, `listTools` `:411`, `execute` `:476`, `buildGatewayDefinitions` `:767`) | Filled at boot by `KeyCortexOrganRegistrarService.onModuleInit` (`key-cortex-organ-registrar.service.ts:52`: temporal-flow, key-inbox, key-genome, storelink, key-connector organs plus the two safe-database tools), by `KeyCortexActionsService.registerLegacyTools` (`key-cortex-actions.service.ts:147`: 16 `cortex.*` tools including `cortex.execute_tool` and `cortex.query_database`), by `KeyCortexEfferentBridgeService.registerFlowTools` (`key-cortex-efferent-bridge.service.ts:101`: mirrors all of `FLOW_TOOLS`) and by `KeyCortexActionExecutorPlugin`. Run by the cortex tool loop (`key-cortex-tool-loop.service.ts`) |
| R4 | `KeyToolRegistryService` (14 `module.name` tools: finance, contacts, commerce, timeline, connect, messages, social) | `S/ai/key-tool-registry.service.ts:475-505` | `KeyCommandService` (`key-command.service.ts:222`) and `KeyCortexActionsService` (`:120`) |
| R5 | Remote MCP tools, `mcp__{server}__{tool}` | `S/mcp/mcp.types.ts` (`loadMcpServerConfigs` `:64`, `isMcpToolName` `:123`), `S/mcp/mcp-client-manager.service.ts` | `executeToolAction` routes them first (`flow-orchestrator.service.ts:4130`). `graph-actions.controller.ts:556` accepts them as tool names. Not on the chat menu today |
| — | Voice agent | `apps/voice-agent/src/main.ts:98` | One tool, `transferToHuman` |

### 2.2 How a tool is scoped per tenant today

Every dispatch takes `businessId` first. Over that, these layers apply in this order:

1. **Role.** `RoleEngineService.crewAllows` / `isToolAllowed` (`role-engine.service.ts:669`, `:728`), with name
   wildcards.
2. **Position envelope** for the WhatsApp/SMS staff bridge (`structure/job-role-policy.service.ts`, `isToolAllowed`).
3. **Member scopes.** `memberToolScopeReader` + `keyMemberMenuScopes` on the menu (`flow-orchestrator.service.ts:1897-1906`),
   and `memberScopeRefusal` (`:3838`) at every dispatch door.
4. **No member.** A turn with no member gets only `MEMBERLESS_KEY_TOOLS` (`S/ai/memberless-key-tools.ts:38`,
   `memberlessKeyToolRefusal` `:79`), denied by default. It is pinned by `memberless-key-allowlist.spec.ts`.
5. **Tier governance and the action boundary.** `AiOversightService.evaluate` (`ai-oversight.service.ts:179`),
   `KeyActionBoundary` (`S/key-autonomy/action-boundary/`), and the cortex registry's `checkRisk` (`:969`) and safety
   check (`:491`).
6. **MCP.** Bound per business in config (`businessIds`).
7. **Custom logic.** `execute_custom_logic` inner calls go back through `executeToolByName` with surface `CUSTOM_LOGIC`
   and the outer member's scope (`flow-orchestrator.service.ts:7437-7458`). The executor blocks only
   `execute_custom_logic` itself (`code-executor.service.ts:21`).

**Gaps that matter for KB-010:**

- **Wildcards.** `general` (`role-engine.service.ts:370`) and `operations` (`:305`) grant `governance_*`,
  `automations_*`, `drive_*`, `documents_*`, `content_*`, `structure_*` and `fetch_*`. A future tool named, say,
  `automations_open_pr` or `fetch_repo_file` would reach every member's chat with no role edit.
- **MCP.** The `mcp__*` path is config-gated, not code-gated. One env change can expose a repository MCP server.
- **R3.** R3 mirrors R1 and adds its own tools. A builder tool registered as an organ would never appear in
  `FLOW_TOOLS`.

### 2.3 Exact place and shape for the KB-010 spec

**File:** `apps/server/src/modules/ai/builder-boundary.spec.ts` (new). It sits next to the pattern it follows,
`S/ai/memberless-key-allowlist.spec.ts`, plus `role-tool-reachability.spec.ts` and `flow-tool-registry.spec.ts`.
`test:unit` picks it up (`include: src/**/*.spec.ts`). Like the PR195 suites it is not manifest-bound, so Release 0 is
not touched (V1-PLAN-RECUT.json:40). The spec should use only static imports and `Object.create(Prototype)` fakes,
as `tool-name-collision.spec.ts` and `role-tool-reachability.spec.ts` already do. No DB.

Suggested cases. Each one fails on a hit. A single shared predicate `isBuilderCapability(name, description)` covers
names and descriptions matching git, github, repo(sitory), pull request, PR, commit, push, merge, branch, deploy,
shell, exec(ute) command, file write, codegen, source code, `kf `, CI and workflow-dispatch, with a reviewed exceptions
list (for example the business "workflow" and "deploy" meanings, if any).

| Case | Asserts | Reads |
| --- | --- | --- |
| KB-010-01 | No `FLOW_TOOLS` entry matches the predicate | `FLOW_TOOLS` (`flow-tool-registry.ts:81`) |
| KB-010-02 | No `CORTEX_TOOL_BRIDGE` key or target matches | `flow-tool-registry.ts:6121` |
| KB-010-03 | No `KeyToolRegistryService.listTools()` entry matches | Construct with fakes (`key-tool-registry.service.ts:479`) |
| KB-010-04 | No organ, legacy or safe-database tool registered into `KeyCortexToolRegistryService` matches | Run `KeyCortexOrganRegistrarService.onModuleInit` against a recording fake registry with each adapter's real `listTools()`, plus `KeyCortexActionsService.prototype.registerLegacyTools` on a fake |
| KB-010-05 | Every role's `approvedTools` pattern, expanded against R1 to R4, yields no builder tool, **and** no pattern is a bare `*` or `mcp__*` | `RoleEngineService` role table; `isToolAllowed` |
| KB-010-06 | `MEMBERLESS_KEY_TOOLS` contains no builder tool (belt and braces) | `memberless-key-tools.ts:38` |
| KB-010-07 | MCP: with `MCP_REMOTE_SERVERS` naming a server whose url host is `api.github.com`, `github.com`, `api.githubcopilot.com`, or whose key or tools match the predicate, either `loadMcpServerConfigs` drops it, or `selectToolsForRequest` / `executeToolAction` refuse its tools. **This needs one product line** (a host and name deny in `mcp.types.ts`), so KB-010 is a test plus a small guard, not a pure spec. The owner should rule on this. | `S/mcp/mcp.types.ts:64`, `flow-orchestrator.service.ts:4130` |
| KB-010-08 | No repository credential is read by the product: grep `apps/server/src` (non-spec) for `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_APP_`, `KB_`, `BUILDER_` env reads and `@octokit`, `simple-git`, `isomorphic-git` imports, and `apps/server/package.json` for those dependencies. Source-level, as `key-cortex-code-execution.spec.ts` does it | file reads |
| KB-010-09 | `execute_custom_logic`: pin the decision. Either (a) it is the one allowed code-writing action, with its executor's backend and `BLOCKED_TOOLS` pinned and its inner calls proven to resolve only through `getToolByName` (R1), or (b) the owner rules it out. The spec must name it explicitly, otherwise the literal rule "no code-writing action reachable" fails on day one | `code-executor.service.ts`, `flow-tool-registry.ts:4880` |
| KB-010-10 | Every `EXECUTION_SURFACES` entry (`control-clearance.ts:27`) is covered by the dispatch doors above (a new surface fails the spec until reviewed) | `control-clearance.ts` |

**Runtime enforcement, if wanted later:** add a `builderCapabilityRefusal(name)` check at the same three places
`memberlessKeyToolRefusal` already runs: the menu (`selectToolsForRequest` `:1897-1906`), `executeTool` /
`memberScopeRefusal` (`:3838`) and `executeToolByName` (`:3798`). Also add it to `KeyCortexToolRegistryService.register`
(`:349`) so no organ can register one. That is product code, so it is a separate packet.

## 3. Model providers, keys and limits

**SDKs in the product:** only `openai` ^4.96 (`apps/server/package.json`), reused for xAI, Kimi (`api.moonshot.cn`),
Google (`generativelanguage.googleapis.com/v1beta/openai/`), native, OpenRouter and Ollama by `baseURL`. Anthropic is
called with raw `fetch` to `api.anthropic.com/v1/messages` (`model-gateway.service.ts:1403`, `:2382`), with tool use and
streaming. There is no `@anthropic-ai/sdk`, `@google/*`, `@ai-sdk/*`, `ai` (Vercel), `langchain` or `@octokit/*`
anywhere. Other AI dependencies: `@e2b/code-interpreter` ^2.6, `@modelcontextprotocol/sdk` ^1.29,
`livekit-server-sdk`; `apps/voice-agent` has `@livekit/agents` plus `@livekit/agents-plugin-openai`.

`AiProvider = 'openai' | 'anthropic' | 'xai' | 'kimi' | 'google' | 'native' | 'opensource'` (`model-gateway.service.ts:10`).

**Key names** (names only, from `.env.example` and the code): `AI_INTEGRATIONS_OPENAI_API_KEY`,
`AI_INTEGRATIONS_OPENAI_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `KIMI_API_KEY`,
`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `KEYFLOW_NATIVE_AI_URL`, `NATIVE_AI_BASE_URL`, `NATIVE_AI_API_KEY`,
`OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `BYOK_ENCRYPTION_SECRET` (per-business keys stored encrypted in AI
preferences), `E2B_API_KEY`, `PUBLIC_API_URL`, `CODE_EXECUTOR_BACKEND`, `MCP_REMOTE_SERVERS` (plus a per-server
`tokenEnvVar`), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `KEY_DISABLED`, `AI_DISABLED`,
`AI_USAGE_ALERT_SCHEDULER_DISABLED`.

**Consequence for Builder:** Builder's keys must use **different env names** (for example a `KB_` prefix) and live on a
different host. If the product process ever had `ANTHROPIC_API_KEY` set to Builder's key, every tenant's KEY would
spend from it. The gateway reads these names directly (`:771-789`, `:2072-2090`).

**Limits already implemented (all per business):**

- Monthly `BudgetCaps` overall and per provider (`:245`), enforced by `filterCandidatesByBudget` (`:1891`). They are
  **soft**: over budget, the call still goes out with degraded routing (`:889`, `:1113`).
- Plan credits (`ai-usage.service.ts:501-560`), hard (403) for billable features only.
- In-memory rate limit per minute per business (`:302`).
- Usage alert scheduler (`ai-usage-alert-scheduler.service.ts`).
- Circuit breakers per provider and per BYOK key (`:2100`, `:3239-3300`).
- `KEY_DISABLED` refuses before anything is read (`:853`).

None of these is per run, per packet or per day, which is what design section 6 needs.

## 4. Admin surfaces (for the M3 page)

**Server.**

- Gate: `AdminGuard` (`apps/server/src/core/auth/admin.guard.ts`) requires `req.user.role === 'SUPER_ADMIN'`. It is
  used as `@UseGuards(AuthGuard, AdminGuard)` on `api/admin/businesses|users|events|analytics`
  (`S/admin-platform/*.controller.ts`, `S/admin-analytics/admin-analytics.controller.ts:13`).
- A few controllers check inline instead: `ai-usage-admin.controller.ts:15`, `feature-flags.controller.ts:40`,
  `diagnostics.controller.ts:20`.
- `req.user.role` comes from the `User` row on every request (`auth.middleware.ts:548`, `:577`), for either a
  Supabase token or the admin local token (`admin-token.util.ts`, revocable).
- `SUPER_ADMIN` is a plain `User.role` string (`schema.prisma:109`, `// USER | SUPER_ADMIN`). It also **bypasses
  `BusinessGuard` and `ModuleScopeGuard` in every tenant** (`business.guard.ts:94,120`, `module-scope.guard.ts:68`).

**Web.**

- Pages: `apps/web/src/app/admin/` ("Owner Console") with `page.tsx`, `users`, `businesses`, `analytics`, `ai-usage`,
  `events`, `system`, `feature-flags` and `login`. The nav list is in `apps/web/src/app/admin/layout.tsx:23-32`.
- The gate is **client-side only.** The layout's `useEffect` calls `isSuperAdmin()` (`apps/web/src/lib/workspace.ts:493`,
  which reads a cached user from localStorage, including `kf_auth_mode=admin`) and redirects to `/admin/login`.
  `apps/web/src/middleware.ts:144` matches only `/app/:path*`, so `/admin/*` HTML is served to anyone. Everything real
  is enforced by the server guards.

**Where Builder's page goes at M3:**

- Web: `apps/web/src/app/admin/builder/page.tsx` (plus `loading.tsx` / `error.tsx` as its siblings have), and one entry
  in `navItems` (optionally hidden behind a `FeatureFlag`).
- Server: a thin `api/admin/builder/*` controller with `@UseGuards(AuthGuard, AdminGuard)` that proxies to the
  separate Builder service. The Builder service credential stays server-side and never reaches the browser.

**Recommendations for that page:**

- Pin the owner more tightly than "any SUPER_ADMIN", for example an allowlisted user id, because the role is a mutable
  DB string that also grants tenant-wide bypass.
- Require a recent sign-in (step-up) for Stop, merge-go and cap raises.
- Do not import any `S/ai` or `S/key-*` module into the builder controller's Nest module, so a builder route can never
  inject KEY services (KB-010-08 can grep for this).

## 5. Anything resembling coding-agent orchestration or self-modification

| Item | Where | Risk note |
| --- | --- | --- |
| `execute_custom_logic` + `CodeExecutorService` | `S/ai/flow-tool-registry.ts:4880`; `S/ai/code-executor.service.ts`; granted to the `operator` role only (`role-engine.service.ts:405`); deliberately kept off `general` (`:360-369`); refused to memberless turns; graph route refuses it (`graph-actions.controller.ts:165-169`) | Model-written JS. The `local` backend (default unless E2B is configured) is `spawn(process.execPath, [harness])` with `env: {}` and parameter-shadowed globals (`:46-64`, `:282-290`). Shadowing does not stop `Function('return process')()` or `process.mainModule.require('fs')`, so a snippet can read the API host's files and open network connections. If a Builder checkout, `gh` login, GitHub App key or `KB_*` keys ever sat on an API host, one prompt-injected operator turn could reach them. **Rule: Builder never runs on, or deploys credentials to, a product API host.** Also consider asking the owner to force `CODE_EXECUTOR_BACKEND=e2b` in production (out of KB-010's scope). |
| `KeyCortexSandboxService` | `S/key-cortex/key-cortex-sandbox.service.ts` (SQL, JS via `node:vm`, Python child process, HTML) | `sandbox/execute` and `sandbox/auto` answer 410 (`key-cortex.controller.ts:3366-3400`, V1-31c). `sandbox/generate` (model writes code, does not run it) and templates remain. Pinned by `key-cortex-code-execution.spec.ts`. Keep it pinned. KB-010 can reference it. |
| `key-cortex-flow-studio.service.ts` | `new Function` over flow-authored strings | Pinned closed by the same spec. |
| `cortex.execute_tool`, `cortex.query_database`, `cortex.update_record` | `key-cortex-actions.service.ts:147-167`; safe-database (`:212`, `:238`) | Generic "run any registered tool" and model/field allow-listed DB access. Business-scoped. If a builder tool ever entered R3, `cortex.execute_tool` would reach it by name, which is why KB-010-04 covers R3. |
| MCP client | `S/mcp/` | Config-only path to arbitrary remote tools for a bound business (see KB-010-07). |
| "Self-improvement" in the cortex | `key-cortex-evolution.service.ts` (preference learning from accept/reject), `self-assessment.service.ts`, `value-learning.service.ts`, `key-cortex-reflection.service.ts`, `key-cortex-consciousness.service.ts:228` | **Data-only learning per business** (memories, preferences, scores). None writes code, prompts-as-code or config files. Naming collision only. KB-010 should say "self-improvement" means Builder's repository work, not these. |
| AI "agents" in the product | `agent-bus`, `agent-state-machine`, `agent-trigger`, `agent-health`, `agent.controller.ts`, `flow/cross-module-agent.service.ts`, `apps/voice-agent` | Business automation agents. No repository or shell access. |
| **Existing repo-level orchestrator** (outside the product) | `scripts/agent-control/`: `orchestrate.mjs` (next legal control action from programme state and #80), `select-directive.mjs` (which #80 message may wake a worker; allowlisted authors), `claude-worker.ps1` (1,104 lines, a non-interactive Claude worker holding `gh` and git, with install/uninstall scripts), `auto-merge-admitted.mjs` (exact-head admission and merger), `lib/adapters.mjs` (vendor-neutral roles, "no adapter reviews its own work", missing credential means `WAITING_EXTERNAL_AGENT`), `lib/semantic-review.mjs` (independent review with copilot primary and chatgpt fallback), `lib/merge-grant.mjs`, `negative-controls.yaml` + `proof-mutation.mjs`, tests under `tests/`. Workflows: `.github/workflows/agent-control-autopilot.yml` (PR, issue_comment, `pull_request_target`, **hourly cron**), `agent-control-gate.yml`, `agent-control-worker-proof.yml`. Last change 2026-11-13 (the tie-off). | **Highest reuse value and highest drift risk.** It already implements much of `kf gate` (exact-head CI, independent review records, merge records) and the runner adapter contract. Building `scripts/key-builder/` beside it gives two orchestrators with different rules. Also check whether the hourly autopilot and `pull_request_target` workflow are still meant to run while Builder KEY takes over. Recommend a short ruling: adopt `lib/adapters.mjs`, `admission.mjs`, `merge-grant.mjs` and `semantic-review.mjs` as the base for KB-002/KB-004, or retire them explicitly. |
| Secret-shape detection | `S/key-cortex/key-cortex-event.service.ts:96-116` (`SECRET_SHAPES`: Stripe, GitHub `ghp_` / `github_pat_`, AWS, Slack, OpenAI / Anthropic `sk-`, Twilio, JWT, PEM, long hex and encoded runs) | **Reusable as a copy** for `kf gate` check 5 (no secrets). It is tuned for values rather than diffs, so add `.env` line detection. |
| Tool-route CI check | `apps/web/scripts/check-tool-routes.ts` | Precedent for a CI script over `FLOW_TOOLS`. KB-010 could be wired the same way if a spec alone is not enough. |

## 6. Reuse / keep apart / guard summary

**Reuse (copy the pattern, not the import):**

- Gateway shape and circuit breaker (`model-gateway.service.ts`).
- Untrusted-content fence (`S/ai/untrusted-content.ts`).
- Output contracts plus validator (`ai-output-contracts.ts`).
- Action envelope plus clearance (`S/key-autonomy/action-boundary/`).
- Idempotency fingerprint (`key-cortex/key-idempotency.service.ts`).
- Secret shapes (`key-cortex-event.service.ts`).
- Langfuse shim.
- Admin guard pair and `api/admin/*` / `app/admin/*` placement.
- `FeatureFlag` for nav hiding.
- E2B dependency as a possible sandbox on Builder's own account.
- Above all, `scripts/agent-control/lib/*` (adapters, admission, merge grant, semantic review), subject to an owner
  ruling.

**Keep apart (tenant-scoped, would mix concerns):**

- All `S/ai`, `S/key-*`, `S/flow*`, approvals, autopilot and governance services.
- The `AiUsageLog`, `AiExecutionLog`, `AiPlan`, `AgentMessage` and `AiApprovalItem` tables.
- BullMQ queues and Redis.
- BYOK preferences.
- The product's provider env names.

**Guard against (KB-010 and operations):**

- The four registries plus MCP.
- Role wildcards.
- `MCP_REMOTE_SERVERS`.
- `execute_custom_logic` with the local backend on a shared host.
- Shared provider key names.
- `SUPER_ADMIN`'s tenant-wide bypass.
- `api/diagnostics/run` (real provider traffic).
- The client-only `/admin` web gate.
