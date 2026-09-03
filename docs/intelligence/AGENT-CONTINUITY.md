# KeyFlowOS Multi-Agent Continuity Contract

Status: CANONICAL OPERATING PROTOCOL

This file exists so ChatGPT, Claude Code, Kimi Code, Codex, and human collaborators all consume and contribute to the same durable KeyFlowOS intelligence.

## Prime rule

Conversation/session memory is temporary. Repository intelligence is durable.

Canonical intelligence lives under:

`docs/intelligence/`

Before substantial analysis, architecture work, or implementation, load:

1. `docs/intelligence/00-START-HERE.md`
2. the canonical files it requires
3. `docs/intelligence/handoff/CURRENT-HANDOFF.md`
4. `docs/intelligence/handoff/CURRENT-STATE.yaml`
5. all active journey/domain/investigation files referenced by the handoff

If the required context is unavailable or contradictory, stop and recover context rather than inventing continuity.

## Context Integrity Check

Before resuming a major analytical cycle, report:

- current repository branch/commit used for implementation evidence
- intelligence branch/commit used for canonical analytical state
- active analytical phase
- active journey mesh/unit
- last completed checkpoint
- unresolved convergence questions
- exact next action
- missing or contradictory context
- `Context integrity: PASS` or `FAIL`

## Persistence obligation

A materially important finding is not complete until it is written back into the correct repository intelligence artifact.

After substantial work, update as applicable:

- active journey/domain/investigation dossier
- `04-CONCEPT-REGISTRY.md`
- `05-DECISION-REGISTER.md`
- `06-OPEN-QUESTIONS.md`
- `08-FINDING-REGISTER.md`
- `09-CONTRADICTION-REGISTER.md`
- `10-RECOMMENDATION-REGISTER.md`
- `07-CURRENT-STATE.md`
- `handoff/CURRENT-HANDOFF.md`
- `handoff/CURRENT-STATE.yaml`
- a dated session journal

Then create a Git checkpoint.

Do not wait for context exhaustion.

## Evidence discipline

Preserve:

`evidence -> interpretation -> architectural implication -> accepted decision`

Distinguish at least:

- IMPLEMENTATION FACT
- RUNTIME EVIDENCE
- TEST SOURCE
- EXECUTED TEST RESULT
- GENERATED STATE
- MAINTAINED ARCHITECTURE DOCUMENT
- HISTORICAL / STALE DOCUMENT
- PRODUCT SOURCE / VISION
- INFERENCE
- WORKING HYPOTHESIS
- ACCEPTED DECISION
- RECOVERY UNCERTAIN

Do not claim tests passed unless they were actually executed in the relevant environment.

Do not treat historical plans as current implementation truth.

Do not treat current implementation as automatically canonical target architecture.

## Governing architecture rule

`MAP BEFORE MODIFYING`

For significant behavior changes, identify the affected:

- journeys
- domains
- capability contracts
- principals/authority
- data entities and mutations
- state transitions
- events/queues/jobs
- external integrations
- invariants
- concurrency/idempotency boundaries
- tests/proofs
- legacy/compatibility consumers

before changing production behavior.

Prefer strengthening coherent existing seams before creating parallel replacement architecture.

## Current analytical programme

The canonical journey catalogue is in `03-ANALYSIS-MAP.md` and currently runs through `KF-JOURNEY-025`.

At creation of this contract, the active mesh is:

```text
KF-JOURNEY-001 — Business Birth
        <->
KF-JOURNEY-025 — Human Authority Lifecycle
        <->
KF-JOURNEY-002 — KEY Request -> Governed Action
```

The current convergence questions are:

1. Tenant relationship: `Business.ownerId + Membership -> safe Membership-first tenancy`.
2. Human authority: base Membership role + JobRole/position + grants/overrides + denials + delegations + approval tier + capability/resource context -> one effective-authority result with provenance.
3. Governed execution: exact action -> clearance -> atomic execution claim -> canonical post-clearance dispatcher -> durable outcome.

Do not fully open `KF-JOURNEY-015 — Approval / Governance Lifecycle` until the current handoff says its admission conditions are satisfied.

## Multi-agent contribution rule

No agent's private conclusion is canonical merely because it wrote code or produced a confident analysis.

When an agent completes material work, persist:

- evidence examined
- conclusions reached
- decisions actually accepted
- unresolved questions
- files/code changed
- tests actually executed and results
- branch and commit SHA
- implications for active journeys/architecture

If an agent changes production behavior before the architecture programme authorizes implementation, flag the divergence rather than silently normalizing it.

## Historical blueprint rule

`KEYFLOW v3` and other source plans are product/architecture evidence, not infallible current specifications.

Preserve their durable principles when still supported, including the pragmatic mandate:

> Isolation is the build strategy. Seamless integration is the user-facing outcome.

But patch or supersede historical technical prescriptions when current implementation evidence and accepted architecture require it.

## Emergency recovery

If context is about to expire before a normal checkpoint:

1. stop broad analysis;
2. emit a dense recovery packet covering exact continuation state, decisions, concepts, findings, contradictions, recommendations, open questions, methodology and unrecoverable gaps;
3. persist that packet or pass it to a fresh session;
4. reconcile it into canonical repository intelligence before substantive continuation.

Target invariant:

> Chats and model sessions may expire. KeyFlowOS knowledge must not.
