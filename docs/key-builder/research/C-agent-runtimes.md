# C. Agent runtimes for Builder KEY: research report

Research for `docs/key-builder/KEY-BUILDER-DESIGN-001.md` (Layer 2, runners; section 6, models and spend).
Written 2026-11-24. Read-only research: no repository, git or issue was touched.

## 0. How this was done, and what could not be read

- Primary sources first: the vendors' documentation sites and the tools' own GitHub repositories (raw files and
  source code where the doc site was unreachable). Every claim below carries its source URL and the version or date
  read.
- This session's network allowlist blocked several primary hosts: `ai.google.dev`, `antigravity.google`,
  `developers.openai.com`, `discuss.ai.google.dev`, `moonshotai.github.io`. For those, the report uses the tools'
  GitHub repositories (raw docs and source) where they exist, and search-engine extracts of the official pages
  otherwise. Every figure that rests only on a search extract or a third-party page is marked **(unverified)**.
  Before a cap or contract decision depends on it, re-read it on the primary page.
- Versions current on 2026-11-24: Claude Code 2.1.331 (installed here); Gemini CLI v0.71.0 stable, v0.72.0-preview.0
  (both released 24 Nov 2026); Codex CLI 0.172.0 (24 Nov 2026); Kimi Code CLI (the Python Kimi CLI is archived);
  Antigravity CLI `agy` (1.4.x per search extracts); MCP schema 2026-07-28.

## 1. The answer in one table

| | Start from a script | Machine result | Restrict | Automation auth that fits the owner's rule | Limit signal a runner can read | Fit for Builder KEY |
| --- | --- | --- | --- | --- | --- | --- |
| **Claude Code** (CLI 2.1.331) | `claude --bare -p "<prompt>"` with cwd = worktree | `--output-format json` or `stream-json`; `result` message with `subtype`, `is_error`, `total_cost_usd`, `num_turns`, `session_id`, `permission_denials`, `structured_output` (`--json-schema`) | `--tools`, `--allowedTools`/`--disallowedTools` rules, `--permission-mode dontAsk`, `--permission-prompts none`, `--settings` with `sandbox` (bubblewrap + domain proxy), `--strict-mcp-config` | `ANTHROPIC_API_KEY` from a dedicated Console workspace with its own spend limit; `--max-budget-usd` per run | `system/api_retry` events with `error: rate_limit/overloaded/billing_error`; `rate_limit_event`; result subtypes `error_max_budget_usd`, `error_max_turns`, `error_during_execution`; API 429 `error_code: enforced_spend_limit_reached` | **Best fit today.** First runner (M0) |
| **Claude Agent SDK** (TS `@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`) | `query({prompt, options:{cwd,...}})` | typed `SDKResultMessage` (same fields), `SDKRateLimitEvent` | same as CLI plus `canUseTool` callback and in-process hooks | API key only for anything that is "a product or service" (Anthropic policy) | typed events, `AbortController` | The M2 Foreman service runner |
| **Gemini CLI** (v0.71.0) | `gemini -p "<prompt>" -o json --approval-mode yolo --skip-trust` (cwd = worktree) | `-o json`: `{response, stats, error}`; `-o stream-json`: `init/message/tool_use/tool_result/error/result` | Policy engine TOML rules (`deny/allow/ask_user`, `commandPrefix`, `argsPattern`, headless-only rules), `--sandbox` (docker/podman/runsc/seatbelt), `--allowed-mcp-server-names` | `GEMINI_API_KEY` (paid tier) or Vertex AI (service account / ADC) | exit codes 0/1/41 auth/42 input/44 sandbox/52 config/53 turn limit/54 tool/55 untrusted/130 cancel; 429 `RESOURCE_EXHAUSTED` inside `error` or stderr (exit 1, no dedicated code) | **Second runner (M1), as the owner ruled** |
| **Antigravity** (`agy`, Antigravity 2.0) | `agy -p "<prompt>" --output-format json` | JSON envelope / NDJSON **(unverified field list)** | `--mode plan/accept-edits/auto`, `--sandbox`, `--dangerously-skip-permissions` **(unverified)** | Consumer plans: wrapping `agy` in third-party agents or automating account rotation is "not supported" (Antigravity FAQ, via search extract). Enterprise: ADC (`AGY_ADC_AUTH=true`), or a Gemini API key | not documented in what could be read | **Interactive tool only, until Google confirms otherwise.** Headless only through enterprise ADC or the Antigravity Python SDK with an API key |
| **Codex CLI** (0.172.0) | `codex exec -C <worktree> --json --sandbox workspace-write -o last.txt "<prompt>"` | `--json` JSONL events; `-o/--output-last-message`; `--output-schema` | `--sandbox read-only/workspace-write/danger-full-access`, permission profiles, approvals, `--add-dir`, network off by default in workspace-write | `CODEX_API_KEY` per invocation (API billing); project hard spend limits | 429 with `project_spend_limit_exceeded` / `organization_spend_limit_exceeded` etc.; 0.172 names the spend limit reached | Third runner |
| **Kimi Code CLI** (MoonshotAI/kimi-code) | `kimi -p "<prompt>" --output-format stream-json` | JSONL on stdout, `session.resume_hint` line with `session_id` | `[[permission.rules]]` deny/ask/allow only; **no OS sandbox**; `-p` auto-approves everything not denied | Moonshot platform API key via `api_key_env` (provider `kimi`, `https://api.moonshot.ai/v1`); membership is for personal interactive use | exit 0/1/4; a quota/balance 429 "is not retried and fails immediately" | Fourth runner, only inside the container, with an outer timeout |
| **ChatGPT** | not a headless coding runtime | | | | | Stays the advisory reviewer on #80; OpenAI models reach Builder KEY through Codex CLI or the `api` runner |

Recommended order: `claude-code` (M0) → `api` (Anthropic, then Gemini; review roles with no shell) → `gemini-cli` (M1)
→ `codex` → `kimi` → `antigravity` (manual runner first; headless only after a terms answer).

## 2. Claude Code

### 2.1 Start non-interactively, get a result and an exit code

Source: Run Claude Code programmatically, https://code.claude.com/docs/en/headless (read 2026-11-24, covers up to
v2.1.31x); CLI reference, https://code.claude.com/docs/en/cli-reference.

- `claude -p "<prompt>"` runs once and exits; stdin is read too (capped at 10 MB). The working directory is the
  process cwd; `--add-dir` grants more directories. `-w/--worktree` makes Claude create its own worktree under
  `<repo>/.claude/worktrees/`, but Builder KEY should create worktrees itself (`kf claim`) and start Claude in them.
- `--bare` is "the recommended mode for scripted and SDK calls, and will become the default for `-p`". It skips
  auto-discovery of hooks, skills, plugins, MCP servers, auto memory and CLAUDE.md, never reads OAuth or the
  keychain, and needs `ANTHROPIC_API_KEY` or `apiKeyHelper`. Everything the run needs is passed explicitly:
  `--append-system-prompt(-file)`, `--settings`, `--mcp-config`, `--agents`, `--plugin-dir`. This is exactly the
  reproducibility property the design wants (principle 5): the run sees only what the runner gives it.
  - Caveat: hooks do not run in bare mode even when passed with `--settings`. If a runner needs a `PreToolUse` hook
    (for example to log every Bash command for gate 6), do not use `--bare`; use `--setting-sources ""`-style
    isolation plus `--strict-mcp-config` instead, and a clean `CLAUDE_CONFIG_DIR`.
  - Without `--bare`, a `-p` run in an untrusted folder still runs the project's `.claude/settings.json` hooks and
    `.mcp.json` servers, with no trust dialog. Repository content is therefore executable configuration: another
    reason to run every worker in a disposable container.
- Exit status: 0 on success, non-zero on failure; flag errors go to stderr before the run; in-run failures (such as
  missing auth) are printed as the result on stdout. SIGTERM gives exit 143 and leaves the turn unfinished; send
  SIGINT (or SDK `interrupt()`) first to end the turn cleanly. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` continues an
  interrupted turn on `--resume`.
- Output: `--output-format json` gives one object; `stream-json` (with `--verbose`) gives NDJSON whose last line is
  the `result` message. `--json-schema '<schema>'` adds a validated `structured_output` field (absent if the run
  ends without valid output, so check for it). The result type (from the TypeScript reference,
  https://code.claude.com/docs/en/agent-sdk/typescript, `SDKResultMessage`):
  - `subtype`: `success` | `error_max_turns` | `error_during_execution` | `error_max_budget_usd` |
    `error_max_structured_output_retries`
  - `is_error`, `api_error_status`, `num_turns`, `duration_ms`, `total_cost_usd`, `usage`, `modelUsage`,
    `permission_denials[]`, `session_id`, `stop_reason`, `terminal_reason`, `structured_output`.
- Resume: `--resume <session_id>` (or the transcript `.jsonl` path); `--session-id <uuid>` lets the runner choose
  the id up front, so the checkpoint can record it before the run starts. `--no-session-persistence` turns this off.
- Limits per run: `--max-turns N`; `--max-budget-usd X` stops the run when the client-side cost estimate reaches X
  ("spend can pass the cap, so leave headroom"; subagent spend counts).
- Background work: a `-p` run waits up to 10 minutes (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) for background
  subagents and commands. Known trap, documented: "When a subagent's long command moves to the background at its
  timeout, a `claude -p` run can exit with code 0 before the command finishes." Raise `BASH_DEFAULT_TIMEOUT_MS`
  above the longest proof command, or better, keep proof out of the model run entirely (`kf prove` is a script).

### 2.2 Restrict it; give it tools

Sources: headless page above; sandboxing, https://code.claude.com/docs/en/sandboxing; permission modes (linked from
the CLI reference).

- Tool surface: `--tools "Read,Edit,Write,Bash,Grep,Glob"` removes everything else from context; `--disallowedTools`
  bare names remove tools, scoped rules such as `Bash(git push *)` deny matching calls in every mode including
  `bypassPermissions`.
- Approval: since v2.1.302 a `-p` run starts in Manual mode and denies whatever needs approval unless an allow rule,
  a `PermissionRequest` hook or `--permission-prompt-tool` approves it. `--permission-mode dontAsk` denies every
  call that would prompt; `--permission-prompts none` (v2.1.259+) guarantees nothing waits on a person. Denials
  appear in `permission_denials` and as `permission_denied` stream events, so the runner can report them.
- Rule syntax: `Bash(pnpm vitest run *)`, `Bash(git commit *)`, `Read(...)`, `Edit(...)`, `WebFetch(domain:...)`.
  Bash rules are prefix matches on the command as written; they are a convenience, not a security boundary.
- Sandbox (Linux: bubblewrap + a local domain proxy; `@anthropic-ai/sandbox-runtime`): writes limited to the working
  directory, temp and `--add-dir`; network only to `sandbox.network.allowedDomains`; `failIfUnavailable: true` and
  `allowUnsandboxedCommands: false` make it strict. Limits that matter here: it covers shell commands only (the
  Read/Edit/Write tools, hooks and local MCP servers run outside it); reads are broad by default
  (`filesystem.denyRead` to fix); `docker` does not work inside it; Chromium (Playwright) needs user namespaces that
  are blocked by default. **Conclusion: for Builder KEY workers the boundary is the `kf env` container plus an
  egress proxy, with the Claude sandbox as an inner layer for reviewer runs that need no browser.**
- MCP: `--mcp-config <file|json>` plus `--strict-mcp-config` loads exactly the servers given. The `system/init`
  event lists `mcp_servers` and `mcp_server_errors`; a runner should fail the run if a required server is missing.
  Cost note from the docs: CLIs such as `gh` are more context-efficient than MCP servers.
- Sub-agents: `--agents <json|file>` defines them per run. They share the run's budget cap. Builder KEY should not
  rely on sub-agents for review independence: principle 6 needs fresh contexts started by the Foreman, ideally on
  another provider.
- Hooks: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SessionStart`, `SessionEnd`, `Stop` and others run
  local commands; useful for logging every executed command (gate 6 needs "the commands a run executed").

### 2.3 Authentication and terms

Sources: Authentication, https://code.claude.com/docs/en/iam (redirects to `/authentication`); Legal and compliance,
https://code.claude.com/docs/en/legal-and-compliance; Agent SDK overview,
https://code.claude.com/docs/en/agent-sdk/overview (all read 2026-11-24).

- Precedence: cloud provider vars > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` (always used in `-p` when present) >
  `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` (one-year subscription token from `claude setup-token`) > profiles >
  `/login`.
- Terms, quoted: "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude
  Code and the Agent SDK." "OAuth authentication is intended exclusively for purchasers of Claude ... subscription
  plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
  "Developers building products or services ..., including those using the Agent SDK, should use API key
  authentication." The policy does not restrict "configuring an API key in a development environment, secrets
  manager, or machine image for use by the customer's own authorized users".
- Reading for Builder KEY: the owner running the unmodified `claude` binary is allowed, but a Foreman service (M2)
  is "a product or service ... using the Agent SDK", and a fleet of parallel unattended workers is not "ordinary,
  individual usage". Both point the same way as D-269 and design principle 7: **an API key in a dedicated Console
  workspace**. `CLAUDE_CODE_OAUTH_TOKEN` is acceptable only for the owner's own interactive sessions, not for the
  Foreman.
- Multiple accounts: `CLAUDE_CONFIG_DIR` separates logins for one person's work and personal accounts. Nothing
  documented supports rotating accounts to evade limits, and the legal page reserves enforcement "without prior
  notice".

### 2.4 Limits, pricing, and how a limit surfaces

Sources: Rate limits, https://platform.claude.com/docs/en/api/rate-limits; Pricing,
https://platform.claude.com/docs/en/about-claude/pricing; Errors, https://code.claude.com/docs/en/errors; Costs,
https://code.claude.com/docs/en/costs (all read 2026-11-24).

- Prices per million tokens (input / output; cache read): Opus 5.5 $4 / $20 (cache hit $0.20); Sonnet 5.5 $2 / $10
  ($0.10); Haiku 5.5 $0.10 / $0.50 up to 100k-token prompts ($0.50 / $2.50 above); Fable 5.2 $8 / $40. 1M context at
  standard price except Haiku 5.5. Batch API 50% off (not useful for interactive agent loops).
- Org tiers and monthly spend caps: Start $500, Build $1,000, Scale $200,000, Custom none. Opus 5.5 at Start tier:
  4,000 RPM, 2,000,000 ITPM (uncached only), 400,000 OTPM, which is far above four parallel workers.
- Spend controls the runner can rely on:
  1. Organization or workspace spend limit you set: requests then return **HTTP 400 `invalid_request_error`**,
     message starting "You have reached your specified API usage limits" (or "workspace API usage limits").
  2. Tier cap reached: **HTTP 429 `rate_limit_error` with `error.details.error_code: enforced_spend_limit_reached`
     and no `retry-after`**; retries fail until the month resets.
  3. Ramp limit after a burst: 429 with `error_code: ramp_limit_exceeded` and `retry-after`.
  4. Ordinary rate limit: 429 with `retry-after` and `anthropic-ratelimit-*` headers. Overload: 529.
  5. Per-run: `--max-budget-usd` → result `subtype: error_max_budget_usd`.
- Claude Code retries transient errors up to `CLAUDE_CODE_MAX_RETRIES` (default 10, max 15).
  `CLAUDE_CODE_RETRY_WATCHDOG=1` retries 429/529 indefinitely but "fails at once on a standard-speed 429 that
  reports a spend limit or exhausted credits"; `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` bounds it. Each retry emits
  `system/api_retry` with `error` in `rate_limit | overloaded | billing_error | authentication_failed | ...`. For the
  Foreman: set `CLAUDE_CODE_MAX_RETRIES=3`, read `api_retry` and the final result, and let the Foreman (not the CLI)
  decide whether to wait or move the role to another provider.
- Cost guide: Anthropic reports enterprise averages of about $13 per developer per active day, under $30 for 90% of
  users. An estimate for one packet worker run on Opus 5.5 with good caching (my arithmetic, not a vendor figure):
  roughly 200 requests over a ~100k context ≈ 20M input tokens, ~90% cache reads ($3.60) + ~2M uncached/cache
  writes (~$9) + ~0.3M output ($6) ≈ **$15–25 per worker run**; a read-only review run is a fraction of that. A
  starting cap of $40 per run and $120 per packet leaves headroom; the owner sets the real numbers.

### 2.5 Maturity and failure modes for long unattended runs

- Mature, versioned weekly, with machine-readable events for retries, rate limits, plugin and MCP load failures.
- Failure modes documented by the vendor: early exit 0 when a subagent's long command moves to the background;
  SIGTERM loses the in-flight turn; `-p` run waits on background work up to a cap; MCP background results are lost
  at exit; subscription logins expire (`claude auth status --text` shows "Sign-in ends"); long sessions grow context
  and auto-compact (cost and drift). Mitigations: one bounded role per run, proof outside the model, explicit
  `--session-id`, checkpoint before start, wall-clock timeout with SIGINT then SIGKILL.

### 2.6 The GitHub Action

Source: https://code.claude.com/docs/en/github-actions; repo https://github.com/anthropics/claude-code-action (v1).

- `anthropics/claude-code-action@v1`; inputs `prompt` (automation mode; no prompt = `@claude` mention mode),
  `claude_args` (any CLI flag, e.g. `--max-turns`, `--model`, `--allowedTools`, `--mcp-config`),
  `anthropic_api_key` or `claude_code_oauth_token` or workload identity federation (`anthropic_federation_rule_id`,
  `anthropic_organization_id`), `settings`, `use_bedrock/use_vertex/use_foundry`.
- Checks: the triggering actor must have write access, and bots are rejected unless listed in `allowed_bots`.
- Useful for Builder KEY later as a CI-hosted reviewer (a PR-triggered acceptance review that writes its review
  record). Not the primary worker: Actions minutes, no persistent sandbox with Postgres/Redis, 6-hour job limit.

## 3. Claude Agent SDK (TypeScript and Python)

Sources: https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/agent-sdk/typescript
(read 2026-11-24); changelogs at https://github.com/anthropics/claude-agent-sdk-typescript and
https://github.com/anthropics/claude-agent-sdk-python.

- `npm i @anthropic-ai/claude-agent-sdk`; `query({ prompt, options })` returns an async generator of `SDKMessage`
  with `interrupt()`, `setPermissionMode()`, `close()`. It runs the Claude Code binary, so behaviour equals the CLI.
- Options that map to the runner: `cwd`, `tools`, `allowedTools`, `disallowedTools`, `permissionMode`, `maxTurns`,
  `maxBudgetUsd`, `mcpServers`, `hooks` (in-process callbacks), `agents`, `canUseTool` (called only when the flow
  would prompt), `settingSources: []` (load no filesystem settings), `sandbox`, `resume`, `forkSession`, `model`,
  `fallbackModel`, `outputFormat: {type:'json_schema', schema}`, `abortController`, `env` (replaces, not merges).
- Typed events the Foreman needs: `SDKResultMessage` (section 2.1), `SDKRateLimitEvent`
  (`status: allowed | allowed_warning | rejected`, `resetsAt`, `utilization`, `errorCode: credits_required`),
  assistant `error` in `rate_limit | overloaded | billing_error | server_error | ...`.
- Policy: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or
  rate limits for their products, including agents built on the Claude Agent SDK." Licence: Commercial Terms.
- Fit: the M2 Foreman service (KB-011) should use the TypeScript SDK (same language as the monorepo and `kf`) with
  an API key; M0 can use the CLI from `kf` scripts. Both produce the same result shape, so the runner contract does
  not change between them.

## 4. Anthropic API tool use and cost controls (for the `api` runner)

Sources: pricing and rate-limit pages above.

- A plain Messages-API tool-use loop (client tools; or the SDK's beta tool runner) is the right shape for roles that
  need no shell: a reviewer that receives the bundle and the diff as text and returns a structured verdict, and the
  owner-question writer. Costs: tool definitions add ~286 system-prompt tokens on Opus/Sonnet/Haiku 5.5; bash tool
  +325, text editor +974 input tokens.
- Controls: workspace spend limits (400 on hit), org tier caps (429 `enforced_spend_limit_reached`), workspace
  rate limits, the Rate Limits API to read them, `anthropic-workspace-id` response header to confirm which workspace
  billed, and prompt caching (cache reads do not count toward ITPM and cost 0.05x on Opus/Sonnet 5.5).
- Managed Agents (Anthropic-hosted harness, $0.08 per session-hour plus tokens) exist but would move the sandbox off
  the owner's machine; not needed for M0–M2.

## 5. Gemini CLI

Sources (repo https://github.com/google-gemini/gemini-cli, files read from `main` on 2026-11-24; v0.71.0 stable):
`docs/cli/headless.md`, `docs/cli/cli-reference.md`, `docs/cli/tutorials/automation.md`, `docs/cli/sandbox.md`,
`docs/reference/policy-engine.md`, `docs/cli/trusted-folders.md`, `docs/get-started/authentication.mdx`,
`docs/resources/quota-and-pricing.md`, `docs/resources/tos-privacy.md`, `packages/core/src/utils/errors.ts`;
releases https://github.com/google-gemini/gemini-cli/releases.

### 5.1 Start, result, exit code

- `gemini -p "<prompt>"` (or non-TTY stdin) is headless. Flags: `-m/--model` (default `auto`), `-o/--output-format
  text|json|stream-json`, `--approval-mode default|auto_edit|yolo|plan` (`--yolo` deprecated),
  `--include-directories`, `-r/--resume latest|<n>`, `-w/--worktree` (experimental), `-s/--sandbox`,
  `--skip-trust`, `--allowed-mcp-server-names`, `-e/--extensions`. `--allowed-tools` is deprecated in favour of the
  policy engine.
- JSON: `{ response, stats, error? }`; stream-json events `init`, `message`, `tool_use`, `tool_result`, `error`,
  `result` (with per-model token usage).
- Exit codes (from `errors.ts` and `headless.md`): `0` success; `1` general error or API failure; `41` auth; `42`
  input; `44` sandbox; `52` config; `53` turn limit (`model.maxSessionTurns`); `54` tool execution; `55` untrusted
  workspace; `130` cancelled.
- Headless in an untrusted folder exits with `FatalUntrustedWorkspaceError` (55) unless `--skip-trust` or
  `GEMINI_CLI_TRUST_WORKSPACE=true`.
- v0.71 release notes: headless abort now kills child processes, records cancelled tools and preserves the signal
  exit code; headless error output normalized.

### 5.2 Restrict it; give it tools

- Policy engine: TOML files in `~/.gemini/policies/` (and admin locations) with `[[rule]]` entries: `toolName`
  (wildcards, `mcpName`), `commandPrefix`, `commandRegex`, `argsPattern` (re2, linear time), `decision =
  allow|deny|ask_user`, `priority`, and an interactive flag so a rule can apply only in headless mode. In headless
  mode `ask_user` is treated as `deny`. This maps cleanly onto Builder KEY's rules (deny `git push --force`, deny
  production hosts, allow `pnpm`, `git commit`).
- Sandbox: `GEMINI_SANDBOX=docker|podman|runsc|lxc|sandbox-exec`; the container mounts the project at the same
  absolute path; a custom image via `tools.sandbox.image`, `GEMINI_SANDBOX_IMAGE` or `.gemini/sandbox.Dockerfile`.
  Builder KEY can point it at the `kf env` image, or run `gemini` inside that container directly (simpler, one
  boundary for all tools).
- MCP: `mcpServers` in `settings.json`, trust and include/exclude filters; `--allowed-mcp-server-names` restricts per
  run.

### 5.3 Authentication, terms, quotas

- Headless needs cached credentials or env: `GEMINI_API_KEY` (AI Studio), or Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI`,
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` with a service-account key or ADC, or `GOOGLE_API_KEY` express).
- Terms (`tos-privacy.md`): "Directly accessing the services powering Gemini CLI (for example, the Gemini Code Assist
  service) using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a
  violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your
  account." Driving the unmodified `gemini` binary is different from reusing its OAuth, but the Google-account
  (Code Assist) quota is sized per user per day; the doc itself recommends a key for "long-running tasks": "the only
  way to ensure your workflow isn't interrupted by reaching a limit on your quota". Unpaid and paid API keys fall
  under different terms (Gemini API Terms, unpaid vs paid services); use a **paid** key so prompts and code fall
  under the paid-services terms.
- Quotas per user per day: Google account 1,000 (Code Assist individual), 1,500 (AI Pro), 2,000 (AI Ultra); API key
  free tier 250 (Flash only); paid API key varies by tier.
- API spend controls (Google blog, 2026-03-16, https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/,
  via search extract **(unverified)**): per-project monthly spend caps in AI Studio, enforced with up to ~10 minutes
  of billing lag ("you may experience overages"); billing-account tier caps Tier 1 $250, Tier 2 $2,000, Tier 3
  $20,000–100,000 per month.
- Prices **(unverified, search extracts of ai.google.dev and cloud.google.com; the names did not match one
  consistent list)**: Gemini 3.1 Pro (preview) about $2 input / $12 output per 1M tokens up to 200k context; current
  Flash models at introductory $0.75 / $3.75 through 2026-12-31. Re-read https://ai.google.dev/gemini-api/docs/pricing
  before setting caps.

### 5.4 How a limit surfaces; maturity

- Over-quota comes back as 429 `RESOURCE_EXHAUSTED` and surfaces as exit `1` with the API error in the JSON `error`
  object or stderr; there is no dedicated exit code. Community wrappers grep for `429|RESOURCE_EXHAUSTED|rate
  limit`. The runner must parse `error` in JSON mode and treat any exit 1 whose error mentions quota as `limit`.
- Known issues on GitHub (e.g. https://github.com/google-gemini/gemini-cli/issues/13112, /10722, /9248): automatic
  Pro→Flash fallback on 429 is unreliable (fires too early, or not at all). For Builder KEY, pin the model with `-m`
  and let the Foreman decide fallback, so a "Pro review" never silently becomes a Flash review.
- Pre-1.0 version numbering, very fast release cadence (stable, preview and nightly the same day). Pin the version in
  the `kf env` image.

### 5.5 GitHub Action

`google-github-actions/run-gemini-cli` (https://github.com/google-github-actions/run-gemini-cli, read 2026-11-24):
inputs `prompt`, `gemini_api_key`, `gcp_workload_identity_provider`, `use_vertex_ai`, `settings`,
`gemini_cli_version` (default `latest`, pin it), `gemini_model`; outputs `summary`, `error`; workflows for PR review,
issue triage and `@gemini-cli` mentions. Same role as the Claude action: a possible CI-hosted second reviewer.

## 6. Google Antigravity

Sources: README https://github.com/google-antigravity/antigravity-cli (read 2026-11-24); SDK README
https://github.com/google-antigravity/antigravity-sdk-python; search extracts of https://antigravity.google/docs/cli/headless/,
https://antigravity.google/docs/cli/reference/, https://antigravity.google/docs/enterprise/,
https://antigravity.google/docs/faq, https://antigravity.google/docs/install/ (host blocked here: **all
`antigravity.google` content below is unverified**); issue https://github.com/google-antigravity/antigravity-cli/issues/223.

- Products: Antigravity 2.0 (desktop GUI) and Antigravity CLI `agy`, sharing one agent engine and settings.
- Headless: `agy -p "<prompt>"` (aliases `--print`, `--prompt`), `--output-format json` (single envelope) or
  `stream-json` (NDJSON), `--agent <name>`, `--mode accept-edits|auto|plan` (auto needs the terminal sandbox and is
  not available on business/enterprise accounts), `--sandbox` (seatbelt on macOS, bubblewrap on Linux),
  `--dangerously-skip-permissions`. A third-party guide notes a run can end "WAITING" on an approval with a success
  exit code, so read the JSON status, not just the exit code.
- Authentication: keyring plus Google Sign-In by default; headless reuses cached credentials and fails with an auth
  error in CI. Enterprise documents ADC (`gcloud auth application-default login`, `AGY_ADC_AUTH=true`, quota
  project resolution). Issue #223 (May 2026) reports that `GEMINI_API_KEY`/`GOOGLE_API_KEY`/Vertex env vars were
  ignored by the CLI; the install docs later describe a settings-file route (`modelProvider = gemini` in
  `~/.gemini/antigravity-cli/settings.json`).
- Terms: the Antigravity FAQ (search extract) says headless `agy -p` "is intended for direct scripting and CI
  workflows", but "Wrapping agy inside third-party coding agents or applications, or automating account rotation, is
  not supported under consumer plans. Such actions can result in suspension or termination of your account." It
  recommends "a Gemini Enterprise or Google AI Studio API key" for third-party agents. Forum answers conflict; staff
  decline to give legal interpretations. The README also says interaction data is collected to improve the product
  unless opted out.
- Quotas: Pro/Ultra refresh on a rolling five-hour window under a weekly cap; overage via AI credits (third-party
  pricing pages; Google blog https://blog.google/feed/new-antigravity-rate-limits-pro-ultra-subsribers/).
- Antigravity SDK (Python, `pip install google-antigravity`): an agent harness with `GEMINI_API_KEY` or Vertex
  (express key or ADC), policies (shell denied by default via `policy.confirm_run_command()`), tool streams. This is
  the API-keyed way to use the Antigravity engine from a script.
- **Recommendation:** treat Antigravity as an owner-driven interactive tool (a "manual runner": the owner opens the
  worktree, pastes `kf brief`, the agent writes the same result file and pushes). Do not let the Foreman launch `agy`
  on a consumer plan. If headless Antigravity is wanted, use it with enterprise ADC or the SDK with a paid key, after
  the owner confirms the terms with Google.

## 7. OpenAI: Codex CLI, Codex cloud, Agents SDK / Responses API, ChatGPT

Sources: repo https://github.com/openai/codex (README; `codex-rs/exec/src/cli.rs`;
`codex-rs/utils/cli/src/shared_options.rs`, read from `main` 2026-11-24); releases
https://github.com/openai/codex/releases (0.172.0, 24 Nov 2026); https://github.com/openai/codex-action; search
extracts of https://developers.openai.com/codex/noninteractive, /codex/concepts/sandboxing,
/api/docs/guides/spend-limits (host blocked: those parts **unverified**).

### 7.1 Codex CLI

- Start: `codex exec [PROMPT]` (stdin if omitted or `-`), `-C/--cd <DIR>` working root, `--add-dir`, `-m/--model`,
  `-p/--profile`, `-s/--sandbox`, `--worktree`, `--ephemeral` (no session files), `--ignore-user-config`,
  `--ignore-rules`, `--strict-config`, `--skip-git-repo-check`, `--json` (JSONL events to stdout),
  `-o/--output-last-message <FILE>`, `--output-schema <FILE>`. Subcommands `exec resume <id>|--last`, `exec fork`,
  `exec review --base <branch>|--commit <sha>|--uncommitted` (a built-in review mode, useful for reviewer roles).
- Sandbox and approvals: `read-only`, `workspace-write` (network off by default; enabled under
  `[sandbox_workspace_write]`), `danger-full-access`; `--dangerously-bypass-approvals-and-sandbox` "intended solely
  for running in environments that are externally sandboxed". Permission profiles are replacing `--full-auto`
  (deprecated in 0.128, reportedly removed later; check `codex exec --help` on the pinned version).
- Auth: `CODEX_API_KEY` set inline on one `codex exec` gives that run an API key; ChatGPT-account login is "only if
  you specifically need to run as your Codex account"; `~/.codex/auth.json` holds tokens. Do not put the key in a
  job-wide env where repository code runs.
- Limits: API hard spend limits per organization and per project (429 with `organization_spend_limit_exceeded` /
  `project_spend_limit_exceeded`; `credit_balance_exhausted`; enforcement not instant). 0.172 reports which spend
  limit was hit as soon as it arrives in the stream.
- MCP: `config.toml` `[mcp_servers]`; stdio servers with cached tool lists start lazily (0.172). `codex mcp-server`
  exposes Codex itself as an MCP server (unverified detail).
- GitHub Action `openai/codex-action@v1`: `prompt`/`prompt-file`, `openai-api-key`, `sandbox` or
  `permission-profile` (beta), `safety-strategy` (`drop-sudo` default, `unprivileged-user`, `read-only`, `unsafe`),
  `output-file`, output `final-message`.
- Prices **(unverified; third-party pages)**: GPT-5.5 about $5 input / $30 output per 1M tokens; earlier Codex models
  $1.25–1.75 / $10–14.

### 7.2 Codex cloud

`codex cloud exec --env <ENV_ID> "<prompt>"` submits a task to an OpenAI-hosted environment (experimental; an
`attempts` option for best-of-N, unverified). It runs on OpenAI's infrastructure with a ChatGPT plan, outside the
owner's sandbox and outside `kf prove`. Not a fit for Builder KEY's "one reproducible machine" rule.

### 7.3 Agents SDK / Responses API

The Responses API is the natural backend for an `api` runner on OpenAI models (review roles with no shell). Kimi
Code and Codex both speak it. Not researched further: the `api` runner needs only "messages + tools + structured
output", which every provider offers.

### 7.4 ChatGPT

ChatGPT (the app) has no supported headless coding mode for a script. It stays what it is in this programme: the
advisory reviewer reading #80. If its model is wanted as an automated reviewer, call it through the `api` runner or
Codex CLI with an API key.

## 8. Moonshot Kimi

Sources: https://github.com/MoonshotAI/kimi-cli (archived), https://github.com/MoonshotAI/kimi-code (README and
`docs/en/reference/kimi-command.md`, `docs/en/configuration/providers.md`, `docs/en/configuration/config-files.md`,
`docs/en/guides/interaction.md`, read from `main` 2026-11-24); search extracts of kimi.com help pages and pricing
aggregators **(unverified)**.

- The Python Kimi CLI is archived ("Existing installations are no longer supported and will stop working"). Use
  **Kimi Code CLI** (`kimi`, single binary; npm `@moonshot-ai/kimi-code`).
- Start: `kimi -p "<prompt>" [--output-format stream-json] [-m <alias>] [--agent <name>|--agent-file <md>]
  [--add-dir <dir>]`; cwd is the workspace. `-p` cannot be combined with `--yolo/--auto/--plan`: "non-interactive
  mode uses `auto` permission by default", i.e. "Regular file operations and shell commands are allowed
  automatically, while `deny` rules in your configuration file still apply."
- Result: stream-json lines (assistant replies, tool calls, tool results, `session.resume_hint` with `session_id`);
  resume with `kimi -S <id> -p ...`. Exit codes: `0` ok, `1` bad args / auth not ready / execution error, `4` session
  held by another process.
- Restrict: `[[permission.rules]]` with deny > ask > allow; a hard block keeps Read/Write/Edit away from secret
  files. No OS sandbox and no network control: **run it only inside the `kf env` container with the egress proxy.**
- Long-run trap: in print mode, background tasks and subagents have no wall-clock cap by default
  (`bash_task_timeout_s = 0`, `print_wait_ceiling_s` and `print_max_turns` "effectively unbounded"), "so only the
  model itself stops a task". Set `loop_control.max_steps_per_turn`, `print_max_turns`, `print_wait_ceiling_s` and an
  outer `timeout`.
- Retries: connection errors, timeouts, 429 rate limits and 5xx are retried; "A 429 caused by an exhausted quota or
  insufficient account balance is not retried and fails immediately" (exit 1).
- Auth: `/login` (Kimi Code OAuth, device-code flow via `kimi login`) or a Moonshot platform API key. Provider `kimi`
  is OpenAI-compatible at `https://api.moonshot.ai/v1` (`KIMI_API_KEY`); credentials come only from `api_key` or
  `api_key_env` in `config.toml`, never silently from the shell. Kimi Code can also drive Anthropic or OpenAI
  providers.
- Terms **(unverified extracts of kimi.com help)**: Kimi Code membership is for personal interactive use; scripted
  batch runs fall outside it; using the membership key in unsupported products may be treated as abuse; sharing via a
  reverse proxy is a violation; quota is a rolling five-hour window shared by all keys. Use the platform API key.
- Prices and limits **(unverified, aggregators disagree)**: kimi-k2.6 about $0.95 / $4.00 per 1M tokens; K2 reportedly
  closed to new API users from 2026-10-31; rate tiers by cumulative top-up from 3 RPM upward. Check
  https://platform.moonshot.ai before use.

## 9. CLI-agnostic standards

- **Model Context Protocol** (https://github.com/modelcontextprotocol/modelcontextprotocol, schema 2026-07-28):
  supported by all five tools. Builder KEY could expose `kf` as an MCP server, but plain shell commands are cheaper in
  context (Anthropic's cost guide says so) and identical across tools. Recommendation: `kf` stays a CLI; MCP only for
  things a CLI cannot do well.
- **AGENTS.md** (https://github.com/agentsmd/agents.md): an open "README for agents". Codex reads it natively; Kimi
  Code, Gemini CLI and Antigravity read their own files and can be pointed at it (verify per tool on the pinned
  version). Builder KEY's protocol already lives in `docs/development/agent-memory/` and `kf brief`; since the brief
  is passed as the prompt, the runner does not depend on any tool's memory-file convention. Keep a short root
  `AGENTS.md` that points to `kf brief`.
- **Agent Client Protocol (ACP)**: `kimi acp`, `agy acp`, Gemini `--experimental-acp`: a stdio JSON-RPC protocol for
  an editor to drive an agent session. A possible later transport for a long-lived worker, not needed for one-shot
  runs.
- **Agent2Agent (A2A)** (https://github.com/a2aproject/A2A; Linux Foundation, Agentic AI Foundation): JSON-RPC 2.0
  over HTTP(S), Agent Cards, long-running tasks. Relevant only if Builder KEY's Foreman later talks to remote agents
  as services (the Gemini CLI a2a-server gained bearer-token auth in v0.72.0-preview). Not needed for M0–M2.

## 10. Recommended runner interface

One function, one contract, one result file. Everything provider-specific stays inside the adapter.

```ts
// scripts/key-builder/runners/types.ts
type Role = 'worker' | 'fix' | 'review-security' | 'review-correctness' | 'confirm' | 'owner-question';

interface RunRequest {
  runId: string;                 // also the checkpoint key (.agent-control/run-<runId>.yaml)
  role: Role;
  packet: string;                // e.g. "SWP-QUOTE-PUBLIC-PAGE"
  provider: 'claude-code' | 'gemini-cli' | 'codex' | 'kimi' | 'api-anthropic' | 'api-gemini' | 'manual';
  model: string;                 // pinned, never "auto"
  worktree: string;              // absolute path, created by kf claim
  promptFile: string;            // output of `kf brief <ID> --role <role>`
  readOnly: boolean;             // reviewers: true
  allowCommands: string[];       // translated per tool (Claude rules, Gemini policy TOML, Kimi rules)
  denyCommands: string[];
  egressHosts: string[];         // enforced by the container proxy, not by the tool
  mcpConfig?: string;
  limits: { maxTurns: number; budgetUsd: number; wallClockMs: number };
  resume?: { sessionId: string };  // from a previous RunResult
}

interface RunResult {
  runId: string;
  status: 'done' | 'limit' | 'budget' | 'turns' | 'timeout' | 'auth' | 'denied' | 'error' | 'cancelled';
  resetAt?: string;              // when status is 'limit' and the provider says when
  exitCode: number;
  sessionId?: string;            // resume handle
  costUsd?: number; tokens?: { input: number; output: number; cacheRead: number };
  headSha?: string;              // read from git by the runner, never taken from the model
  resultFile?: string;           // .agent-control/result-<runId>.yaml written by the agent
  structured?: unknown;          // review verdict when the tool supports a JSON schema
  transcript: string;            // raw stdout/stderr saved under the run directory
  commandsExecuted: string[];    // for gate 6, from hooks or stream events
}

function run(req: RunRequest): Promise<RunResult>;
```

Common wrapper around every adapter (so the adapters stay small):

1. Write the checkpoint (`step: started`, provider, model, session id if pre-assigned) before starting.
2. Start the tool inside the `kf env` container with the worktree mounted, the egress proxy on, only that
   provider's key in the environment, and a fresh config home (`CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for
   Codex, a per-run `HOME` for Gemini CLI and Kimi Code, whose settings live under `~/.gemini` and the Kimi config
   directory) so no personal settings leak in.
3. Enforce `wallClockMs` from outside (`timeout --signal=INT`, then KILL after a grace period).
4. Classify the end state from the tool's own signals (table below), save the transcript, read `git rev-parse HEAD`
   and the result file, write the checkpoint (`step: ended`, status).
5. Never trust the agent's claim of success: the Foreman runs `kf gate` and `kf prove` on the head afterwards.

| Provider | Command shape | `limit` when | `budget` when | `turns` when | Resume |
| --- | --- | --- | --- | --- | --- |
| claude-code | `claude --bare -p --output-format stream-json --verbose --session-id <uuid> --model <m> --tools ... --allowedTools ... --permission-mode dontAsk --permission-prompts none --max-turns N --max-budget-usd X --append-system-prompt-file <rules> < prompt` | `rate_limit_event.status=rejected`, or final error `rate_limit/billing_error`, or API 429 `enforced_spend_limit_reached`, or 400 "specified API usage limits" | result `subtype=error_max_budget_usd` | `error_max_turns` | `--resume <session_id>` |
| gemini-cli | `gemini -p "$(cat prompt)" -o stream-json -m <m> --approval-mode yolo --skip-trust` with policy TOML in the config home (read-only roles: deny edit/write/shell-mutating tools) | exit 1 with `RESOURCE_EXHAUSTED`/429 in `error` | provider project cap → 429 (same path) | exit 53 | `--resume latest` within the same config home |
| codex | `CODEX_API_KEY=... codex exec -C <wt> -m <m> --json --ephemeral --sandbox workspace-write -o last.txt - < prompt` (reviewers: `--sandbox read-only` or `codex exec review --base <sha>`) | 429 rate limit | 429 `project_spend_limit_exceeded` / `organization_spend_limit_exceeded` | config `max turns` (verify) | `codex exec resume <id>` (drop `--ephemeral`) |
| kimi | `kimi -p "$(cat prompt)" --output-format stream-json -m <alias>` with `[[permission.rules]]`, `loop_control`, `print_max_turns` set in its config | exit 1 with quota/balance 429 | same | `max_steps_per_turn` reached | `kimi -S <session_id> -p ...` |
| api-* | Messages / Gemini `generateContent` / Responses with the bundle and diff inlined, JSON-schema output | 429 per provider | spend-cap errors per provider | loop counter in the runner | stateless: re-run |
| manual | prints `kf brief` and the worktree path for the owner; polls for the result file and the pushed head | n/a | n/a | n/a | n/a |

On `limit`: the Foreman keeps the checkpoint, and either waits until `resetAt` or reassigns the role. A worker that
moves provider mid-packet restarts from the last pushed commit with a fresh `kf brief` (which includes the commits so
far), not from the other tool's session: sessions are not portable between tools, git is.

## 11. Which tool for which role

| Role | First choice | Second choice | Why |
| --- | --- | --- | --- |
| Packet worker (tests first, code, fix rounds) | Claude Code, Opus 5.5, API key | Gemini CLI (Pro, paid key) | Most mature headless contract (typed result, budget cap, retry events, sandbox, hooks for command logging). Gemini is the owner's chosen second provider |
| Acceptance reviews (security, correctness) | A provider different from the worker: Gemini CLI read-only, or `api-gemini` | Codex `exec review` or Claude Code read-only (`--tools Read,Grep,Glob`, `dontAsk`) when the worker was not Claude | Principle 6: fresh context, different provider; reviewers need the code and the packet, not a shell that can write |
| Confirmation review of a fix delta | Same provider as the original reviewer, fresh session | `api-*` with only the delta | Cheap, scoped |
| Owner-question wording, RETURN prose | `api-anthropic` Haiku 5.5 or Sonnet 5.5 | `api-gemini` Flash | Short, structured text |
| Bookkeeping (next, claim, gate, prove, return, wave, checkpoint) | No model: `kf` scripts | | Principle 2 |
| Owner's own interactive sessions | Claude Code, Antigravity, ChatGPT, Kimi, Gemini | | Any tool can follow `kf brief` by hand; the result file and RETURN shape are the same |

## 12. Order to add them

1. **`claude-code` runner (KB-007, M0)**: CLI `claude --bare -p` from `kf`; dedicated Console workspace "builder-key"
   with a workspace spend limit; `--max-budget-usd` per run; reviewers on Claude too at M0 but in fresh sessions.
2. **`api` runner (part of KB-007/KB-008)**: Anthropic first, then Gemini. Gives cross-provider review cheaply before
   any second CLI is wired, which satisfies principle 6 early.
3. **`gemini-cli` runner (KB-008, M1)**: paid `GEMINI_API_KEY` with an AI Studio project spend cap, pinned CLI
   version and model, policy TOML generated from `RunRequest`, run inside the container. M1's second-tool packet.
4. **`codex` runner**: `CODEX_API_KEY` per invocation, OpenAI project hard limit; `exec review` for reviews.
5. **`kimi` runner**: Moonshot platform key via `api_key_env`, strict container, loop limits and outer timeout.
6. **`antigravity`**: `manual` runner now (owner-driven). A headless adapter only after the owner gets a written
   answer from Google, then via enterprise ADC or the Antigravity SDK with a paid key.
7. **M2**: move the `claude-code` adapter to the TypeScript Agent SDK inside the Foreman service; keep the CLI adapter
   for the owner's machine. Same `RunRequest`/`RunResult`.

## 13. Risks and points for the owner

- **Terms are the sharpest constraint.** Anthropic (OAuth "ordinary use"; SDK products must use API keys), Google
  (Gemini CLI OAuth reuse is a violation; Antigravity consumer plans do not support wrapping `agy` in other agents or
  account rotation), Kimi (membership for personal interactive use) all point the same way as D-269: API keys with
  caps, one owner, no account rotation. Proposed ruling: the Foreman never uses a consumer login.
- **Spend caps are not instant** on Google (≈10 min lag) or OpenAI ("enforcement is not immediate"), and Claude's
  `--max-budget-usd` is a client estimate that "can pass the cap". Builder KEY's own per-run, per-packet and per-day
  caps (section 6 of the design) must count spend from each run's reported cost and stop launching new runs at, say,
  80% of a cap; the provider caps are the backstop, not the control.
- **Sandboxes differ in strength**: Claude (bubblewrap + proxy), Gemini (container), Codex (seatbelt/landlock,
  permission profiles), Kimi (none), Antigravity (seatbelt/bubblewrap, unverified). One `kf env` container with an
  egress allowlist is the only boundary that is the same for all tools; tool sandboxes are a second layer. Playwright
  e2e inside a bubblewrap sandbox will fail (user namespaces), which is another reason `kf prove` runs outside the
  model.
- **Silent downgrades**: Gemini CLI auto-fallback Pro→Flash; Claude `--fallback-model`. Pin models and record the
  served model (`modelUsage` / `stats`) in the review record so gate 7 can check the reviewer's model.
- **Unverified figures**: Gemini, OpenAI and Kimi prices and the Antigravity flags could only be read through search
  extracts because those hosts are blocked in this session. Allow `ai.google.dev`, `antigravity.google`,
  `developers.openai.com`, `platform.moonshot.ai` (and `moonshotai.github.io`) in the environment, or re-read them
  from another machine, before KB-008.

Questions to batch for the owner (OWNER-QUESTION-FORMAT, recommendation first):

1. Ruling: the Foreman and all runners use API keys only (Anthropic Console workspace, Gemini paid key, later OpenAI
   and Moonshot keys), never consumer logins. Recommended: yes.
2. Starting caps: per run $40, per packet $120, per day $300, across providers. Recommended as a start, to be lowered
   after the M0 packet's real cost is known.
3. Antigravity: keep it as an owner-driven tool until Google answers in writing whether a local script may launch
   `agy -p` on the owner's plan. Recommended: yes; use Gemini CLI for automated Gemini work.

## 14. Sources (read 2026-11-24 unless stated)

Anthropic
- https://code.claude.com/docs/en/headless (Run Claude Code programmatically)
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/iam → /authentication
- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/errors
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/github-actions ; https://github.com/anthropics/claude-code-action
- https://code.claude.com/docs/en/agent-sdk/overview ; https://code.claude.com/docs/en/agent-sdk/typescript
- https://platform.claude.com/docs/en/api/rate-limits ; https://platform.claude.com/docs/en/about-claude/pricing
- Claude Code 2.1.331 installed in this session

Google
- https://github.com/google-gemini/gemini-cli (main, v0.71.0): docs/cli/headless.md, docs/cli/cli-reference.md,
  docs/cli/tutorials/automation.md, docs/cli/sandbox.md, docs/reference/policy-engine.md,
  docs/cli/trusted-folders.md, docs/get-started/authentication.mdx, docs/resources/quota-and-pricing.md,
  docs/resources/tos-privacy.md, packages/core/src/utils/errors.ts; /releases
- https://github.com/google-gemini/gemini-cli/issues/13112, /10722, /9248 (429 fallback reports, via search)
- https://github.com/google-github-actions/run-gemini-cli
- https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/ (2026-03-16, via search)
- https://ai.google.dev/gemini-api/docs/pricing , /rate-limits , /billing (blocked; search extracts only)
- https://github.com/google-antigravity/antigravity-cli (README), /issues/223
- https://github.com/google-antigravity/antigravity-sdk-python (README)
- https://antigravity.google/docs/cli/headless/ , /docs/cli/reference/ , /docs/enterprise/ , /docs/faq , /docs/install/ (blocked; search extracts only)
- https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051 and related threads (blocked; search extracts only)
- https://blog.google/feed/new-antigravity-rate-limits-pro-ultra-subsribers/ (via search)

OpenAI
- https://github.com/openai/codex (README; codex-rs/exec/src/cli.rs; codex-rs/utils/cli/src/shared_options.rs); /releases (0.172.0)
- https://github.com/openai/codex-action
- https://developers.openai.com/codex/noninteractive , /codex/concepts/sandboxing , /api/docs/guides/spend-limits (blocked; search extracts only)

Moonshot
- https://github.com/MoonshotAI/kimi-cli (archived README)
- https://github.com/MoonshotAI/kimi-code (README; docs/en/reference/kimi-command.md; docs/en/configuration/providers.md;
  docs/en/configuration/config-files.md; docs/en/guides/interaction.md)
- https://www.kimi.com/help/kimi-code/membership-guide , https://www.kimi.com/help/kimi-code/benefits (search extracts only)
- Pricing aggregators (unverified): https://www.chatbase.co/blog/kimi-k2-api , https://costgoat.com/pricing/kimi-api ,
  https://www.usagepricing.com/blueprint/moonshot-ai , https://www.morphllm.com/kimi-api

Standards
- https://github.com/modelcontextprotocol/modelcontextprotocol (schema 2026-07-28)
- https://github.com/agentsmd/agents.md
- https://github.com/a2aproject/A2A
- https://agentclientprotocol.com (referenced by Kimi Code and Antigravity)
