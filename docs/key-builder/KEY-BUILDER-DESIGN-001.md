# KEY Builder: design 001

Status: proposal for the owner, 2026-11-24. Rulings D-268 (the change of focus) and D-269 (the owner's three answers)
are on issue #80. This file is the starting point for whichever account or tool builds it next: it holds everything
the conversation that produced it knew.

## 1. What the owner asked for

> "I wanted KEY to be able to orchestrate the building out of keyflowos as i am doing right now ie coordinating
> multiple ai llm accounts to self code and self implement packets" ... "versions of key to help me produce V1 and
> self code and tend to final version" (D-268)

The owner's answers to three design questions (D-269):

1. **Who it serves.** The owner. Customers only get business capability. Building, coding and self-improvement are
   never a customer capability.
2. **How it runs.** It must work reliably and be as reproducible as possible. First it is proven in the tools the
   owner already uses (Claude Code, Antigravity, ChatGPT, Kimi, Gemini). Once proven it is reachable through KEYFLOW.
3. **First jobs.** All agreed:
   - Run one packet end to end with the owner approving only the merge.
   - Then run a wave of packets in parallel.
   - Then tend the product toward its final version.

## 2. Two KEYs, one name

| | Business KEY (exists) | Builder KEY (new) |
| --- | --- | --- |
| Who uses it | Every business on KEYFLOWOS, and their staff | The owner only |
| What it does | Business work: invoices, quotes, customers, bookings, messages, money | Builds KEYFLOWOS: plans, codes, reviews, proves, asks the owner |
| Where it runs | The product (`apps/server`, modules `ai`, `key-*`, `flow`) | Separate tooling: `scripts/key-builder/`, later its own service |
| What it can touch | One tenant's data, through the product's guards | The repository, sandboxes, issue #80. Never production, staging, customer data or secrets |
| Credentials | The product's own | Its own GitHub App or token and its own model API keys. None shared with the product |

The line between them is a security boundary, not a naming choice:

- A customer's WhatsApp message, email or uploaded file reaches Business KEY. If Business KEY could reach a builder
  tool, one prompt injection could write and push code.
- So builder tools are never registered in Business KEY's tool registry.
- A spec in the product fails if any builder tool, repository credential or code-writing action is reachable from a
  tenant-scoped KEY (packet KB-010).
- When the owner later reaches Builder KEY through KEYFLOW, it is through an owner-only admin surface behind the admin
  gate, talking to the separate Builder service. It is never a tool of the tenant KEY.

## 3. Principles

1. **State lives in git and on #80, never in a session.** This is how this programme already works ("every step of
   the way our work is accessible"). A builder run that dies loses nothing but the run.
2. **Scripts do the bookkeeping and models do the judgement.**
   - Scripts handle deterministic work: picking ready packets, compiling a packet's context, claiming, checking write
     sets, commit order and evidence files, running proof, and formatting a RETURN. Two runs of a script on the same
     inputs give the same answer.
   - Models handle only what needs judgement: writing tests and code, reviewing, and wording owner questions.
3. **Any tool can be a worker.** The protocol is files, shell commands and GitHub. Any agent that can read files, run
   a shell and use git can claim, build, review and return a packet the same way. Claude Code, Antigravity, Codex,
   Kimi and Gemini CLIs differ only in how they are started. That is one small adapter each, not a different process.
4. **The owner's rules are gates in code, not sentences in a prompt.** A model can forget or argue with a sentence. It
   cannot argue with `kf gate` exiting 1 (section 5).
5. **The environment is reproducible.** One container definition holds Node 22, pnpm, Postgres, Redis, Playwright
   with the browser aliases, the e2e database and the seeds. `kf env up` gives every worker in every tool the same
   machine. Proof results are tied to an exact commit sha (the Release 0 receipt pattern).
6. **Independence is real.**
   - The two reviews of a packet run in fresh contexts that never saw the worker's reasoning.
   - Where possible they run on a different model or provider from the worker.
   - Reviewers get the code and the packet, not the worker's conclusions.
7. **Usage limits pause, they do not kill.**
   - Every step writes its checkpoint before it starts. A run stopped by a usage limit resumes from the checkpoint, on
     the same tool or another.
   - Models are called through APIs with spend caps per day and per packet. Consumer accounts are not rotated to get
     around limits: that is fragile, as the outages of 22 and 24 November showed, and can break provider terms.
8. **The owner approves what is hard to undo.** Merging (D-239 conditions checked by code), production deploys (the
   owner's step, D-266), new rulings, and spending above a cap.

## 4. Architecture

```
Layer 4  Owner surface      #80 batches now; later an owner-only page in KEYFLOW admin
Layer 3  Foreman            the loop: next -> claim -> worker -> 2 reviews -> fix rounds -> prove -> RETURN -> wave -> ask owner
Layer 2  Runners            adapters that start a worker or reviewer in a tool (Claude Code, Antigravity, Codex, Kimi, Gemini, API)
Layer 1  kf CLI             deterministic commands over the repo, the plan and #80
Layer 0  Protocol           briefs, plan JSON, bundles, status, #80 message formats, .agent-control files (exists today)
```

### Layer 0: the protocol (mostly exists)

- **Exists today:**
  - `docs/development/agent-memory/` (worker, acceptance review, confirmation review, wave runbook, owner question
    format);
  - `scripts/agent-memory/` (`bundle.mjs`, `status.mjs`, with tests);
  - the plan `docs/reconstruction/V1-PLAN-RECUT.json`;
  - rulings in `BUILD-MAP-001.md`;
  - the control room on #80.
- **To add:** machine-readable blocks inside the #80 messages. Each CLAIM, RETURN, REVIEW and RULING comment ends with
  a fenced `yaml` block (`kind`, `packet`, `branch`, `head`, `red_shas`, `fix_shas`, `verdict`, `findings[]`), so the
  Foreman reads #80 without parsing prose.

### Layer 1: the `kf` CLI (`scripts/key-builder/`)

| Command | Does | Today done by |
| --- | --- | --- |
| `kf next [--track launch]` | The ready packets in plan order, with dependencies met (on main or in the current wave) and no claim | `status.mjs` plus reading |
| `kf claim <ID> --base <sha>` | Checks `refs/heads/pkt/V1-<ID>` is free, creates and pushes it, posts the CLAIM with its yaml block | by hand |
| `kf brief <ID> --role worker\|security\|correctness\|confirm` | Writes the full prompt for that role: the bundle, the brief, the diff range, the rules and the stop conditions | hand-written prompts |
| `kf gate <ID>` | Exits 1 unless the section 5 checks pass | reviewers, by reading |
| `kf prove <sha> [--full] [--e2e <specs>]` | Runs the proof in the sandbox at that exact sha, strictly one head at a time, with services checked first; writes `proof/<sha>.json` | `chain-*.sh` scratch scripts |
| `kf return <ID>` | Drafts the RETURN from git, the proof receipt and the review records; a model edits only the judgement parts | hand-written |
| `kf wave <IDs...>` | Stacks or merges the packet heads into a wave branch, proves the head, drafts the PR body | WAVE-RUNBOOK by hand |
| `kf env up\|down\|reset` | Starts or resets the reproducible sandbox | hand setup |
| `kf checkpoint` / `kf resume` | Writes or reads `.agent-control/run-<id>.yaml`: the step reached and what is next | ORCHESTRATOR-STATE by hand |

### Layer 2: runners

A runner starts one role in one tool and waits for it to end:

1. It hands the tool `kf brief`'s prompt.
2. The tool works in its own worktree and sandbox, using the same `kf` commands.
3. It pushes, then writes its result file (`.agent-control/result-<run>.yaml`).

Runners:

- `claude-code`: headless (`claude -p`) or the Agent SDK.
- `antigravity`, `codex`, `gemini-cli`, `kimi`: their CLIs or agents.
- `api`: a plain tool-use loop on any provider's API, for review roles that need no shell.

Adding a tool means adding one runner file.

### Layer 3: the Foreman

The loop this session ran by hand, written down once:

1. `kf next` picks up to N ready packets that do not touch the same files.
2. For each packet: claim it, then start a worker.
3. When the worker returns, run `kf gate`, then two reviewers in parallel, independent of each other and of the worker.
4. Each finding goes back to the worker as a fix round, tests first. Then a confirmation review of the delta.
5. Repeat until both accept. There is no cap on rounds (owner).
6. `kf prove` per D-265: the touched folders and the type check per packet; the full suite and Release 0 per packet
   only when the packet edits a Release 0 bound or manifest-bound file; otherwise once at the wave head.
7. Post the RETURN.
8. When the wave is complete: build it, prove its head, and ask the owner "open the wave PR / merge under D-239" as a
   batch with a recommendation first.
9. Questions that need the owner are batched and asked in the OWNER-QUESTION-FORMAT. Meanwhile the Foreman works on
   what is not blocked.

- **v0** (milestone M0): the Foreman is a brief (`docs/key-builder/FOREMAN-BRIEF.md`) that one agent session follows,
  calling `kf` and starting runners as sub-agents.
- **v1** (milestone M2): the Foreman is a small service with its own host, a GitHub App and API keys with caps. It
  stores runs and resumes them after any stop.

### Layer 4: the owner surface

- **Now:** issue #80. Every message carries its yaml block.
- **Later (M3):** an owner-only page in KEYFLOW admin, behind the admin route gate. It shows:
  - runs in flight;
  - questions waiting, with answer buttons that post the ruling;
  - spend against caps;
  - a Stop button.

  It talks to the Builder service over its own authenticated API. It is not a tenant feature and is not a tool of
  Business KEY.

## 5. Hard gates (`kf gate`)

Each check is a script with tests, written from a rule the owner has already given:

1. **Tests first.** In the packet's commit range, the first commit that touches a test file comes before the first
   commit that touches a non-test file in the write set. RED evidence is recorded: the test ids and the failure
   message at that commit.
2. **Write set.**
   - Every changed file is in the packet's write set or listed as a reported departure in the RETURN draft.
   - A departure needs a reason line.
3. **Release 0 untouched.** No change under `scripts/proof-admission/` or the R0 evidence files without a ruling id in
   the commit message.
4. **No weakened test.**
   - No deleted assertion, `.skip`, `.only`, `it.todo` turned from a test, or lowered count in a changed test file,
     unless a ruling id is cited.
   - This is a diff heuristic. A hit stops the run for a human or reviewer judgement, not a silent pass.
5. **No secrets.** A secret scan of the diff (keys, tokens, `.env` contents).
6. **No forbidden targets.** No production or staging URL, no real provider host, no production database name in the
   changed files or in the commands a run executed (the runner logs them).
7. **Two reviews.** Two review records with different reviewer contexts, both ACCEPT or ACCEPT WITH MINORS, and every
   MAJOR closed by a later commit or a ruling.
8. **Proof receipt.** `proof/<sha>.json` exists for the exact head, with the result D-265 requires for this packet.
9. **Merge (D-239).** CI green at the exact head, both reviews accept, the head re-verified, mergeability and scope
   re-checked. Then a merge commit with the expected head pinned. Only when the owner's go for that wave is on #80.

## 6. Models and spend

- **Roles to models.** Packet workers take the strongest coding model available. Reviewers take a different model or
  provider from the worker where possible. Bookkeeping takes no model at all.
- **Spend caps.** There is a cap per run, per packet and per day. A run that reaches its cap checkpoints and waits;
  raising the cap is an owner decision.
- **Usage limits.** On a limit error the run checkpoints and the Foreman moves that role to another configured
  provider, or waits. A limit never loses state.
- **Parallelism.** At most four workers at once by default, the lesson of 22 November.

## 7. Milestones

| | Goal | Done when |
| --- | --- | --- |
| **M0** | One packet end to end, the owner approving only the merge, inside Claude Code or Antigravity | `kf env up`, `kf next/claim/brief/gate/prove/return` exist with tests. FOREMAN-BRIEF.md exists. One real packet (proposed: SWP-QUOTE-PUBLIC-PAGE) is claimed, built, reviewed twice, proven and RETURNed by the Foreman, with no human step but the owner's answers |
| **M1** | The same thing from a second tool, then a wave in parallel | The next packet is run from a different tool (Antigravity, Gemini CLI or Codex) with the same commands and an identical RETURN shape. Then three packets run in parallel to a proven wave head |
| **M2** | Reliable and reproducible as a service | The Foreman runs on its own host with a GitHub App, API keys and spend caps. Runs survive a restart. A week of waves runs with no lost state |
| **M3** | Reachable through KEYFLOW | The owner-only admin page is live, and the boundary spec from section 2 is green |
| **M4** | Tending the final version | The Foreman reads the plan beyond v1 and the vision, proposes the next packets with reasons, and the owner rules |

## 8. First packets (track `key-builder`)

| ID | What | Size |
| --- | --- | --- |
| KB-001 | Reproducible sandbox: devcontainer or Dockerfile with Node 22, pnpm, Postgres, Redis, Playwright and the aliases; `kf env up/down/reset`; seeds the e2e database | M |
| KB-002 | `kf` CLI skeleton with tests; `next` (over `status.mjs`) and `brief` (over `bundle.mjs` and the briefs) | M |
| KB-003 | `kf claim` and the yaml blocks in #80 messages (CLAIM, RETURN, REVIEW, RULING), with a parser and tests | S |
| KB-004 | `kf gate`: the nine checks of section 5, each with tests (RED cases taken from this programme's history) | L |
| KB-005 | `kf prove`: strict one-head-at-a-time proof in the sandbox, with services checked first, `.env` loaded and a receipt per sha; e2e mode with the production web build | M |
| KB-006 | `kf return` and `kf checkpoint` / `kf resume` | M |
| KB-007 | FOREMAN-BRIEF.md and the `claude-code` runner; the M0 run on one real packet | M |
| KB-008 | Second runner (Antigravity, Gemini CLI or Codex) and the M1 run | M |
| KB-009 | `kf wave` and the parallel M1 wave | M |
| KB-010 | Product boundary spec: no builder tool, repository credential or code-writing action is reachable from tenant KEY (fails on any) | S |
| KB-011 | Foreman service (M2): host, GitHub App, API keys, spend caps, run store | L |
| KB-012 | Owner page in KEYFLOW admin (M3) | M |

KB-001 to KB-007 make M0. They change only `scripts/key-builder/`, `docs/key-builder/`, the container files and tests.
They touch no product code, so v1's Release 0 is not in play. KB-010 is the only product change before M3.

## 9. Risks

- **Prompt injection from repository text, issue comments or web pages.** Workers treat what they read as data. The
  gates do not depend on a model obeying. Builder tools never touch customer data.
- **Cost runaway.** Caps per run, per packet and per day, owner-raised only.
- **Flaky proof.** Strict sequential proof per head, services checked first, receipts tied to the sha. This
  programme's past failures each have a check: a missing `.env`, a head moved mid-suite, services stopped by a
  container restart, a killed run.
- **Drift between tools.** One CLI and one brief. Runners only start the tool. M1's done-when compares the RETURN
  shapes.
- **Provider terms.** Use APIs and the tools' own supported modes. Do not pool or rotate consumer accounts to get
  around limits.

## 10. Questions for the owner (ask together)

1. **Hosting for M2.** Where should the Foreman service run, and what monthly spend cap applies to start? It could run
   on a small cloud VM, or on the infrastructure KEYFLOWOS already uses. Recommendation: a small VM in the same cloud
   account, starting with a modest daily cap.
2. **GitHub access for M2.** Use a GitHub App installed on the repository only, or a fine-grained token?
   Recommendation: a GitHub App, because its permissions are scoped and can be revoked.
3. **Providers beyond Claude.** Which ones should be configured first for the second runner and for independent
   reviews: Gemini (Antigravity / Gemini CLI), OpenAI (Codex), Kimi? Recommendation: Gemini first, since the owner
   already uses Antigravity.
4. **The M0 packet.** SWP-QUOTE-PUBLIC-PAGE is proposed. Its dependencies are built and unmerged, and it is small and
   web-only.
