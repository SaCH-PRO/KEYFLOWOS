# PR 120 control recovery research and proposed contracts

Date: 2026-10-05
Status: RESEARCH AND PROPOSED DESIGN, NOT IMPLEMENTATION AUTHORITY
Repository evidence: PR 120 at 5a9f9aa5b775984a2b9d4d2f2a2f593247c11682; main referenced by that PR is 110532883411007787f62de35e0a951aa1c16cfa.
Research base: docs/keyflow-intelligence-foundation at b4e5bb54a80a1c7f1ef147981f4f973fe56e9b97.
Scope: control message admission, authority replay, checkpoint recovery, evidence finalization and coordination. No production, control-room, PR 120 branch or gate changes.

## Conclusion

PR 120 reduces routine checkpoint staleness by folding typed authority over a reviewed checkpoint. Its unresolved class of problems is safe recovery: one malformed authority candidate blocks the shared stream, and restoring it requires coordinated authority, checkpoint, proof and artifact changes.

Preventing unsafe advancement and guaranteeing conditional recovery are separate requirements. A stopped controller can satisfy safety while failing to make progress indefinitely. Recovery must preserve authority boundaries and remain executable when ordinary replay is blocked.

## Context integrity and reuse

The supplied continuity protocol and reassessment document require repository-grounded continuity, evidence before interpretation, map before modifying, and reuse before new concepts. The historical START-HERE and handoff refer to older stages and cannot establish current operational status. PR 120 and issue 80 are the operational evidence for this investigation.

Context integrity: PARTIAL for whole-programme status because historical handoff and current operational state differ; sufficient for this bounded, pinned PR investigation. No whole-system convergence claim is made.

Read: canonical concept registry, taxonomy and allocation ledger; KF-REC-048 recovery contract; KF-REC-051 operator attention contract; issue 121 contract compiler proposal.
Reuse:
- KF-REC-048 / K11: recovery identity, certainty, ownership, authority and outcome.
- K8 / KF-CONCEPT-042: evidence and outcome integrity.
- KF-REC-050: work-definition control relationships; detailed integration needs its complete contract read before implementation.
- KF-REC-051: source-grounded attention, incident ownership and disposition.
- Issue 121: phase-aware control contract compiler, finding classification and dependency validation.
No new canonical finding, recommendation, journey, kernel or execution-packet IDs are allocated. Labels below are local report sections only.

## Evidence and causality

1. The shared control-envelope parser reads any column-zero key/value line anywhere in an issue comment. Markdown code fences do not delimit the control envelope.
2. RULING-020 contains two prose lines beginning Reason:. A local execution of the exact parser from PR 120 produced Reason (repeated; ambiguous). Its YAML block alone passed AUTHORITY validation. FINAL-CORRECTION-020 passed both ways.
3. The reducer stops on the first malformed candidate after its checkpoint. Later candidates remain unapplied.
4. The recorded checkpoint is generation 81. Four effects reach generation 85; malformed RULING-020 occupies generation 86.
5. A prior malformed memory-track review also stopped this shared stream. The failure boundary exceeds one packet.
6. Re-anchoring this PR changes recovery fixtures and test controls as well as checkpoint data, so it advances the semantic commit.
7. Current return artifacts still describe a046914d, while semantic head is 5a9f9aa5. The reported non-control-tail gate failure is valid evidence of that mismatch.
8. The orchestrator first requires consistent reconciliation, then stops on any active hold. ACTION-001 remains held. Successful recovery can therefore legitimately end in WAIT_AUTHORITY.
9. The latest inspected worker report distinguishes 447 local passes/no skips from one CI skip. This research did not rerun full CI or independently verify every reported count.
10. Two overlapping rulings were posted 27 seconds apart. Their relationship was not encoded as an explicit supersession.

Evidence:
- https://github.com/SaCH-PRO/KEYFLOWOS/pull/120
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5985751518
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5985754624
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5985786311
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5986574041
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/121
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/5a9f9aa5b775984a2b9d4d2f2a2f593247c11682/scripts/agent-control/lib/control-envelope.mjs
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/5a9f9aa5b775984a2b9d4d2f2a2f593247c11682/scripts/agent-control/lib/authority-effects.mjs
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/5a9f9aa5b775984a2b9d4d2f2a2f593247c11682/scripts/agent-control/lib/orchestrator.mjs

## Research comparison

### Safety and liveness

Lamport formalizes safety, liveness and fairness as distinct properties [1]. Apply that distinction to acceptance: rejecting bad authority is necessary, but recovery must also reach a defined postcondition when valid recovery authorization, dependencies and fair scheduling are available. Deliberately held work is excluded from a promise to execute. No finite test establishes unconditional eventual progress in an unbounded environment.

### Controllers and conditional updates

Kubernetes controllers reconcile observed resources toward desired state [2]. Kubernetes resourceVersion rejects stale writes [3]. Adapt the principles through explicit observed versions and conditional state updates. A GitHub comment is not an atomic compare-and-swap operation: a publish-time freshness check alone cannot prevent a race. The acceptance transition must serialize or atomically compare the expected authority revision; stale candidates stay recorded but non-executable.

### Message framing and identity

CloudEvents separates event context from data and defines source-plus-id identity [4]. It supplies an envelope pattern, not authority or authorization. KEYFLOWOS still needs authenticated author identity, declared action scope, preconditions and policy. A content hash establishes identity/integrity, not permission.

### Replay and correction

Event sourcing preserves history and reconstructs projections; snapshots optimize replay, and correction needs explicit history [5]. Apply this only to the existing control stream rather than imposing event sourcing on all application data. Raw received comments and accepted executable decisions must be distinguishable. A malformed historical candidate still requires a recorded authorized disposition; changing parser versions must not silently reinterpret it.

### Ordered failure handling

AWS warns that moving FIFO messages to a dead-letter queue can break exact operation order [6]. An unreadable HOLD cannot be dropped merely to unblock later work. Quarantine preserves the raw input and records the blocked dependency boundary. Recovery must settle the uncertainty before affected actions continue.

### Evidence attestations

SLSA identifies subjects and relates authenticated evidence and verification policy [7,8]. Adapt the subject/predicate/verifier separation: proof of code, proof of control-artifact binding and proof of current admission are different claims. A valid attestation is still limited to its stated subject, policy, environment and trusted verifier. These proposals do not claim SLSA compliance.

### Idempotency

AWS distinguishes retrying the same request token and parameters from reusing that token with different parameters [9]. Apply the same rule to recovery and authority acceptance: repeated identical operation is a no-op or equivalent response; reused identity with different intent is a conflict.

### Model-based verification

fast-check generates command sequences against a model and supports replay of failures [10]. A small state model can exercise duplicated messages, concurrent rulings, crashes and changed holds. TLA+/TLC is a candidate for bounded safety and liveness exploration, not a substitute for implementation and integration evidence.

## Proposed contracts

### Admission before execution

Use one explicitly delimited versioned control object for new-format messages, with prose outside it non-executable. Reject multiple envelopes, duplicate keys, unknown versions, missing identity, ambiguous scope and invalid types. Do not silently fall back from a malformed new envelope to legacy parsing.

A native authoring preflight should parse and validate exactly what will be published. Consumer validation remains mandatory because authoring tooling can be bypassed. Keep source bytes, comment identity, author, timestamps and parse version. Authoring validation does not itself admit work.

Compile the accepted request under issue 121 into a deterministic contract: packet, expected revision, source/main/head, branch/PR, action, prerequisites, permitted mutations, finding dispositions and policy version. Acyclic dependencies are necessary but not sufficient: availability, authorization, contradictory preconditions and reachable effects also matter.

### Recovery while ordinary replay is blocked

Provide a narrowly scoped recovery operation through the same authority root and shared validators, with a handler that does not require the failed ordinary projection to be consistent. This is an exception in permitted operation type, not a bypass of authentication or safety policy.

A proposed recovery record contains:
- operation identity and current authorized actor;
- expected checkpoint digest and authority revision;
- exact blocked raw-message identities and content digests;
- explicit disposition of each blocked message;
- complete observed evidence boundary, including intervening holds;
- proposed resulting projection digest;
- preserved holds, denied powers and other invariants;
- policy/reducer/schema versions;
- proof references and expiry/preconditions.

Execution validates authority, captures a coherent input manifest, computes a candidate without side effects, checks invariants, conditionally installs against the expected revision, replays and verifies the result. A concurrent HOLD or changed input invalidates the candidate and requires recomputation. Crashes and duplicate execution must not partially install recovery.

Do not define recovery as automatically skipping a bad event. It records the disposition and reconstructs state explicitly. It must never silently release a hold, grant merge authority, change production permission or mark business work complete.

### Scope and containment

Model global safety barriers separately from packet-local holds and dependency-scoped blocks. Packet labels alone are insufficient to prove isolation. Shared artifacts, shared ownership, dependent packets and global policies determine the affected closure.

If the trusted envelope establishes scope, contain a failure to that proven scope and its dependants. If scope is unknowable or could be global, broader suspension remains necessary. Retain today's global hold semantics until an explicit migration authorizes and proves a narrower contract.

### Evidence and artifact finalization

Separate:
1. semantic evidence about a specific implementation and relevant inputs;
2. generated control-artifact binding evidence;
3. current admission evidence about live head, base, authority and required checks.

Generate artifact facts from an immutable manifest: Git SHA, relevant tree/config/test/lockfile hashes, runner and toolchain identity, evidence producer, run IDs, skips, failures, scope and policy. Human or independent reviewer decisions remain explicit authenticated records.

Avoid self-reference: a file cannot straightforwardly contain the hash of its final containing commit. Record proof of the final commit in an external workflow artifact or later authorized attestation. Required checks continue to run at the admitted head under current policy. Reusing semantic evidence is a future policy decision requiring proven input equivalence, not permission to skip present gates.

Path-based control-only classification deserves a dedicated audit. programme-state.yaml influences orchestration despite being under .agent-control/. Establish which files are descriptive and which are executable configuration; this is a research question, not a newly verified exploit.

### Explicit phases and finding ownership

Issue 121 already owns IMPLEMENT, PROVE, SEMANTIC_REVIEW, ARTIFACT_FINALIZE, FINAL_REVIEW, RETURN and ADMISSION. A finding must specify its subject, origin, risk, required mutation and earliest satisfaction phase.

An artifact-only finding can remain an explicit obligation for ARTIFACT_FINALIZE; it must not require artifacts to be finalized before that phase is permitted. Any finding that invalidates current safety or semantic evidence still blocks. Graph validation must reject a cycle in which semantic acceptance requires final artifacts while final artifacts require semantic acceptance.

### Coordination and useful observability

Represent one incident per stable blocked condition, with first/last observation, affected scope, owner, evidence, last meaningful transition and next permitted action. Repeated polls update observations rather than create duplicate decision demands. Escalation deadlines request attention; elapsed time grants no authority.

Use an explicit decision identity, expected revision and supersedes link. One coordinator owns final authority emission while independent review remains independent. Do not infer authenticated agent identity solely from sender text under a shared GitHub account.

Measure blocked duration, recovery latency, unresolved phase edges, artifact regeneration count and reopen count alongside proof results. Separate code health, evidence health, authority health and advancement state.

## Science and work parallels

Spacecraft fault management: NASA safe-mode guidance preserves a sustainable, commandable state and a communication path [11]. Design inference: a safe stop must retain a constrained repair path. NASA's August 2026 HelioSwarm account also shows failure analysis integrated with system models [12]; use the actual control dependency graph to derive failure scenarios. Neither source certifies the proposed software design.

Control theory: the controller must have an available permitted action that can change the state being regulated. Repeated observation without such an action cannot converge. Repeated alert generation resembles accumulated corrective demand against a blocked actuator; this is an analogy, not a mathematical claim that the current system implements a PID integrator.

Manufacturing: Toyota jidoka detects abnormalities, stops affected production and signals assistance [13]. Design inference: couple a stop to ownership, a repair task and a verified restart condition. Do not treat a stream of alerts as repair progress.

Incident command: Google SRE emphasizes explicit command ownership, a live incident record and acknowledged handoff; recovery coordination should remain usable during the incident [14]. Adapt this to prevent overlapping authoritative rulings and lost recovery ownership.

Accounting analogy: preserve original entries and append explicit corrections. In control recovery, a superseding disposition records why a blocked instruction no longer governs; it does not erase its historical existence. This analogy explains provenance, not financial functionality.

## Permanent proof scenarios

- Repeated Reason: or Required: prose outside a new envelope leaves its machine meaning unchanged.
- Two new envelopes or duplicate authority keys are rejected.
- Historical replay under its declared parser version remains stable.
- Unauthorized recovery and same identity/different payload are rejected.
- Valid recovery is consumable while ordinary replay is blocked.
- An unknown-scope instruction cannot be downgraded to packet-local failure.
- New HOLD during candidate preparation invalidates the recovery installation.
- Two candidates based on the same revision cannot both install.
- Crash before/after installation and duplicate retries preserve one effective recovery.
- Existing holds and production/merge prohibitions survive reconstruction.
- A legitimate retained hold produces WAIT_AUTHORITY after consistency restoration.
- A changed code, dependency, policy or relevant runner input invalidates reusable proof.
- Artifact-only obligations can complete at their designated phase without a dependency cycle.
- Required final-head checks and independent review remain enforced.
- Under bounded available dependencies and valid authority, recovery eventually reaches a verified consistent state or an explicit new blocker.
- An indefinitely held packet is not falsely diagnosed as failed recovery.

Use recorded PR 120 messages as regression fixtures and generated interleavings as broader evidence. A proof count alone is not a recovery outcome.

## Staged adaptation

1. Finish the bounded PR 120 recovery under its existing contract, with validated authority and explicit expected post-recovery state. This document does not issue that authority.
2. Extend issue 121 with authoring/consumer preflight, versioned envelope migration, phase obligations and conditional acceptance. Keep current control semantics in shadow comparison until explicitly admitted.
3. Specialize KF-REC-048 for control recovery; replay historical incidents and exercise crash/concurrency cases before making the handler executable.
4. Generate evidence bindings and improve incident ownership through existing proof and operator contracts.
5. Prove packet/dependency containment before changing global hold behavior.
6. Transfer the proven contracts into KEY's existing runtime seams through a separate map and implementation packet. GitHub identities must become tenant, actor, action and effect identities; developer control authority must never become product-user authority automatically.

Acceptance is functional: the historical sequence recovers without weakening holds, stale evidence cannot admit work, repeated delivery is safe, and independent work proceeds only where scope is proven. No whole-system completion percentage is inferred.

## Open questions and exact next frontier

Read the full KF-REC-050 contract and locate all publish paths and worker claim writers. Determine the smallest transactional acceptance primitive supported by the current runtime. Audit the meaning of control-only paths and source-head equivalence. Check issue 121 and related dispatch/ownership issues for overlap before changing their scope. Capture raw issue metadata for a full replay; normalized connector comments alone may omit edit/order evidence.

This research is preserved on a documentation branch for review. It does not update canonical handoff status, allocate new architecture IDs, merge code, post control-room messages, or authorize runtime work.

## Sources

All web sources accessed 2026-10-05. Source age is not proof of obsolescence; established concepts are paired with current official documentation. Proposed KEYFLOWOS adaptations are design inferences.

1. https://lamport.azurewebsites.net/tla/safety-liveness.pdf
2. https://kubernetes.io/docs/concepts/architecture/controller/
3. https://kubernetes.io/docs/reference/using-api/api-concepts/
4. https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
5. https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
6. https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
7. https://slsa.dev/spec/v1.2/attestation-model
8. https://slsa.dev/spec/v1.2/verification_summary
9. https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html
10. https://fast-check.dev/docs/advanced/model-based-testing/
11. https://swehb.nasa.gov/pages/viewpage.action?pageId=133235173
12. https://science.nasa.gov/science-research/science-enabling-technology/technology-highlights/integrating-model-based-systems-engineering-and-fault-management-to-enable-autonomous-space-missions/
13. https://global.toyota/en/company/plant-tours/production-system/
14. https://sre.google/sre-book/managing-incidents/
