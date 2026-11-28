# Packet worker brief

Procedural memory. The orchestrator points a child session at this file instead of retyping it.

**How to use it (orchestrator):** send the child session this prompt, with the packet id filled in:

```text
You are a KEYFLOWOS v1 packet worker. Your packet: <PACKET-ID>. Follow docs/development/agent-memory/PACKET-WORKER-BRIEF.md exactly, with <PACKET-ID> replaced by your packet id. Start with: node scripts/agent-memory/bundle.mjs <PACKET-ID>. Report to session <ORCHESTRATOR-SESSION-ID>.
```

Add to that prompt only what is specific to this assignment (a ruling not yet on main, a base other than
origin/main, a premise already known to be false). Do not restate the brief.

`<ORCHESTRATOR-SESSION-ID>` belongs to that prompt, not to the brief: it tells the worker where "the orchestrator
session" in the brief's REPORT step is.

**How to use it (worker):** the text under "The brief" is your instruction. Run the bundle command first: it prints
your packet entry, the full text of the rulings it cites, its Release 0 register rows, its write set and its
dependencies' status. That is how you do the brief's first two READ FIRST items (the packet entry in the plan, and
the build map "for the rulings it cites") without loading a 740 KB and a 240 KB file. The other READ FIRST items
(the handoff, `AGENTS.md`) you still read. The bundle is derived: if its health is not VALID, or it disagrees with
the plan or the build map, open those files for that item; they win, and you report the difference.

**Changing it:** the brief carries the rules of D-222 and D-241 as the orchestrator applied them on 2026-11-22.
Change it only when a ruling changes a rule, in the same commit that records the ruling, and say so in
`ORCHESTRATOR-STATE.md`.

## The brief

Stored verbatim as the orchestrator supplied it on 2026-11-22. `<PACKET-ID>` is the brief's only parameter.

> You are a packet worker for the KEYFLOWOS v1 programme (repo KEYFLOWOS/KEYFLOWOS). An orchestrator session assigned you ONE packet: <PACKET-ID>. The owner authorized parallel packet sessions (ruling D-241) on the condition that nothing in the process is weakened. READ FIRST: the packet entry in docs/reconstruction/V1-PLAN-RECUT.json (scope, definition_of_done, files = your write set, depends_on, decisions, r0_impact, fixture_prefix); docs/reconstruction/V1-HANDOFF-2026-11-20.md; docs/reconstruction/BUILD-MAP-001.md for the rulings it cites; AGENTS.md. Issue #273 is the control room (#80 is archived at the 2,500-comment cap; roll over to a new issue at 2,350 comments): do not post to it; the CLAUDE.md steps about ACK/RETURN and .agent-control/* are handled by the orchestrator; leave .agent-control/* untouched. HOW TO WORK: (1) base on origin/main, work on pkt/V1-<PACKET-ID>, push only there, no PR, no merge. Push after EVERY commit: a session can be stopped at any moment by a usage limit, and work that is not on GitHub is lost (three packets were lost this way on 2026-11-22). If you are resuming a packet, fetch the branch first and continue from its head. (2) Tests first: tests-only RED commits that pin the definition of done, shown failing for the right reason, before any fix commit. (3) Stay inside the write set; if you must touch another file keep it minimal and report it. Before building on any factual premise the packet states about the current code, check it against the code; if a premise is false or an owner decision is missing, STOP that part and report; never edit a Release 0 evidence file (anything named in scripts/proof-admission/manifests or release0-index.json) without an owner ruling. (4) Two independent reviews by fresh subagents given the diff and packet text but not your conclusions: security and tenancy; correctness and regression. Fix every real finding tests-first, re-review until both accept, no round cap, no commits after the last review round. (5) Bootstrap on the LOCAL database only: start postgresql and redis if down; pnpm db:generate; build the workspace packages; pnpm db:deploy. (6) Proof at the final commit (ruling D-265, proofwave): the server type check (rm -f dist/.tsbuildinfo; pnpm build), the tests of every folder you touched plus your new spec files, and for web changes the typecheck, the web unit suite, lint and any named browser spec. The full server suite (pnpm vitest run, in apps/server with env from .env and Node 22.23.4) and pnpm proof:release0 -- --skip-build (must print R0 EXIT GATE MET) run once at the wave head before its pull request, not at every packet head; run Release 0 yourself only when the packet edits a Release 0 bound suite (release0-edited-suites.json) or a manifest-bound file. Nothing merges without both green at its exact head. Never count a run with real ECONNREFUSED; never run two DB suites at once; never edit the tree while a suite runs; new tests go in new spec files; register a new fixture prefix by appending one row. NEVER: touch production or staging, send real provider traffic, weaken or skip a test or gate, fabricate evidence, put secrets anywhere. REPORT: push, then send ONE message to the orchestrator session with branch and head sha, RED and fix shas, files changed, suite totals and the R0 line as printed, each review's findings and how each was closed, anything outside the write set, false premises found, open questions; then stop.
