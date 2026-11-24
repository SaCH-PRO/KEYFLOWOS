# Research B: what the programme already provides for Builder KEY, and what it learned the hard way

Research for `docs/key-builder/KEY-BUILDER-DESIGN-001.md` (D-268, D-269; D-270 on #80 comment 7119158082 accepts its
section 10: GitHub App, small cloud VM with a daily cap, Gemini as second provider, M0 = SWP-QUOTE-PUBLIC-PAGE).

Read-only. Worktree `scratchpad/wt-key` at `560bdf36` (branch `key/builder-design-tmp`, 43 commits ahead of
`origin/main` `9a7b5011`, carrying the rulings and wedge re-cut branches). GitHub data via `gh api` on 2026-11-24:
182 PRs (#1 to #228), all 1,990 comments on issue #80, 210 branches. Raw pulls are in `research/raw/`.

Method note: one `git fetch origin main` was run early; it only refreshed the remote-tracking ref in the shared
`/home/user/KEYFLOWOS/.git` (no checkout, no working-tree change). Nothing else was written outside
`scratchpad/research/`.

---

## 0. The short version

1. **This is the programme's fourth attempt at automating itself.** The first three are all in the repo:
   - `architecture/os/` scheduled cloud routines (truth, audit, burndown, reflect). They ran 9 to 12 Sep and were
     halted by the owner (`architecture/os/OS.md`, `status: HALTED`, commit `88b8016c`).
   - The ChatGPT-era control plane: `scripts/agent-control/` (about 7,200 lines, 28 spec files), the autopilot
     workflow, and the Windows `claude-worker.ps1`. Built from Sep 23 to Oct 24 (PRs #87, #89, #92, #100, #103,
     #104, #120, #159, #166, #181).
     - The 2026-10-21 appraisal (`docs/development/PROGRAMME-APPRAISAL-2026-10-21.md` section 0) records what it did
       to the programme: 73 control-plane commits against 18 application commits, 13 of 16 recent packets meta, the
       merge evaluator merged exactly one PR, and "claude is not on PATH" was posted 143 times.
     - My count over all of #80: 1,386 of 1,990 comments are bot `AUTO_EVENT`s. 906 of those say `REPORT_DRIFT` and
       335 say "claude is not on PATH".
   - The v1 hand process (20 to 24 Nov) worked. It took main from 58 to 87 packets done in about three days. It
     has a small, tested tool layer (`scripts/agent-memory/`) and briefs. Its failures were operational ones, listed
     in section 3b.
2. **Most of Layer 0 and about half of Layer 1 already exist.** `bundle.mjs`, `status.mjs`, `compact.sh` and
   `finish-squash.sh` exist, with 16 tests that are in CI.
   - The proof stack (`run-manifests.mjs`, `release0.mjs`, `evaluate.mjs`) already writes exact-head receipts.
   - `admit-resources.mjs` with `test-local.sh` already refuses non-local databases and Redis.
   - `worktree-resources.sh` already gives each packet its own Postgres database and Redis index.
   - `check-branch-divergence.sh` is the wave-size gate.
   - `e2e-live.yml` is a reproducible live-journey runner.
   - `adapters.mjs`, `claude-worker.ps1` and `momentum.mjs` hold tested ideas for runners and for spotting a stall.
3. **The unwritten tools are real and sit in a scratch directory.** The acting orchestrator's scratchpad holds the
   de-facto Layer 1:
   - `chain-*.sh`: strict sequential proof;
   - `titles.mjs`: a weakened-test check;
   - `mutants.sh`: mutation probes run by reviewers;
   - `e2e-api-start.sh`: an `env -i` API for live runs;
   - `bootstrap.sh`;
   - `claim-*.md` and `return-*.md` drafts.

   These are the best seeds for `kf prove`, `kf gate` and `kf return`. They are not in the repo.
4. **The biggest design risk is the one the second attempt hit.** Strict machine-parsed authority on #80 plus
   fail-closed reconciliation produced deadlock and noise instead of progress. Builder KEY's yaml blocks should be
   data for the Foreman. They must not be a second authority parser that can halt the programme.

---

## 1. Inventory and reuse verdicts

Verdicts: **REUSE** (wrap as is), **EXTEND** (reuse, with named fixes), **MINE** (take ideas or code, not the
module), **RETIRE/AVOID** (do not build on it).

### 1.1 `scripts/agent-memory/` (D-253 Track 1; PR #221 wave 3d, fixes in #224)

| File | What it does | Verdict |
| --- | --- | --- |
| `lib.mjs` (557 lines, pure functions) | `deriveStatus`, `readyList` (critical path first, then unblocks, then priority, then id), `longestRemainingChain`, `parseRulings` / `resolveDecision` (BUILD-MAP rows by id or slug, prefers the ruling row over the open-question row), `buildBundle` (packet, cited rulings in full, r0_register rows, fixture prefixes, write set with exists flag, dependency status, PROHIBITED and STOP_CONDITIONS lists, brief pointers), `statusFingerprint` / `statusFilesCurrent` | **EXTEND**: the core of `kf next` and `kf brief` |
| `status.mjs` | Writes `docs/reconstruction/handoff/V1-STATUS.{json,md}`. `--check` exits 1 when stale. `--stdout`. `--with-branches` marks unmerged `pkt/V1-*` in-progress. `--ref` | **EXTEND** (gaps below) |
| `bundle.mjs` | Per-packet Markdown or JSON (`--json` is CONTEXT-BUNDLE-SCHEMA shaped, with health VALID or DEGRADED). The M0 bundle is 4,477 characters, VALID | **REUSE**: the body of `kf brief` |
| `git.mjs` | Thin local-git readers (`show`, `commitsSince`, `unmergedPacketBranches`, `treeFiles`) | **REUSE** |
| `compact.sh` | Squashes one packet branch into a wave as `test(<scope>): RED for pkt/V1-<ID> (compacted)` + `fix(<scope>): pkt/V1-<ID> (compacted)`. Test files are classed by regex. A hold-regex keeps Release 0 evidence edits in the fix commit. `COMMIT_TRAILER` | **EXTEND**: the core of `kf wave` |
| `finish-squash.sh` | After a `fixture-prefixes.json` conflict: merges index stages 2 and 3 as JSON (union by `prefix`, refuses duplicates or other conflicts), then makes the two commits | **REUSE** inside `kf wave` |
| `tests/lib.spec.mjs` (14 tests), `tests/finish-squash.spec.mjs` (2) | `node --test`. 16 of 16 pass locally (Node 22.23.5) | **REUSE**. Already run in CI by `ci-cd.yml` line 68 since `cbb61d04` (RR-SCRIPT-SPECS-IN-CI) |

Defects and gaps found, which Builder KEY must fix or design around:

- **Tests-only packets never count as done.** `commitEvidence` counts only `fix|feat|refactor|perf` subjects as
  "compacted". A tests-only packet compacts to one `test(...): RED for pkt/V1-<ID> (compacted)` commit (the
  `compact.sh` "tests-only packet: one commit" path).
  - Probe: `deriveStatus({id:'GATE-X'}, {commits:[test(gate): RED for pkt/V1-GATE-X (compacted)]})` gives
    `todo / no-evidence`.
  - This affects gate and journey packets (34 packets are in lane `gate`).
- **A wave assembled by `--no-ff` merges is invisible.** `wave/3j-second-lane` (16 packets) is one
  `wave 3j (second lane): merge pkt/V1-<ID> @ <sha>` merge per packet. `deriveStatus` gives `todo / no-evidence` for
  those subjects. That branch is also 116 commits and 64 files ahead of main, so it fails the 25-commit / 50-file
  divergence gate. `kf wave` must produce the compacted form and nothing else.
- **Status sees main only.** The M0 packet SWP-QUOTE-PUBLIC-PAGE depends on SWP-INV-PUBLIC-LINK and MOUNT-QUOTES. Both
  are built and unmerged (SWP-INV-PUBLIC-LINK at `8ae6abfa`, stacked on SWP-INV-MATH `6ea50c09`, stacked on
  MOUNT-QUOTES `78567330`).
  - The bundle says "NOT READY".
  - `kf next` needs a "done or accepted-in-wave" notion, as the design says. That needs a durable record of
    accepted heads, which today exists only as #80 prose and the state file's section 3.
  - Or the owner merges wave 3j / MOUNT-QUOTES first.
- **The plan of record lags main.** It lives on `pkt/V1-RULINGS-3E` / `pkt/V1-WEDGE-RECUT` (364 packets at `HEAD`
  against 346 on main). `status.mjs --check` on `origin/main` says STALE in this worktree, and `--ref HEAD` says
  current.
  - Every `kf` command needs an explicit `--ref` policy: "plan ref" separate from "code ref".
- **A minor fragility.** `compact.sh` reads paths with `git status --porcelain | awk '{print $2}'`, which breaks on
  spaces. `finish-squash.sh` uses unquoted `$TESTS` / `$REST`. Both class tests by path regex only.

### 1.2 `docs/development/agent-memory/` (procedural memory; D-253)

| File | Content | Verdict |
| --- | --- | --- |
| `README.md` | Memory layers (working, episodic, semantic, procedural, consolidation, retrieval), order of authority (#80 ruling > BUILD-MAP / plan > state file > generated status), consolidation table (what to rewrite on merge, return, verdict, ruling, start), "push or it is not memory" | **REUSE** as the Foreman's memory contract |
| `PACKET-WORKER-BRIEF.md` | Verbatim worker brief with one parameter, `<PACKET-ID>`. Includes: push after EVERY commit; tests-only RED first; write set; premise check; never edit R0 evidence; two fresh-subagent reviews, no round cap; local DB bootstrap; D-265 proof; NEVER list; one REPORT message | **REUSE** as `kf brief --role worker`. Strip the "Report to session" step, which is runner-specific |
| `ACCEPTANCE-REVIEW-BRIEF.md` | Two lenses (security-tenancy; correctness-regression), read-only, inputs (bundle, `git diff BASE...HEAD`, the worker's deviations as facts and never its conclusions), report format (VERDICT ACCEPT / ACCEPT WITH MINORS / REJECT; findings ranked with `file:line`, a scenario and how verified; deviations judged; owner questions; "not checked") | **REUSE** as `kf brief --role security\|correctness`. The report format is already machine-friendly, so add a yaml tail |
| `CONFIRMATION-REVIEW-BRIEF.md` | Delta review `OLD..NEW`, two confirmations (one per lens), CONFIRMED / NOT CONFIRMED | **REUSE** as `--role confirm` |
| `WAVE-RUNBOOK.md` | Pre-wave conditions; compaction (2 commits per packet); prove the wave head (one suite at a time; Node 22.23.4; `.env`; services; `db:generate` cache trap); web proof; divergence gate (25 / 50); PR body from the template; D-239 / D-240 merge conditions; consolidation after merge | **REUSE**: the spec for `kf wave`, `kf prove` and `kf merge` |
| `OWNER-QUESTION-FORMAT.md` | Batch, keep working on safe defaults, recommendation first, record at once as D-nnn, never infer a ruling (except D-222's 48 h PROVISIONAL), numbering rule, templates | **REUSE** verbatim for the Foreman's owner channel |
| `MEASUREMENT.md` | Pointer briefs 9.6:1 against inline; resume test (10 of 10 on one run); bundle sizes (median 5,094 characters) | **REUSE** the resume test as an M0 acceptance check |
| `SECOND-ACCOUNT-SETUP.md` | Second Claude account as a lane through GitHub only. Includes the environment setup script (pgvector, Postgres 16 trust auth, Redis, Node from `.nvmrc` with checksum, local-only `.env`, `pnpm install`), lane rules and the claim rule via `git ls-remote` | **REUSE** the setup script as the starting point of KB-001 `kf env up`, and the claim rule as the base of `kf claim` |

### 1.3 Control-plane standards

| File | Verdict |
| --- | --- |
| `docs/development/EXECUTION_CONTROL_STANDARD.md` | **REUSE the parts that are rules; drop the ritual.** The packet states (CHARACTERIZING ... BLOCKED), GREEN / YELLOW / RED, the momentum thresholds (6 operations without a transition; 2 identical failures; 2 CI failures without a new cause), the scope ledger, the completion contract, "no silent scope reduction" and code-versus-process health separation all map cleanly onto Foreman checkpoint fields. `momentum.mjs` already turns the thresholds into code |
| `docs/development/AGENT_CONTROL_PLANE.md` (881 lines) | **MINE.** It defines the ChatGPT-era topology, superseded for v1 by D-222. Worth keeping: the exact-head merge rule (two snapshots, pinned head; "PR 103 marked ready at 19:09:33, merged 19:09:40, gate failed 19:09:48"); "each required gate is bound to its workflow file" (a name-only check can be spoofed by a second workflow); the semantic-head rule; artifact binding; "an edited authority comment makes authority unverifiable"; "the allowlist attests the account, not which agent wrote the words" (every agent posts as `SaCH-PRO`). Avoid: the authority fold, reconcile and `REPORT_DRIFT` as a gate on all progress |
| `AGENTS.md` | **REUSE** the launch, gotchas and conventions, and the memory-layer pointer. It also points at `architecture/os/OS.md` (halted cycles) and requires `impl/*` artifacts: stale for v1 |
| `CLAUDE.md` | **REUSE** the "Before mutation", "Return" and "Never" rules. Note that `gh issue view 80 --comments` is refused with 403 in cloud sessions; use `gh api` (agent-memory README section 2) |
| `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md` | **MINE.** A historical record. Its return envelope (`packet_id, source_head, source_drift, changed_files, tests{commands,passed,failed,skipped}, negative_controls, deviations_from_packet, open_questions, evidence_refs`) and message envelope (`message_id, message_type, packet_id, sender, in_reply_to, source_main, source_head, implementation_branch, state, health, scope_changed, production_touched, summary, evidence_refs, next_action`) are the obvious base for the design's yaml blocks |
| `docs/development/KF-AGENT-PARALLEL-ORCHESTRATION-PLAN-001.md` (never adopted) | **MINE.** File claims, semantic claims, conflict admission, "unattended next-packet launch": the same list as KB-003 and KB-009 |
| `docs/development/MULTI_AI_REVIEW_ARCHITECTURE.md` (proposal) and `scripts/agent-control/lib/semantic-review.mjs` | **MINE.** A provider-neutral review record (`provider, reviewer, reviewed_head, outcome PASS\|NOT_RUN\|..., reason: capacity_exhausted, unresolved_substantive_findings`). Fallback is allowed only when the primary is NOT_RUN for a machine reason. That is exactly Builder KEY's reviewer-failover need |

### 1.4 `.agent-control/*`

- **Contents.**
  - `active-packet.yaml`, `claude-return.yaml` and `programme-state.yaml` are frozen at packet
    KF-META-MERGE-AUTHORITY-001 (PR #181, Oct).
  - The README still calls `programme-state.yaml` "canonical live programme control state". AGENT_CONTROL_PLANE has
    since demoted it to a "derived projection".
- **How v1 treats it.** Workers must not touch it (worker brief), and wave PRs reset it to main's copy
  (`WAVE-RUNBOOK.md` section 1).
- **Gate trap.** `.github/workflows/agent-control-gate.yml` treats any `impl/*` or `pkt/*` PR as a packet PR and
  validates these artifacts, and it fails closed for `pkt/*`. Wave PRs (`wave/*`) are outside it.
- **Verdict: AVOID as Builder KEY's run store.**
  - The design puts `run-<id>.yaml` and `result-<run>.yaml` in `.agent-control/`. That collides with an existing gate
    and with the wave rule.
  - Recommend `.kf/runs/` on a dedicated branch (for example `kf/state`), or a run store in the M2 service, with git
    as the audit copy.
  - Retiring or rewriting `.agent-control` and the gate is a separate owner question.

### 1.5 `scripts/agent-control/` (not in the brief's list, but the closest prior art)

7,222 lines across `*.mjs` plus 1,104 lines of `claude-worker.ps1`; 28 spec files run by `agent-control-worker-proof.yml`.

| Module | Idea | Verdict for Builder KEY |
| --- | --- | --- |
| `lib/adapters.mjs` | Vendor-neutral roles (BUILDER, ADVERSARIAL_REVIEWER, ARCHITECTURE_AUTHORITY). `probeAuth` gives READY / WAITING_EXTERNAL_AGENT / DISABLED. "No adapter may fill the adversarial-review role for work produced by the same adapter id". `claude -p` invoked with the prompt on stdin (`KEYFLOW_CLAUDE_BIN`) | **MINE heavily** for Layer 2 runners. The same-adapter rule is a ready-made gate 7 check |
| `claude-worker.ps1` | Polls #80. Takes an exclusive machine lock (one worker per repo and issue). Gives each wake its own worktree. Writes a durable processed-message cursor (idempotent). Stops after 2 identical failures (HELD_RETRYABLE, escalates once). Bounds network faults separately (15 failures / 30 minutes). Pause / resume / release-hold. Detects permission denials (`claude -p` exits 0 even when every tool call was denied) | **MINE** the semantics into the Foreman's run loop. Its Windows-only form and its #80-polling trigger are obsolete |
| `lib/momentum.mjs` | Thresholds as data; `failureSignature()` makes "materially the same failure" mechanical | **REUSE** (pure) in Foreman loop detection |
| `lib/state-machine.mjs` | Legal packet-state transitions, failing closed | **MINE** for the run checkpoint state machine |
| `lib/admission.mjs`, `merge-grant.mjs`, `auto-merge-admitted.mjs` | Exact-head evaluator: required workflows bound to their files (`REQUIRED_WORKFLOW_FILES`), no pending checks, no "owed" run after a reopen or ready transition, two snapshots, merge pinned to the head | **MINE** for `kf gate` check 9 / `kf merge`. Its `impl/*`-only and ChatGPT-grant parts do not apply to v1 waves (D-239) |
| `lib/control-envelope.mjs`, `lib/yaml.mjs` | One parser for #80 fields; repeated keys or unmatched quotes are malformed; edits make authority unverifiable | **MINE `yaml.mjs`**. **AVOID** making #80 parsing a halt condition (section 3b, L-01) |
| `lib/reconcile.mjs`, `authority-effects.mjs`, `orchestrator.mjs`, `normalize-event.mjs`, `.github/workflows/agent-control-autopilot.yml` | Event to action rule table behind a reconciliation that must be fully consistent | **RETIRE/AVOID**: 906 `REPORT_DRIFT` posts. Consider asking the owner to switch the autopilot's #80 posting off |
| `research/compile-context.mjs` | Deterministic research ContextBundle compiler with authority classes and freshness | Superseded by `bundle.mjs` |

### 1.6 `scripts/proof-admission/` and the Release 0 proof

- **`evaluate.mjs`** judges one vitest JSON report against one case manifest.
  - Manifest schema: `manifestVersion: 1`, `packageId`, `proofScope`, `description`, `suites` (or the files of an
    `npx vitest run` line in the description), `requiredCases` (exact titles), `allowAdditionalCases`,
    `requireReportSuccess`.
  - Reason codes: `KF_PROOF_MANIFEST_UNBOUND`, `KF_PROOF_BOUND_SUITE_MISSING`, `KF_PROOF_UNEXPECTED_CASE`,
    `KF_PROOF_HEAD_MISMATCH` and others.
  - Exit codes: 0 SATISFIED, 2 REJECTED, 3 INCOMPLETE.
- **The receipt** is the JSON line it prints: `sourceHead` (HEAD of the checkout) and `sourceTreeClean` (no tracked
  diff, and no untracked file under `apps/server`, `packages` or `scripts/proof-admission`), plus the verdict, the
  required case count, the bound suites, missing, unexpected, duplicated and notPassed.
  - With `--expect-head <sha>` a different head is REJECTED.
  - Only `run-manifests.mjs` running the suites itself on a clean tree issues an **exact-head receipt**. Otherwise
    each line says NOT-EXACT-HEAD.
- **`run-manifests.mjs`** classes every `manifests/*.json` as resource, negative-controls or case. It runs vitest
  once over the union of suites (building `dist/main.js` when a suite needs it) and judges every manifest with
  `--expect-head`.
  - Options: `--only`, `--report`, `--out` (all receipts as JSON), `--keep-report`, `--skip-build` (dist must be
    newer than src), `--plan`.
- **`release0.mjs`** (`pnpm --filter server proof:release0`):
  1. run-manifests over exactly the manifests in `release0-index.json`;
  2. `release0-proof-coverage.spec.ts`;
  3. a runtime check that every case of a Release 0 suite either ran or is explained;
  4. OPEN items.

  It prints `proof:release0: R0 EXIT GATE MET (exit 0)` / REJECTED (2) / NOT MET (3).
- **Inputs.** `release0-index.json` (1,864 lines: packets, suites, journey, explained skips, `editedOnly`) and
  `manifests/release0-edited-suites.json` define which files are "Release 0 bound". There are 46 manifests in all.
- **`admit-resources.mjs`** (K12) is CI mode (`ci-resources.json`) or per-packet mode (`--packet <id>`, admits only
  `kf_wt_<packet>` and the Redis index allocated to it).
  - It refuses any non-local URL, and any URL whose query overrides its host (`?host=`).
  - **This is already gate 6 ("no forbidden targets") for databases and Redis.**
- **`negative-controls.mjs`** re-applies a known defect and checks that the bound test fails.

**Verdict: REUSE as is.** `kf prove` should:

- call `release0.mjs --skip-build --out proof/<sha>/r0.json` and `run-manifests.mjs --out`, and never reimplement them;
- add the parts they lack: a check that the worktree head did not move, a services preflight, `.env` loading, the
  full `vitest run` and web suites, and a combined `proof/<sha>.json` that points at the receipts.

Never let a Builder change touch `scripts/proof-admission/**` or the manifests (gate 3).

### 1.7 Environment and isolation scripts

| Script | Verdict |
| --- | --- |
| `scripts/worktree-resources.sh` (R0-00-WT-ISOLATION) | **REUSE in `kf env` / `kf prove`.** `provision <packet>` creates the database `kf_wt_<id>` from a migrated template, claims a Redis index 1-15 with `SET kf_wt:owner NX`, and writes the worktree `.env`. Also `release`, `reprovision` after a migration, `list`. Safe by construction: it only creates and drops `^kf_wt_[a-z0-9_]+$` on localhost. It was used early in v1 (RETURN 7052103351: "isolated database kf_wt_v1_63, Redis index 1") and dropped later for "one shared Postgres, never two suites at once". Using it again would allow parallel packet-level proof. Wave-head proof stays one at a time for CPU and memory |
| `scripts/test-local.sh` (`pnpm test:local`) | **REUSE.** The admission step always runs first, then compose, generate, workspace build, deploy, build, then `--suite release0\|server\|<file>`, with `--packet <id>` and `--plan` |
| `scripts/check-branch-divergence.sh` + `.github/branch-divergence-overrides.yml` + `scripts/ci/resolve-divergence-thresholds.sh` | **REUSE in `kf wave`** (25 commits / 50 files by default; per-branch overrides exist) |
| `.github/workflows/e2e-live.yml` | **REUSE for `kf prove --e2e`.** It runs `workflow_dispatch` on GitHub runners: production web build, real API, Postgres and Redis on the runner; phone and desktop; variants `ai-disabled` and `key-disabled`. `ai-on` is staging-only with required reviewers and the owner's authority. It avoids the local Turbopack / Playwright alias traps. Up to 120 minutes |
| `Dockerfile`, `docker-compose.yml` (pgvector/pg16 + redis) | **EXTEND** into KB-001's container |

### 1.8 CI (`.github/workflows/`)

Durations measured on PR #227 head `1d6f71fa`.

| Workflow | Trigger | What it gates | Time |
| --- | --- | --- | --- |
| `ci-cd.yml` CI/CD Pipeline | push, PR | Runtime pin and script-spec census (which runs the agent-memory tests); Type Check (server and web tsc); Lint (marked "debt ratchet — blocks nothing"; caps 3343 server, 26 web); Security Scan (secret-scan range, `scripts/security/tests`); Build Server; Build Web; E2E (Playwright, mocked API); **Run Tests** (Postgres + Redis services, K12 admission, `db:deploy`, `test:ci`, `run-manifests --skip-build`, **`proof:release0 --skip-build`**, the test-local self-test, `proof:k12`, web and api unit tests) | about 31 minutes in all; Run Tests 27.5 |
| `agent-control-worker-proof.yml` | PR, no path filter | Portable proof (ubuntu, 1 minute) plus the **Windows worker proof** for the obsolete worker | **55 minutes**: the longest required check. It was once cancelled mid-step at 44 minutes and re-run (7086362185) |
| `agent-control-gate.yml` | PR | `.agent-control` artifacts on `impl/*` and `pkt/*` | 14 s |
| `branch-divergence.yml` | PR, push, schedule | Commits and files ahead of base, both sides | 20 s |
| `native-dast.yml` DAST (Native) | PR | Native DAST plus an evaluator spec | 3 minutes |
| `agent-control-autopilot.yml` | PR, issue_comment on #80, workflow_run, hourly | Normalizes events, posts AUTO_EVENT to #80, auto-merge for `impl/*` | Source of 1,386 #80 posts |
| `e2e-live.yml` | manual | Live Release 0 and v1 journeys | up to 120 minutes |
| `hawkscan.yml`, `deploy-drift.yml`, `uptime-monitor.yml` | manual or schedule | Not gates | - |

- CI therefore re-runs `proof:release0` at every PR head. That is the second, independent exact-head proof D-239
  relies on.
- `main` has **no branch protection** (#80 7072216699: "the CI checks are the gate"). Gate 9 must enforce "all
  required checks green at the exact head" itself, using `admission.mjs`'s bind-to-file and no-pending rules.
- Vercel statuses fail on the free-tier quota and are explicitly "not a gate" (7088922193, PR #228 body).
- `chatgpt-codex-connector` reviews wave PRs and found real P1 / P2 issues on #217, #221, #224 and #227. It is a free
  third reviewer, and its usage limit has been hit before (#80 5848225508).

### 1.9 The fixture-prefix registry

- **File.** `apps/server/test/helpers/fixture-prefixes.json`: `registryVersion`, `about`, `prefixes[239]` (each
  `{prefix, owner, packet?, legacy?}`), `pendingRenames`, `noPrefixSuites`.
- **Enforcement.** `apps/server/src/core/config/fixture-prefix-registry.spec.ts` enforces it. Format
  `^[kv]NN[a-z]_$`, allocated in sequence (`v72v_`, `v72w_`, `v72x_` ...).
- **In the plan.** It also has `fixture_prefix_table` (108 rows) and a per-packet `fixture_prefix` (168 packets).
- **Failure seen.** Parallel packets append at the same place and conflict (handled by `finish-squash.sh`), and a
  real clash happened ("prefix clash v71t_" on MEM-SEMANTIC-SIGHT, state-file history).
- **Builder KEY.** `kf claim` should allocate the next free prefix against main, all open `pkt/*` branches and the
  plan, and record it in the CLAIM block.

### 1.10 The plan and the rulings

**`docs/reconstruction/V1-PLAN-RECUT.json`** (about 740 KB; 364 packets at `HEAD`, 346 on main):

- Top-level keys: `_about, summary, packets, moot, fixed_in_flight, waves, r0_register (69), ruling_sensitive (37),
  coverage, totals, open_questions, fixture_prefix_table (108), validation {dependency_problems, collisions,
  step0_unordered, critical_path, ...}, wedge {ruling D-263, launch_journeys, follow_on_journeys, ...}`.
- Fields on every packet: `id, title, kind (kept|new|shrunk|consolidated), bugs[], step (0-8), lane
  (server|web|both|gate|docs), size (XS|S|M|L → 0.5/1/2/3 points), priority (P0-P3), depends_on[], files[]` (= the
  write set), `decisions[]` (ruling ids or slugs), `scope, definition_of_done` (prose: the RED cases, the proof, what
  stays green), `journeys[], absorbs[], r0_impact` (KEEP / AMEND text).
- Optional fields:
  - `track` (launch 208 / follow-on 69; missing on 87), with `track_reason` and `track_ruling`;
  - `fixture_prefix` (168);
  - `wedge_first` (10);
  - `priority_before_wedge`;
  - `follow_on_deps_removed`.
- There is no machine field for the RED test ids, the proof commands or the browser specs. They are inside the
  `definition_of_done` prose, so `kf gate` check 1 cannot know the expected RED tests without parsing prose or
  reading the worker's RED commit message.
- `validation.collisions` already detects write-set overlap at plan level. `kf next` can reuse that logic to pick
  non-overlapping packets.

**`docs/reconstruction/BUILD-MAP-001.md`** (about 240 KB):

- Rulings live in section (g), "Owner rulings, <date>" subsections, as table rows:
  `| D-nnn | <Name>: <ruling text> (owner ruling <date>, <where>; #80 comment <id>). (\`slug\`) | <packets affected> |`.
  Format template: `OWNER-QUESTION-FORMAT.md`. Parsed by `lib.mjs parseRulings`.
- Rulings after the last rulings commit live first on #80, then on the rulings branch, then on main. D-268 to D-270
  are on #80 only.
- Withdrawn rulings keep their number (D-247).

---

## 2. PR history and how waves were built

### 2.1 Eras

| Era | PRs | Character |
| --- | --- | --- |
| Nov 2025 to Aug 2026 | #1 to #62 | Feature PRs by Cursor, Claude and Codex branches (`cursor/*`, `claude/*`, `feature/*`); one human author |
| Sep 2026, Release 0 / control plane | #74 to #104 | `impl/kf-exec-*` application packets (#74 K12 proof admission, #76, #81, #84, #85) and `impl/kf-meta-*` control-plane packets (#87 orchestrator, #89 worker hardening, #92 state reconcile, #100 one #80 parser, #103, #104 AI-review failover) |
| Oct 2026 | #105 to #194 | Mostly meta and docs. Merged: #120 (state reducer), #147 (ACTION-001), #159 (authority-effect compat, the one auto-merge, by `github-actions[bot]`), #166 (worker recovery), #181 (merge grant F9). About 60 drafts, closed unmerged at the 13 Nov tie-off. These include the agent-tooling PRs #169 to #172 and #175 (worker worktree path, PR discovery, merge-record audit, observability, coordination), #132 / #146 (mission-control dashboards), #149 (parallel orchestration plan), #176 (multi-AI review), #193 (Gemini recovery checkpoint), #194 (cloud-native multi-agent control plane) |
| 12-13 Nov tie-off | #197 (1,534 commits, 1,108 files: reconstruction waves 1 to 11a, Release 0 exit gate met), #208 (154 commits, 886 files: every open PR tied off) | Mega-PRs from `claude/elegant-curie-7azpsb` |
| 16-20 Nov, v1 waves 1 to 2b | #209 (22 commits, 115 files), #210 (42 / 39), #211 (45 / 103), #214 (169 / 272) | Still one long branch. The divergence gate came later |
| 21-23 Nov, v1 waves 3a to 3i | #215 to #227 | `wave/v1-wave-3*`. Each is about 8 to 20 commits and 24 to 50 files, a compacted RED + fix pair per packet. Merged by `SaCH-PRO` (Claude under D-239) with a merge commit, usually 1 to 2 hours after opening |
| Open | #228 wave 3j (6 commits, 42 files) | Plus `wave/3j-second-lane` (no PR; 116 commits, 64 files), `wave/v1-wave-3k`, `wave/v1-wave-3l`. 7 dependabot PRs frozen |

The v1 waves in detail (number, commits, files, +/-):

| PR | Wave | Notes |
| --- | --- | --- |
| #215 | 3a part 1 (8 / 40 / +5,675) | The six WIP packets. First CI green PR under D-232 |
| #216 | 3a part 2 (9 / 15) | Phone duplicates. Conflicted with #215 on `fixture-prefixes.json` (union) |
| #217 | 3b part 1 (15 / 24) | First merge under D-239. Codex P1 threads left open for the owner |
| #218 | 3b part 2 (20 / 50) | Main merged in twice. The Windows proof was cancelled at 44 minutes and re-run |
| #219 | CI repair (1 / 4) | Node heap ceiling for the server type check. First use of D-240 |
| #220 | 3c (8 / 24) | Rulings D-240 to D-248 ride in the wave |
| #221 | 3d (8 / 24) | **The agent memory layer (D-253 Track 1)**: rulings D-249 to D-254. Four Codex findings fixed (2b2d3286 / 3e84310b) |
| #222 | CI repair (1 / 1) | The BRS-12 timestamp flake, under D-240 |
| #223 | 3e (20 / 43) | 7 packets plus RULINGS-3E |
| #224 | 3f (9 / 45) | NAV-A1 and **AGENT-MEMORY-FIXES** (finish-squash JSON merge, optional trailer) |
| #225 | 3g (16 / 39) | |
| #226 | 3h (17 / 47) | Stacked on 3g |
| #227 | 3i (14 / 45) | |

### 2.2 How a wave was built (the de-facto algorithm)

1. Packets are accepted. The worker's two reviews accept, then the orchestrator's two acceptance reviews accept at
   the exact head (D-241). Confirmation reviews cover each repair delta.
2. Cut `wave/v1-wave-<n>` from main. Run `compact.sh` per packet, using `finish-squash.sh` on a prefix conflict.
   Bring stacked packets in after their base. Rulings branches ride in the wave.
3. `git checkout origin/main -- .agent-control`.
4. Prove the wave head (WAVE-RUNBOOK section 2) and check divergence.
5. Run a read-only "assembly review" of the merge (PR #228 body).
6. Open the PR from the template. Fix Codex findings with a RED + fix pair.
7. Merge under D-239 with a merge commit and `expectedHeadSha`. Then `status.mjs`, a state-file rewrite and a
   PROGRESS post on #80.
- When a wave goes over 50 files, split it (3a, 3b). Waves stack (3h on 3g) to keep throughput while a PR waits for CI.

### 2.3 PRs and branches about agent tooling, memory, CI and merge mechanics

- **Agent memory:**
  - Track 1 `pkt/V1-AGENT-MEMORY-LAYER` (in #221) and `pkt/V1-AGENT-MEMORY-FIXES` (in #224).
  - Track 2 research `docs/kf-memory-rnd-001` @ `d2db3c7e`: 13 proposed MEM packets and owner questions Q0 to Q14.
    Its packets are now in the plan via D-257 and D-261.
  - Older: `docs/kf-memory-context-genome-plan-001`, `impl/kf-meta-memory-truth-audit-001`.
- **Agent control:** #86 / #87, #89, #92, #100, #103, #104, #120, #159, #166, #181 merged. #169 to #172, #175, #184,
  #185, #191, #193, #194 closed.
- **CI repair:** #219, #222, plus RR-SCRIPT-SPECS-IN-CI and RR-CI-REQUIRED-JOBS-AGGREGATE (the second-lane packets that
  add a `ci-verdict` job; making it a required check needs the owner).
- **Squash and merge mechanics:** `compact.sh` (moved out of scratch in the 7083919403 handover), `finish-squash.sh`
  (Codex review on #223: merge as JSON, not marker text).
- **Builder KEY:** `ccr-1eadc8f4-aqfqne` @ `560bdf36` (the design).

---

## 3. Issue #80

1,990 comments (20 Sep to 24 Nov): 1,387 by `github-actions[bot]`, 597 by `SaCH-PRO` (every agent and the owner
share it), 4 by `chatgpt-codex-connector[bot]`, and 2 by an outside account `Agence-IA-Toulouse` posting
`sender: chatgpt` REVIEW envelopes (5997061944, 5997065390). That last point shows that a sender field means nothing
without an author check.

### 3a. Message types and their de-facto formats

**ChatGPT era (20 Sep to 8 Nov).**

- Volume:

  | Type | Count |
  | --- | --- |
  | AUTO_EVENT | 1,386 |
  | REVIEW | 111 |
  | ACK | 109 |
  | PROGRESS | 109 |
  | RETURN | 54 |
  | DIRECTIVE | 39 |
  | CONTRADICTION | 27 |
  | MOMENTUM | 24 |
  | CLOSE | 2 |
  | HOLD | 1 |
  | RESUME | 1 |
  | AUTO_MERGE | 1 |

- Every message was a yaml envelope, often fenced, with:
  - the fields `message_id, message_type, packet_id, sender, recipient, in_reply_to, source_main, source_head,
    implementation_branch, pr_number, state, health, scope_changed, production_touched, provider_traffic,
    merge_authority, review_status, control_effect`;
  - prose sections after the fields.
- ID conventions: `CG-DIRECTIVE-*`, `CG-REVIEW-*`, `CG-HOLD-*`, `CC-ACK-*`, `CC-RETURN-*`, `CC-CONTRADICTION-*`,
  `CW-MOMENTUM-HELD-*` (the worker).
- Example DIRECTIVE: 5750633070 (`CG-BOOTSTRAP-001`, with `objective`, `prohibited_scope`, `proof_obligations`,
  `next_action`).

**v1 standing-directive era (20 Nov on), 113 comments.**

- **DIRECTIVE.** `OWNER-DIR-V1-STANDING-001` (7051296684) is the last yaml authority message: scope, rules, review,
  rulings with the 48 h PROVISIONAL rule, stop conditions, reporting, effect (D-222).
- **ACK.** Yaml: `CC-ACK-V1-STANDING-001` (7051421733) and `CC-ACK-V1-SESSION-20261121-001` (7070722674). Once per
  series.
- **RETURN.**
  - Yaml for the first eight (`CC-RETURN-<PACKET>-001`, for example 7052103351), then prose from 22 Nov.
  - The prose shape (second-lane RETURNs 7090356995, 7092117468 and others) is a header line
    `**RETURN <ID> (second lane)**`, then these blocks:
    - branch / base / head;
    - **Commits (RED, then fix, per round)**;
    - **Premise check**;
    - **What the packet does**;
    - **Proof at <sha>** (exact counts, `R0 EXIT GATE MET (exit 0)`, "no ECONNREFUSED");
    - **Reviews** (each round, each lens, each finding and how it was closed);
    - **Outside the write set**;
    - **False premises**;
    - **Open for the orchestrator / owner**.
  - 37 RETURNs in all, 2.3k to 19k characters each.
- **CLAIM.** Introduced by the lane split (7089287861): `CLAIM <ID> (second lane)` plus the branch, base sha, lane,
  priority and fixture prefix. 21 posts (for example 7089120864, 7101512125). Pushing the branch is the actual claim;
  the comment is the record.
- **ACCEPTED / REJECTED** are the orchestrator's acceptance verdicts:
  - `**ACCEPTED (orchestrator) — <ID>** at <branch> @ <sha>`, then the verdict per lens, what it re-ran, notes
    (7090546612, 7092219528, 7096513277);
  - `**REJECTED (orchestrator), repair requested**`, with findings by severity and the fix asked for (7092243796).
- **PROGRESS.** Per wave or per session (7072216699, 7092097028). "MERGED: PR #n under D-239" posts carry the merge
  commit, `expectedHeadSha`, local and CI proof, and the packets landed (7085866733, 7088922193).
- **ORCHESTRATOR STATE**, **HANDOVER / HANDOFF**, **CHECKPOINT** posts are snapshots pointing at the state file
  (7083919403, 7084465376, 7085239441, 7089358538).
- **Rulings.** `**OWNER RULING D-nnn (date): <name>.**` with the owner's words quoted and "what this means" (17 posts,
  D-239 to D-270). An early form was `CC-RULING-RECORD D-239` (7074545855).
- **CONTRADICTION**: 7079513393 (a false packet precondition, kept in the packet on the reviewer's recommendation).
  **MATERIAL DISCOVERY**: 7106160726.
- **MOMENTUM.** One in v1 (7073371189: three review rounds each found new surfaces; YELLOW).
- **ORCHESTRATOR DECISION**: 7086968118 (a scope call under existing rulings, with follow-up packets).
- **WAVE ASSEMBLED**: 7117144941.

Takeaway: v1 abandoned the yaml envelope after 22 Nov 03:10. A message from then on is a bold headline plus
structured prose. The design's proposed yaml tail restores machine-readability, and should be a tail (data), not an
envelope (authority).

### 3b. Documented failures and lessons

Each line gives the lesson, its evidence, and the gate or check Builder KEY needs.

**Usage, capacity and parallelism**

- **L-01. The account's 5-hour usage limit is shared by all sessions.** Nine parallel sessions stopped everything
  for two hours (16:42 to 18:40 UTC, 22 Nov).
  - Evidence: #80 7083919403; state file section 1.
  - Builder KEY: a hard cap of 4 workers (3 on Opus). The Foreman budgets tokens per provider and per account.
- **L-02. The seven-day model limit (Fable) killed every worker on that model.** Work moved to Opus, which shares the
  5-hour pool with the orchestrator.
  - Evidence: 7084465376; state file ("Fable limit spent until 2026-11-25 / 11-30").
  - Builder KEY: model failover in the runner config. A limit error triggers checkpoint and reassignment, never a
    retry loop.
- **L-03. Three packets were lost because workers had not pushed** (FU-CONTRACT-FETCH-OUTBOUND-GUARD had reached both
  accepts).
  - Evidence: 7084465376.
  - Builder KEY: the "push after every commit" brief rule. `kf checkpoint` refuses to record a step whose head is not
    on origin. The Foreman runs a nightly "unpushed worktrees" audit (as in 7085239441: 22 worktrees audited).
- **L-04. Reviewers hit usage limits mid-packet.** The later commits were reviewed by fresh agents on another model.
  - Evidence: 7117999068 (MOUNT-QUOTES).
  - Builder KEY: the review record names provider and model. Gate 7 accepts a reviewer swap and requires the new
    reviewer to see the whole delta since the last accepted head.
- **L-05. Codex review hit its usage limit; Copilot was out of quota "at every head".**
  - Evidence: 5848225508; appraisal section 0 item 6.
  - Builder KEY: never make a third-party bot review a required gate. Record NOT_RUN with a reason (the
    `semantic-review.mjs` pattern).
- **L-06. The first orchestrator account went out of usage.** The second-lane account became acting orchestrator and
  then judged its own lane's work ("weaker ... the owner can re-open any of them").
  - Evidence: 7117144941; state file section 3.
  - Builder KEY: gate 7 requires reviewer contexts independent of the worker. Where possible a different
    account or provider (the `adapters.mjs` same-adapter rule). The Foreman flags self-acceptance to the owner.
- **L-07. Two lanes and two accounts cannot message each other.**
  - What went wrong: RR-REDACTION-BY-CONTENT ended up in both PR #228 (`wave/v1-wave-3j`) and `wave/3j-second-lane`,
    and "wave 3j" was named twice.
  - Evidence: PR #228 body; 7117144941.
  - Builder KEY: claims and wave membership need one durable registry (branch existence plus a CLAIM/WAVE yaml on #80
    or a `kf/state` file). `kf wave` refuses a packet that is already in another open wave branch.
- **L-08. Child sessions belong to the account that started them.** Scheduled check-ins belong to the session. A new
  account can only use branches and #80.
  - Evidence: 7085239441; SECOND-ACCOUNT-SETUP.
  - Builder KEY: Principle 1 (state in git and #80) is confirmed. The runner result file must be pushed, not sent by
    a session message.

**Proof integrity**

- **L-09. Release 0 was run without `.env`.** One DB suite could not start ("Environment variable not found:
  DATABASE_URL"), and R0 was REJECTED for no product reason. This happened more than once.
  - Evidence: 7117144941; 7116570679; 7117999068; 7052103351 (`public-payment-intent` needs `DATABASE_URL` exported);
    state file section 5.
  - Builder KEY: `kf prove` loads `.env`, runs `admit-resources.mjs`, and refuses to start if a required variable is
    unset.
- **L-10. The head moved mid-suite.** A queued chain waited by grepping "chain finished at", which matched "previous
  chain finished at"; another run checked out a different head during the suite.
  - Evidence: 7117144941; state file section 5. The scratch `chain-final.sh` now checks the head before and after
    each step, but it still runs `git checkout` in the main checkout.
  - Builder KEY: proof runs in a dedicated, detached worktree per sha, under a global lock (one suite per database).
    `HEAD` is checked before and after each step, and the receipt is written only if unchanged.
- **L-11. A container restart stops Postgres and Redis.** Proof runs were void with ECONNREFUSED. A machine restart at
  about 01:22 UTC stopped them mid-run.
  - Evidence: 7072661205; 7086362185 (wave 3e "first proof run was void"); 7117999068 ("two container restarts").
  - Builder KEY: a preflight with `pg_isready` and `redis-cli ping`. A run with any ECONNREFUSED in its log is marked
    VOID, never a result.
- **L-12. A `.env` copied from `.env.example` is not a valid test env.** An empty `TRUST_PROXY` crashes, a partial
  `S3_*` group fails validation, and placeholder Supabase URLs flip auth to remote verification. Two full runs failed
  for these reasons alone.
  - Evidence: 7090356995; 7090546612. The scratch `bootstrap.sh` still copies `.env.example`.
  - Builder KEY: `kf env up` writes the minimal local `.env` from SECOND-ACCOUNT-SETUP. A test asserts the env is
    valid.
- **L-13. `pnpm db:generate` can come back from the turbo cache having generated nothing.** Hundreds of suites then
  fail with `Cannot find module '.prisma/client/default'`.
  - Evidence: WAVE-RUNBOOK section 2.
  - Builder KEY: an env health check. The client must exist after generate, else run `prisma generate` directly.
- **L-14. The Node pin.** The container has 22.23.5 and the repo pins 22.23.4 (`.nvmrc`). Proofs run on
  `/opt/node-22.23.4`.
  - Evidence: 7090356995.
  - Builder KEY: `kf env` installs the pinned Node with checksum; `kf prove` asserts `node -v` equals `.nvmrc`.
- **L-15. Load flakes under the full suite.** `contacts-audit-actor` ST-R3 and CR-1 (+2 teamLogs);
  `booking-concurrency` V1-16 (ECONNRESET); `invoice-status-events` A9-R2. Each passed alone.
  - Evidence: 7084932316, 7086362185, 7086968118, 7092097028.
  - Builder KEY: a known-flake list with ids. A failure on the list is re-run alone 3 times and recorded. Any other
    failure fails the run. Never auto-skip.
- **L-16. "Green" receipts that were not green.** #215's first receipt said green while CI was red, and its "20/20
  server suites" was a subset.
  - Evidence: 7071174439.
  - Builder KEY: `kf return` and the PR body take counts only from `proof/<sha>.json` and CI. A model may not type a
    number.
- **L-17. jsdom cannot show React event timing between capture and bubble listeners.** A menu that closed in the
  capture phase passed its unit test and broke every menu item in a browser. A phone sheet sat 345 px off screen.
  - Evidence: state file section 5; 7117999068.
  - Builder KEY: packets that touch menus, focus, animation or layout need the live journey (`e2e-live.yml` dispatch,
    or the local production build with the Playwright aliases). `kf gate` flags web diffs in those components without
    a browser receipt.
- **L-18. Live journeys need setup.** They need a production web build from a real `pnpm install` (Turbopack refuses
  symlinked `node_modules`), a separate `keyflowos_e2e` database, and Playwright 1.59's browser names aliased
  (`/opt/pw-browsers/chromium*-1217 -> *-1243`). A run was cut off when the test API was stopped to free memory.
  - Evidence: state file section 3; 7118763435.
  - Builder KEY: prefer `e2e-live.yml` on GitHub runners via the App. Locally, bake the aliases into the container.
- **L-19. Tests that cite source line numbers go stale when other waves merge** (NAV-A1 NMS-18).
  - Evidence: 7089358538.
  - Builder KEY: a review-brief rule, plus a cheap gate heuristic that warns on `:\d+` line citations in new tests.
- **L-20. Load-bearing CI pieces.** The server `tsc` needs a 6 GB heap (#219). The Windows worker proof takes 55
  minutes and was cancelled once at 44.
  - Builder KEY: CI duration is the wave-cycle floor. Ask the owner to retire the Windows job (it proves an unused
    worker).

**Git mechanics**

- **L-21. Amend and force-push are refused by the environment's policy.** A shell error in a commit chain skipped the
  tests commit, so the history landed fix-then-tests (`122bc0e3` then `dfc26026`). That is a bisect hazard: at
  `122bc0e3` six QPM cases are red.
  - Evidence: 7117999068.
  - Builder KEY: `kf commit --red` / `--fix` wrappers that verify the staged files (tests only, or no tests) before
    committing. Gate 1 detects fix-before-test and requires a recorded deviation. Compaction removes the hazard on
    main.
- **L-22. Shell quoting ate backticked words in commit messages.**
  - Evidence: 7117999068.
  - Builder KEY: commit messages are written to a file and passed with `-F`.
- **L-23. A reviewer's RED checkout in the worker's live worktree polluted an unpushed commit.**
  - Evidence: 7106160726 ("reviewers now work in detached worktrees only").
  - Builder KEY: the runner gives every reviewer a fresh detached worktree, never the worker's.
- **L-24. Fixtures and shared files collide.** `fixture-prefixes.json` conflicts on every parallel pair (#215 / #216,
  wave 3j). A real prefix clash happened (v71t_). `ci-cd.yml` and `model-gateway.service.ts` import blocks conflicted
  in wave 3j.
  - Evidence: 7072216699; 7117144941; state file history.
  - Builder KEY: `kf claim` allocates the prefix. `kf next` avoids packets whose write sets overlap, with
    `git merge-tree` against main and the open wave as a cheap check (as in 7096513277).
- **L-25. Stacked packets.** A packet built on another packet's branch conflicts with that packet's compacted commit.
  - Evidence: WAVE-RUNBOOK section 1; MOUNT-QUOTES → SWP-INV-MATH → SWP-INV-PUBLIC-LINK.
  - Builder KEY: `kf claim --base <sha>` records the stack. `kf wave` compacts bases first.
- **L-26. Divergence gate.** 25 commits / 50 files. Waves were split; a 64-file branch exists.
  - Evidence: WAVE-RUNBOOK section 3.
  - Builder KEY: `kf wave` runs `check-branch-divergence.sh` and refuses.

**Process and scope**

- **L-27. Plan premises can be false.** Three were in one day. A packet precondition was false (W11-DISPATCH-REFUSAL).
  The M0 packet's own plan text already contradicted Release 0 (SWP-INV-PUBLIC-LINK: INVOICE_NOT_SHAREABLE).
  - Evidence: 7079513393; state file section 3.
  - Builder KEY: the worker brief's premise check must report in the RETURN block (`false_premises[]`). CONTRADICTION
    stops only that packet.
- **L-28. Review rounds keep finding new surfaces.** FU-PROPOSAL-REVENUE-SIGHT had 3 rounds with new surfaces each
  time. NAV-A1 had 6 rounds per lens. The owner declined a cap.
  - Evidence: 7073371189; 7086409526.
  - Builder KEY: no round cap (owner). After 2 rounds that each add new surfaces, a MOMENTUM report and a scope-split
    proposal (`momentum.mjs`).
- **L-29. Reviewers find pre-existing defects outside scope.** These became follow-up packets: 7 to 13 per day,
  growing the plan from 210 to 364.
  - Builder KEY: the review record has `follow_ups[]`, and the Foreman batches them into the next rulings commit.
- **L-30. Release 0 evidence edits need an owner ruling** (D-242, D-243, owner question 20). An R0-bound case whose
  premise came from unvalidated tests blocked FU-VITEST-DECORATOR-METADATA.
  - Builder KEY: gate 3. The packet stops and the question is batched.
- **L-31. Provider keys in a developer shell reach the network in tests** (`KIMI_API_KEY` in `model-gateway.service.spec.ts`).
  - Evidence: 7091002911.
  - Builder KEY: worker sandboxes carry no product provider keys. The runner starts tools with a scrubbed env
    (`env -i`, as `e2e-api-start.sh` does).

**Lessons from the earlier automation attempts**

- **L-32. A strict authority parser on #80 halts everything.** Three malformed REVIEWs (missing `state` and `health`)
  made authority AUTHORITY_MALFORMED, and the programme needed a recovery packet. 906 `REPORT_DRIFT` posts,
  10 CONTRADICTIONs on one meta packet (5964613912 to 5994350028), and a capacity HOLD (6692411347).
  - Evidence: 6691596446.
  - Builder KEY: parse yaml blocks leniently as data. Authority is only the owner's rulings and merge go. A malformed
    block makes the Foreman ask, never halt.
- **L-33. Heartbeats to #80 drown it.** 1,386 bot posts (70%), 335 "claude is not on PATH".
  - Builder KEY: post only state changes. Liveness goes to the run store or a status page, never #80.
- **L-34. Meta work consumes the programme.** 13 of 16 packets were meta (appraisal).
  - Builder KEY: the KB track has a size budget, and M0 must deliver a real product packet early.
- **L-35. Scheduled cloud routines probed production, and the owner halted them** (`architecture/os/OS.md`, 12 Sep).
  The halt file pattern (`status: HALTED`, "a halted run is a success") is a good kill switch.
  - Builder KEY: a `kf` kill switch file and a Stop button. No cycle may touch production.
- **L-36. Edited comments break authority.** A comment deleted from #80 cannot be detected.
  - Evidence: AGENT_CONTROL_PLANE section on the #80 parser.
  - Builder KEY: the Foreman keeps a local append-only mirror of #80 comment ids and bodies, and detects edits.
- **L-37. One shared GitHub account for all agents** means #80 cannot tell agents apart.
  - Builder KEY: the GitHub App from D-270 gives the Foreman its own identity. Workers can be told apart by a yaml
    `agent:` field plus the App's commit signature.

### 3c. How child sessions were created and returned (D-241)

- **Authority.** D-241 (7078600627; BUILD-MAP line 1248): critical-path first, then by most unblocked. Independent
  packets go in parallel child sessions under the unchanged process. Workers push only `pkt/*`, open no PR, merge
  nothing and do not post on #80. The orchestrator re-verifies each return.
- **Creation.** The orchestrator (a Claude Code cloud session) created child sessions with the remote-session tool
  `create_session` (state file section 1: "`model: claude-opus-5-5` in create_session").
  - The prompt is the pointer form in `PACKET-WORKER-BRIEF.md`: "You are a KEYFLOWOS v1 packet worker. Your packet:
    <ID>. Follow ... Start with: bundle.mjs <ID>. Report to session <ORCHESTRATOR-SESSION-ID>", plus only what is
    specific (a ruling not on main, a non-main base, a known false premise).
  - Session ids were recorded in #80 and the state file (`session_017o9EB...`; for example 7084465376, 7085513731).
  - Several sessions were reused for chains of stacked packets.
- **Concurrency.** Three child sessions in batch 1 (BIZ-SETTINGS-WEB, W11-DISPATCH-REFUSAL-FINAL,
  SWP-INV-MONEY-TOTALS). Nine at peak, which hit the limit. Then at most 4, then 3 on Opus.
- **Inside a worker.** The two reviews per round are fresh subagents given the diff and the packet text only, until
  both accept. Proof follows D-265.
- **Return.** One message back to the orchestrator session (session-to-session send). It carries: branch and head,
  RED and fix shas, files, suite totals and the R0 line, each finding and its closure, out-of-write-set files, false
  premises, open questions.
  - The orchestrator then runs its own two acceptance-review subagents (`ACCEPTANCE-REVIEW-BRIEF.md`), plus
    confirmation reviews for repair deltas, and records ACCEPTED or REJECTED on #80 and in state file section 3.
- **Second account (from 23 Nov 01:30, 7089287861).** It cannot message the orchestrator, so the channel is GitHub
  only. Claim = `git ls-remote` then push the branch, then post CLAIM on #80. RETURN goes on #80; the orchestrator
  posts ACCEPTED or REJECTED on #80.
  - Lane: RR-* P2/P3, widened by the owner when the first account ran out.
- **Scheduled check-ins** (send-later) were used for PR CI polling. They belong to the session.
- **Antigravity** was also running packets on 24 Nov (D-268 tells it to stop claiming).

**What Builder KEY should copy:** the pointer brief, push-as-claim, a result written durably (branch plus a #80 or
file block, never only a session message), fresh detached reviewers, and orchestrator-side acceptance review.

**What to replace:** session-message returns (which do not cross accounts or tools) and by-hand session id tracking.

---

## 4. Gaps: what each `kf` command can wrap, and what is new

| Command | Wraps (exists) | Must be written new |
| --- | --- | --- |
| `kf next [--track launch]` | `lib.mjs readyList` / `buildStatus` / `longestRemainingChain`; `status.mjs --ref`; `--with-branches`; plan `validation.collisions` logic | **Accepted-in-wave** dependency satisfaction (a registry of accepted heads; today only #80 prose and state file section 3). Track filter (`track`, `wedge_first`). Write-set disjointness among the N picks plus `git merge-tree` against main and the open waves. Claim exclusion (`git ls-remote refs/heads/pkt/V1-*`). Fixes for the two status blind spots (tests-only compacted; `--no-ff` wave merges) |
| `kf claim <ID> --base <sha>` | The SECOND-ACCOUNT-SETUP claim rule; CLAIM post shape (7089120864); `worktree-resources.sh provision <id>` | Atomic create and push of `refs/heads/pkt/V1-<ID>` (push fails if it exists). Fixture-prefix allocation against main, the open `pkt/*` and the plan. CLAIM yaml block and parser. Recording the stack base. A local `#80` mirror |
| `kf brief <ID> --role worker\|security\|correctness\|confirm` | `bundle.mjs` (Markdown / JSON); the four briefs verbatim; their prompt templates | A renderer that fills each template with bundle, diff range, deviations-as-facts and stop conditions. A per-runner prompt size budget. An "inputs not conclusions" rule enforced by construction (a reviewer brief never includes the worker's RETURN prose) |
| `kf gate <ID>` | Gate 3: `release0-index.json`, `manifests/*` and `release0-edited-suites.json` define the bound files. Gate 5: `ci-cd.yml` secret-scan step and `scripts/security/*`. Gate 6: `admit-resources.mjs` (DB / Redis targets). Gate 9: `admission.mjs` / `merge-grant.mjs` ideas (bind to workflow file, no pending, owed runs, two snapshots). Gate 4 seed: scratch `titles.mjs` (title and skip counts base against head). Gate 26: `check-branch-divergence.sh`. Gate 7 seed: `adapters.mjs` same-adapter rule | Gate 1: tests-first order over the commit range, plus RED evidence capture (test ids and failure message from the RED commit body or a re-run). Gate 2: write set against `packet.files` plus RETURN departures. Gate 4 proper: deleted `expect`, `.skip`, `.only`, `.todo`, lowered counts. Gate 6 extension to URLs and commands in the diff and in runner logs. Gate 7: review records (yaml) with reviewer context ids. Gate 8: receipt lookup. Plus a jsdom-risk warning and a line-number-citation warning. Each check with RED cases taken from section 3b |
| `kf prove <sha> [--full] [--e2e <specs>]` | `release0.mjs`, `run-manifests.mjs --out` (exact-head receipts), `test-local.sh`, `worktree-resources.sh`, `admit-resources.mjs`, `e2e-live.yml` (dispatch), WAVE-RUNBOOK section 2 command list, scratch `chain-final.sh` and `e2e-api-start.sh` | A detached worktree per sha. A global DB lock. Services preflight. `.env` load and validity. Node pin assertion. Head-unchanged check. ECONNREFUSED makes the run void. Known-flake re-run policy. D-265 scope selection (touched folders plus tsc per packet; full suite plus R0 only at the wave head or when R0-bound files changed). A combined `proof/<sha>.json` (where it lives: on a `kf/state` branch, not in the packet branch). Web proof (typegen, tsc with heap, vitest, lint cap) |
| `kf return <ID>` | The de-facto prose RETURN shape (section 3a); the MULTI-AGENT return envelope fields; scratch `return-*.md` | A drafter from git (RED / fix shas, files, write-set departures) plus the proof receipt plus review records, with a yaml tail. A model edits only premise and judgement text. Numbers only from receipts (L-16) |
| `kf wave <IDs...>` | `compact.sh`, `finish-squash.sh`, the `.agent-control` reset, `check-branch-divergence.sh`, the PR template, WAVE-RUNBOOK sections 0 to 6 | Ordering of stacked bases. Refusing a packet already in another open wave (L-07). An automatic split at 25 / 50. An assembly review brief. PR body from receipts. A `kf merge` subcommand that implements D-239 with re-verification and `--match-head-commit` |
| `kf env up\|down\|reset` | SECOND-ACCOUNT-SETUP script; `Dockerfile`; `docker-compose.yml`; scratch `bootstrap.sh`; `worktree-resources.sh`; AGENTS.md gotchas | One container definition (Node from `.nvmrc`, pnpm, pg16 + pgvector, Redis, ICU database, Playwright with aliases, `keyflowos_e2e`, seeds). A valid minimal `.env` (L-12). Health checks (L-13, L-14). `reset` of the DB template |
| `kf checkpoint` / `kf resume` | The ORCHESTRATOR-STATE.md sections; agent-memory README consolidation rules; `claude-worker.ps1` cursor, lock and hold semantics; `momentum.mjs` | A run file schema (step reached, next action, heads, session or runner ids, spend). Storage that avoids `.agent-control/` (section 1.4). An idempotent resume. An unpushed-head refusal (L-03). A state-file rewrite generator for the parts that are derivable |
| (new) `kf ask` | `OWNER-QUESTION-FORMAT.md` | A batcher, D-nnn numbering (read #80, BUILD-MAP and the state file), the PROVISIONAL 48 h clock |
| (new) runners | `adapters.mjs` (`claude -p` on stdin, `probeAuth`, WAITING_EXTERNAL_AGENT), `claude-worker.ps1` (lock, worktree per wake, bounded retry, permission-denial detection) | The `claude-code` runner (headless; result file pushed), `gemini-cli` / Antigravity (D-270), `api` for reviewers. Spend caps. Model failover on limit errors (L-01, L-02, L-04) |

---

## 5. Recommendations that follow from the evidence

1. Build `kf` as a thin layer over `scripts/agent-memory/` and `scripts/proof-admission/`. Fix the two `status.mjs`
   blind spots first: they decide whether `kf next` is truthful. `scripts/key-builder/tests/*.spec.mjs` must be named
   in `ci-cd.yml`, or the script-spec census (`scripts/ci/script-specs-in-ci.spec.mjs`) fails.
2. Keep run state out of `.agent-control/` (the gate and the wave rule). Use `.kf/` on a `kf/state` branch for
   receipts and checkpoints.
3. Use `worktree-resources.sh` for per-packet databases. This lifts "one suite at a time" for packet-level proof.
   Keep wave-head proof serial.
4. Dispatch `e2e-live.yml` from the GitHub App for live journeys instead of the fragile local setup. The App needs
   `actions: write`, `contents: write` and `issues: write` (and `pull_requests: write` for M2).
5. Make #80 yaml tails data. Authority stays the owner's ruling text and merge go. Never post heartbeats (L-32, L-33).
6. Owner questions this research surfaces:
   - Turn off the autopilot's #80 posting?
   - Retire the 55-minute Windows worker proof?
   - What becomes of the stale `.agent-control/` artifacts and the `pkt/*` gate?
   - Merge MOUNT-QUOTES, SWP-INV-MATH and SWP-INV-PUBLIC-LINK (and wave 3j) before the M0 run, so that
     SWP-QUOTE-PUBLIC-PAGE is ready on main rather than 3-deep stacked?
   - What happens to `wave/3j-second-lane` (fails the divergence gate; duplicates RR-REDACTION-BY-CONTENT with #228)?
7. M0 acceptance should include the MEASUREMENT.md resume test, run against the Foreman's run files.

---

## Appendix: key references

- Files:
  - `scripts/agent-memory/{lib,status,bundle,git}.mjs`, `compact.sh`, `finish-squash.sh`, `tests/*`;
  - `docs/development/agent-memory/*` (8 files);
  - `scripts/proof-admission/{evaluate,run-manifests,release0,admit-resources,negative-controls}.mjs`,
    `release0-index.json`, `manifests/` (46);
  - `scripts/worktree-resources.sh`, `scripts/test-local.sh`, `scripts/check-branch-divergence.sh`;
  - `scripts/agent-control/lib/{adapters,momentum,state-machine,admission,merge-grant,semantic-review,yaml}.mjs`,
    `scripts/agent-control/claude-worker.ps1`;
  - `.github/workflows/{ci-cd,agent-control-gate,agent-control-worker-proof,agent-control-autopilot,branch-divergence,e2e-live,native-dast}.yml`;
  - `apps/server/test/helpers/fixture-prefixes.json`;
  - `docs/reconstruction/{V1-PLAN-RECUT.json,BUILD-MAP-001.md,V1-HANDOFF-2026-11-20.md}`,
    `docs/reconstruction/handoff/ORCHESTRATOR-STATE.md`;
  - `docs/development/PROGRAMME-APPRAISAL-2026-10-21.md`, `architecture/os/OS.md`.
- #80 comment ids:
  - Rulings: 7051296684 (D-222 directive), 7074545855 (D-239), 7078367961 (D-240), 7078600627 (D-241), 7081880780
    (D-253), 7081997117 (D-254), 7118009265 (D-263 to D-267), 7118970946 (D-268), 7119075149 (D-269), 7119158082
    (D-270).
  - Formats: 7051421733 (ACK), 7052103351 (yaml RETURN), 7089120864 (CLAIM), 7089287861 (lane split), 7090356995
    (prose RETURN), 7090546612 / 7092243796 (ACCEPTED / REJECTED).
  - Lessons: 7073371189 (MOMENTUM), 7079513393 (CONTRADICTION), 7083919403 (usage limit), 7084465376 (lost unpushed
    work), 7085239441 (handoff), 7106160726 (reviewer worktree pollution), 7117144941 (proof-run incident, lane-wave
    duplication), 7117999068 (amend refusal, bisect hazard, jsdom gap, reviewer limit).
  - Earlier attempts: 6691596446 / 6692411347 (malformed-authority recovery, capacity HOLD), 6323205536 (worker
    HELD_RETRYABLE), 5848225508 (Codex limit).
