# KF-KERNEL-005 — Capability Fabric

Status: ACTIVE / STRONG DIRECTION / NOT FROZEN

## A. Definition / Scope

Owns stable business-action contracts whose identity and semantics remain recognizable from proposal through governance, execution and outcome.

## B. Product Intent

Every material action KEY or a human can perform should have one canonical machine-resolvable identity with enough metadata to support authority, readiness, governance, execution and proof.

## C. Truth Ownership

Primary existing seam to strengthen: `CapabilityContractService`.

Do not create `ActionRegistry2` unless this seam is disproven.

## D. Current Implementation Sources

CapabilityContractService, FLOW_TOOLS, Cortex tool definitions, proposal action types, plugin/action execution wrappers and domain execution services.

## E. Inputs

- business action definition;
- version;
- input/output schema;
- changed entities;
- impact/risk;
- permission identity;
- readiness requirements;
- execution/idempotency/compensation metadata.

## F. Outputs / Consumers

- ActionEnvelope construction;
- Effective Authority resolution;
- ControlRequirement calculation;
- action fingerprint;
- dispatcher/executor choice;
- evidence/outcome interpretation.

## G. State / Transition Semantics

Capability definitions are versioned contracts, not per-request workflow state.

Invocation state belongs to ActionEnvelope/clearance/execution layers.

## H. Journey Impact Matrix

Touches essentially every journey that requests, approves, executes or observes business action.

Highest current impact: J2, J6, J15, J17, J23, J25.

## I. Canonical Vocabulary / Contracts

Candidate contract fields:

```text
name
version
owner
inputSchema
outputSchema
impactTier
permission
readinessRequirements
controlPolicyMetadata
executionMode
idempotencyClass
changedEntities
compensationSemantics
```

## J. Authority / Governance

The capability permission identity should become the exact authority vocabulary consumed by the Effective Authority Resolver.

Impact Tier is not Control Requirement.

## K. Transactions / Concurrency / Idempotency

Capability defines idempotency/side-effect class; the Recovery kernel owns actual atomic execution claims and retry behavior.

## L. Failure / Recovery

Known failure class:

```text
real capability
-> generic workflow actionType such as EXECUTE_TOOL / REQUEST_APPROVAL
-> exact identity/risk semantics collapse
```

## M. Security / Privacy

Governance must evaluate the actual business capability, not a generic wrapper.

## N. Evidence / Observability

Every action trace should preserve capability name/version from intent through outcome.

## O. Reachability / Consumers

Current CapabilityContract seam appears primarily definitional/discoverable rather than load-bearing in execution. Consumer mapping remains required.

## P. Duplication / Legacy / Compatibility

Current action vocabularies include FLOW_TOOLS, Cortex tools, proposal actionType, module scopes and JobRole tool families. These require adapters/convergence, not another independent registry.

## Q. Invariants

1. One exact capability identity survives proposal → governance → control evidence → clearance → execution → outcome.
2. Generic workflow choreography is not capability identity.
3. Capability permission vocabulary is canonical and versioned.
4. Impact classification is distinct from control requirement.
5. Material capability-version/input changes invalidate prior action fingerprints/control evidence where relevant.

## R. Findings

Primary relevant findings: F033–F035, F037, F057, F068, F073–F075.

## S. Contradictions

Key candidates include C022, C028 and C039.

## T. Open Questions

- exact mapping from FLOW_TOOLS/Cortex tools into CapabilityContract;
- canonical impact-tier vocabulary;
- how resource/value bounds become normalized parameters;
- capability version migration/compatibility.

## U. Target-State Candidate

```text
CapabilityContract
-> normalized ActionEnvelope
-> fingerprint
-> authority/readiness/governance
-> execution
-> outcome
```

## V. Migration / Compatibility

Introduce adapters from legacy action names/types to canonical capabilities while preserving consumer behavior. Remove adapters only after reachability/consumer proof.

## W. Proof / Test Ratchets

Prove that high-impact real capability identity cannot collapse to a lower-risk generic wrapper; every execution trace must identify the canonical capability/version.

## X. Layered Improvement

L0: correct action identity.
L1: versioned schemas, validation, permissions, audit.
L2: load-bearing Capability Contract.
L3: compatibility-aware capability evolution and exact resource fingerprints.
L4: capability graph that lets KEY reason safely about available business actions and consequences.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-005
name: Capability Fabric
status: strong-direction-not-frozen
implementation_authorized: false
```
