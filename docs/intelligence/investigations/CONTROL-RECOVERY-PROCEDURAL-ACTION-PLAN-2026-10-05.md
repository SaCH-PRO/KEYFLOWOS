# Consolidated control recovery and procedural strategy action plan
Date: 2026-10-05
Status: PROPOSED ACTION PLAN FOR DISCUSSION; not an execution authorization or implementation claim.
Scope: research consolidated in this conversation. Operational evidence remains pinned to PR120 at 5a9f9aa5b775984a2b9d4d2f2a2f593247c11682. No fresh live PR status asserted.

## Continuity
Companion: PR120-CONTROL-RECOVERY-RESEARCH-2026-10-05.md in this directory.
The uploaded continuity and reassessment documents were re-read. Preserve evidence -> interpretation -> decision, reuse before allocation, explicit ownership, and separation of domain/control/execution/evidence/attention/learning state.
Existing reuse: KF-REC-048 recovery; KF-REC-050 work definitions (full contract read still required); KF-REC-051 attention; K8 evidence/outcome; issue121 phase-aware contract compilation. No new canonical IDs allocated.
Whole-programme context remains partial because historical handoffs and operational evidence differ. This document is a bounded synthesis, not a replacement for the canonical programme handoff.

## Outcome
A controller that can establish trustworthy state, select a permitted next action, recover under disturbance, and improve procedures using verified outcomes.
Safety: preserve authority and invariants.
Conditional progress: with valid authority and available dependencies, reach a verified result or a specific new blocker.
Learning: proposed improvements remain versioned and validated before promotion.

## Ordered actions and acceptance

| Order | Action | Deliverable | Acceptance evidence |
|---|---|---|---|
| 0 | Reconcile current execution frontier before dispatch | Current PR/head/base/authority/holds manifest; existing packet and owner mapping | Each proposed mutation maps to current authority; stale research snapshots are not used as live state |
| 1 | Complete bounded PR120 recovery | Explicit blocked-event dispositions, validated checkpoint reconstruction and regenerated affected artifacts | Replay is consistent; historical holds survive; final-head checks match; WAIT_AUTHORITY remains legitimate |
| 2 | Make control admission unambiguous | Versioned delimited envelope, shared producer/consumer validation, stable identity and conditional acceptance | Prose cannot change machine meaning; malformed envelopes fail; concurrent stale candidates cannot both install |
| 3 | Make recovery executable during a normal-path failure | Specialization of existing recovery contract with preview, expected revision, atomic installation and post-verification | Unauthorized repair fails; crash/retry preserves one effective repair; concurrent HOLD invalidates stale candidate |
| 4 | Resolve phase and evidence dependency traps | Extend issue121 compiler; distinguish semantic proof, artifact binding and current admission | Contradictory obligations/cycles rejected; artifacts can finalize at their valid phase; stale proof cannot admit work |
| 5 | Give each blocked condition ownership | Source-grounded incident record, next permitted action, escalation and acknowledged handoff | Repeated polls update one condition; elapsed time grants no authority; closure needs source evidence |
| 6 | Define a small procedural repertoire | Versioned diagnose, reconcile, repair, verify and escalate procedures | Entry/exit conditions, permissions, effect identity and failure branches are testable; restart preserves confirmed work |
| 7 | Add bounded strategy selection | Explicit diagnosis and short-horizon planning among admissible procedures | Transient, deterministic, ambiguous, authority and overload failures select different responses; no feasible action produces explicit escalation |
| 8 | Add measured adaptation | Expected-versus-observed outcome records and offline procedure comparison | Improvements beat defined baselines without weakening invariants; promotion is explicit; rollback exists |
| 9 | Prove containment and transfer into KEY | Dependency/scope model and one mapped product journey using existing runtime seams | Independent work proceeds only where isolation is proven; tenant/actor/effect boundaries remain valid |

Actions are proposed deliverables, not verified missing features across the entire app. Audit actual reachable code before determining build versus reuse.

## Procedure contract
Each procedure should declare identity/version; purpose and trigger; observations and uncertainty; entry conditions; authority; ordered/conditional steps; business-effect and attempt identity; expected effects; verification evidence; termination; bounded retry and compensation/reconciliation rules; escalation owner; revision lineage and applicability.
Use behavior-tree ideas where conditional composition helps. Do not add another universal runtime or adopt reinforcement learning simply to select a handful of known procedures.

## Decision algorithm
1. Observe authoritative evidence and its freshness/provenance.
2. Represent known state and consequential unknowns separately.
3. Classify the obstruction; gather more evidence if classification is unsafe.
4. Exclude actions violating authority, holds or invariants.
5. Compare remaining procedures for likely progress, uncertainty reduction, cost and reversibility.
6. Execute a bounded permitted step.
7. Verify actual effects and preserve successful substeps.
8. Replan on material evidence change; terminate or escalate if no valid path remains.
Authority and invariants are hard constraints, not weighted costs that a high reward can override.
Prevent unstable switching with explicit material-change triggers and bounded retry/time budgets. Budgets stop or escalate; they do not grant new powers.

## Dynamic systems transfers
- Biological homeostasis: explicitly identify variables whose acceptable ranges matter. Avoid collapsing all health into one green flag.
- Bacterial integral feedback: retain evidence of persistent deviation and ineffective intervention. This is a design analogy, not a claim that a PID controller fits discrete authority.
- Model predictive control: plan ahead but execute and verify a limited next step. A useful prediction model and feasible constraints are prerequisites; begin with deterministic rules.
- Robotics/behavior trees: compose reactive procedures with tested interfaces; durability and authority require additional contracts.
- Manufacturing: measure queue age, blocked duration and completed outcomes. Cap work in progress where measured bottlenecks justify it.
- Biological bow-tie architecture: converge shared semantics into a small core, recognizing that core failure becomes consequential; avoid one undifferentiated global queue.
- Spacecraft/incident operations: a safe stop must preserve a constrained, owned repair path.
- Learning: compare procedure versions using replay/shadow evidence before controlled activation. One successful case does not prove broad efficacy.

## Verification
Use the recorded PR120 obstruction as a regression case. Add generated sequences for duplicate delivery, edited/ambiguous messages, stale evidence, concurrent authority, crash boundaries, partial completion and scope uncertainty.
Prove safety separately from progress under stated assumptions.
Measure recovery latency, repeated ineffective attempts, duplicate effects, false admission, unnecessarily blocked independent work, operator interventions and incident recurrence. Report evidence freshness and unresolved gaps alongside outcomes.

## Sequencing and open decisions
First: action0 and bounded recovery mapping. Then strengthen admission/recovery/phase contracts. Procedural schema work can proceed as documentation while the same interfaces are audited; executable learning waits for stable outcome records.
Open discussion: which outcome defines success for each procedure; which actions are already preauthorized; which uncertainties require operator judgment; how progress is measured without rewarding superficial completion; which product journey should validate reuse.
Recommended initial autonomy: automate deterministic, authorized, verifiable actions; reconcile ambiguous external effects before repetition; preserve explicit escalation for absent authority and conflicting contracts.
Next forensic frontier: read full KF-REC-050, locate publish/acceptance/claim writers, establish the supported atomic acceptance primitive, and map proposal overlap with issue121 and active packets.

## Research references
Detailed engineering references and primary evidence are in the companion report.
Dynamic systems sources consulted 2026-10-05:
- Yi et al., bacterial integral feedback: https://pubmed.ncbi.nlm.nih.gov/10781070/
- Rawlings, Mayne, Diehl, Model Predictive Control: https://sites.engineering.ucsb.edu/~jbraw/mpc/
- Colledanchise and Ogren, Behavior Trees: https://arxiv.org/abs/1709.00084
- NIST, manufacturing flow time: https://www.nist.gov/el/applied-economics-office/manufacturing/supply-chain/flow-time
- Csete and Doyle, Bow ties, metabolism and disease: https://www.cs.cornell.edu/~ginsparg/physics/Phys446-546/doyle_bowties.pdf
These sources motivate proposals; they do not establish correctness of KEYFLOWOS implementations.
