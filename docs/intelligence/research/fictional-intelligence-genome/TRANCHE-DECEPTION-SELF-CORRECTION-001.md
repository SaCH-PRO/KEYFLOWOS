# KIGP Tranche — Deception Resistance, Adversarial Epistemics, Self-Correction

Status: RESEARCH_ONLY
Programme: KIGP-001
Recorded: 2026-10-06

## Purpose
Extract mechanisms for resisting manipulation, reasoning under deceptive or adversarial information, detecting model failure, revising beliefs safely, and preserving continuity when KEY discovers that its prior world model was wrong.

## Reference families
Design-hypothesis references include Ava/Ex Machina, L vs Light/Death Note, GLaDOS/Portal, Aizen-style perception manipulation, Foundation/Mule outlier dynamics, The Machine/Samaritan adversarial modelling, HAL/Ultron failure analysis, mystery/deduction systems, and adversarial multi-agent patterns.

Fictional references generate hypotheses only; engineering adoption requires independent evidence and repository pressure testing.

## Track A — Extracted candidate genes

### G111 — Evidence-Origin Separation
The system must distinguish the observed content from the source that supplied it. A persuasive message, sensor reading, model output, or agent report is not self-authenticating.

Candidate structure:
claim -> source -> channel -> evidence -> confidence -> authority -> verification state.

### G112 — Source Reliability Model
Source reliability should be contextual and historical, not global:
- identity/authenticity
- past accuracy
- domain competence
- incentives
- possible compromise
- freshness
- corroboration

A reliable source in one domain may be weak in another.

### G113 — Deception-as-Hypothesis
When evidence conflicts or incentives suggest manipulation, deception becomes one candidate explanation, not an automatic accusation.

Possible explanations should remain plural until evidence distinguishes them:
error / stale data / misunderstanding / system bug / intentional deception / compromised channel.

### G114 — Independent Corroboration
High-impact claims should be verified through independent evidence paths where feasible. Repeating the same upstream source through multiple intermediaries is not independent corroboration.

### G115 — Sensor / Channel Cross-Validation
Conflicting modalities should trigger reconciliation:
API state vs database state vs external-provider state vs user report vs event log.
The system should preserve the contradiction rather than averaging it away.

### G116 — Adversarial Perspective Simulation
For high-risk actions, evaluate how a malicious, compromised, mistaken, or strategically self-interested actor could exploit the current plan.

This extends perspective simulation from empathy to red-team reasoning.

### G117 — Out-of-Distribution / Model-Break Detection
When observations repeatedly violate predictions or fall outside known patterns, KEY should question the model itself rather than forcing data into the existing ontology.

Signals may include:
- persistent residual error
- contradictory evidence
- unseen entity/action combinations
- failed invariants
- anomalous causal sequences
- unexpected provider outcomes

### G118 — Belief Revision with Lineage
When the world model is wrong:
OLD BELIEF -> CHALLENGED -> REVISED / REJECTED / SUPERSEDED
Preserve the evidence and reasoning that caused revision. Do not silently overwrite history.

### G119 — Model Rollback / Safe Fallback
If a newly adopted model or strategy performs worse or violates invariants, the system should be able to revert to a previously proven representation/strategy while preserving the failed attempt as evidence.

### G120 — Epistemic Quarantine
Untrusted or adversarial information may be stored for analysis without being promoted into trusted memory, policy, capability, or goal state.

This is the informational counterpart of the Cognitive Immune System.

### G121 — Strategic Disclosure Control
An intelligent system may know more than it should reveal to a given actor. Response generation should respect need-to-know, privacy, security, relationship scope, and authority.

Knowledge possession != disclosure authority.

### G122 — Contradiction-Seeking Review
Independent evaluators should actively search for disconfirming evidence, not only verify that supporting evidence exists.

Builder: find a working answer.
Reviewer: find where it fails.
Admission: decide from both.

### G123 — Identity-Preserving Self-Correction
KEY must be able to say "my prior model was wrong" without losing persistent identity. Identity should depend on durable lineage/values/relationships, not infallibility.

### G124 — Manipulation-Resistant Goal Admission
Persuasive text, urgency, emotional pressure, authority impersonation, or repeated prompting must not promote an inferred request into an authorized goal without passing identity/authority checks.

### G125 — Information Hazard Boundary
Some information can alter behavior merely by being interpreted as an instruction, credential, capability definition, policy, or goal. Therefore ingestion must separate data from executable/control semantics.

Candidate law:
DATA != INSTRUCTION != AUTHORITY.

## Anti-genome additions
- AG35 Persuasive content becomes trusted evidence automatically.
- AG36 Correlated copies are mistaken for independent corroboration.
- AG37 Model protects itself by explaining away all contradictory evidence.
- AG38 Belief correction silently erases prior state.
- AG39 New model cannot be rolled back after failed adoption.
- AG40 Untrusted information crosses directly into goals/policy/capabilities.
- AG41 Possessing information implies permission to disclose it.
- AG42 Reviewer searches only for confirming evidence.
- AG43 Being wrong threatens identity, causing defensive reasoning.
- AG44 Urgency/emotion bypasses authority checks.
- AG45 Data and instructions share one unguarded ingestion path.

## Track B — Convergence / repo application candidates

### Context Genome
Pressure-test support for:
- contradiction as first-class state
- challenge/supersession lineage
- source/channel identity
- corroboration independence
- epistemic quarantine
- failed-model history

### Cognitive Immune System
Extend from capability/code quarantine to information/control quarantine:
INGEST -> CLASSIFY -> ISOLATE -> VERIFY -> ADMIT AS DATA / CLAIM / GOAL / POLICY / CAPABILITY according to authority and evidence.

### Independent Evaluator
Strengthen reviewer role from generic correctness to explicit disconfirmation and adversarial perspective simulation.

### Authority
Candidate hard law:
DATA != INSTRUCTION != AUTHORITY.
A model output, document, message, or external source cannot acquire action authority by content alone.

### R&D Loop
Add model-failure branch:
OBSERVE -> PREDICT -> MISMATCH -> TEST ASSUMPTIONS -> REVISE MODEL -> RE-RUN -> COMPARE -> ADOPT/ROLLBACK.

### Connector Fabric
Provider/external state discrepancies should preserve external ambiguity rather than converting transient or conflicting provider observations into internal truth.

## Self-correction loop
WORLD MODEL -> PREDICTION -> OBSERVATION -> RESIDUAL/CONTRADICTION -> MODEL CHALLENGE -> ALTERNATIVE MODEL -> TEST -> ADOPT / REJECT / ROLLBACK -> LINEAGE UPDATE

## Status
EXTRACTED -> CROSS-CONVERGENCE IN PROGRESS.
No implementation authority.
