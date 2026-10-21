# KEYFLOWOS programme appraisal, 2026-10-21

Written by Claude Code for the ChatGPT programme command center and the human operator.
Read-only analysis of main at `98ee0202499ba87fa4ee13d58a2a9075016225bd`, issue #80 as of comment 6303046233, and the open PRs on 2026-10-20.
This document is evidence and opinion. It carries no control effect, releases nothing, and holds nothing.

## 0. Summary in ten lines

1. The product is a very large Caribbean-first SMB operating system (NestJS + Next.js + Prisma) with ~790k lines, 441 Prisma models, ~2,190 HTTP routes and 251 pages. Maturity is about 4.5 of 10.
2. The merged packet KF-META-AUTHORITY-EFFECT-COMPAT-001 (PR 159) is correct, minimal and well proven. The merge was properly authorised by CG-REVIEW-KF159-EXACT-HEAD-MERGE-AUTH-001 (6111001643).
3. The application programme is 5 of 35 packets checkpointed (14 percent). The committed checkpoint still says 4. Only one packet (KF-EXEC-TIME-001) is eligible to start.
4. Since 1 September, 73 commits on main touch the control plane and 18 touch the application. Thirteen of sixteen recent packets are meta.
5. The merge evaluator has merged exactly one PR (159). PRs 120 and 147 were merged by hand (GitHub `merged_by` field).
6. Three gates are not real today: DAST never scans (no key) yet is required; Copilot has been out of quota at every head; F9 makes ACCEPT_FOR_ADMISSION equal to READY_TO_MERGE in `lib/admission.mjs`.
7. The last merge of any kind was 11 October. Twenty draft PRs are open. The newest ChatGPT message is CG-REV-F9-004 (6248791378, 18 October). CC-RETURN-F9-002 (6249425702) is waiting for review.
8. Since 11 October the autopilot has posted the heartbeat "claude is not on PATH" 143 times. That is 22 percent of all #80 traffic in the period studied.
9. On main the LLM-parsed command path in `key-cortex-query-pipeline.service.ts` still fails open. PR 155 fixes it and has been draft since 6 October.
10. Recommended order: unstick the loop this week (F9, worker path, gate hygiene), ship PR 155, relax the freeze rules, then give product hardening a credited lane.

## 1. The product

### 1.1 What it is

- Pitch: an AI-powered business operating system for founders, freelancers and small service teams, Caribbean-first (TTD pricing, WiPay gateway, Trinidad timezone). Sources: `README.md`, `KEYFLOWOS-STRATEGY.md`, `docs/CRITICAL_ANALYSIS_2026-08.md`.
- Modules: cockpit, CRM, commerce (quotes, invoices, storefront, Stripe, PayPal, WiPay), bookings, marketing, finance (double-entry ledger), expenses, projects, payroll, time tracking, voice (LiveKit + OpenAI Realtime), marketplace, community, education, procurement, helpdesk, contracts.
- KEY is the AI co-pilot. KEY Cortex is its reasoning and action layer. Business Genome is the evidence-backed business identity kernel. Mind, Soul and Evolution are the plan to go from co-pilot to autonomous digital employee (`docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md`).
- The repo's own audits say the vision outruns the implementation. `docs/audits/KEY_EFFECTIVENESS_RATING.md` rates KEY 7 of 10 as a governed co-pilot and 3 of 10 as the autonomous employee that is described.

### 1.2 Stack and shape

| Measure | Value | Source |
|---|---|---|
| Server LOC / web LOC | ~436k / ~350k | `git ls-files` + `wc` |
| Server modules / HTTP route decorators | 110 / ~2,190 | `apps/server/src/modules` |
| Prisma models / schema lines | 441 / 12,863 | `packages/db` |
| Web pages | 251 (about 173 after redirects, about 37 percent unreachable from navigation) | `apps/web/app`, `docs/system-map/README.md` |
| Server unit tests / web unit tests | ~4,400 / 210, green in CI | `.github/workflows/ci-cd.yml` |
| Playwright e2e tests | 71, never run in CI | `apps/web`, `ci-cd.yml` |
| Dependency advisories | 260 (12 critical, 107 high) | PR 155 receipt 6240756683 |
| Human authors in git history | 1 | `git shortlog` |

- Web: Next.js 16.2.4 (locally patched), React 19, Tailwind. Server: NestJS 11, Socket.io, EventEmitter2 (276 event names). Data: Prisma 6 on Postgres with pgvector, Redis and BullMQ. tRPC exists in `packages/api` (82 procedures) but was measured unreachable in August.
- Auth: Supabase JWT plus HMAC admin tokens. Tenancy: one `Business` boundary, 349 of 441 models carry `businessId`, auto-scoped by an AsyncLocalStorage Prisma extension. No Postgres row-level security.
- AI: one gateway, `apps/server/src/modules/ai/model-gateway.service.ts` (3,030 lines) fronting OpenAI, Anthropic, xAI, Kimi, Google, Ollama, BYOK. Two parallel agent stacks: `ai/flow-orchestrator.service.ts` (6,974 lines, 286 tools) and `key-cortex/*` (~70k lines, its own registry).
- Jobs: 28 `@Cron` and 36 `setInterval`, no leader election.

### 1.3 Quality and risk signals

- Craft is above median: strict TypeScript on web, ratcheted lint (server `--max-warnings 3343`), 4k green tests, honest audit documents.
- Release engineering is pre-production: no continuous deployment, manual VPS deploy script to a single Hetzner host, `render.yaml` is a tombstone. `docs/PRODUCTION_STATE.md` (2026-08-03) recorded the live database at 29 tables against 433 required and a proven cross-tenant write on 2026-08-07.
- Security: `architecture/architecture-risks.md` still lists open criticals R16 (plaintext OAuth and bank tokens at rest), R19 (`/admin/*` gated client-side only), R20 (cross-tenant WebSocket approvals), R22 to R25 (GDPR purge incomplete). `SECURITY.md` posture table is stale against 260 advisories.
- Fail-open autonomy on main: in `apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts` the autonomy-checked command set starts as all parsed commands, and the catch block logs "Autonomy check failed, using all parsed commands" and executes them. PR 155 (KF-EXEC-AUTH-FAIL-CLOSED-001) starts from an empty set and publishes approvals only after the whole batch evaluates.
- Debt markers: `as any` 1,882 on server; `eslint-disable` 373; two AI stacks; about 8,500 lines behind 30 cortex routes with no caller; 8 of 10 realtime handlers subscribe to events that are never emitted.
- Credential hygiene: `audit-keyflowos.py` and `audit-mobile-quick.py` at the repo root hard-code a login email and password for a test account. They should be rotated and removed. Only `.env.example` is tracked otherwise.

### 1.4 Product maturity score: 4.5 of 10

- Reachable depth is a fraction of built surface.
- Release engineering cannot ship safely.
- Open critical security findings plus a fail-open LLM execution path on main.
- Scope spans freelancer invoicing and mid-market ERP in one binary.
- The documentation is the strongest asset and is honest about all of the above.

## 2. The programme vocabulary: phases, kernels, journeys, waves, paths

| Term | Meaning in this repository | Defined in |
|---|---|---|
| Packet | The unit of work. One PR, one lifecycle, released only by a ChatGPT DIRECTIVE. KF-EXEC packets earn credit. KF-META packets are control-plane work and earn zero. | `docs/development/EXECUTION_CONTROL_STANDARD.md`, `AGENT_CONTROL_PLANE.md` |
| Wave | Dependency tier 0, A, B, C, D, E of the application DAG. `do_not_leapfrog_wave_gate: true` means nothing in wave N+1 starts until all of wave N is checkpointed. | `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml`, `lib/dag.mjs` |
| Phase (DAG sense) | A packet sub-node. Two packets (PLAYBOOK-001, GROWTH-001) are split across waves to fix a deadlock, so 35 packets become 37 phases. | DAG header, `lib/dag.mjs` |
| Phase (roadmap sense) | Six older, incompatible numbering schemes (Construction Manual 0 to 11, KEY_10 A to E, GAP_ANALYSIS A to G, Genome 1 to 10 and 11 to 17, key-genome 14 to 18, migration plan 1 to 6). None references waves or packets. All last touched 2026-09-06. | `docs/*ROADMAP*`, `docs/KEYFLOWOS_10_OUT_OF_10_CONSTRUCTION_MANUAL.md`, `architecture/migration-plan.md` |
| Kernel | 12 architectural truth-owners, K1 Tenant Genesis and Identity through K12 Engineering Control Plane. Final acceptance requires 12 of 12 reassessed. | `docs/intelligence/12-KERNEL-PROGRAMME.md` and `docs/intelligence/kernels/` on branch `docs/keyflow-intelligence-foundation`, not on main |
| Journey | 26 canonical end-to-end business journeys, J1 Business Birth through J26 Business Network. Final acceptance requires 26 of 26 reassessed. Some documents still say 25. | `docs/intelligence/journeys/` on the same branch, not on main |
| Constellation | Six cross-journey groupings. | Same branch |
| Path | Not a programme concept. `architecture/execution-paths.md` is a map of 13 runtime call paths through the code. The DAG uses chain and order, never path. | `architecture/execution-paths.md` |
| Gate | Four things: the wave gate; the proof and admission gates (CI, exact-head evaluator, review); the 10 human gates of the platform DAG that automation may never perform; and the TRUST-G milestone gates on the intelligence branch. | `KEYFLOWOS_PLATFORM_DAG.yaml`, `AGENT_CONTROL_PLANE.md` |

Observation. `CLAUDE.md` instructs Claude to read the multi-agent protocol and the wave board "when available on the working base". They are never on main. The canonical board on its branch still shows 4 checkpointed and ACTION-001 characterising, which has been wrong since 2026-10-06.

## 3. Programme progress

### 3.1 Application DAG (35 packets, 37 phases, 131 edges, root K12-001)

| Wave | Packets | Status |
|---|---|---|
| 0 | K12-001, EXTFX-001 | checkpointed |
| A | TENANT-001, AUTH-001, ACTION-001 | checkpointed (ACTION-001 by CG-REVIEW-ACTION-001-POST-MERGE-CHECKPOINT-004, 6010515405; the committed file still omits it) |
| B | TIME-001, INGRESS-001, CONNECTOR-001, TEMPORAL-002, RECOVERY-001, CONVO-001, PLAYBOOK-001#foundation | not started; TIME-001 is the only eligible packet |
| C | COMMERCIAL-001, BOOKING-001, FINANCE-001, DELIVERYBILL-001, COMMERCE-001, ENTITLE-001, GROWTH-001#foundation | not started |
| D | PLAYBOOK#convergence, KNOWLEDGE-001, KNOWLEDGE-002, COMMAND-001, PUBLIC-001, SPACE-001, GROWTH#closed_loop, VOICE-001, PRIVACY-001, NETWORK-001, UX-001, EXPERIENCE-001 | not started |
| E | WITHDRAW-001, WITHDRAW-002, MIGRATE-001, INTEGRATED-001, OPS-001, RELEASE-001 | not started |

- Checkpointed: 5 of 35 (14 percent). The committed `.agent-control/programme-state.yaml` is anchored at RECOVERY-021 (2026-10-05) and lists 4.
- KF-EXEC-AUTH-FAIL-CLOSED-001 (PR 155) carries the EXEC prefix but is not a DAG member, so it earns no credit.
- Critical path, 17 packets: K12, TENANT, AUTH, ACTION, TIME, COMMERCIAL, FINANCE, COMMERCE, PUBLIC, SPACE, GROWTH#closed_loop, WITHDRAW-001, WITHDRAW-002, MIGRATE, INTEGRATED, OPS, RELEASE. RELEASE-001 explicitly does not authorise production release.
- Largest hub ahead: TIME-001 with 10 direct and 28 transitive dependants.
- Wave-gate inefficiency: KNOWLEDGE-001, KNOWLEDGE-002 and PRIVACY-001 depend only on K12 (done) yet wait behind 14 unrelated wave B and C nodes.
- Both validators pass: `validate-dag.mjs` (35 packets, 37 phases) and `validate-platform-dag.mjs` (63 packets, INACTIVE_SUCCESSOR). No cycles.

### 3.2 Platform DAG (successor)

KEYFLOWOS_PLATFORM_CONVERGENCE: 63 packets in groups P0 to P11, near-linear (longest chain 37), 10 human gates, 0 started. Inactive by construction. Activation needs a ChatGPT DIRECTIVE with `programme` and `programme_action: ACTIVATE`. Its evaluator is not wired into the orchestrator; that wiring is its own first packet.

### 3.3 Delivery throughput since 1 September

| Measure | Value |
|---|---|
| Commits on main | 130 |
| Commits touching control-plane paths / application paths | 73 / 18 |
| Application packets merged | 5 (EXTFX 09-19, TENANT 09-20, ACTION 10-06; K12 and AUTH earlier) |
| Meta packets merged | 6 (AUTO, CONTROL-PARSER, STATE-RECONCILE-002, AI-REVIEW-FAILOVER, STATE-REDUCER-LIVE, AUTHORITY-EFFECT-COMPAT) |
| Merges in October | 5 (4 control plane, 1 application) |
| Last merge of any kind | 2026-10-11 |
| Open draft PRs | 20 |
| Issue #80 comments | 1,526 |

## 4. The ChatGPT, GitHub, Claude loop

### 4.1 As implemented

1. ChatGPT, relayed by the human from the `SaCH-PRO` account, posts a typed DIRECTIVE or REVIEW envelope on #80.
2. `scripts/agent-control/claude-worker.ps1` (Windows) polls #80. `select-directive.mjs` picks the newest valid authority comment (author allowlisted, `sender: chatgpt`, DIRECTIVE or REVIEW, well-formed, unedited, not yet processed), adds a detached worktree named after the message id, and runs `claude -p` with a bounded prompt. A run counts only if the transcript ends with the done marker.
3. Claude posts ACK, writes `.agent-control/active-packet.yaml` and `claude-return.yaml`, pushes an `impl/*` branch, opens a draft PR, posts RETURN with `review_status: PENDING_CHATGPT_REVIEW`.
4. `agent-control-gate.yml` checks envelope keys, branch binding, `source_head` ancestry with a control-only tail, `production_touched: false`; for non-draft PRs also `source_main` equals the base SHA and status in READY_TO_MERGE or ACCEPT_FOR_ADMISSION.
5. ChatGPT reviews. Claude records the verdict and the `semantic_review` block in the artifact. ChatGPT grants merge. The PR is marked ready.
6. `agent-control-autopilot.yml` runs `orchestrate.mjs` (reconcile plus fold) on every #80 comment, every workflow run and hourly, posting an AUTO_EVENT each time. On a workflow run it executes `auto-merge-admitted.mjs --merge` under one concurrency lock: full snapshot, second snapshot, SHA-pinned squash merge, idempotent AUTO_MERGE record.
7. ChatGPT posts a CHECKPOINT review. The fold projects it. The committed checkpoint moves only by a reviewed commit.

### 4.2 Mechanisms and their condition

| Mechanism | Code (lines) | Tests / negative controls | Condition |
|---|---|---|---|
| Envelope parser `lib/control-envelope.mjs` | 424 | 27 / 12 | Sound. Any column-0 `word:` line anywhere in an authority comment makes it malformed and freezes the fold for every packet. Three reviewed re-anchors so far. |
| Authority and identity `select-directive.mjs` | 142 | 25 / 22 | Allowlist is one login. ChatGPT and Claude are a self-declared `sender` string from the same account. The one outside post (2026-10-05) was rejected correctly. |
| Typed effects and fold `lib/authority-effects.mjs`, `lib/state.mjs` | 749 | 87 / 37 | Sound and deterministic. First unfoldable message freezes the projection: safety over liveness. |
| Reconcile against repository truth `lib/reconcile.mjs`, `lib/truth.mjs` | 336 | 19 / 10 | Sound. 383 of 650 AUTO_EVENTs in the sample were REPORT_DRIFT. |
| Mutation proof `proof-mutation.mjs`, `negative-controls.yaml` | 145 + 2,480 | 193 controls | Sound. Windows-only in full, 26 to 61 minutes per push. |
| DAG validators `lib/dag.mjs`, `lib/platform-dag.mjs` | 638 | 57 | Sound. The platform validator validates a graph nothing consumes. |
| Pre-RETURN artifact contract `lib/return-evidence.mjs` | 183 | 17 / 14 | Regex-based prose policing; brittle by construction. |
| Admission and merge `lib/admission.mjs`, `auto-merge-admitted.mjs`, `lib/merge-record.mjs`, `lib/semantic-review.mjs` | 1,140 | 101 / 46 | The strongest piece. Weakened by F9, a no-op DAST gate and a Copilot reviewer that never runs. |

Totals: 5,749 lines of control-plane JavaScript, 8,824 lines of tests, 193 negative controls, about 1,000 lines of PowerShell. Test-to-code ratio about 1.5 to 1.

### 4.3 Message statistics

Sample: 842 #80 comments from 2026-10-03 to 2026-10-20 (55 percent of the issue), classified from the committed fixture plus the live issue.

| Dimension | Count |
|---|---|
| By type | AUTO_EVENT 649, ACK 48, REVIEW 48, PROGRESS 47, RETURN 20, CONTRADICTION 15, DIRECTIVE 9, MOMENTUM 2, RESUME 1, AUTO_MERGE 1 |
| By sender | github-autopilot 650, claude 120, chatgpt 70 |
| By packet prefix | none 560, KF-META 228, KF-EXEC 48, KF-ATLAS 4 |
| Distinct packets | 16 (13 META, 2 EXEC, 1 ATLAS) |
| ChatGPT control effects | NO_STATE_CHANGE 26, PACKET_CORRECTION 23, untyped 12, RELEASE 2, ADMISSION 2, CHECKPOINT 2, HOLD_CLEAR 1, aliases 2 |
| AUTO_EVENT derived action | REPORT_DRIFT 383, WAIT_EXTERNAL_AGENT 185, EVALUATE_ADMISSION 73, other 9 |
| Messages per merged packet | about 280 (about 64 excluding AUTO_EVENT) |

Worked example, KF-META-AUTHORITY-EFFECT-COMPAT-001: 37 messages (3 DIRECTIVE, 5 REVIEW, 7 ACK, 6 RETURN, 2 PROGRESS, 14 AUTO_EVENT). Directive 10-06 20:54, first RETURN 22:09, semantic pass 10-08 02:42, re-integration directive 10-11 11:27 because main had moved, three more rounds, auto-merge 16:13. About 3 hours of implementation in about 115 hours elapsed. 5,361 lines merged for a 2-entry alias table.

### 4.4 Known defects

- F9. `lib/admission.mjs` line 39 sets `READY_STATUSES` to both READY_TO_MERGE and ACCEPT_FOR_ADMISSION, and `agent-control-gate.yml` line 120 accepts either. Nothing on the merge path reads `merge_authority`. The draft flag is the only guard. Fix: PR 181 (KF-META-MERGE-AUTHORITY-001), draft since 10-17, four review rounds, waiting on CG review of CC-RETURN-F9-002.
- Worker worktree path. A 68-character message id plus the repository path exceeds the Windows 260-character limit, `git worktree add` fails, and the failure is thrown before the attempt ledger so it is never counted. Fix: PR 169, draft since 10-11.
- Single identity. ChatGPT and Claude post from one GitHub account. The allowlist defends only against outsiders.
- Heartbeat noise. `lib/adapters.mjs` `probeAuth()` returns WAITING_EXTERNAL_AGENT on the Ubuntu runner, so every hourly reconcile posts "claude is not on PATH". 143 such comments since 2026-10-11 16:15. The Windows worker ignores `derived_action` anyway.
- Copilot quota. NOT_RUN at every head since early October. The fallback reviewer is ChatGPT, the author of the directives, so independent review is currently self-review by the command center.
- DAST. `HAWK_API_KEY` is absent, every scan step is skipped, the workflow concludes success in zero minutes, and it is in `REQUIRED_WORKFLOWS` (`lib/events.mjs` line 35). A required gate that cannot fail.
- Main-moves rule. `source_main` must equal the base SHA for a non-draft PR. Each merge to main invalidates every other open PR's RETURN and semantic review.
- Truth sources disagree. Committed checkpoint 4, wave board 4, live fold 5, plus one off-DAG EXEC packet in flight.
- Manual merges. PR 120 and PR 147 were merged by `SaCH-PRO`, not by the evaluator. Branch protection is not readable from this session, so the "every merge goes through the evaluator" rule is procedural.

## 5. Appraisal

| Area | Score | Reason |
|---|---|---|
| Product maturity | 4.5 / 10 | Huge built surface, thin reachable depth, pre-production release engineering, open critical security |
| Engineering craft | 7 / 10 | 4k green tests, ratcheted invariants, honest audits, exact-head proof discipline |
| Control plane safety | 8 / 10 | Deterministic fold, SHA-pinned double-snapshot merge, 193 live mutation controls |
| Control plane throughput | 2 / 10 | About 280 messages per merged packet, 3 hours of work in 115 elapsed, 9 days with no merge |
| Programme design | 5 / 10 | DAGs are sound, but 98 packets plus a 17-item acceptance contract for one human and one worker |
| Overall programme health | Stalled | Yellow by its own vocabulary, red on velocity |

The central finding: the control plane has become the product. The merge path is genuinely safe and has merged one PR, ever. Fail-closed on prose turns every typo into a multi-day re-anchor packet. Serialisation is designed in at three layers (wave gate, base-SHA pinning, global lock plus one worker). What is genuinely good, the honesty of the records, the fail-closed instincts, the mutation proof discipline and the quality of the application packets that landed, should be kept and pointed at the product.

## 6. Plan forward

Estimates assume one human operator relaying ChatGPT plus one Claude worker. Difficulty is Low, Medium or High. Nothing below is released by this document; each item needs its own DIRECTIVE or operator action.

### Step 0, this week: unstick the loop

| Action | Difficulty | Time |
|---|---|---|
| Review and merge PR 181 (F9), then PR 169 (worktree path) | Low | 1 day |
| Skip the builder probe on CI; post AUTO_EVENT only on state change or drift; keep the hourly sweep log-only | Low | half a day |
| Remove DAST from `REQUIRED_WORKFLOWS` until it has a key, or add the key | Low | 1 hour |
| Replace Copilot with a reviewer that runs (an API-keyed second model), or record ChatGPT fallback review as non-independent | Medium | 1 day |
| Move the committed checkpoint to 5 of 35; bring the wave board onto main or retire it | Low | half a day |
| Rotate and remove the committed test credential in the two audit scripts | Low | 1 hour |

### Step 1, next two to three weeks: ship the safety fix and relax the freeze

| Action | Difficulty | Time |
|---|---|---|
| Merge and deploy PR 155 (fail-closed autonomy). Highest-risk item on main. | Medium | 2 to 3 days including review |
| Parse only a fenced envelope block, not every column-0 line | Medium | 2 days |
| Allow `source_main` to lag the base when the diff since base touches no file the PR touches | Medium | 2 days |
| Batch ChatGPT reviews to one cadence per day | Low | process change |
| Start KF-EXEC-TIME-001, the only eligible packet and the largest hub ahead | High | 1 to 2 weeks |

### Step 2, next one to two months: a credited product-hardening lane

| Action | Difficulty | Time |
|---|---|---|
| Close R16, R19, R20 (plaintext tokens, client-side admin gate, cross-tenant WebSocket approvals) | High | 2 to 3 weeks |
| Converge the production schema and build a real CD path (platform DAG P0 to P2 as ordinary work, not 63 packets) | High | 3 to 4 weeks |
| Run the 71 Playwright tests in CI; triage the 12 critical advisories | Medium | 1 week |
| Decide scope: quarantine the unreachable 37 percent of routes and one of the two AI stacks | High (a decision) | 1 week to decide |

### Step 3, the following quarter: run the programme at a rate that can finish

- Loosen the wave gate for packets whose dependencies are already met (KNOWLEDGE, PRIVACY). Medium, 2 days.
- Collapse 35 packets toward about 15 by merging wave C and D domain packets that touch the same modules. Medium, 1 week of planning.
- Bring kernels and journeys onto main or drop them from the acceptance contract. Low, 1 day.
- Keep the first three groups of the platform DAG and archive the rest until they are needed.

### Time to a usable product

- At the observed rate when moving, about one packet per week, the remaining 30 application packets are 30 weeks of serial work before the platform programme activates.
- With step 0 and step 1, two to three bounded packets per week is plausible: waves B and C in about three months, the full DAG in nine to twelve months.
- Without those changes the honest estimate is that the programme does not finish, because its overhead grows with its own history.

## 7. Decisions requested from ChatGPT

1. Review CC-RETURN-F9-002 (6249425702) and decide PR 181.
2. Decide PR 169 (worker worktree path).
3. Rule on DAST in `REQUIRED_WORKFLOWS` while it cannot scan.
4. Rule on the independent reviewer while Copilot is out of quota.
5. Authorise a reviewed checkpoint commit moving `programme-state.yaml` to 5 of 35.
6. Decide whether PR 155 proceeds to admission before or after F9 merges.
7. Decide whether a product-hardening lane earns credit, and under which packet ids.

## 8. Method and limits

- Produced on 2026-10-20 and 2026-10-21 from main `98ee0202`, the open PRs, issue #80 pages 13 to 16, the committed fixture, and local runs of the portable test suite (492 tests, 0 failures, 38 environment skips) and the mutation proof (171 of 193 live on Linux; the 22 others need PowerShell and were 193 of 193 on the Windows runner at the merged head).
- Not verified: branch protection settings, the current production host and database, the Windows-only proof suite, and the kernel and journey documents in full (they live on a side branch).
- Three parallel read-only investigations (product, programme structure, control plane) fed this document. Every number above was taken from a file, a command, or a GitHub API field named here.
