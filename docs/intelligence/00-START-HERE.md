# KeyFlowOS Intelligence - START HERE

Checkpoint: `J24-MAP-2026-09-16-01`  
Updated: 2026-09-16  
Canonical branch: `docs/keyflow-intelligence-foundation`.

## Current position

**Current machine state:** [handoff/CURRENT-STATE.yaml](handoff/CURRENT-STATE.yaml).  
**Human continuation:** [handoff/CURRENT-HANDOFF.md](handoff/CURRENT-HANDOFF.md).  
**Visual programme map:** [maps/PROGRAMME-MAP.md](maps/PROGRAMME-MAP.md).  
**Completed:** J24 activation and source trace 001, plus the derived programme-map utility.  
**Next:** J24 proof-admission and run-isolation mapping, not another J13 scan.

```text
Repository: SaCH-PRO/KEYFLOWOS
Input intelligence: 81046dd4c74c55d8d213285a61eb34ca55925704
Forensic implementation baseline: 8f173bfe79f1418159cf4099ea18b0d60d203ec2
J13: PROVISIONALLY TARGET-ALIGNED FOR THE MAPPED CORE ONLY
J24: ACTIVE INITIAL SOURCE TRACE / NOT CONVERGED
Production source/schema/deployment: READ-ONLY / UNAUTHORIZED
Application/provider/concurrency/boot/migration proof: NOT_EXECUTED
```

Resolve the live branch head and matching checkpoint. The input SHA is provenance, not the output commit. No rebaseline, execution-packet promotion or app-completion percentage is implied.

## Resume in order

Read AGENTS.md and [AGENT-CONTINUITY.md](AGENT-CONTINUITY.md), this file, [07-CURRENT-STATE.md](07-CURRENT-STATE.md), and all four CURRENT/ROLLOVER files. Run the Context Integrity Check. Load the [active J24 dossier](journeys/KF-JOURNEY-024-SYSTEM-CHANGE-ENGINEERING-SAFETY.md), the J13 [conformance/migration map](investigations/J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md), its [44-case design manifest](investigations/J13-INTEGRATION-TEST-MANIFEST.yaml), and `architecture/os/OS.md`.

J13's LAC remains the one home of D01-D10/T01-T13. Its original microtraces, separate callback supplement, BCR and completed Q1-Q4 map remain unchanged. Their old next-action instructions do not override CURRENT. F227/C177 remains the existing root; no F228/C178/KF-REC-058 allocation was made.

## Exact next artifact

Planned, not created here:
`investigations/J24-PROOF-ADMISSION-AND-RUN-ISOLATION-MAP.md`.

Trace the actual OS truth/burndown playbook commands, selected runner/configuration, discovery and reporter consumers, skip/setup handling, environment acquisition, per-run resource ownership and cleanup. Bind R03/R04/R05/R07 to concrete owners before any write-capable test collection/setup. Preserve shuffle seeds, negative controls, meaningful assertions and the existing constitution.

The initial J24 trace established that generic test:ci does not explicitly select the unit config; the unit config disables module isolation and enables shuffling; the integration config allows empty discovery; one integration fixture uses root environment loading and fixed-prefix cleanup; the dev launcher prints stack-is-up after readiness loops even when they exhaust, and changes inherited resource variables/fixed ports. These are source facts and conditional paths, not reproduced incidents. Next work maps actual admission enforcement rather than restating these observations.

## Map refresh discipline

The map is a derived view, not a new status register. Its inputs are CURRENT-STATE, canonical numbered names in 03-ANALYSIS-MAP, dossier inventories and the existing design manifest. Older constellation prose in 03 is historical, not the current frontier.

```bash
python docs/intelligence/tools/build-programme-map.py
python docs/intelligence/tools/build-programme-map.py --check
```

Python/PyYAML are authoring-tool requirements, not new app dependencies. See [maps/README.md](maps/README.md). The generator creates Markdown plus local JSON/HTML. It has no app imports, provider calls, Git writes or background sync. Update authoritative state/dossiers first; regenerate and check after each material tranche. Commit the Markdown with matching continuity. The interactive HTML can load a newer generated JSON without modifying the repository.

The map now shows 20/25 journey dossiers (80% coverage only), seven explicit provisional target alignments, five mature-pool members, seven other existing dossiers, active J24 and five without dedicated dossiers. These are conservative display categories, not new maturity levels. The 44 cases remain designed with zero runner bindings, not executed tests. Map-tool QA is not app proof.

## Programme method and preserved foundations

Conversations are working memory; repository intelligence is durable. The programme is whole-system architectural forensics, target/migration/proof synthesis and eventual explicitly authorized transformation, not a ticket factory or repeated stack selection.

```text
EVIDENCE -> MAP -> MICROSCOPIC TRACE -> JOURNEYS -> CONSTELLATIONS -> KERNELS
 -> DYNAMIC/CAUSAL/FEEDBACK GRAPHS -> STANDARDS/RESEARCH -> POOL
 -> TARGET SYNTHESIS -> BACKWARD RE-AUDIT -> REFINE
 -> MIGRATION/PROOF ARCHITECTURE -> AUTHORIZED IMPLEMENTATION -> VERIFIED RESULTS
```

Preserve 25 canonical journeys and 12 conceptual kernels. The foundational documents remain responsible for master context/system model, canonical programme, concepts/taxonomy/ID allocation, decisions/questions, finding/contradiction/recommendation registers, recursive assurance, kernels, implementation handoff, research/innovation, digital twin and architect/system-dynamics contracts. Load the relevant owners rather than duplicate their semantics in a new map.

J23's definition/occurrence/attempt distinctions, J18's certainty-aware recovery and J13's current grant/credential/intent/projection separation remain load-bearing targets. Provider timeout is not confirmed failure; effect dedupe is not consequence completeness; reversing an external effect is separately governed; old approval or time does not create authority. Prefer coherent existing owners instead of parallel replacement engines.

## Allocation and safety

Ranges remain through F227, C177, KF-REC-057 and KF-CONCEPT-042. F228/C178/KF-REC-058 are unallocated. 04B overrides older numeric snapshots; later J5 re-audit/current state overrides historical pending-audit prose. Source evidence, product intent, proposed design, test source and executed proof remain distinct.

Do not modify production, schema, deployment, OS.md or gate assertions. Do not run application tests or cleanup on unverified resources. A safe reference is not automatically the unfenced baseline; feature withdrawal must preserve authority, data and history. ED1-ED5 remain explicit implementation-readiness debts.

This live navigation replaces the prior next-J24-activation pointer. Earlier detailed navigation/history is preserved at input commit `81046dd4c74c55d8d213285a61eb34ca55925704` and in the unchanged underlying programme artifacts. Persist each material result, refresh all CURRENT/ROLLOVER views, regenerate the map and verify the Git checkpoint before ending.
