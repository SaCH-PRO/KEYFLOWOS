# KEYFLOWOS Project Source Bootstrap

Purpose: give any new ChatGPT, Claude Code, Kimi Code, Cursor/Copilot-style agent, or human engineer a deterministic way to recover KEYFLOWOS without relying on conversational memory.

This file is a bootstrap pointer, not a source of runtime truth and not programme authority.

## 1. Repository

Repository: `SaCH-PRO/KEYFLOWOS`

Canonical semantic continuity lives under `docs/intelligence/` on the canonical intelligence branch.

Current canonical intelligence branch:
`docs/keyflow-intelligence-foundation`

Whole-system convergence hardening may also exist on an open PR targeting that branch. Resolve it before trusting an older checkpoint.

## 2. Mandatory startup sequence

Before substantial analysis, implementation, review, architecture work, merge advice, or automation:

1. Resolve the exact current `main` SHA.
2. Resolve the exact head SHA of every PR you intend to discuss or change.
3. Read `AGENTS.md` from current main.
4. Read `docs/intelligence/00-START-HERE.md` from the newest applicable canonical intelligence revision.
5. Read `docs/intelligence/handoff/AGENT-PICKUP.yaml`.
6. Read `docs/intelligence/handoff/CURRENT-STATE.yaml`.
7. Read `docs/intelligence/handoff/CURRENT-HANDOFF.md`.
8. Read the newest valid typed authority on GitHub issue #80 for control-sensitive work.
9. Read the exact active packet/PR artifacts.
10. Read affected `/architecture` maps and domain/journey/kernel dossiers.
11. Only then decide whether context integrity is sufficient to continue.

Never reconstruct programme state from chat history when repository evidence exists.

## 3. Source precedence

When sources disagree, use this order:

1. exact current implementation evidence: main / exact PR head / migrations / tests / CI;
2. newest valid typed issue #80 authority;
3. canonical `docs/intelligence/` semantic continuity;
4. revision-pinned `/architecture` maps;
5. research artifacts;
6. open PR proposals;
7. historical plans and conversation.

Code shows implementation reality, not automatically intended architecture.
Research provides intelligence, not implementation authority.
Derived state is not authority.

## 4. Context Integrity Check

Every new agent must explicitly resolve:

- current main SHA;
- active application packet;
- active control/meta packet, if any;
- exact active PR heads;
- last completed/admitted checkpoint;
- unresolved convergence;
- immediate next action;
- missing, stale, or contradictory context;
- production authorization state;
- Context integrity: PASS or FAIL.

If any critical item is unknown or contradictory, fail closed:
- do not invent continuity;
- do not weaken a gate;
- do not merge;
- do not write production state;
- recover context first.

A continuity-only repair is allowed when its sole purpose is to make the above evidence recoverable and it does not grant execution or merge authority.

## 5. Non-negotiable engineering laws

- MAP BEFORE MODIFYING.
- No fake green.
- Exact-head evidence only for admission claims.
- A failing gate is information; never edit the gate merely to make it pass.
- One semantic owner per concern.
- Do not create parallel control planes, memory systems, registries, orchestration runtimes, or sources of truth when an existing owner already exists.
- Keep domain state, derived state, evidence, control state, execution state, business outcome, financial truth, operator attention, and AI interpretation distinct.
- Models create intelligence, not authority.
- Retrieval creates candidates, not truth.
- Learning cannot self-promote.
- Production deployment, destructive mutation, or real provider effects require explicit authorization.

## 6. Cross-agent handoff contract

Before ending a material work tranche, write durable repository state, not just a chat summary.

A valid handoff must record:

- repository and exact source SHA;
- branch and exact head SHA;
- packet/PR/issue identifiers;
- what changed;
- what was proved;
- what is still unproved;
- current blockers;
- source precedence used;
- scope ledger: completed / remaining / deferred / dropped / superseded;
- safety/production status;
- exact next action;
- any contradiction or stale artifact discovered.

Do not claim completion until the durable handoff is updated.

## 7. Fast pickup

A new agent should be able to answer these questions within one read cycle:

- What is on main?
- What is only proposed?
- What is currently active?
- What is blocked?
- Why is it blocked?
- Which source is authoritative?
- What exact action is next?
- What actions are forbidden?

If it cannot, continuity is not hardened enough and the next task is to repair the handoff, not to expand the architecture.

## 8. Current known repair direction

At the 2026-10-07 continuity refresh, the immediate control-plane problem is the stale derived authority projection. The bounded compatibility repair is PR #159, `KF-META-AUTHORITY-EFFECT-COMPAT-001`. Re-resolve its exact head and workflows before acting. It is a control-plane repair only and does not itself grant merge authority.

The active application safety packet remains PR #155, `KF-EXEC-AUTH-FAIL-CLOSED-001`, until current authority says otherwise.

Do not infer current truth from this paragraph alone; the mandatory startup sequence above always wins.
