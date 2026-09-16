# KF-JOURNEY-024 - System Change / Engineering Safety

Checkpoint: `J24-PA-2026-09-16-01`  
Status: **ACTIVE / PROOF-ADMISSION MAP COMPLETED / NOT CONVERGED**  
Activated: 2026-09-16  
Current intelligence input: `59c94b381025fd2b35cda8f53283b1c33d22533f`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Primary kernel: K12 Engineering Control Plane. Secondary: K1/K3/K7/K8/K11.  
Adjacent journeys: J13, J18, J23, J2, J15; safe change ultimately affects all journeys.

Production source, schema, deployment, OS constitution and test assertions remain unchanged. No KEYFLOWOS application, provider, concurrency, boot or migration tests were executed. Verification of the new programme-map utility is documentation tooling evidence only.

## Current checkpoint - proof admission and run isolation

**Completed:** [J24 Proof Admission and Run Isolation Map](../investigations/J24-PROOF-ADMISSION-AND-RUN-ISOLATION-MAP.md), plus its [machine-readable design specification](../investigations/J24-PROOF-ADMISSION-CONTRACT.yaml). Neither installs a harness or changes assertions.

Eight further pinned sources now connect the actual truth/burndown instructions, root Turbo tasks, CI test job, boot test, GrowthBook wrapper and source-vacuity gate. CI's PostgreSQL/Redis provisioning and server rebuild are positive seams, not missing infrastructure. At the inspected test-step/config boundary no explicit zero-skip/required-case report consumer is invoked. The integration-only passWithNoTests setting must not be misattributed to default test:ci.

Freshness, scope and identity remain separate: a root Turbo unit-task cache can replay logs; source-gate input non-vacuity is not proof of runtime discovery; a module-error signature screen is not positive HTTP readiness; the boot test uses child startup logs and does not await confirmed child termination after kill. These are static conclusions, not observed runtime incidents. The constitution prevails over the truth playbook's broader direct-write list; neither is changed.

R03/R04/R05/R07 now have named existing seams and required rejection predicates. Admission belongs before dangerous module/config collection; case identity sets, setup/skips/shards, negative-control lineage, current safety and run-owned cleanup cannot be replaced by one exit code. Twelve local analytical counterexamples are not new runtime cases. The J13 manifest remains 44 designed, zero bindings, NOT_EXECUTED.

**Exact next unit:** J24_SAFE_CHANGE_CONVERGENCE_REVIEW, producing `investigations/J24-SAFE-CHANGE-CONVERGENCE-REVIEW.md`. Resolve the trusted change/policy boundary, enforceable existing-tool integration/withdrawal design, then the backward re-audit and declared-scope convergence decision. No generic scan, no application run, no gate weakening and no production edits. J24 remains ACTIVE / NOT CONVERGED; no K12 dossier or new canonical IDs are created.

The activation trace below is preserved as historical source evidence. Its former next-action references to creating the proof-admission map are completed by this checkpoint; they do not override the current continuation above. The initial trace's source labels remain local to that trace; the new map has its own full source manifest.

## Definition and accepted input

J24 is the journey from a proposed system change through bounded authority, reproducible evidence, isolated execution, review, integration and withdrawal without destroying business truth or weakening the rules used to judge the change.

It consumes the J13 mapped-core acceptance, six integration slices I0-I5, 44 designed cases and ED1-ED5 debts in [J13 conformance/migration](../investigations/J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md). J13 is not restarted or promoted to production-ready. Its [manifest](../investigations/J13-INTEGRATION-TEST-MANIFEST.yaml) remains the case inventory, not a runnable harness. R03/R04/R05/R07 are immediate J24 inputs; the manifest still has no runner bindings.

User-facing objective: make optional behavior easy to add, compare, disable, replace and remove in controlled tests, while preserving tenant separation, authority, revocation, effect identity, secret protection and historical evidence. No claim that all code changes or external actions are inherently reversible is made.

## Source trace 001 - Runner and boot admission

Document-local OBS labels below are not new canonical F/C/REC allocations.

| Observation | Exact source fact | Consequence / scope limit |
|---|---|---|
| OBS-01 Runner selection is part of proof identity | Server package maps test/test:ci to `vitest run`; test:unit explicitly selects vitest.unit.config.ts; smoke and integration explicitly select their own configs. The default file only configures globals/environment. [S1-S5] | Do not infer the unit suite's shuffle/isolation choices merely from a CI task name. Future proof receipts must identify command, configuration and actual discovered cases. No test population was counted or executed here. |
| OBS-02 Order sensitivity is intentionally exercised, but differently from process isolation | Unit config sets `isolate: false` and `sequence: { shuffle: true }`. Its comments describe historical timings/runs and explicitly narrow that evidence. [S3] | Preserve recorded seeds and meaningful failure diagnostics. Do not copy the comment's historical pass counts or timings into the current dashboard as fresh proof. Do not claim unit config isolates databases, queues or other runs. |
| OBS-03 A passing process may contain no intended integration cases | Integration config sets `passWithNoTests: true` and includes `test/**/*.integration.test.ts`. [S5] | Required discovery must be nonempty and matched to expected case bindings. This is a missing proof-admission responsibility in the inspected config, not proof that any historical green run was empty. |
| OBS-04 Fixture isolation and cleanup need an owner | The inspected social integration test loads root .env, uses fixed tss_ fixture IDs and best-effort raw prefix deletes before/after tests. [S6] | A unique run-owned resource set must be verified before database import/setup/cleanup. Preserve useful assertions. No .env was opened, no database was accessed and no collision/production incident was reproduced. |
| OBS-05 The dev launcher is not a fail-closed readiness certificate | API and Web readiness loops break on success, but loop exhaustion is not followed by a failed-readiness check. The subsequent stack-is-up banner is unconditional. [S7] | A timeout path can reach the banner without its success branch firing. Preserve distinct compiled, spawned, reachable and ready evidence. This is static control-flow analysis, not an observed boot failure. |
| OBS-06 A developer convenience launcher is not a per-run test allocator | The launcher unsets DATABASE_URL/DIRECT_URL/REDIS_URL/SUPABASE_URL overrides, cleans fixed ports 3001/5000, clears caches, and treats database readiness as best-effort. [S7] | An outer test wrapper must not assume inherited resource overrides survive this script. Fixed-port cleanup is not proof the process belongs to this test run. Do not run the launcher to test this hypothesis against unknown resources. |
| OBS-07 Written gate policy is stronger than a generic green exit | OS.md requires nonempty measurement, zero skips, negative controls, preserved seeds, rebuilt dist for boot evidence, and prohibits weakening gate assertions. [S8] | This is the governing requirement, not evidence its complete reporter/CI path has been traced. Next work maps actual consumers/enforcement rather than creating another competing constitution. |

## Current execution graph

```text
human/agent selects command
  -> package.json script
  -> selected/default runner configuration
  -> test module evaluation and setup
  -> existing environment/DB client acquisition
  -> fixture allocation and possible cleanup
  -> tests and assertions
  -> runner process result
  -> claimed proof / subsequent change decision

separate developer boot path
  -> launch-dev.sh environment changes
  -> fixed-port/cache cleanup
  -> best-effort DB check
  -> required workspace/server builds; optional voice build
  -> spawn compiled API, web dev server, optional voice
  -> bounded readiness polling
  -> unconditional stack-is-up banner
  -> wait for process exit
```

The actual end-to-end proof receipt, skip/discovery admission, run-resource ownership and CI/OS-playbook consumer chain are not established by these source reads. Source presence is not runtime success. A generated map is not allowed to fill those gaps with green status.

## Target admission boundary - proposed, not implemented

```text
exact change request + authorized scope
 -> immutable source/build identity + contract version
 -> exact command/configuration + intended cases + seed/clock policy
 -> positive isolated-environment and resource ownership check
 -> nonempty discovered cases mapped to required obligations
 -> setup and execution with one run/resource owner
 -> assertions + failure/skip/setup outcomes + raw result evidence
 -> controlled negative proof where required
 -> run-owned cleanup outcome and remaining obligations
 -> independent review / decision
 -> explicitly authorized integration or safe withdrawal
```

The identity of a test run must include its environment, not merely a branch name. A Git worktree can separate source directories; it does not establish a separate database, queue, storage area, callback destination or provider account.

A discovery-only step is not presumed harmless: runner collection can evaluate test modules. Admission must precede whatever code path first obtains dangerous capabilities or shared resources. Whether existing hooks provide that boundary is an explicit next-source question. No blanket instruction to execute discovery against the normal root environment is given.

For boot proof, retain at least build provenance, spawned process identity, expected port/resource ownership, actual readiness responses, timeout outcome, and cleanup. Starting an old dist or printing a banner cannot establish a rebuilt application is ready.

## Responsibility map

| Concern | Owner / existing seam | Required input to next trace |
|---|---|---|
| Change authority and scope | Human review and existing K3/OS write rules | Which command/run may touch which source/resource; no automatic production permission |
| Runner/config/case identity | Existing package scripts, Vitest configs and reporter/harness chain | Bind required manifest IDs to real test identities and assert expected discovery/skip outcomes |
| Isolated fixture/resource admission | Existing test setup/DB/resource acquisition owners, still to map | Positive environment identity, unique run namespace, deny wrong resource before mutation |
| Domain invariants and assertions | Existing journey/kernel contracts and existing gate assertions | Keep invariants load-bearing across variants; reviewed supersession is distinct from weakening a red gate |
| Attempt, timeout and cleanup truth | K7/K11/J18 and test-run lifecycle | Setup failure, assertion failure, skipped test, boot timeout and cleanup failure remain distinct |
| Proof and progress projection | K8 plus canonical repository state | Exact executed evidence; map-tool QA never becomes app or provider proof |
| Exposure/withdrawal | Existing GrowthBook seam and J13 admission contract, inherited evidence | Flags select optional behavior; they do not overrule revocation or make an unsafe reference implementation safe |

K12 is canonically defined in 03-ANALYSIS-MAP.md. No independent K12 kernel dossier is created here. This J24 dossier records the first bounded engineering-safety trace without certifying the entire control plane.

## Programme-map integration

The user requested a map that reflects programme progress. [PROGRAMME-MAP.md](../maps/PROGRAMME-MAP.md) is a derived view, not an independent status register. Its source responsibilities are:

- CURRENT-STATE.yaml: phase, active frontier, recorded pools/statuses, proof boundaries, debts and recent milestone references;
- 03-ANALYSIS-MAP.md: canonical names and IDs only; historical active-constellation prose is not treated as current state;
- journey/kernel directory inventories: dossier existence, not convergence;
- J13-INTEGRATION-TEST-MANIFEST.yaml: designed cases, bindings and integration dependencies, not executed proof.

The source directory contains 19 pre-existing journey dossiers at the input checkpoint. Creating this J24 dossier makes 20/25, or 80% dossier coverage. Five remain without dedicated dossiers: J8/J9/J20/J21/J22. This does not mean 80% of the app, target architecture or implementation is complete. No dedicated dossier does not mean no related work exists.

Seven journeys have explicit provisional target-alignment status in current state (J3/J4/J5/J10/J11/J12/J13); five are members of mature pools without a new closure certification from the map (J7/J16/J17/J18/J23); seven other dossiers are present; J24 is active; five have no dedicated dossier. These are five visualization buckets, not new canonical maturity levels. The underlying raw status and source are retained in the generated data.

Generator checks fail on inconsistent dossier counts, unknown/duplicate identities, inconsistent case counts, missing case coverage and cyclic slice dependencies. Regeneration and a freshness check are part of the documentation handoff. This is not a deployed live dashboard, background job, new CI gate or application module.

## Historical activation disposition and next action - completed

J24 activation and source trace 001: **completed at named source scope**. J24 overall: **ACTIVE / NOT CONVERGED**. J13 bounded alignment, D01-D10/T01-T13, ED1-ED5 and all 44 unexecuted design cases are preserved. No F228/C178/KF-REC-058 allocation, no execution packet promotion, no gate edit and no production change.

Next artifact: `investigations/J24-PROOF-ADMISSION-AND-RUN-ISOLATION-MAP.md`.

Begin with the actual OS truth/burndown playbook commands and their runner/report consumers. Trace discovery, skip/setup handling and environment acquisition before any write-capable collection/setup. Bind R03/R04/R05/R07 to concrete admission and cleanup owners; separate written rules from enforced predicates. Carry OBS-05/06 into boot-proof and test-resource requirements. Stop at named source boundaries; do not restart J13 or a generic provider scan.

Before ending the next tranche, update canonical state/dossier, regenerate the map and verify freshness. Preserve original evidence and meaningful test assertions. Application/provider execution remains separately authorized and requires positive environment isolation.

## Source manifest

All implementation reads use `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Repository instructions use the verified intelligence input. No claim of exhaustive source coverage.

| Ref | File and read scope | Blob SHA |
|---|---|---|
| S1 | apps/server/package.json, full scripts and package contents (lines 1-100) | fabcc52a15c6f0c62e2128b476098074bcdd242f |
| S2 | apps/server/vitest.config.ts, full | 8e730d5055c9554efae0c599a7cd46a1a785cf5b |
| S3 | apps/server/vitest.unit.config.ts, full | 1552f94bfec935d17a3e83af78952f766626d69f |
| S4 | apps/server/vitest.smoke.config.ts, full | 795f672e8bdfa181d6b20fcb490e6dacecd7f0dd |
| S5 | apps/server/vitest.integration.config.ts, full | 0975d0cce26d8d3a2a1ab3b4761c6c4c6f99109f |
| S6 | apps/server/test/social-sync-unsupported.integration.test.ts, full | b4a4208c38fd2fc03f061bc716176226cf5eda45 |
| S7 | scripts/launch-dev.sh, full returned source | 1af74bf00311e86f7f2cf78028677ef4042e2843 |
| S8 | architecture/os/OS.md, full at intelligence input | f2a79023740f91e4f520339a1be14036cc997da1 |

Inherited evidence: J13 conformance map and LAC/BCR/SUP/M001-M004 in the continuing session; their individual source classifications remain intact. GrowthBook behavior is inherited here, not freshly re-proved. The blueprint's isolation/integration philosophy is product intent, not completion evidence.

Context integrity: **PASS for this bounded continuation**. Live intelligence input and main head were read; main remains at `88b8016c0ef45e383cc5b0d98c7062151a6a0f27`, with no forensic rebaseline. AGENTS, AGENT-CONTINUITY, current machine state, canonical roster, OS and named source files were read. Matching human continuity from the same prior checkpoint is preserved in the continuous session; it is refreshed with this result. Source inventory was retrieved through GitHub, not a local repository checkout. No missing setup/reporter/deployment proof is claimed resolved. Existing execution-packet specifics are inherited unpromoted/unauthorized, not independently re-audited here.
