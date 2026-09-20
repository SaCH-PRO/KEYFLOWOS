# Claude Code — KeyFlowOS Continuity Bootstrap

Before substantial KeyFlowOS analysis, architecture work, or implementation, read and follow:

1. `AGENTS.md`
2. `docs/intelligence/AGENT-CONTINUITY.md`
3. `docs/intelligence/00-START-HERE.md`
4. `docs/intelligence/handoff/CURRENT-HANDOFF.md`
5. `docs/intelligence/handoff/CURRENT-STATE.yaml`
6. active journey/domain/investigation files referenced by the handoff

Do not reconstruct architectural continuity from private session memory when canonical repository intelligence exists.

Preserve `evidence -> interpretation -> architectural implication -> accepted decision`.

Follow `MAP BEFORE MODIFYING`.

After material work, persist the relevant intelligence updates and exact branch/commit/test state so another agent can continue without the session.


## ChatGPT command-center loop

The human operator uses ChatGPT as the primary KEYFLOWOS interface. Claude Code is a bounded implementation worker and communicates back through the repository.

Before any packet implementation:
1. read `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md`;
2. read `docs/development/EXECUTION_CONTROL_STANDARD.md` when present on the working base;
3. read `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md`;
4. read GitHub issue #80 and find the newest DIRECTIVE or REVIEW addressed to Claude;
5. ACK the directive before mutation with exact `source_main`, `source_head`, `implementation_branch`, packet state, health and scope.

Control-room commands:
```bash
gh issue view 80 --repo SaCH-PRO/KEYFLOWOS --comments
gh issue comment 80 --repo SaCH-PRO/KEYFLOWOS --body-file <message-file>
```

During work:
- post PROGRESS only for state transitions or material findings, not low-level tool chatter;
- post MOMENTUM when the execution-control threshold is reached;
- post CONTRADICTION and stop the affected scope if current code conflicts with the packet target;
- never silently narrow scope, weaken proof, edit a gate to make it pass, or redefine architecture.

At handoff:
- push the bounded branch/PR;
- post RETURN using the canonical return envelope with exact changed files, migrations, commands, results, failures/skips, negative controls, new consumers/writers, deviations, rollback floor and evidence references;
- wait for ChatGPT REVIEW before expanding scope or merging unless the directive explicitly grants that authority.

If `gh` cannot access issue #80, persist the same message envelope in the active packet handoff and tell the human operator that the direct repository channel is unavailable.
