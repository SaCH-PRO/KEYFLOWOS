# KEYFLOWOS Project Source Bootstrap

Status: **CANONICAL RECOVERY ENTRYPOINT CANDIDATE**  
Purpose: let ChatGPT, Claude Code, Kimi Code, future agents, and a human operator recover the project safely from any point without reconstructing architecture from conversation memory.

## Prime rule

**Repository evidence is durable truth. Conversation context is temporary working memory.**

Never resume KEYFLOWOS by guessing from a prior chat when repository state can be recovered.

## Recovery sequence

Before any substantial analysis, architecture decision, or code mutation:

1. Re-resolve the live repository head and relevant open PR/issue state.
2. Read:
   - `docs/intelligence/00-START-HERE.md`
   - `docs/intelligence/handoff/CURRENT-STATE.yaml`
   - `docs/intelligence/handoff/CURRENT-HANDOFF.md`
   - `docs/intelligence/handoff/ACTIVE-WORK-LEDGER.yaml`
   - `docs/intelligence/handoff/NEXT-CHAT-ROLLOVER.md`
3. Read `docs/intelligence/CURRENT-PROGRAMME-LINES-OF-WORK-2026-10-05.md`.
4. If working on KEY itself, additionally read:
   - `docs/intelligence/KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md`
   - `docs/intelligence/KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md`
5. Read only the active workstream's detailed docs, issue, PR, packet, tests, and current code.
6. Run the Context Integrity Check below before mutation.

## Context Integrity Check

Report:

- live main head;
- active workstream;
- active issue/PR/packet;
- exact branch/head;
- last accepted checkpoint;
- current blocker;
- next legal action;
- missing or contradictory context;
- PASS or FAIL.

If current repository truth contradicts the handoff, **repository truth wins** and the handoff must be repaired before claiming continuity.

## Current workstream families

The project presently has these major families:

1. Product / application.
2. KEY cognitive architecture.
3. Memory / Context Genome.
4. Autonomous development control plane.
5. Architecture forensics / convergence.
6. Connector / world-integration fabric.
7. Verification / security / no-fake-green.
8. Runtime / deployment / stabilization.

Do not give one stream progress credit for another.

## Cross-agent contract

### ChatGPT
- architecture/convergence;
- control authority/review when explicitly assigned;
- cross-stream synthesis;
- durable checkpointing.

### Claude Code
- bounded implementation and proof on assigned packets;
- repository-first execution;
- must not silently widen scope.

### Kimi Code
- optional bounded implementation/research role;
- same read contract and authority boundaries as any other worker;
- no independent sovereign project state.

### All agents
- load the same durable state;
- preserve evidence vs interpretation vs decision;
- stop on contradictions;
- never infer merge/admission authority;
- update durable state after material work.

## One-KEY rule

KEY is one persistent cognitive entity. Roles, specialists, delegated workers, workflows and swarms are temporary cognitive/execution configurations, not separate sovereign KEY identities.

## No-fake-green rule

Registered != reachable != correct != proven.

A required proof that is skipped, unavailable, stale, partial, simulated, unknown or swallowed cannot satisfy a green admission gate unless it is explicitly and correctly classified as not applicable.

## Mutation rule

Before a semantic mutation:

- bind the exact packet/issue/PR;
- bind source/base/head;
- identify affected journeys/kernels/contracts;
- derive mandatory proof;
- preserve authority and production constraints.

After a material tranche:

- update the active work ledger;
- update current handoff/state if project truth changed;
- record decisions/contradictions/findings in canonical intelligence;
- leave the next legal action explicit.

## Recovery from an arbitrary future point

If this file is the only reliable starting point:

1. Resolve live main.
2. Resolve the newest versions of the handoff files listed above.
3. Resolve current open PRs/issues for the selected workstream.
4. Compare those to the recorded snapshot.
5. Mark stale entries as stale rather than deleting historical evidence.
6. Reconstruct only the minimal active path needed to continue.
7. Do not restart completed architecture or implementation packets unless new evidence invalidates their proof.

This file is deliberately short. It points to current durable state; it is not itself the full project memory.
