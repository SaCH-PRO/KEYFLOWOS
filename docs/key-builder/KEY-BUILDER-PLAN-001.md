# KEY Builder: execution plan 001

Status: plan for the owner, 2026-11-24. It follows rulings D-268 (focus on building KEY), D-269 (its shape) and D-270
(the owner accepted the design's four recommendations), and the design in `KEY-BUILDER-DESIGN-001.md`.

It rests on four research reports, in `research/` beside this file:

| Report | What it covers |
| --- | --- |
| A, the product's own AI code | KEY's server modules, tool registries, model providers, admin surfaces |
| B, the programme's tooling and lessons | `scripts/agent-memory`, `scripts/agent-control`, `scripts/proof-admission`, CI, all 182 PRs, all 1,990 comments on #80 |
| C, the AI tools' unattended modes | Claude Code and the Agent SDK, Gemini CLI and Antigravity, Codex and the OpenAI APIs, Kimi, MCP, AGENTS.md |
| D, the wider ecosystem | Open-source orchestrators, durable execution, sandboxes, GitHub mechanics, gates for AI-written code, evaluation |

Each report gives file:line references, PR numbers, #80 comment ids and URLs.

Limits of the research: one repository is reachable from this account (SaCH-PRO/KEYFLOWOS). Five vendor sites were
blocked from the research session: ai.google.dev, antigravity.google, developers.openai.com, docs.github.com and
moonshotai.github.io. Facts taken from those sites are marked "(search extract)" or "unverified" in C and D. They must
be re-read before a cap or a gate depends on them (packet KB-002 does this).

## 1. What the research changed

1. **Most of the parts already exist. Builder KEY is the programme's fourth attempt at automating itself, not the
   first.**
   - `scripts/agent-memory/` gives the plan reader, the packet bundles, the ready list and squash mechanics, with
     tests in CI.
   - `scripts/proof-admission/` gives Release 0 receipts tied to an exact commit, and refuses non-local databases.
   - `scripts/agent-control/` (about 7,200 lines and 28 specs, last changed 13 Nov) holds:
     - vendor-neutral roles, with the rule that no adapter reviews its own work;
     - a headless Claude worker;
     - an exact-head merge admission check, and a merge grant read from #80;
     - a packet state machine and failure-loop detection.
   - The `kf` CLI is a thin layer that imports these modules (B §4, D §1). The design's section 8 is replaced by
     section 4 below.
2. **The earlier attempts failed in ways that become gates.**
   - **The control plane:** the ChatGPT-era control plane deadlocked on a strict #80 parser, with 906 drift posts and
     335 "claude is not on PATH" posts.
   - **Usage limits:** nine sessions at once hit the shared usage limit. A seven-day model limit lost three unpushed
     packets.
   - **Proof runs:** proof was run without `.env`, the head moved mid-suite, a container restart stopped Postgres and
     Redis, and a PR reported green while CI was red.
   - **Browser bugs:** jsdom missed bugs that only a browser shows.
   - **Git:** a reviewer's checkout polluted a worker's worktree, and two accounts built two different "wave 3j"
     branches.
   - B §3b lists each with evidence. Section 5 below maps each to a check.
3. **Builder KEY must not run as an ordinary Claude Code session.**
   - Run headless, Claude Code loads the hooks and MCP servers stored in the checkout with no prompt. A worker's
     branch could plant a hook that then runs inside a reviewer's or a proof run's session.
   - So every runner starts with `--bare` and with settings supplied from outside the checkout.
   - Any change to `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md` or `.github/workflows/` is high risk (D §6.3).
4. **Personal plans cannot be automated.** The terms of Anthropic, Google (Gemini CLI and Antigravity) and Moonshot
   (Kimi) all limit consumer logins to individual, interactive use. Wrapping them in another agent, or rotating
   accounts, risks suspension. Builder KEY runs on API keys with spend caps. The owner may keep using Antigravity by
   hand (C §2.3, §5.3, §6, §8).
5. **The product has a security risk that Builder KEY's boundary depends on.**
   - Tenant KEY's `execute_custom_logic` writes and runs JavaScript. Its default backend is a child process on the
     API host, which the code can escape (A §5, unverified by running).
   - Tenant KEY reaches tools through four registries plus MCP. Role wildcards would grant future tools whose names
     match.
   - The `/admin` gate on the web is client-side only.
   - Builder KEY must never run on, or keep credentials on, a host that runs the product API.
6. **The repository is public.**
   - Self-hosted runners must not run PR workflows.
   - Proof of record stays on GitHub-hosted runners.
   - Merge queue is not needed.
7. **No outside orchestrator is adopted as the Foreman** (D §2).
   - LangGraph, CrewAI, AutoGen (in maintenance mode), ruflo/claude-flow and OpenHands (always auto-approves when
     headless) are all rejected.
   - claude-squad is AGPL. Aider's auto-commit breaks tests-first evidence.
   - Patterns copied:
     - mini-SWE-agent: a bash-only loop for reviewers on any provider;
     - Copilot coding agent: one branch per task, and the agent cannot approve its own work;
     - GitHub Agentic Workflows: agents propose writes, and a separate step checks and applies them.
8. **Durable execution needs no new engine before M2.**
   - Git and #80 checkpoints are the truth.
   - M2 adds BullMQ (already in the repo) for scheduling, usage-limit delays and the four-worker cap, with a Postgres
     run table as the index. Builder's own Redis and Postgres are never the product's.
   - Upgrade path if needed: Temporal (MIT). Avoid Restate (BSL) and Inngest (SSPL server).
   - The repo's `modules/temporal` is a business calendar, not Temporal.io.

## 2. Questions for the owner (one batch; recommendation first)

| # | Question | Recommendation | Why |
| --- | --- | --- | --- |
| Q1 | What happens to `scripts/agent-control/` and its three workflows (an hourly autopilot that posts on #80, and a `pull_request_target` workflow on a public repo)? | **Switch the autopilot and its #80 posting off now. Keep the modules as a library that `kf` imports. Retire the rest once M1 passes.** | Two orchestrators with different rules is the worst case. The autopilot produced the 906 drift posts. `pull_request_target` on a public repo needs care |
| Q2 | API keys only, never consumer logins, and the starting spend caps? | **API keys only. $40 per run, $120 per packet, $300 per day. Builder KEY's own counters stop new runs before a cap, and provider caps are the backstop** | Provider terms (finding 4). Provider caps lag by up to about 10 minutes. A packet costs about $15–25 of worker time plus reviews (C §13) |
| Q3 | Antigravity? | **The owner keeps using it by hand. Builder KEY does not drive it until Google confirms the terms in writing. The second automated runner is Gemini CLI on a paid Gemini API key** | Antigravity's FAQ: wrapping `agy` in third-party agents is not supported on consumer plans |
| Q4 | Merge the proven stack before M0? | **Yes. Build a wave from `pkt/V1-SWP-INV-PUBLIC-LINK` @ 8ae6abfa (MOUNT-QUOTES + SWP-INV-MATH + SWP-INV-PUBLIC-LINK), run journeys D and E live, and merge under D-239. Split `wave/3j-second-lane` before it ships** | Without this, M0's packet SWP-QUOTE-PUBLIC-PAGE sits three branches deep and `kf next` calls it not ready. Wave 3j fails the 25-commit / 50-file divergence gate (B §4) |
| Q5 | The `execute_custom_logic` risk? | **Open a security packet now (SEC-KEY-CUSTOM-LOGIC). Confirm it with a test. Then default the tool to a real sandbox (the repo already depends on `@e2b/code-interpreter`) or turn it off for tenants until it is sandboxed** | It affects customers today, whatever happens to Builder KEY |
| Q6 | The 55-minute Windows worker-proof CI job, and the stale `.agent-control/` files and gate? | **Retire both with the autopilot in Q1.** Builder KEY keeps its run state on a `kf/state` branch, not in `.agent-control/` | It is the slowest CI job and belongs to the retired worker. `.agent-control/` is reset by every wave PR |

## 3. How it gets built: the bootstrap

- KB-001 to KB-008 are built the way v1 packets are now: a Claude Code or other session following the worker brief.
  Tests first, two independent reviews, proof, RETURN on #80, owner's go to merge.
- **From KB-008 on, Builder KEY builds its own later packets.** That is the "self code" in D-268. It is also the best
  test of M0 and M1.
- Every Builder KEY packet changes only `scripts/key-builder/`, `docs/key-builder/`, the container files, CI wiring for
  its tests, and (in Phase S) a few product files. None touches a Release 0 bound file. The two exceptions, SEC-KEY-
  CUSTOM-LOGIC and KB-003 (the boundary spec), are named below.

## 4. Phases and packets

Packet ids `KB-nnn` are new. They replace the design's section 8. They live in the plan as track `key-builder`. Sizes
are S, M or L as in the v1 plan.

### Phase S: make it safe to start (before M0)

| ID | What | Done when | Reuses |
| --- | --- | --- | --- |
| S-1 | **Q1 and Q6:** disable `agent-control-autopilot.yml`, the `pull_request_target` workflow and the Windows worker proof. Record the retirement | No scheduled or PR-target workflow of agent-control runs. The modules and their specs still pass in CI | B §1.5, §1.8 |
| SEC-KEY-CUSTOM-LOGIC (L, product) | **Q5:** prove whether tenant KEY's `execute_custom_logic` can reach the host, then sandbox it or turn it off for tenants | A RED test shows the escape on the base, then green. Two reviews. Full suite and R0 MET | A §5, `@e2b/code-interpreter` |
| KB-003 (S, product) | The boundary spec `apps/server/src/modules/ai/builder-boundary.spec.ts`, beside `memberless-key-allowlist.spec.ts`. It fails if a builder, repository or code-writing capability is reachable from tenant KEY. It covers: `FLOW_TOOLS`, `CORTEX_TOOL_BRIDGE`, `KeyToolRegistryService.listTools()`, the organ and legacy registrations, every role's expanded `approvedTools` (no bare `*` or `mcp__*`), `MEMBERLESS_KEY_TOOLS`, `EXECUTION_SURFACES`, and a grep of source and `package.json` for GitHub tokens, `@octokit` and git libraries. Plus one host and name deny for GitHub MCP servers in `mcp/mcp.types.ts` | Green on main, and red on a planted builder tool. `execute_custom_logic` is handled as SEC-KEY-CUSTOM-LOGIC rules | A §2.3 |

### Phase M0: one packet end to end in Claude Code

| ID | What | Done when | Reuses |
| --- | --- | --- | --- |
| KB-001 (M) | **`kf env`.** One devcontainer with a pinned Claude Code, Node from `.nvmrc`, pnpm, Postgres 16 + pgvector, Redis, ICU data, Playwright with its browser aliases, gitleaks and trufflehog. Per-run compose project names, ports and databases. A valid minimal `.env` (not a copy of `.env.example`). Health checks. `up`, `down`, `reset` | Two runs side by side each pass the agent-memory tests and one server integration file, with no shared database or Redis | `Dockerfile`, `docker-compose.yml`, `worktree-resources.sh`, SECOND-ACCOUNT-SETUP, AGENTS.md (B §1.7) |
| KB-002 (M) | **`kf` skeleton, `kf next`, `kf brief`.** Node ESM in `scripts/key-builder/`, tested with `node --test`, and listed in `ci-cd.yml` so the script-spec census passes. `next`: <br>- fixes the two `status.mjs` blind spots (a tests-only compacted packet, `--no-ff` wave merges); <br>- adds an accepted-in-wave registry, so a packet stacked on accepted, unmerged work can be ready; <br>- filters by track and `wedge_first`; <br>- picks only packets with disjoint write sets, checked with `git merge-tree`; <br>- excludes claimed packets; <br>- has a `--ref` policy. <br>`brief`: fills the four briefs verbatim from the bundle. A reviewer brief never contains the worker's RETURN prose. This packet also re-reads the blocked vendor docs (section 0) | `kf next` lists exactly the packets the owner and orchestrator would pick on three past days, replayed from git history | `bundle.mjs`, `lib.mjs readyList`, `status.mjs`, the briefs (B §4) |
| KB-004 (S) | **`kf claim` and the yaml tails on #80.** An atomic push of `refs/heads/pkt/<ID>`. Fixture-prefix allocation against main, the open `pkt/*` branches and the plan. CLAIM, RETURN, REVIEW and RULING comments carry a fenced yaml tail. The tails are data the Foreman reads, never a parser that can halt work | Two `kf claim` calls racing for one packet: one wins, one is refused | `agent-control/lib/yaml.mjs` (B §1.5) |
| KB-005 (L) | **`kf gate`.** One script per check, each with RED cases from this programme's history: <br>1. tests-first commit order, with the RED evidence captured; <br>2. write set, with departures named; <br>3. Release 0 bound files untouched without a ruling; <br>4. no weakened test (compare test-file syntax trees between base and head: deleted `expect`, `.skip`, `.only`, `.todo`, lowered counts); <br>5. gitleaks over the commit range; <br>6. no forbidden targets (production or staging URLs, provider hosts, non-local databases) in the diff or in runner logs; <br>7. two review records from independent contexts (the same-adapter rule); <br>8. a proof receipt for the exact head; <br>9. merge admission. <br>Also: high-risk paths (`.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, workflows), and warnings for jsdom-only proof of menu, focus or layout changes | Every check is red on its historical case and green on a clean packet (for example SWP-INV-PUBLIC-LINK) | `admit-resources.mjs`, `release0-index.json`, `check-branch-divergence.sh`, `agent-control` admission and adapters (B §4, D §6) |
| KB-006 (M) | **`kf prove`.** A detached worktree per sha and a global database lock. It checks services before starting, checks `.env` is loaded and valid, and asserts the Node pin. It checks the head did not move during the run. ECONNREFUSED makes a run void. A known-flake policy decides re-runs. Scope follows D-265. It writes a combined `proof/<sha>.json` receipt on a `kf/state` branch. It dispatches `e2e-live.yml` for live journeys | The past failures (no `.env`, head moved, services stopped) each give a void receipt, never a pass | `release0.mjs`, `run-manifests.mjs --out`, `e2e-live.yml`, WAVE-RUNBOOK §2 (B §1.6) |
| KB-007 (M) | **`kf return`, `kf checkpoint`, `kf resume`, `kf ask`.** <br>- `return` drafts the RETURN from git, the receipt and the review records. A model edits only the judgement text. <br>- `checkpoint` writes run files (`.kf/run-<id>.yaml` on `kf/state`) and refuses an unpushed head. <br>- `resume` is idempotent. <br>- `ask` batches owner questions, numbers rulings D-nnn and starts the 48-hour PROVISIONAL clock | MEASUREMENT.md's resume test passes against a run that is killed at each step | OWNER-QUESTION-FORMAT, `momentum.mjs`, `state-machine.mjs` (B §4) |
| KB-008 (M) | **Runners, the Foreman brief, and the M0 run.** <br>- `claude-code` runner: `claude --bare -p --output-format stream-json --max-budget-usd --permission-mode dontAsk --tools <role list> --strict-mcp-config`, with settings from outside the checkout. It classifies the end as done, limit, budget, turns, timeout, auth, denied or error. It catches the "exited 0 with a background command still running" trap. <br>- `api` runner for read-only reviews on any provider (mini-SWE-agent pattern). <br>- `FOREMAN-BRIEF.md`: the loop in design §4, Layer 3. <br>Then **the M0 run: Builder KEY builds SWP-QUOTE-PUBLIC-PAGE end to end**, with the owner approving only the merge | The M0 packet is claimed, built tests first, reviewed twice (one review on a different provider), proven and RETURNed by the Foreman, with no human step but the owner's answers. Its cost and time are recorded | `adapters.mjs`, `claude-worker.ps1` semantics (locks, bounded retries, permission-denial detection), C §10 |

### Phase M1: a second tool, then a parallel wave

| ID | What | Done when |
| --- | --- | --- |
| KB-009 (M) | `gemini-cli` runner, with Gemini as worker and reviewer: exit codes 41/42/44/52/53/54/55, `RESOURCE_EXHAUSTED` parsed from exit 1, the model pinned (its automatic fallback is unreliable), the TOML policy engine, `auto_edit` mode outside a microVM. Then the `codex` runner (`codex exec --json --output-schema --sandbox workspace-write`, with `exec review` for reviews) | The next packet is built by Gemini CLI with the same `kf` commands. Its RETURN shape is identical to the Claude-built one |
| KB-010 (M) | `kf wave` and `kf merge`: stacked-base ordering, refusing a packet already in another open wave, an automatic split at 25 commits / 50 files, a PR body from receipts, and D-239 with the head re-verified and `--match-head-commit` | Three packets run in parallel (at most four workers) and reach one proven wave head, then a PR |
| KB-011 (M) | Reviewer evidence: StrykerJS (vitest runner, incremental, changed files only) per packet, and a coverage ratchet on changed files. AI reviews are published as check runs | The mutation score and the check runs appear on the M1 wave PR |
| KB-012 (M) | Measurement: <br>- a private replay set from merged KEYFLOWOS packets; <br>- canary packets with seeded bugs, to measure how many bugs the reviewers catch; <br>- per-packet cost, time and fix rounds from run files (D §7.2). <br>Public references: SWE-bench Pro and Multi-SWE-bench, not SWE-bench Verified, which is contaminated | A weekly metrics note on #80, generated with no model |

### Phase M2: a reliable service

| ID | What | Done when |
| --- | --- | --- |
| KB-013 (L) | The Foreman service: a small NestJS or Node service on its own VM in the account KEYFLOWOS uses (D-270). Its own Postgres and Redis. BullMQ for scheduling, limit delays and the worker cap. A run table. The reconcile loop from git and #80 | A week of waves with no lost state across restarts and usage limits |
| KB-014 (M) | The GitHub App (D-270), installed on this repository only: Contents, Pull requests, Issues and Checks write, Actions read. **No Workflows and no Administration.** Rulesets require the App's check runs by expected source, plus the owner's review. Merges pin the head sha | The App opens, checks and merges a wave under D-239. It cannot edit CI or the rulesets |
| KB-015 (M) | Sandboxes on the VM: Docker Sandboxes microVMs (or rootless Docker) with an egress proxy per run. Proof of record on GitHub-hosted runners | A worker cannot reach a host outside its allowlist. Proven by a test run that tries |
| KB-016 (S) | Spend at three levels: provider organisation limits on each key, a per-day ledger in the run table, and the per-run budget flag. Builder's key names differ from the product's (`BUILDER_ANTHROPIC_API_KEY` and so on), so no tenant call can spend from them | A run that reaches its cap stops and checkpoints. The day's cap stops new runs |
| KB-017 (S) | `kimi` runner (Kimi Code CLI), only inside the microVM with an outer timeout, because it has no OS sandbox and auto-approves | One review run on Kimi |

### Phase M3: reachable through KEYFLOW

| ID | What | Done when |
| --- | --- | --- |
| KB-018 (M, product) | A server-side gate for `/admin`. The web middleware matches only `/app/*` today. Pin the owner's user id rather than any `SUPER_ADMIN` (it is a mutable database role that bypasses tenant guards) | An unauthenticated or non-owner request to `/admin/*` is refused on the server |
| KB-019 (M, product) | `apps/web/src/app/admin/builder/page.tsx`, plus a nav entry. Behind it, a server proxy `api/admin/builder/*` under `AuthGuard` + `AdminGuard`, keeping the Builder service credential on the server. It shows runs, questions with answer buttons that post the ruling, spend, and a Stop button | The owner runs and answers a wave from KEYFLOW. KB-003's boundary spec stays green |

### Phase M4: tending the final version

| ID | What | Done when |
| --- | --- | --- |
| KB-020 (M) | Proposals: the Foreman reads the plan beyond v1 and the vision, proposes the next packets with reasons and evidence, and the owner rules | The owner accepts a proposed batch and it runs |

## 5. Lessons and the checks that hold them

| Lesson (B §3b) | Check |
| --- | --- |
| Nine sessions at once hit the shared usage limit | Worker cap of 4 (KB-008, KB-013) |
| A model limit lost three unpushed packets | Push after every commit. `checkpoint` refuses an unpushed head. Model failover (KB-007, KB-008) |
| Release 0 run without `.env`; head moved mid-suite; services stopped; Node not pinned; Prisma generate did nothing | `kf prove` preflights, and voids the run on any of them (KB-006) |
| A PR reported green while CI was red | Numbers only from receipts (KB-006, KB-007) |
| jsdom missed a capture-phase menu bug | A live-run warning on menu, focus or layout changes (KB-005) |
| Fix committed before its test; amend and force-push refused | Tests-first order check, run before push (KB-005) |
| A reviewer's checkout polluted a worker's worktree | A detached worktree per reviewer, enforced by the runner (KB-008) |
| Two accounts built two different wave 3j branches | Atomic claim; refuse a packet already in another open wave (KB-004, KB-010) |
| The orchestrator reviewed its own lane | The same-adapter rule plus a different-provider rule (KB-005 check 7) |
| A strict #80 parser deadlocked the control plane | Yaml tails are data; no heartbeat posts (KB-004) |
| Fixtures collided in parallel runs | A fixture prefix allocated per claim, plus a database per run (KB-001, KB-004) |
| `claude -p` exits 0 when every tool call was denied, or while a background command still runs | The runner classifies the end from the stream, not the exit code (KB-008) |

## 6. Order and dependencies

```
S-1 ─┐
SEC-KEY-CUSTOM-LOGIC ─┼─(safety)
KB-003 ─┘
KB-001 ─┬─ KB-002 ─ KB-004 ─┐
        └─ KB-006 ──────────┼─ KB-005 ─ KB-007 ─ KB-008 (M0 run)
                            │
Q4 wave merged ─────────────┘ (M0 packet ready on main)
KB-008 ─ KB-009 ─ KB-010 ─ KB-011 ─ KB-012 (M1)
KB-012 ─ KB-013 ─ KB-014 ─ KB-015 ─ KB-016 ─ KB-017 (M2)
KB-016 ─ KB-018 ─ KB-019 (M3) ─ KB-020 (M4)
```

Phase S and KB-001/KB-002 can run in parallel: three workers, under the cap of four. From KB-008 on, Builder KEY
builds its own packets.

## 7. What is not decided here

- The M2 VM's size and the exact monthly cap. These are set when M2 starts (D-270).
- Whether v1 packet work resumes in parallel with the Builder KEY packets, or waits for M1. The recommendation is to
  wait for M0, then let Builder KEY run v1 packets. That is its purpose and its proof.
