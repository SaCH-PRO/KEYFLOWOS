# KEYFLOWOS Multi-Agent Execution Protocol

## ChatGPT — Architecture / Evidence Command Center
Owns packet semantics, dependency release, evidence admission and minimal architecture reopen decisions.

## Claude Code — Primary Implementer
For an authorized packet:
1. load AGENTS, continuity, packet and owners;
2. revalidate current main;
3. return no-edit characterization;
4. implement bounded scope only;
5. run applicable proof;
6. return exact diff/migrations/commands/results/new consumers;
7. stop on target contradiction.

## Kimi Code — Adversarial Reviewer
Independently challenge missed writers/readers, concurrency/idempotency/tenant/authority assumptions, migration ambiguity, rollback and proof vacuity.

## Required return envelope

```yaml
packet_id:
source_head:
source_drift:
characterization:
changed_files:
schema_migrations:
tests:
  commands:
  discovered:
  passed:
  failed:
  skipped:
negative_controls:
provider_or_external_runs:
cleanup:
new_consumers_or_writers:
deviations_from_packet:
rollback_floor:
open_questions:
evidence_refs:
```

No agent may silently add a kernel, duplicate authority/billing/workflow/recovery engine, weaken a gate, or expand scope.

Parallel implementation is allowed only when authoritative writers/migrations do not overlap.


## Canonical agent-to-agent control channel

The repository is the communication bus. The canonical live control channel is GitHub issue **#80 — KEYFLOWOS Agent Control Room — ChatGPT ↔ Claude Code**.

Direct agent socket/chat communication is not assumed. All cross-agent instructions and returns must be durable and auditable through the control-room issue plus the packet branch/PR.

### Roles

**ChatGPT / programme command center**
- selects/releases dependency-safe packets;
- supplies the bounded directive and acceptance/proof contract;
- reads Claude ACK/PROGRESS/MOMENTUM/CONTRADICTION/RETURN messages;
- reviews diffs, CI and proof;
- issues REVIEW/CLOSE;
- controls merge/checkpoint by default.

**Claude Code / bounded implementer**
- reads the newest DIRECTIVE/REVIEW before acting;
- ACKs exact source main, branch and scope before mutation;
- works only inside the released packet boundary;
- reports material findings immediately;
- triggers MOMENTUM under the execution-control standard;
- stops affected work on CONTRADICTION;
- returns exact implementation/proof evidence;
- does not merge unless explicitly authorized.

### Message lifecycle

```text
ChatGPT DIRECTIVE
  -> Claude ACK
  -> Claude PROGRESS as state changes/material findings occur
  -> Claude MOMENTUM if stalled, or CONTRADICTION if target assumptions break
  -> Claude RETURN
  -> ChatGPT REVIEW
      -> bounded correction loop if required
      -> ChatGPT CLOSE when admitted/checkpointed
```

### Required message envelope

Every control-room message must carry:

```yaml
message_id:
message_type: DIRECTIVE|ACK|PROGRESS|MOMENTUM|CONTRADICTION|RETURN|REVIEW|CLOSE
packet_id:
sender: chatgpt|claude|kimi|human
in_reply_to:
source_main:
source_head:
implementation_branch:
state:
health: GREEN|YELLOW|RED
scope_changed: false
production_touched: false
summary:
evidence_refs: []
next_action:
```

RETURN messages must additionally include the full existing required return envelope:
- source drift;
- characterization;
- changed files;
- schema migrations;
- commands/tests and exact results;
- skipped/failed proof;
- negative controls;
- provider/external runs;
- cleanup;
- new consumers/writers;
- deviations;
- rollback floor;
- open questions.

### GitHub issue use

Claude should use:

```bash
gh issue view 80 --repo SaCH-PRO/KEYFLOWOS --comments
gh issue comment 80 --repo SaCH-PRO/KEYFLOWOS --body-file <message-file>
```

Large diffs never belong in issue comments. They belong in a packet branch and PR. Control-room comments reference the branch, PR, commits, logs and proof artifacts.

If GitHub CLI is unavailable, Claude must persist the same message envelope to the active packet handoff file and explicitly report that the live control channel is unavailable. It must not silently continue as if ChatGPT has received the message.

### Ownership and concurrency

One packet has one implementation owner at a time unless ChatGPT releases non-overlapping subscopes explicitly. Claude must not modify files owned by another active packet without a REVIEW/DIRECTIVE resolving the overlap.

### Human interface

The human operator uses ChatGPT as the primary interface. ChatGPT translates user intent into packet directives and translates Claude returns into concise programme status. The human should not need to manually shuttle normal agent messages between systems.
