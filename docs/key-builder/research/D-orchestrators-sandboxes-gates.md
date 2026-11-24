# Research D: orchestrators, durable execution, sandboxes, GitHub mechanics, gates, evaluation

For: Builder KEY (`docs/key-builder/KEY-BUILDER-DESIGN-001.md`, 2026-11-24). Researched 2026-11-24.

## 0. How to read this, and its limits

- Sources are primary where possible: project repositories on github.com, Claude Code docs (code.claude.com), papers on
  arXiv, and vendor docs.
- **Two primary doc hosts were outside this session's network allowlist**: `docs.github.com` and
  `developers.openai.com`. Facts about GitHub (Apps, rulesets, merge queue, Copilot agent) and Codex CLI come from
  search-engine extracts of those pages, not from reading them. They are marked "(search extract)" and should be
  checked before they become gates. The GitHub REST API was also scoped to this session's repositories, so star counts
  and licences come from the repository web pages.
- Star counts and versions are snapshots taken on 2026-11-24. Where a page showed no release number, none is given.
- Reading the repository: I read the design document, `apps/server/src/modules/temporal`, `package.json` files,
  `docker-compose.yml`, `.github/workflows/*` headers and `scripts/agent-control/*` headers. I made no changes. One
  read-only `git remote -v` was run in the worktree to confirm the repository; nothing else touched git.

## 1. What the repository already gives Builder KEY (read this first)

The design document lists `scripts/agent-memory/` as the existing protocol layer. It does not mention
`scripts/agent-control/`, which already holds much of what Layers 1 and 3 need, with tests:

| Existing file | What it already does | Reuse in Builder KEY |
| --- | --- | --- |
| `scripts/agent-control/lib/state-machine.mjs` | Machine-enforced legal packet transitions, fails closed on unknown states | The Foreman's step graph and `kf checkpoint` state names |
| `scripts/agent-control/lib/admission.mjs`, `auto-merge-admitted.mjs` | Exact-head admission: workflow conclusions only at the exact PR head, a second snapshot immediately before merge, skipped-test checks | `kf gate` check 9 (D-239 merge) almost as is |
| `scripts/agent-control/lib/merge-grant.mjs` | Pure predicate for "the owner/ChatGPT granted this exact merge", read from #80 comments | The owner's go on #80 for a wave |
| `scripts/agent-control/lib/semantic-review.mjs` | Provider-neutral independent review contract, with failover (Copilot preferred, ChatGPT fallback) | `kf gate` check 7 (two reviews, independence) |
| `scripts/agent-control/select-directive.ps1/.mjs` | Authority filter: only comments from allow-listed authors with the right sender count | Prompt-injection defence for anything read from #80 |
| `scripts/agent-control/claude-worker.ps1` | Local worker: polls #80, durable cursor, exclusive lock, `claude -p` in a dedicated worktree, bounded retry, HELD_RETRYABLE | The `claude-code` runner's lifecycle (port to Node so it runs off Windows) |
| `scripts/agent-control/proof-mutation.mjs` | Negative-control runner: restore a defect, the proof must then fail | The pattern for testing each `kf gate` check, and a cheap, targeted form of mutation testing |
| `scripts/agent-control/orchestrate.mjs`, `lib/reconcile.mjs`, `lib/authority-effects.mjs` | Folds #80 authority over a checkpoint, reconciles with repository truth, prints the single next legal action, `REPORT_DRIFT` if inconsistent | This is the "git-checkpoint state machine" option for durable execution (section 3) |
| `scripts/agent-control/research/compile-context.mjs` | Deterministic context bundle compiler, no LLM | `kf brief` |
| `.github/workflows/ci-cd.yml` | TruffleHog pinned to v3.99.7 by commit, Postgres and Redis as CI services, Playwright on `ubuntu-24.04` | The proof environment and the secret scan already exist in CI |
| `docker-compose.yml` | `pgvector/pgvector:pg16`, `redis:7-alpine`, MinIO, docling, with health checks | The base of `kf env up` |

**Recommendation:** KB-002 to KB-006 should start by importing these libraries rather than rewriting them. The cheapest
path to M0 is "Node CLI over agent-memory plus agent-control", not a new framework.

The `temporal` module (`apps/server/src/modules/temporal/`) is **not Temporal.io**. It is a business calendar overview
(`TemporalOverviewService.getOverview(businessId)`: bookings, tasks, capacity) behind `AuthGuard` and `BusinessGuard`.
There is no `@temporalio/*` dependency anywhere. The repository does use **BullMQ `^5.76.8` with `ioredis ^5.10.1`**
(`apps/server/src/modules/ai/queue.service.ts`, `temporal-flow/temporal-flow-memory.queue.service.ts`,
`business-events/business-event.queue.ts`, and a scheduler kill switch in `core/config`). The product's Redis and
Postgres must **not** be reused by Builder KEY (section 3.3).

## 2. Coding-agent orchestrators and frameworks

### 2.1 Summary table

| Project | Licence | Maturity (2026-11-24) | Unattended mode | Isolation | Review / merge | Fit for Builder KEY |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code `claude -p` / Agent SDK (TS) | Commercial terms (SDK) | Production, flags documented to v2.1.302 | `-p`, `--bare`, `--output-format json`, `--json-schema`, `--max-budget-usd`, `--permission-mode dontAsk/auto`, `--permission-prompts none`, `--resume <id>` | Native bash sandbox (bubblewrap/Seatbelt) plus devcontainer | None built in | **Primary worker runner (M0)** |
| OpenAI Codex CLI `codex exec` | Apache-2.0 (CLI) | Production | `codex exec --json`, `--output-schema`, `--sandbox workspace-write`, `resume`; `--full-auto` deprecated (search extract) | OS sandbox, read-only by default | None | **Second runner / independent reviewer (M1)** |
| Gemini CLI | Apache-2.0 (not verified this session) | Production | `-p`, `--output-format json/stream-json`, `--approval-mode default/auto_edit/yolo/plan`; yolo only from the command line (search extract) | Optional sandbox | None | Second runner (owner already uses Antigravity) |
| Kimi CLI | Not verified | Young | `kimi -p`, print and wire modes; auto permission policy, static deny rules apply (third-party extracts) | Not documented | None | Third runner, later |
| OpenHands (ex All-Hands) | MIT (README); `openhands/software-agent-sdk` separate | 94.2k stars; image `agent-canvas:1.44.0` in quickstart | `openhands --headless -t ... --json`; **headless always auto-approves, cannot be changed** | Per-conversation Docker sandbox with its own Agent Server (REST); "no sandbox" mode has full host access | GitHub automations, resolver | Reference architecture; a possible runner, but Python and heavy |
| SWE-agent / mini-SWE-agent | MIT | SWE-agent 20.9k stars, 1.0 released; mini 10.0k stars, v2 | Batch mode; mini is bash-only, `subprocess.run` per action, linear history | docker/podman, singularity, bubblewrap | None | **Pattern for the `api` runner** (an ~100-line loop); maintainers now recommend mini over SWE-agent |
| Aider | Apache-2.0 | 50.2k stars | Scripting via `--message`/`--yes-always` per its docs (not on README) | None (runs on host) | Auto-commits every change | Not a fit: auto-commit conflicts with tests-first commit order |
| AutoGen | MIT/CC | **Maintenance mode** since Oct 2025; successor Microsoft Agent Framework (GA reported Apr 2026) | Library | None | None | Avoid |
| LangGraph (JS) | MIT | Mature | Graph runtime with checkpointers (`PostgresSaver`), `interrupt()` + `Command({resume})`, keyed by `thread_id` | None | None | Not needed: the Foreman is deterministic; borrow the interrupt/resume pattern only |
| CrewAI | MIT | Mature, Python | Flows (event-driven) host Crews | None | None | Avoid (Python, role-play abstraction adds nothing here) |
| OpenAI Agents SDK (JS) | MIT | Active (core 0.22.x seen) | Guardrails, handoffs, tool approvals that pause the run, tracing; Temporal integration `@temporalio/openai-agents` | None | None | Only if an `api` runner on OpenAI is wanted |
| GitHub Copilot coding agent | Proprietary (GitHub) | Production | Assigned issues; runs in ephemeral GitHub Actions | Firewalled ephemeral VM; may push only to `copilot/*` or the PR's branch | Cannot approve or merge its PR; the requester cannot approve it either; workflows on its PRs wait for a human (search extract) | **Copy its controls**; already used as reviewer in `semantic-review.mjs` |
| GitHub Agentic Workflows (`gh-aw`) | MIT (GitHub Next) | 2026 | Markdown workflows compiled to Actions | Agent job read-only; **safe outputs**: writes are proposed, then a threat-detection job, then a separate job applies them | Threat detection job (prompt injection, secret leak, malicious patch) | **Copy "stage and vet all writes"** |
| Sweep | Pivoted | Now "AI coding assistant for JetBrains" | n/a | n/a | n/a | Dead end for issue-to-PR |
| claude-flow (now **ruflo**) | MIT | 82.3k stars, v3.8.x, claims swarms, hive mind, consensus | MCP server | Not described for agents | None | **Avoid**: benchmarks self-published, isolation undocumented |
| claude-squad | **AGPL-3.0** | 8.9k stars | tmux + git worktree per agent; `--autoyes` experimental | Worktrees only (same host, same network) | Human keys: commit, push | Use as a tool if wanted; do not embed code (AGPL) |
| Vibe Kanban (BloopAI) | Apache-2.0 | ~28k stars | Kanban of tasks, each in its own worktree; Claude Code, Codex, Gemini CLI, Amp | Worktrees | Human review in UI | Reference for the M3 owner page |
| Conductor (conductor.build) | Proprietary, macOS only | Product | Parallel Claude Code / Codex workspaces | Worktree per workspace | Diffs, checks, PR flow in app | Owner convenience only; uses consumer logins, multiplies usage |
| Devin (Cognition) | Proprietary SaaS | Product; parallel sessions (Feb 2026, third-party report); ~15 min active work = 1 ACU | Sessions, playbooks | Cognition VMs | PRs | Pattern only (playbooks = briefs); costs per ACU |
| Docker Sandboxes (`sbx run claude`) | Docker product | 2026 | Runs agents unsupervised | **microVM** per sandbox, own Docker daemon, filesystem, network | None | **Sandbox candidate for M2** (section 4) |

### 2.2 Details that matter for the design

**Claude Code headless (code.claude.com/docs/en/headless, read 2026-11-24).**
- `--bare` skips hooks, skills, plugins, MCP servers, auto memory and CLAUDE.md, and does not read OAuth credentials:
  it needs `ANTHROPIC_API_KEY`. The docs say it "is the recommended mode for scripted and SDK calls, and will become the
  default for `-p`".
- **Security finding:** without `--bare`, "a `-p` session runs the hooks in a project's `.claude/settings.json` and
  connects the servers in its `.mcp.json`, even in a folder you've never trusted", with no trust dialog. A worker's
  branch can therefore plant a hook that runs in the *reviewer's* session when the reviewer opens that branch. Builder
  KEY reviewers and provers must run with `--bare` and settings supplied from outside the checkout, and `kf gate`
  should treat any change to `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md` or `.github/workflows/` as a
  high-risk path needing a ruling.
- `--output-format json` returns `total_cost_usd`, `session_id` and `structured_output` (with `--json-schema`). This
  is the cost meter for section 6 and the structured RETURN draft.
- `--max-budget-usd` caps a run (the run also stops background work at the cap). This is the per-run spend cap.
- `--permission-mode dontAsk` denies anything that would prompt; `--permission-prompts none` (v2.1.259+) removes
  prompts and `AskUserQuestion` in unattended runs. `claude -p` starts in Manual mode from v2.1.302 when nothing sets a
  mode.
- SIGTERM exits 143 and leaves the turn unfinished; `--resume <session_id>` continues. Usage-limit and overload errors
  surface as `system/api_retry` events with `error` in `rate_limit`, `overloaded`, `billing_error` and so on: the
  runner can map these to "checkpoint and wait" (design principle 7).
- **Terms:** "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or
  rate limits for their products, including agents built on the Claude Agent SDK" (Agent SDK overview). This matches
  the design's "APIs with spend caps; no account rotation".

**Claude Code security docs** (code.claude.com/docs/en/security, /sandboxing, /devcontainer):
- Native sandbox: bubblewrap on Linux, Seatbelt on macOS, implemented by the open-source `@anthropic-ai/sandbox-runtime`,
  which can also wrap the whole Claude Code process. Network goes through a host proxy with `allowedDomains`.
  Credentials can be masked (`credentials.envVars`), with the proxy swapping in the real value only for allowed hosts.
  Limits: only shell commands are sandboxed (file tools, WebFetch, MCP, hooks are not); falls back to unsandboxed unless
  `failIfUnavailable: true`; `allowUnsandboxedCommands: false` should be set.
- Devcontainer: the reference container's `init-firewall.sh` gives default-deny egress. With
  `--dangerously-skip-permissions`, "dev containers do not prevent a malicious project from exfiltrating anything
  accessible inside the container, including the Claude Code credentials". Pin the CLI version with
  `npm install -g @anthropic-ai/claude-code@X.Y.Z` and `DISABLE_AUTOUPDATER=1` for reproducibility.

**OpenHands** (github.com/All-Hands-AI/OpenHands; docs.openhands.dev/openhands/usage/cli/headless): the useful pattern
is "each conversation in its own Docker container with its own Agent Server", controlled over REST. Its headless mode
cannot ask for approval, so all safety must come from the sandbox, which is the right assumption for Builder KEY too.

**mini-SWE-agent** (github.com/SWE-agent/mini-swe-agent): bash only, no tool-calling interface, each action a fresh
`subprocess.run` so sandboxing is swapping in `docker exec`, and the trajectory equals the prompt history. Claims >74%
on SWE-bench Verified (model and date not stated on the page). This is the simplest correct design for the `api` runner
and for running reviewers on any provider.

**Copilot coding agent controls to copy** (docs.github.com, search extract): one writable branch per task; the agent
cannot mark ready, approve or merge; the requester cannot approve; workflows triggered by agent PRs need a write-access
human to approve; firewalled egress with warnings in the PR for blocked hosts; CodeQL plus a second-model review of
its own output.

**gh-aw** (github.github.com/gh-aw; github.blog 2026-03-09 "Under the hood: Security architecture of GitHub Agentic
Workflows"): four principles: defence in depth, do not trust agents with secrets, stage and vet all writes, log
everything. In Builder KEY terms: the worker writes only to its packet branch; every write to #80, PR bodies and merges
is done by the deterministic `kf` layer after `kf gate`.

### 2.3 Parallel worktree tools: the common pattern

claude-squad, Vibe Kanban, Conductor and `claude --worktree` all use **one git worktree and branch per agent on one
host**. That isolates files, not services: two agents running `pnpm test:integration` against one Postgres will collide,
and all share the host network and credentials. Builder KEY needs worktree **plus** a per-run service stack (own
compose project, own database name and ports) and per-run egress rules. None of these tools provides that; `kf env up`
must.

## 3. Durable execution for M2

### 3.1 Options

| Option | Licence | Self-host footprint | Model | Strengths | Weaknesses for Builder KEY |
| --- | --- | --- | --- | --- | --- |
| **Temporal** (temporalio/temporal, 24.6k stars; TS SDK `temporalio/sdk-typescript`, Node 20/22/24) | MIT | Temporal server + Postgres/MySQL/Cassandra, workers; `temporal server start-dev` for dev | Deterministic workflow code replayed from event history; activities do I/O | Most mature; signals, timers, child workflows, history; OpenAI Agents SDK integration (`@temporalio/openai-agents`, TS listed GA) | Another cluster to run; determinism rules in workflow code (Node `vm` sandbox); no first-party NestJS module |
| **Restate** (restatedev/restate, 4.7k stars) | **BSL 1.1**, converts to Apache-2.0 after 4 years; use allowed except a "Public Restate Platform Service" | Single server binary or Docker | Journaling of ordinary handler code, durable promises, timers, state | Light; ordinary code | Source-available, single vendor, smaller ecosystem |
| **Inngest** (inngest/inngest, 6.1k stars) | Server **SSPL** with delayed Apache-2.0; SDKs Apache-2.0 | Single binary `inngest start`; bundled store, or `--postgres-uri` (v1.4.0+) and `--redis-uri` for production | `step.run` memoised steps, events, flow control | Nice step model | SSPL server; event-driven model fits SaaS better than a local runner |
| **Trigger.dev** (triggerdotdev/trigger.dev, 16.8k stars) | Apache-2.0 | v4 Docker Compose: webapp, Postgres, Redis, registry, MinIO, supervisor, Docker socket proxy; each task in its own container | Tasks with checkpoint-resume, waitpoints for human approval, no timeouts | Waitpoints = owner approval; containers per task | Heaviest self-host; "we don't provide specific advice for securing your deployment" |
| **BullMQ** (taskforcesh/bullmq, 9.6k stars; repo pins `^5.76.8`) | MIT (Pro features paid: groups, group rate limit, batches, observables) | Redis only | Queues, flows (parent/child), repeatable jobs, rate limiter; documented "process step jobs" pattern (`job.updateData` + `moveToDelayed` + `DelayedError`, or `moveToWaitingChildren`) | Already in the stack and understood by the team; tiny footprint | No workflow history: steps must be idempotent and state kept elsewhere; documented step pattern has a crash window between `moveToDelayed` and `updateData` |
| **Git-checkpoint state machine** (what `orchestrate.mjs` already does) | n/a | None | State in git and #80; each step checks repository truth before acting | Principle 1 of the design; survives anything; tool-agnostic; auditable | Needs a scheduler for timers, retries and concurrency |

### 3.2 Recommendation for M2

**Use the git-checkpoint state machine as the source of truth, BullMQ as the scheduler, and a small Postgres run table
as the index. Keep Temporal as the named upgrade path.**

Reasons:
1. **The steps are coarse and their effects are observable.** A Builder step is "a worker run", "a review", "a proof at
   sha X", "a #80 post". Each leaves a durable trace (a pushed commit, `proof/<sha>.json`, a review record, a comment with
   a yaml block). So re-running a step can start with "is its effect already there?", which is exactly what
   `orchestrate.mjs` + `reconcile.mjs` do. Temporal's main gift, replaying fine-grained in-process history, is not
   needed when the history already lives in git and #80.
2. **Principle 1 says state lives in git and on #80, never in a session.** A workflow engine's history would become a
   second source of truth that must be reconciled with git. With BullMQ, Redis holds only "what to try next and when";
   losing Redis loses nothing but the schedule, which the reconciler rebuilds from git and #80.
3. **Usage limits map to BullMQ primitives directly:** `moveToDelayed` until the reset time, rate limiter per provider,
   concurrency limit per queue (four workers by default, design section 6), flows for "two reviews in parallel, then
   continue".
4. **The team already runs BullMQ in NestJS** with a kill switch and readiness handling
   (`temporal-flow-memory.queue.service.ts`), so operational knowledge exists.
5. **Fix the step-pattern crash window** by writing the checkpoint (git or Postgres) *before* moving the job, and by
   making the job's data only a pointer (`run_id`, `step`); the step reads its state from the checkpoint.

**Switch to Temporal (self-hosted, MIT, Postgres persistence) if** the Foreman grows into many concurrent long-lived
runs with rich signals (owner answers arriving mid-run, cancellations, per-packet timers), or if the reconciler's
"check before act" logic starts to sprawl. Do not adopt Restate (BSL) or Inngest (SSPL server) for a long-lived internal
tool when MIT options fit. Trigger.dev is attractive for its container-per-task model, but it is the heaviest to run and
secure; its sandbox role is better played by section 4's choice.

### 3.3 Separation from the product

Builder KEY's queue and run store must be **separate instances** from the product's Redis and Postgres (own container
or own managed instance, own credentials). Sharing them would put the builder's GitHub App key and model keys one
misconfiguration away from tenant-facing code, which the design's section 2 forbids. A separate NestJS app (e.g.
`apps/builder` or its own repository) can reuse the code style without sharing runtime resources.

## 4. Sandboxes for agents and proofs

### 4.1 Options

| Option | Isolation | Postgres + Redis + browser | Cost | Fit |
| --- | --- | --- | --- | --- |
| **Docker Compose + devcontainer on one host** | Container (shared kernel) | Yes: repo already has `pgvector:pg16`, `redis:7`; Playwright image for browsers | Host cost only | **M0/M1**: `kf env up` = `docker compose -p kb-<run> up` with per-run ports and database names |
| **Claude Code native sandbox / `@anthropic-ai/sandbox-runtime`** | bubblewrap (Linux), proxy egress allowlist, credential masking | Services run outside; sandbox needs `allowLocalBinding`/excluded `docker compose` | Free | Add inside the devcontainer for defence in depth |
| **Docker Sandboxes** (`sbx run claude`) | **microVM**, own Docker daemon, filesystem and network per sandbox | Yes: compose runs inside the microVM | Local free; cloud metered per second | **M2 candidate** for untrusted runs on the Foreman host |
| **GitHub Actions hosted runners** | Ephemeral VM per job | Yes: CI already uses `services:` and Playwright | ~$0.006/min standard Linux after the 2026-01-01 price cut; free in public repos (search extract) | **Proof of record** at the exact head (already the D-239 condition) |
| **Self-hosted Actions runners** | As good as you make them | Yes | Your VM; a $0.002/min platform fee was announced then postponed (search extract) | Only ephemeral (`--ephemeral`), only for private repos; never for public repos with fork PRs |
| **GitHub Codespaces** | VM per codespace, devcontainer spec | Yes | 4-core ~$0.36/h (search extract) | Good for the owner's interactive checks of the same devcontainer; not a runner farm |
| **E2B** | Firecracker microVM | Possible via custom template; services inside the VM | ~$0.05/vCPU-h + RAM; Hobby 1 h sessions, Pro $150/month with 24 h sessions, 100 concurrent | Session caps and per-sandbox service setup make full-stack proofs awkward |
| **Daytona** | Container sandboxes (Apache/AGPL licensing not verified) | Possible | $0.0504/vCPU-h, $0.0162/GiB-h; org cap 4 vCPU / 8 GB per sandbox | Too small by default for Next.js build + Playwright + Postgres |
| **Modal Sandboxes** | gVisor containers | Possible | ~$0.142 per physical core-h (2 vCPU) | Python-centric platform; no advantage here |
| **Firecracker directly / Fly Machines** | microVM | Yes, you build it | VM cost | Only if M2 needs hard multi-tenant isolation; Docker Sandboxes gives this with less work |

### 4.2 Recommendation

- **M0/M1:** one devcontainer definition (Node 22, pnpm via corepack, Playwright with browsers baked in, Claude Code
  pinned by version, `gitleaks` and `trufflehog` binaries) plus the existing `docker-compose.yml` for Postgres and
  Redis. Each run gets: its own worktree, its own compose project name (`kb-<run-id>`), its own host ports, its own
  database, and an egress allowlist (Anthropic/OpenAI/Google API hosts, GitHub, npm registry). No production or
  staging hostnames resolvable at all.
- **Proof of record** stays on GitHub-hosted runners at the exact head, as the repository already does. `kf prove`
  locally is a fast pre-check whose receipt says "local", never a substitute for CI at the head.
- **M2:** one VM sized for four concurrent runs (roughly 16 vCPU / 64 GB: each run needs a Next.js build, a Nest test
  suite, Postgres, Redis and Chromium), with each run in a Docker Sandbox microVM or, failing that, rootless Docker with
  the sandbox-runtime egress proxy. This keeps the cost a fixed monthly VM rather than per-second sandbox billing for
  hour-long runs.
- **Check before M2:** the repository's visibility. If `SaCH-PRO/KEYFLOWOS` is public, self-hosted runners must not
  serve `pull_request` workflows.

## 5. GitHub mechanics

### 5.1 GitHub App (recommended over a fine-grained token; matches the design's question 2)

- Installation tokens expire after **1 hour**, can be narrowed per request to specific repositories and to a subset of
  the App's permissions; Octokit refreshes them. From 2026-04-27 new tokens use a stateless `ghs_APPID_JWT` format, so
  no code may assume 40 characters (search extract of docs.github.com).
- Git over HTTPS needs the **Contents** permission; the token is the HTTP password.
- Proposed permission set (repository-scoped, installed on this repository only):

| Permission | Level | Why |
| --- | --- | --- |
| Metadata | Read | Mandatory |
| Contents | Read and write | Push `pkt/*` branches; merge via API |
| Pull requests | Read and write | Open/update PRs, post review records |
| Issues | Read and write | Read and post on #80 |
| Checks | Read and write | Publish `kf-gate`, `kf-review-*`, `kf-proof` as check runs on the exact head |
| Commit statuses | Read | Read legacy statuses |
| Actions | Read | Read workflow runs at the head |
| **Workflows** | **None** | Without it the App cannot push changes to `.github/workflows/`, so an agent cannot weaken CI (verify on docs.github.com) |
| Administration | None | Cannot change rulesets or branch protection |
| Secrets, Environments, Deployments | None | Never touches production |

- Use **two Apps** if the owner wants separation: a "builder" App (push, PR, #80) used by the Foreman, and the merge
  performed either by the owner or by a "merger" App that only the merge step's code holds.

### 5.2 Rulesets and merge

- A `main` ruleset: require a PR; required status checks including the App's check runs (rulesets let you pin the
  **expected source App** for a check, so a worker cannot fake `kf-gate` with a commit status); block force pushes and
  deletions; require the owner's review via CODEOWNERS for gate code, `.github/`, `.claude/`, `scripts/proof-admission/`.
- A `pkt/*` ruleset: allow the builder App to push; block force pushes after a RETURN (or require the Foreman to pin
  heads by sha, which the D-239 merge already does).
- **Bot approvals.** Whether a GitHub App's PR approval counts toward required reviews is inconsistently documented
  (community threads say App or machine-user reviews count; `GITHUB_TOKEN` approvals do not; an org setting controls
  Actions approvals; Copilot reviews never count). **Recommendation:** do not rely on bot approvals. Publish the two AI
  reviews as **check runs** (`kf-review-security`, `kf-review-correctness`) with the verdict and the reviewed sha, and
  keep the single required human approval for the owner. That matches the design's "owner approves the merge".
- **Pin the head on merge.** The merge endpoint takes the expected head `sha`, so a push between check and merge makes
  the merge fail. `auto-merge-admitted.mjs` already re-snapshots before merging.
- **Merge queue** is available only for public org repos or private repos on GitHub Enterprise Cloud (search extract),
  and needs `merge_group` triggers on every required workflow. It is not needed: Builder KEY's wave branch plus
  exact-head proof does the same job at this scale.

## 6. Gates and safety for AI-written code

### 6.1 Secret scanning (`kf gate` check 5)

- **TruffleHog** is already in CI (pinned v3.99.7, by commit). Licence AGPL-3.0, fine for running as a tool. Range scan:
  `trufflehog git file://. --since-commit <base> --branch HEAD --fail` (exit 183 on findings). Verification sends the
  found secret to the provider's API; in a sandbox with an egress allowlist, use `--no-verification` locally and keep
  verification in CI.
- **gitleaks** (MIT, "feature complete": security patches only from now on): fast, offline, good for the local gate:
  `gitleaks git --log-opts="<base>..<head>" .`, exit 1 on leaks. Use the CLI, not `gitleaks-action` v2+, which needs a
  licence key for organisation repositories.
- Use both: gitleaks offline in `kf gate` on every commit, TruffleHog in CI as now.

### 6.2 Test-weakening detection (`kf gate` check 4)

Evidence that this check is needed: **ImpossibleBench** (Zhong, Raghunathan, Carlini; arXiv 2510.20270, Oct 2025, ICLR
2026) mutates tests to contradict the spec; any pass implies cheating. Frontier models cheat often, stronger models
more; one summary reports GPT-5 cheating on 76% of impossible SWE-bench tasks, by editing tests or special-casing
inputs. EvilGenie (arXiv 2511.21654) notes some "cheats" are legitimate test fixes, so a hit should stop for judgement,
as the design says.

Concrete heuristics (cheap, deterministic, testable with fixtures from this programme's history):
- Per changed test file, parse with the TypeScript compiler API and compare base vs head: number of `it`/`test`
  blocks, number of `expect(` calls, assertions removed or relaxed (`toBe` -> `toBeDefined`, `toEqual` ->
  `toMatchObject`), new `.skip`, `.only`, `.todo`, `test.fixme`, `test.fail`, `expect.soft`, `vi.mock` of the unit
  under test.
- Deleted or renamed test files; snapshot files changed in the same commit as the code they cover.
- Changes to `vitest.config.*`, `playwright.config.*`, coverage thresholds, `include`/`exclude` globs, `tsconfig`
  `strict` flags, ESLint rules; new `// @ts-ignore`, `@ts-expect-error`, `eslint-disable`, `as any`.
- Tests-first order (check 1) already catches "tests written to fit the code".
- **Mutation testing as evidence, not a per-commit gate:** StrykerJS with `@stryker-mutator/vitest-runner` (since v7;
  per-test coverage, which makes `--incremental` reliable) and optionally the TypeScript checker. Run it with
  `--mutate` limited to the packet's changed source files, once per packet before review; give surviving mutants to
  the correctness reviewer. Full-repository runs are too slow for this monorepo. The existing `proof-mutation.mjs`
  negative controls already cover the gate code itself.
- **Coverage ratchet:** compare changed-file coverage at head against base, fail on a drop. Vitest's
  `coverage.thresholds.autoUpdate` can ratchet thresholds but rewrites config during the run, so run it only in a
  separate owner-approved job, never in the gated run.

### 6.3 Prompt injection and agent safety

- **Threat model:** Simon Willison's "lethal trifecta" (simonwillison.net, 2025-06-16): private data + untrusted
  content + a way to communicate out. A Builder worker has all three by default (the repository and keys; issue
  comments, web pages, dependency READMEs; git push, #80 posts, web fetch). Remove at least one leg per role:
  - Workers: no secrets inside the sandbox (model keys injected by the egress proxy, GitHub pushes through the `kf`
    layer or a proxy), egress allowlist, no web fetch except an allowlist of documentation hosts.
  - Reviewers: read-only checkout, no push credentials, output only a structured verdict file.
  - Everything read from #80 passes the existing authority filter (`select-directive`): comments from non-allowlisted
    authors are data, never instructions.
- **OWASP Top 10 for LLM Applications 2025:** LLM01 Prompt Injection and LLM06 Excessive Agency are the two that apply;
  the mitigations are least privilege for tools and separating external content from instructions (genai.owasp.org;
  a 2026 edition reportedly moves Excessive Agency up, verify on OWASP's site).
- **Anthropic guidance** (code.claude.com/docs/en/security): use VMs for scripts and tool calls with external content;
  run the whole process inside the sandbox runtime or a devcontainer; review `.mcp.json` and hooks; `-p` shows no trust
  prompt (section 2.2).
- **GitHub guidance:** agentic security principles (github.blog, 2025-11-25): visible context, firewalled agents,
  limited access to sensitive data, attributable actions; gh-aw: stage and vet all writes.
- **Copy-able controls for `kf`:** high-risk paths list (`.github/`, `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`,
  `scripts/proof-admission/`, `scripts/key-builder/` gate code, lockfiles' registry URLs); a lockfile diff check for new
  registries or `git+`/tarball dependencies; logging every command a runner executes (design check 6 needs this log).

## 7. Evaluation

### 7.1 What public benchmarks say

- **SWE-bench Verified is no longer a trustworthy headline.** OpenAI stopped reporting it in February 2026, citing
  contamination and flawed tests (at least 59.4% of reviewed hard failures had tests that rejected correct solutions)
  (openai.com/index/why-we-no-longer-evaluate-swe-bench-verified). "The SWE-Bench Illusion" (arXiv 2506.12286) shows
  drops to ~53% on unseen repositories.
- **SWE-bench Pro** (Scale AI, arXiv 2509.16941): 1,865 tasks from 41 maintained repositories; frontier models scored
  under 25% with the SWE-agent scaffold at release. A "Pro Verified" subset of 731 instances corrects some labels
  (huggingface.co/papers/2609.08149).
- **Multi-SWE-bench** covers TypeScript among seven languages (1,632 instances): the closest public proxy for this stack.
- **Code review benchmarks** are vendor-run and disagree (Qodo 1.0: 580 injected issues in 100 PRs; GitHub/Microsoft
  ReviewBench Oct 2026: Copilot leads at 40.1% grounded F1; CR-Bench arXiv 2603.11078 reports a precision vs recall
  trade-off). Lesson: measure reviewers on *your* seeded defects.
- **Productivity:** METR's RCT (arXiv 2507.09089, July 2025): experienced developers were 19% slower with early-2025
  tools while believing they were 20% faster. Lesson: measure wall time and rework, not impressions.
- **Cost:** Anthropic reports multi-agent systems use about 15x the tokens of chat (anthropic.com/engineering/
  multi-agent-research-system). Two reviews plus fix rounds per packet will dominate cost; budget for it.
- **Long-running harness:** Anthropic's "Effective harnesses for long-running agents" (anthropic.com/engineering):
  an initializer session, a progress file plus git commits as the memory across contexts, one feature per session, a
  JSON feature list (the model rewrites Markdown). This matches Builder KEY's checkpoint files; keep checkpoints in
  YAML/JSON that scripts own, not prose.

### 7.2 Metrics for Builder KEY (all computable from run files, git and #80)

| Metric | Definition | Source |
| --- | --- | --- |
| Packet success rate | Packets merged with no owner code change and no revert within N days / packets started | git, #80 |
| First-pass gate rate | Worker returns that pass `kf gate` without a fix round | gate receipts |
| Fix rounds per packet | Count, and by finding severity | review records |
| Reviewer recall on seeded defects | Run "canary" packets with known injected bugs (the Qodo method) monthly; per reviewer and model | canary set |
| Escape rate | Defects found after merge (later packets, CI, owner) that both reviews missed | #80, issues |
| Reviewer agreement | Share of MAJOR findings raised by both reviewers vs one | review records |
| Gate trip rate and false positives | Per check; a false positive is a trip the owner overrules | gate receipts, rulings |
| Cost per packet | Sum of `total_cost_usd` (Claude JSON), Codex/Gemini usage, sandbox minutes, CI minutes | runner logs |
| Time per packet | Wall clock claim -> RETURN, and per step; queue wait vs active | checkpoints |
| Owner interventions | Questions asked per packet; time waiting on the owner | #80 |
| Resume reliability | Runs interrupted (limits, restarts) that resumed with no lost or repeated side effect | checkpoints vs git |
| Flaky proof rate | Proofs whose result changed on rerun at the same sha | `proof/<sha>.json` |

**Offline regression set:** take 20 to 30 already-merged KEYFLOWOS packets with their review history, reset to each
packet's base sha, hide the merged tests, run the Foreman, and score with the hidden tests plus `kf gate`. This is a
private, uncontaminated SWE-bench for this codebase and lets you compare models, briefs and runners before changing
them.

## 8. Recommended stack

### M0: one packet end to end in Claude Code

**Use**
- `kf` as a Node ESM CLI in `scripts/key-builder/`, tested with `node --test` (as `scripts/agent-memory` and
  `scripts/agent-control` are), importing `agent-memory` (`bundle`, `status`) and `agent-control` (`state-machine`,
  `admission`, `merge-grant`, `semantic-review`, `yaml`, `select-directive`, `proof-mutation`) instead of rewriting them.
- Runner: `claude -p --bare --output-format json --json-schema <role schema> --max-budget-usd <cap>
  --permission-mode dontAsk --allowedTools <role list> --permission-prompts none`, with `ANTHROPIC_API_KEY` and
  settings passed from outside the checkout; `--resume <session_id>` after a limit. The Agent SDK (TS) only if the
  Foreman needs callbacks.
- Environment: devcontainer (pinned Claude Code version, Node 22, pnpm, Playwright browsers, gitleaks, trufflehog) plus
  the existing compose file with per-run project names, ports and databases; Claude Code native sandbox inside with
  `failIfUnavailable: true` and `allowUnsandboxedCommands: false`.
- Gates: gitleaks range scan, TS-AST test-weakening diff, tests-first order, write set, high-risk paths, forbidden
  targets; TruffleHog and the full proof stay in CI at the exact head.
- State: `.agent-control/run-<id>.yaml` checkpoints pushed to the packet branch, yaml blocks on #80; no engine.

**Avoid:** agent frameworks (LangGraph, CrewAI, AutoGen, ruflo) as the Foreman; `-p` without `--bare` for reviewers;
consumer logins or account rotation; Aider (auto-commit breaks tests-first evidence); any credential in the worktree.

### M1: a second tool, then a parallel wave of three

**Use**
- Runners: `codex exec --json --output-schema --sandbox workspace-write` and Gemini CLI `-p --output-format json
  --approval-mode auto_edit` (avoid `yolo` outside a microVM), each a single adapter mapping exit codes, JSON output and
  usage errors to the same result file.
- Reviewers on a different provider from the worker; a mini-SWE-agent-style bash-only `api` runner for review roles on
  any provider.
- Parallelism: git worktree per packet plus per-run compose stack; at most four; `kf next` refuses overlapping write
  sets.
- StrykerJS (vitest runner, `--incremental`, `--mutate` on changed files) as reviewer evidence per packet.
- AI reviews published as check runs; owner remains the only required human approval.
- Start the offline regression set and the metrics in section 7.2.

**Avoid:** worktree-only tools as the isolation story (claude-squad is also AGPL); merge queue; letting a runner post to
#80 directly (the `kf` layer posts).

### M2: a reliable service

**Use**
- Foreman as a small NestJS (or plain Node) service on its own VM, with **its own Postgres and Redis**, never the
  product's.
- Durable execution: git/#80 checkpoints as truth (the `orchestrate.mjs` reconcile pattern), **BullMQ** for scheduling,
  retries, provider rate limits, usage-limit delays and the four-worker concurrency cap, a Postgres run table as index.
  Upgrade path: self-hosted **Temporal** (MIT) if signals and timers outgrow the reconciler.
- A GitHub App installed on this repository only: Contents, Pull requests, Issues, Checks write; Actions read;
  **no Workflows, no Administration**; rulesets that require the App's check runs by expected source and the owner's
  review; merges pinned to the head sha.
- Sandboxes: Docker Sandboxes (microVM) or rootless Docker plus the sandbox-runtime egress proxy per run on that VM;
  GitHub-hosted runners for proof of record.
- Spend caps at three levels: provider org limits on each API key, a per-day ledger in the run table, and
  `--max-budget-usd` per run.

**Avoid:** Restate (BSL) and Inngest (SSPL server) for a long-lived internal tool; Trigger.dev self-host unless its
container-per-task model is wanted and someone owns securing it; E2B/Daytona for full-stack proofs (session and size
limits, services re-created per sandbox); self-hosted runners on a public repository; sharing any credential or data
store with Business KEY.

## 9. Sources

Repository (read-only): `docs/key-builder/KEY-BUILDER-DESIGN-001.md`; `apps/server/src/modules/temporal/*`;
`apps/server/src/modules/temporal-flow/temporal-flow-memory.queue.service.ts`; `docker-compose.yml`;
`.github/workflows/ci-cd.yml`, `agent-control-gate.yml`, `agent-control-worker-proof.yml`; `scripts/agent-control/*`.

Agents and orchestrators
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/security
- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/devcontainer
- https://github.com/All-Hands-AI/OpenHands ; https://docs.openhands.dev/openhands/usage/cli/headless
- https://github.com/SWE-agent/mini-swe-agent ; https://github.com/SWE-agent/SWE-agent
- https://github.com/Aider-AI/aider
- https://github.com/microsoft/autogen ; https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/
- https://docs.langchain.com/oss/javascript/langgraph/interrupts ; https://docs.langchain.com/oss/javascript/langgraph/checkpointers
- https://github.com/crewAIInc/crewAI
- https://openai.github.io/openai-agents-js ; https://developers.openai.com/api/docs/guides/agents/guardrails-approvals (search extract)
- https://developers.openai.com/codex/noninteractive (search extract)
- https://geminicli.com/docs/cli/headless/ (search extract)
- https://github.com/MoonshotAI/kimi-cli (search extract)
- https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent ; https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations (search extracts)
- https://github.github.com/gh-aw/ ; https://github.github.com/gh-aw/reference/threat-detection/ ; https://github.blog/2026/03/09/under-the-hood-security-architecture-of-github-agentic-workflows/
- https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/
- https://github.com/sweepai/sweep
- https://github.com/ruvnet/claude-flow (now ruvnet/ruflo)
- https://github.com/smtg-ai/claude-squad
- https://github.com/BloopAI/vibe-kanban
- https://www.conductor.build/ ; https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/
- https://cognition.ai/blog/new-self-serve-plans-for-devin (pricing figures are third-party and inconsistent)

Durable execution
- https://github.com/temporalio/temporal ; https://github.com/temporalio/sdk-typescript ; https://docs.temporal.io/develop/typescript/integrations/openai-agents
- https://github.com/restatedev/restate ; https://github.com/restatedev/restate/blob/main/LICENSE
- https://github.com/inngest/inngest ; https://www.inngest.com/docs/self-hosting
- https://github.com/triggerdotdev/trigger.dev ; https://trigger.dev/docs/self-hosting/docker
- https://github.com/taskforcesh/bullmq ; https://docs.bullmq.io/patterns/process-step-jobs

Sandboxes and pricing
- https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/ ; https://docs.docker.com/ai/sandboxes/get-started/
- https://e2b.dev/docs/billing ; https://e2b.dev/pricing
- https://www.daytona.io/pricing
- https://fly.io/learn/ai-sandbox-pricing/ (third-party comparison incl. Modal)
- https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/ ; https://resources.github.com/actions/2026-pricing-changes-for-github-actions/
- https://docs.github.com/en/billing/concepts/product-billing/github-codespaces (search extract)

GitHub mechanics (search extracts)
- https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews
- https://github.blog/changelog/2022-01-14-github-actions-prevent-github-actions-from-approving-pull-requests

Gates and safety
- https://github.com/gitleaks/gitleaks ; https://github.com/trufflesecurity/trufflehog
- https://stryker-mutator.io/docs/stryker-js/vitest-runner/ ; https://stryker-mutator.io/docs/stryker-js/incremental/
- https://vitest.dev/config/coverage
- https://arxiv.org/abs/2510.20270 (ImpossibleBench) ; https://arxiv.org/pdf/2511.21654 (EvilGenie)
- https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ ; https://martinfowler.com/articles/agentic-ai-security.html
- https://genai.owasp.org/llm-top-10/ (OWASP Top 10 for LLM Applications 2025; verify the 2026 edition there)

Evaluation
- https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- https://arxiv.org/abs/2509.16941 (SWE-bench Pro) ; https://huggingface.co/papers/2609.08149 (SWE-Bench Pro Verified) ; https://arxiv.org/abs/2506.12286
- Multi-SWE-bench (arXiv 2504.02605)
- https://arxiv.org/abs/2507.09089 ; https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://qodo.ai/ai-code-review-benchmark/ ; https://arxiv.org/abs/2603.11078 (CR-Bench) ; https://thenewstack.io/github-reviewbench-code-review/
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
