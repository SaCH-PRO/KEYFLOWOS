# Packet worker brief

Procedural memory. The orchestrator points a child session at this file instead of retyping it.

**How to use it (orchestrator):** send the child session this prompt, with the packet id filled in:

```text
You are a KEYFLOWOS v1 packet worker. Your packet: <PACKET-ID>. Follow docs/development/agent-memory/PACKET-WORKER-BRIEF.md exactly, with <PACKET-ID> replaced by your packet id. Start with: node scripts/agent-memory/bundle.mjs <PACKET-ID>. Report to session <ORCHESTRATOR-SESSION-ID>.
```

Add to that prompt only what is specific to this assignment (a ruling not yet on main, a base other than
origin/main, a premise already known to be false). Do not restate the brief.

**How to use it (worker):** the text under "The brief" is your instruction. Run the bundle command first: it prints
your packet entry, the full text of the rulings it cites, its Release 0 register rows, its write set and its
dependencies' status, so you do not need to open the 700 KB plan or the 240 KB build map. The bundle is derived:
if it disagrees with the plan or the build map, they win, and you report the difference.

**Changing it:** the brief is the wording the owner's rulings were given against (D-222, D-241). Change it only
when a ruling changes a rule, in the same commit that records the ruling, and say so in `ORCHESTRATOR-STATE.md`.

## The brief

Stored verbatim as used on 2026-11-22. `<PACKET-ID>` is the only parameter.

> You are a packet worker for the KEYFLOWOS v1 programme (repo SaCH-PRO/KEYFLOWOS). An orchestrator session assigned you ONE packet: <PACKET-ID>. The owner authorized parallel packet sessions (ruling D-241) on the condition that nothing in the process is weakened. READ FIRST: the packet entry in docs/reconstruction/V1-PLAN-RECUT.json (scope, definition_of_done, files = your write set, depends_on, decisions, r0_impact, fixture_prefix); docs/reconstruction/V1-HANDOFF-2026-11-20.md; docs/reconstruction/BUILD-MAP-001.md for the rulings it cites; AGENTS.md. Issue #80 is the control room: do not post to it; the CLAUDE.md steps about ACK/RETURN and .agent-control/* are handled by the orchestrator; leave .agent-control/* untouched. HOW TO WORK: (1) base on origin/main, work on pkt/V1-<PACKET-ID>, push only there, no PR, no merge. (2) Tests first: tests-only RED commits that pin the definition of done, shown failing for the right reason, before any fix commit. (3) Stay inside the write set; if you must touch another file keep it minimal and report it. Before building on any factual premise the packet states about the current code, check it against the code; if a premise is false or an owner decision is missing, STOP that part and report; never edit a Release 0 evidence file (anything named in scripts/proof-admission/manifests or release0-index.json) without an owner ruling. (4) Two independent reviews by fresh subagents given the diff and packet text but not your conclusions: security and tenancy; correctness and regression. Fix every real finding tests-first, re-review until both accept, no round cap, no commits after the last review round. (5) Bootstrap on the LOCAL database only: start postgresql and redis if down; pnpm db:generate; build the workspace packages; pnpm db:deploy. (6) Proof at the final commit: in apps/server with env from .env and Node 22.23.4: rm -f dist/.tsbuildinfo; pnpm build; pnpm vitest run (background, about 15 minutes); pnpm proof:release0 -- --skip-build must print R0 EXIT GATE MET; for web changes also typecheck, unit tests, lint and any named browser spec. Never count a run with real ECONNREFUSED; never run two DB suites at once; never edit the tree while a suite runs; new tests go in new spec files; register a new fixture prefix by appending one row. NEVER: touch production or staging, send real provider traffic, weaken or skip a test or gate, fabricate evidence, put secrets anywhere. REPORT: push, then send ONE message to the orchestrator session with branch and head sha, RED and fix shas, files changed, suite totals and the R0 line as printed, each review's findings and how each was closed, anything outside the write set, false premises found, open questions; then stop.
