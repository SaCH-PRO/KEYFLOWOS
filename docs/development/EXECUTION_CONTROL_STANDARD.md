# KEYFLOWOS Execution Control Standard

Status: Canonical repository standard for bounded implementation and forensic-convergence work.

Applies to: ChatGPT, Claude Code, Kimi Code, autonomous agents, and human operators executing KEYFLOWOS implementation packages.

## Purpose

Execution must remain observable, scope-complete, reviewable, and interruption-safe. Long tool sequences, CI waits, debugging loops, or agent activity must never make it unclear whether the programme is progressing, stalled, narrowing scope, or changing strategy.

This standard governs every execution packet and any other bounded implementation package derived from KEYFLOWOS architecture, forensics, journeys, kernels, constellations, contradictions, or convergence findings.

## 1. Required packet states

Every active packet MUST have exactly one current execution state:

- CHARACTERIZING
- IMPLEMENTING
- PROVING
- FIXING_PROOF_FAILURES
- READY_TO_MERGE
- MERGED
- CHECKPOINTED
- BLOCKED

State changes must be reported explicitly to the supervising user/operator.

## 2. Required programme health signal

Every meaningful progress update MUST classify execution health as one of:

- GREEN / PROGRESSING — expected forward progress.
- YELLOW / FRICTION — unexpected issue exists, but a clear resolution path is known.
- RED / BLOCKED — repeated attempts are not advancing the packet, a required capability is missing, or a strategic decision is required.

A failed workflow is not automatically a code failure. Reports must distinguish:
- code/architecture health;
- proof/admission health;
- repository/process health.

## 3. Momentum alarm

A momentum report is mandatory when any of the following occurs:

- 6 or more substantive repository/tool operations occur without a packet-state transition;
- 2 consecutive attempts fail for materially the same reason;
- 2 consecutive CI runs fail without a newly identified root cause;
- the implementation branch crosses a repository hygiene threshold;
- execution remains in the same state while scope, architecture, or proof assumptions are changing;
- the operator could reasonably mistake activity for progress.

The momentum report MUST state:
- current packet and state;
- GREEN/YELLOW/RED health;
- what is blocking movement;
- attempts already made;
- what evidence has changed;
- next action;
- whether declared scope changed;
- whether anything was deferred, dropped, or split.

Do not continue a repetitive loop silently after the momentum alarm threshold is reached.

## 4. Scope ledger

Every packet MUST maintain a scope ledger. At minimum:

```text
Declared obligations:
Resolved:
Remaining:
Deferred:
Dropped:
Superseded:
```

Rules:
- Deferred, dropped, split, or superseded obligations require an explicit reason.
- No obligation may disappear merely because tests pass.
- A green CI run is not evidence that the declared packet scope was fully resolved.
- If characterization discovers new required obligations inside the packet boundary, add them to the ledger explicitly.

## 5. Packet completion contract

A packet MUST NOT be called resolved, complete, admitted, or closed until every applicable condition is YES:

- Scope accounted for
- Architecture invariant satisfied
- Required implementation complete
- Declared proof obligations passed
- Known failure cases tested
- Regression suite green
- CI/admission gates green
- No unexplained deferrals or dropped obligations
- Merged into current main
- Post-merge state verified
- Durable intelligence/handoff updated

If a condition is not applicable, record N/A with a reason.

## 6. Required execution loop

Use this sequence unless the packet specification explicitly requires more gates:

```text
SELECT
  -> RE-RESOLVE CURRENT MAIN
  -> CHARACTERIZE ACTUAL CODE
  -> MAP TO FINDING / JOURNEY / KERNEL / CONSTELLATION
  -> DEFINE INVARIANTS + FAILURE MATRIX
  -> HARDEN SURGICAL PACKAGE
  -> IMPLEMENT
  -> TEST / MIGRATE / SIMULATE
  -> FULL CI
  -> ADVERSARIAL PROOF REVIEW
  -> MERGE
  -> POST-MERGE VERIFY
  -> DURABLE CHECKPOINT
```

The next packet must be characterized against the new main produced by prior admitted work.

## 7. Communication standard

Updates should report meaning, not tool mechanics.

Good:
> YELLOW — TENANT / PROVING. Code semantics are stable; branch hygiene rejected the candidate because the connected writer produced too many commits. Scope is unchanged. Resolution: reproduce the exact stabilized diff on a fresh branch within policy.

Bad:
> I am fetching another file.

Material discoveries must be surfaced when confirmed, not saved for the end.

Examples:
- an invariant is wrong;
- a schema constraint contradicts tenancy;
- a packet is materially larger than expected;
- two packets overlap;
- a previous proof assumption is invalidated;
- a safety or production constraint would need to change.

## 8. No silent scope reduction

Agents must never make a difficult packet appear complete by:
- deleting or weakening proof obligations;
- editing a gate merely to make it pass;
- removing hard cases from tests;
- converting failures into skips without declared justification;
- shrinking implementation scope without updating the scope ledger;
- reclassifying unresolved work as documentation-only without evidence.

A failing gate is information.

## 9. Proof and process separation

Reports must separately track:

```text
CODE / ARCHITECTURE
characterization
implementation
semantic correctness
focused proof

PROCESS / ADMISSION
branch hygiene
migration application
typecheck
tests
build
security
adversarial review
merge
post-merge verification
checkpoint
```

This prevents repository-process failures from being misreported as semantic failures and vice versa.

## 10. Branch and PR discipline

Follow `docs/branch-hygiene-policy.md`.

For agent-driven file-by-file writers:
- anticipate commit inflation before it breaches the branch threshold;
- if a connected writer inherently produces one commit per file update, compact via a fresh branch before opening/finalizing the admission PR;
- do not weaken divergence thresholds solely to accommodate noisy agent commit mechanics;
- retain superseded PRs only long enough to preserve auditability, then close them with a pointer to the replacement.

## 11. Multi-agent rule

ChatGPT, Claude Code, Kimi Code, and other agents may collaborate, but:
- one canonical packet contract governs all agents;
- all agents resolve against the same current main;
- parallel work must be semantically and structurally non-overlapping;
- no secondary agent may redefine architecture independently;
- all output returns through the same completion contract and proof gates.

## 12. Safety and production constraints

Packet execution must preserve any active programme constraints, including:
- no production deployment unless explicitly authorized;
- no production data mutation unless explicitly authorized;
- no real provider traffic unless explicitly authorized;
- no silent forensic rebaseline;
- no silent programme-map refresh.

## 13. Required status snapshot

For every active packet, handoffs should be able to render:

```text
PACKET:
STATE:
HEALTH:

Declared obligations:
Resolved:
Remaining:
Deferred:
Dropped:
Superseded:

Architecture invariant:
Implementation:
Focused proof:
Regression:
CI:
Branch hygiene:
Adversarial review:
Merge:
Post-merge verification:
Durable checkpoint:

Current blocker:
Next action:
Scope changed:
Production touched:
Forensic baseline preserved:
```

## 14. Programme scoreboard

At meaningful milestones, surface a compact programme view:

```text
Packets total:
Admitted/resolved:
Active:
Remaining:

Active packet:
State:
Health:
Scope drift:
Production touched:
Forensic baseline:
```

This is required for long-running convergence programmes so the supervising operator can distinguish real progress from activity volume.

## 15. Authority

If another ad-hoc agent instruction conflicts with this standard, the stricter observability, scope-accounting, and proof requirement wins unless the repository owner explicitly overrides it for a named packet.
