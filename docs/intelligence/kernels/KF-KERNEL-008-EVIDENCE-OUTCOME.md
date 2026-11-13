# KF-KERNEL-008 — Evidence & Outcome

Status: ACTIVE / WORKING CANONICAL KERNEL

## A. Definition / Scope

Owns durable proof of what happened before, during and after governed business actions and external events, so Business Graph truth and Genome evolution are based on evidence rather than intent alone.

## B. Product Intent

KEY should not merely act. It should know whether the intended business consequence actually occurred, how confidently that is known, and what should be learned from the result.

## C. Truth Ownership

Evidence is not the same as workflow state, audit text or AI memory. It is durable support for claims about actions, controls and business outcomes.

## D. Current Implementation Sources

Current evidence is fragmented across proposal audit records, approval items, ApprovalRequest history, BusinessEvent, domain records, provider responses, GenomeEvidence and logging/feedback systems.

## E. Inputs

- action/control decisions;
- execution attempts;
- provider responses;
- domain mutations;
- external events/reconciliation;
- human decisions;
- observed business consequences.

## F. Outputs / Consumers

- ControlEvidence;
- execution outcome;
- Business Graph updates;
- Genome evidence/confidence updates;
- reliability learning;
- audit/incident reconstruction;
- future policy/recommendation inputs.

## G. State / Transition Semantics

Working outcome lifecycle:

```text
INTENT
-> CONTROL EVIDENCE
-> EXECUTION ATTEMPT
-> PROVIDER/DOMAIN RESULT
-> SUCCEEDED | FAILED | OUTCOME_UNKNOWN
-> RECONCILED OUTCOME
-> BUSINESS CONSEQUENCE EVIDENCE
```

## H. Journey Impact Matrix

Primary: J2, J6, J12, J14, J15, J16, J18. Eventually every operational journey that mutates business or external state.

## I. Canonical Vocabulary / Contracts

- ControlEvidence
- ExecutionAttempt
- Outcome
- OutcomeUnknown
- ReconciliationEvidence
- BusinessConsequence
- Provenance
- Confidence
- Verification
- Causation/Correlation

## J. Authority / Governance

ControlEvidence must identify who/what satisfied a control and under which authority/policy version. Approval workflow state alone should not substitute for normalized evidence.

## K. Transactions / Concurrency / Idempotency

Evidence must distinguish duplicate attempts from duplicate effects and preserve the relationship between ExecutionClaim, attempt and provider outcome.

## L. Failure / Recovery

A provider timeout after a side effect must not be treated as ordinary failed execution. `OUTCOME_UNKNOWN` should trigger reconciliation before retry where duplicate effects are possible.

## M. Security / Privacy

Evidence must preserve auditability without unnecessarily exposing sensitive payloads. Privacy/deletion requirements must define which evidence can be redacted, retained or cryptographically referenced.

## N. Evidence / Observability

This kernel is itself the architecture of durable evidence. Logs are useful but should not be the only source for critical business/control facts.

## O. Reachability / Consumers

J15 currently demonstrates that approval/control evidence is distributed across specialized workflow records with inconsistent binding semantics.

## P. Duplication / Legacy / Compatibility

- AiApprovalItem evidence;
- KeyActionProposal audit/lifecycle;
- ApprovalRequest/steps;
- domain state;
- BusinessEvent;
- provider logs;
- GenomeEvidence.

These should interoperate through normalized semantics rather than one monolithic evidence table.

## Q. Invariants

1. Intent is not outcome.
2. Workflow status is not necessarily control evidence.
3. ControlEvidence binds exact action identity and satisfying authority/policy context.
4. Execution attempt is distinct from business consequence.
5. Ambiguous external effects are represented as OUTCOME_UNKNOWN and reconciled.
6. Evidence provenance survives asynchronous boundaries.
7. Business Graph/Genome learning must not treat synthetic/demo or weak evidence as verified real-world truth.

## R. Findings

Relevant findings include F018, F026–F027, F031, F057–F068 and F074.

## S. Contradictions

Key contradictions include approval state vs exact-action evidence, human-approval labels vs timeout auto-approval, and workflow shadow state vs canonical evidence.

## T. Open Questions

- canonical ControlEvidence persistence;
- generalized Outcome representation versus domain-specific evidence;
- how provider reconciliation feeds Business Graph and Genome;
- retention/privacy policy for evidence;
- evidence confidence/version semantics.

## U. Target-State Candidate

```text
action/control
-> typed ControlEvidence
-> ExecutionClaim/Attempt
-> typed Outcome
-> reconciliation if necessary
-> BusinessConsequence evidence
-> Business Graph
-> Genome evolution
```

## V. Migration / Compatibility

Normalize evidence semantics first; preserve existing specialized records as sources/projections until consumers and retention requirements are mapped.

## W. Proof / Test Ratchets

Prove that approvals identify exact actions, async execution retains lineage, provider ambiguity does not duplicate effects, synthetic records do not contaminate canonical truth, and outcomes feed later knowledge with traceable provenance.

## X. Layered Improvement

L0: know what happened.
L1: durable audit, provenance, reconciliation and privacy controls.
L2: normalized evidence/outcome semantics across domains.
L3: causal/confidence-aware evidence graph.
L4: KEY learns from verified business consequences and explains why its beliefs/recommendations changed.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-008
name: Evidence & Outcome
status: working-canonical
implementation_authorized: false
```
