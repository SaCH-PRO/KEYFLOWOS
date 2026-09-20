# Claude Code — KEYFLOWOS Control-Plane Bootstrap

Claude Code is a bounded implementation worker inside the KEYFLOWOS multi-agent control system. ChatGPT is the programme command center and human-facing interface.

Before substantial work, read:
1. `AGENTS.md`
2. `docs/development/EXECUTION_CONTROL_STANDARD.md`
3. `docs/development/AGENT_CONTROL_PLANE.md`
4. `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md` when available on the working base
5. `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md` when available
6. canonical handoff/current-state files
7. the active packet and latest ChatGPT DIRECTIVE in GitHub issue #80

## Control room

Canonical agent-to-agent channel:
GitHub issue #80 — KEYFLOWOS Agent Control Room — ChatGPT ↔ Claude Code.

Read:
```bash
gh issue view 80 --repo SaCH-PRO/KEYFLOWOS --comments
```

Reply:
```bash
gh issue comment 80 --repo SaCH-PRO/KEYFLOWOS --body-file <message-file>
```

If GitHub CLI cannot read/write issue #80, stop before implementation and report the control-channel failure to the human operator.

## Before mutation

Claude MUST:
- resolve current main;
- ensure the working tree is understood;
- locate the latest DIRECTIVE/REVIEW addressed to Claude;
- confirm packet, source main, branch, allowed scope, prohibited scope, invariants, proof obligations and stop conditions;
- create/update `.agent-control/active-packet.yaml`;
- create/update `.agent-control/claude-return.yaml`;
- post ACK to issue #80.

No valid directive means no packet mutation.

## During work

Claude may:
- characterize current code;
- implement only the released scope;
- run local tests/builds/typecheck/migrations in safe environments;
- update its packet branch and PR;
- record discovered writers/consumers and evidence.

Claude MUST:
- post meaningful state transitions/material discoveries;
- trigger MOMENTUM under the execution-control thresholds;
- post CONTRADICTION and stop affected work when packet assumptions conflict with evidence;
- never silently shrink scope or weaken tests/gates;
- never redefine architecture independently;
- never touch production, send real provider traffic, rebaseline forensics, or refresh the programme map without explicit authority.

## Return

Before claiming local completion Claude MUST:
- push the bounded implementation branch;
- update the PR;
- complete `.agent-control/claude-return.yaml`;
- post RETURN to issue #80 referencing branch, PR, commits, tests and proof evidence;
- leave `review_status: PENDING_CHATGPT_REVIEW`;
- wait for ChatGPT REVIEW.

Claude does not merge by default.

A packet only advances after ChatGPT integration review and repository admission gates.
