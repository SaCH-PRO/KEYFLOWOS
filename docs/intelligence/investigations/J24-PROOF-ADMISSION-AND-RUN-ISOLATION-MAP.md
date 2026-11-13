# J24 - Proof Admission and Run Isolation Map

Checkpoint: `J24-PA-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `59c94b381025fd2b35cda8f53283b1c33d22533f`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Status: **NAMED PROOF-ADMISSION / RUN-ISOLATION MAP COMPLETED; J24 NOT CONVERGED**.

Production source, test assertions, constitution, workflow files, schemas and deployments are unchanged. No application test, boot probe, database setup/cleanup or provider operation was executed. This document separates source facts, governing instructions, proposed controls and missing evidence. It does not install a harness or turn the 44 J13 design cases into executable tests.

This continues [J24 source trace 001](../journeys/KF-JOURNEY-024-SYSTEM-CHANGE-ENGINEERING-SAFETY.md). The [J13 manifest](J13-INTEGRATION-TEST-MANIFEST.yaml) remains the one case inventory. R03/R04/R05/R07 below are existing case IDs; PA labels are local analytical references, not F/C/REC allocations. The companion [admission specification](J24-PROOF-ADMISSION-CONTRACT.yaml) is a machine-readable design, not a new test runner or independent authorization system.

## 1. What this tranche resolved

The actual path is now traced from OS instructions through commands, runner configuration and CI consumers to fixture and child-process ownership. Eight additional source files were read at the pinned baseline. The conclusions are narrower and more useful than claiming either that CI proves everything or that no protection exists.

| Question | Disposition | Evidence / remaining limit |
|---|---|---|
| Which command selects which proof population? | CLOSED at named paths | Section 2 separates root Turbo, direct unit, integration, default CI and build diagnostics. Actual discovered populations were not run or counted. |
| Does the inspected CI consume a zero-skip/required-case proof receipt? | GAP IDENTIFIED | CI calls test:ci directly; the inspected config/step has no explicit result-consumer predicate for those rules. This is not a repository-wide absence claim or a claim every historical green run skipped tests. |
| Are database/Redis prerequisites entirely absent? | NO; narrowed | CI declares PostgreSQL and Redis services, migrations, workspace builds and a server rebuild. Retain these positive mechanisms. Their presence is not local multi-agent isolation or live deployment proof. |
| Where must resource admission occur? | CLOSED as design placement | Before test/config/module evaluation can obtain dangerous capabilities, not merely in beforeAll after imports. The current fixture acquires DB then runs prefix cleanup. |
| What does boot evidence actually establish? | CLOSED at named paths | Module-error filtering, child log detection, HTTP readiness and process termination are separate dimensions; section 4. |
| How should R03/R04/R05/R07 be enforced? | OWNER/PREDICATE DESIGN COMPLETE | Sections 5-7 assign existing seams, necessary new responsibilities and rejection conditions. None is claimed implemented. |
| Is J24 ready to close? | NO | Protected integration of these controls, change-trust boundaries and a backward convergence review remain. Existing OS/gates must not be weakened to close them. |

## 2. Actual command and enforcement matrix

| Entry / evidence | Actual route | What is established | What must not be inferred |
|---|---|---|---|
| Truth playbook [S1] | Build packages/server, then `cd apps/server && pnpm test:unit` | Explicit unit-config selection; prose requires zero skips, shuffle seed and stop-on-failure. This avoids the default integration population in that cycle. | The statement that the suite is DB-free is a playbook claim, not a fresh audit of every imported spec. The instruction is not a machine result verifier. |
| Burndown playbook [S2] | Truth's starting suite; per-removal negative control; final green suite; explicit CommonJS check when dependencies change | Requires the controlled re-added ledger entry to fail by name, independent review and PR-only code changes. | A transcript was produced, the named CommonJS file ran, or the current task authorizes this cycle to modify code. |
| Root `test:unit` [S3/S4] | `turbo run test:unit`; task depends on upstream builds | Different wrapper from direct server pnpm invocation. Unit task has `outputs: []` and no explicit cache:false; other test families explicitly disable cache. | Empty outputs disables task/log caching, or replayed terminal text proves a new shuffle seed was executed. See E2; no cache-hit incident was observed. |
| Server test/test:ci [H1/S5] | `vitest run`, default config with globals/node environment | Does not explicitly select `vitest.unit.config.ts`. CI test step invokes this path. | Unit config's `isolate:false` and shuffle are necessarily effective in CI. Runner configuration must be recorded, not inferred from the word test. |
| Server explicit integration [H1] | Include `test/**/*.integration.test.ts`; `passWithNoTests:true` | Empty selection can be acceptable to this configuration. | Every CI test uses that flag: test:ci uses the default config, not this integration config. |
| CI test job [S5] | Fresh checkout; PostgreSQL/Redis services; fixed job environment values; install/generate/build; migrations; server build; server tests; web unit tests | Concrete infrastructure and build prerequisites exist. The server is rebuilt in this job; no assumption that another job's dist is shared. | This job is already the run-owned isolated local harness for two agents, or actual service/test results were observed in this tranche. |
| CI result consumer [S5] | Shell outcome of server command; next step runs web tests | No explicit JSON/JUnit output selection, expected-case comparison or zero-skip report parser is invoked at this inspected boundary. | No useful test fails, no GitHub annotations exist, or no other helper anywhere could validate results. The missing link is the named proof-admission boundary. |
| `gate-vacuity.spec.ts` [S8] | Reads spec source shapes; asserts scanned/scanner lower bounds and no recognized vacuous gates | A useful anti-vacuity source gate exists and describes its regex limitations. | This proves runner discovery completeness, no runtime skips, correct environment or every expected test executed. Input-reader non-vacuity is not run-completion evidence. |
| CI branch graph [S5] | Specified push/PR branch list; typecheck prerequisite; same-ref run cancellation | Cancelling an old workflow and skipping dependents are possible control states. | Cancellation is test success, a skipped job is proof, or branch-protection/required-check policies were inspected. This docs branch is not listed for push in that workflow. |

### PA-01 - Written policy is not yet a run-admission implementation

The OS constitution requires nonempty measurement, zero skips and relevant negative controls [H2]. Truth/burndown consume those requirements as instructions [S1/S2]. In contrast, the inspected test job consumes process status without an explicit report admissibility check [S5]. A green process is necessary but not sufficient to establish the selected case set completed without skips/setup failure.

This comparison does not certify historical results false. It defines the missing evidence that must be supplied before reporting a new transformation proof as satisfied.

### PA-02 - The source of acceptance rules must not be the candidate under test

A proposed expected-case manifest, reporter adapter or environment guard is itself changeable code. A candidate cannot remove its own required case, alter its reporting rule and then certify itself. The trusted review/control path must identify the accepted policy/manifest version independently and inspect changes to assertions, case selection, reporting, resource admission and workflow dependencies.

There is also a concrete instruction conflict: truth's direct-write list includes `apps/server/src/modules/ai/capability-map/capability-map.seed.ts`; the OS truth-cycle direct-write matrix does not include that application path [S1/H2]. Preserve the stricter constitution: this difference does not authorize direct application writes. Route changes outside the governing allowlist for review. Neither document is edited here, and no actual unauthorized commit is asserted.

## 3. Runner, discovery and result identity

### Selected design: retain Vitest, add explicit proof consumption around it

Do not build another test framework. Vitest v2's documented reporters provide JSON/JUnit output and named assertion results [E1]. That is a supported direction for the declared v2 package family, not evidence an exact resolved package version or reporter was exercised. The installed/lockfile version and its setup-error mapping still require characterization.

A future proof receipt must identify:

| Dimension | Required meaning |
|---|---|
| Scope | Exact journey/invariant, accepted case selection and claim type: source analysis, mock/unit, real DB, boot, provider sandbox or integrated business journey |
| Source | Code commit/tree plus any authorized working diff, gate/manifest versions, build artifact identity and toolchain; a branch name alone is insufficient |
| Run | Unique attempt, command arguments, working directory, effective configuration, runner version, shard set, seed/clock policy and resource owner |
| Collection | Required case-to-runner bindings and discovered project/file/qualified test/parameter identities; duplicates and missing identities are errors |
| Execution | Case results, suite/collection/setup failures, skipped/pending/todo states, exit/signal/timeout/cancellation and unhandled runner errors |
| Provenance | Fresh execution versus cache reuse; original receipt and relevant matching inputs for reuse; a cached result is not a new seed exploration |
| Isolation | Positively verified resource identity and least-privilege capabilities before collection; lease/ownership and allowed external destinations |
| Cleanup | Confirmed run-owned cleanup/process closure, or named unresolved cleanup obligations; passing assertions do not prove cleanup |
| Review | Raw artifact references/hashes, independent evaluation and permitted promotion scope; hashes detect mismatches but do not authenticate an untrusted self-report |

Keep actual executed results separate from expected-case records. The 44 J13 cases currently have no runner bindings. This specification does not fill those bindings with vaguely similar existing tests.

### PA-03 - Reconcile sets, not only counts

A positive result requires the intended nonempty population, complete binding/discovery, and terminal passing outcomes for all required cases. Two copies of one test cannot substitute for two different obligations. Filtering, shards, generated parameter cases and retries must preserve identity.

Use native reporter counters as cross-checks, not the only evidence. Vitest v2 documents `numPendingTests`, `numTodoTests`, suite outcomes and per-assertion statuses [E1]. The consumer must reject an unknown schema/status or missing result, and compare the normalized per-case results with the trusted expected selection. A setup/collection error remains failure even if some cases are reported skipped rather than individually failed.

A cancelled or incomplete shard is INCOMPLETE, never silently dropped from the denominator. A retry does not erase the earlier failed attempt. An expected negative-control failure belongs to a separately identified control run, not a general exemption allowing a positive suite to fail.

## 4. Boot proof and cleanup are distinct

### PA-04 - Three existing instruments answer different questions

| Instrument | Source behavior | Correct interpretation |
|---|---|---|
| CI module-loading check [S5] | Executes child under timeout with `set +e`; searches captured output for a bounded list of module errors; otherwise prints success without checking the command outcome as a success condition | A known-error signature screen. Absence of those strings is not positive proof every module loaded or HTTP became ready; timeout/unrelated error can fall through. |
| Integration boot test [S6] | Requires dist file; spawns that artifact on fixed port 3994; watches child stdout/stderr for dependency failures or either startup phrase; has idle and hard caps | Stronger actual-child/DI observation than compilation alone. It does not make an HTTP request or bind an HTTP response to that child/build. Preserve the existing assertions. |
| Development launcher [H1] | Separate readiness loops; unconditional final banner after exhaustion; fixed ports and resource override changes | Developer convenience, not an isolated-run admission/boot certificate. Do not invoke it to establish this hypothesis on unknown resources. |

The boot test's body calls `child.kill()` and resolves its promise without waiting for confirmed exit/close. The wrapper's completion therefore does not by itself prove port/process resources are reusable. A zero-code exit without a recognized signal is not treated as started; timers eventually decide failure. These are static control-flow observations, not a reproduced leaked process or failed boot.

A stale diagnostic message in the dist-existence assertion still says CI does not build the server, while the current workflow and the test header do show a rebuild [S5/S6]. Follow the actual workflow for that fact; the diagnostic should not cause another agent to repeat a resolved build-order change. No test assertion or message is modified here.

### Selected boot receipt

Separate: artifact built -> child spawned -> module/DI startup observed -> HTTP response received -> required dependencies/capabilities ready -> child/resources closed. Missing a later stage must not be relabelled as success at that later stage. A controlled boot need not prove every provider capability; its declared readiness scope must state what it actually requires.

Use a run-owned process handle and port allocation; probe the expected child/build identity where supported. Merely finding an open familiar port is not identity proof. Close/drain the child and confirm termination before releasing its resources; escalation must target owned processes, not any PID listening on a fixed port. Uncertain cleanup retains a residual obligation instead of pretending nothing remains.

## 5. Resource admission before collection and cleanup

### Actual path and missing boundary

The social regression fixture loads root `.env` at module evaluation; beforeAll imports the DB, constructs services and calls raw fixed-prefix cleanup before seeding [H1]. The boot test also loads root environment and inherits process.env into its child [S6]. No root environment file or database was opened here.

The CI job provides environment values and job service declarations, which is a useful existing route [S5]. It does not establish that arbitrary local worktrees, inherited shell variables, provider credentials, shared queues or repeated test commands are isolated. Nor does the named fixture establish run ownership before destructive cleanup. Fixed prefix and node test mode are not resource ownership proofs.

### Selected admission and ownership sequence

```text
accepted change/test scope
 -> external run controller allocates least-privilege, run-owned resources
 -> verify nonproduction identity and the authorized capability set
 -> bind source/config/expected cases and effective resource coordinates
 -> only then evaluate runner config and collect test modules
 -> setup and execute under those same controls
 -> collect proof and close/drain owned child work
 -> run-owned cleanup + confirmed outcome or residual debt
 -> evaluate the precise proof claim; independent promotion remains separate
```

The controller is a responsibility over existing runners/provisioners, not a new product runtime. A setup hook is too late if imports already acquired dangerous capabilities. Later configuration changes must not escape the admission decision; isolate secrets/network/process permissions so a changed environment string cannot redirect work to production.

Prefer separate ephemeral DB/schema with verified ownership and restricted role, queue namespace/credentials, storage root, callbacks, provider-sandbox destination and ports for each independent run. A worktree isolates source files, not these resources. If setup or teardown fails, record which resources were allocated and who can safely reclaim them. Reclaimed leases must not permit a still-running old worker to mutate a new run's namespace. These are design requirements; no allocator is installed here.

Admission probes may need narrow read-only connections to identify an already-authorized test resource; do not make a broad connection with production-capable credentials and only afterward ask whether it is safe. Never record credential values in the proof manifest, logs or intelligence documents. Preserve secured raw evidence according to access policy and provide redacted references/hashes rather than publishing secrets.

## 6. Bind the existing reversible-testing cases

| Existing case | Current responsible seams | Required reject condition / correction | Current proof status |
|---|---|---|---|
| R03: nonempty discovery, complete bindings, no required skips, negative control | package scripts/configs; CI test steps; truth/burndown review; Vitest reporter; existing gate-vacuity source check | Reject empty/unbound/missing/duplicate/skipped/todo/incomplete/error results; require independently accepted case set. Attach named control transcript where policy requires it. Source anti-vacuity remains separate. | Owner/predicate mapping complete; actual reporter consumer and runner bindings not implemented/proven. |
| R04: reject wrong/shared/production environment before writes | CI service setup; fixture dotenv/DB acquisition; child inherited environment; launcher override behavior | Reject before unsafe import/collection/setup/cleanup; verify least-privilege resource identities and no escape to disallowed destinations. Fixed names and NODE_ENV do not suffice. | Static boundary mapped; no environment probe or test run executed. |
| R05: concurrent runs cannot touch each other's resources | Fixture cleanup prefix, DB service namespace, boot port/process handle; run controller/reclaimer | Require unique ownership across DB, queues, storage, callbacks and child processes. Never use an unowned prefix/PID; failure to confirm shutdown blocks reuse. | Fixed-resource limitations mapped; no actual concurrent collision reproduced. |
| R07: flag outage/stale/invalid values cannot override current safety | GrowthBookService plus trusted callers, J13 grant/claim boundary and K3 authority | Treat dynamic flag as implementation/exposure choice only. Unknown result selects safe reference or disabled; cached ON cannot override revoke/stop. Trust reserved tenant attributes and validate mode values at callers. | Wrapper re-read [S7]; exhaustive caller paths, SDK freshness and runtime stop enforcement remain unproved. |

GrowthBook's wrapper returns caller fallbacks on disabled/missing/error paths; successful cached evaluation is not automatically a fresh remote kill-switch observation [S7]. It has no independent grant/revocation state in the inspected body. The typed cast in getValue is not runtime mode validation. `attributes` are spread after generated id/businessId, so trusted caller construction is required; no untrusted call-site exploit is asserted without tracing its inputs.

## 7. Admission decisions and analytical counterexamples

The proposed normalized verdicts are REJECTED, INCOMPLETE and SATISFIED_AT_DECLARED_SCOPE. SATISFIED is not production permission, not whole-app completion and not a new authority grant. Unknown evidence does not default to satisfied.

| Local challenge | Required disposition |
|---|---|
| All reported cases pass, but no required-case mapping was supplied | REJECTED for the requested proof; source tests may still have run. |
| Expected count matches but a required identity is replaced by a duplicate | REJECTED; set comparison precedes aggregate certification. |
| beforeAll fails and a reporter marks tests pending/skipped | REJECTED; preserve setup error, not a green subset. |
| Positive run passes; one shard is missing/cancelled | INCOMPLETE; do not shrink expected scope after the fact. |
| Cached green output is reused as a new shuffled run | Reject freshness claim; retain original cache provenance only under explicitly accepted reuse. |
| Correct unit tests are presented as real-database isolation proof | REJECTED at that stronger scope; preserve the true unit evidence. |
| Candidate alters gate/manifest/report parser to make itself pass | Require independent policy/diff review; do not auto-admit its chosen rules. |
| Negative control fails for environment setup rather than the named removed entry | REJECTED control; failure alone is not proof the gate still detects the defect. |
| Two agents have distinct branches but the same cleanup prefix and DB | Reject independence claim until resource ownership is established. |
| Child startup log is seen; HTTP is unavailable or process exit unconfirmed | Keep startup observation; readiness/cleanup are not satisfied. |
| Flag service has cached ON after current local revocation | Deny new effect admission despite exposure result. |
| Assertions pass but cleanup fails or a child remains unknown | Record passing assertions and cleanup debt separately; do not certify a fully safe completed run. |

All twelve are analytical challenges, not executed application fixtures and not additions to the 44-case manifest. The YAML companion makes these admission requirements inspectable but performs no validation itself.

### Negative-control lineage and test evolution

Retain the OS's specific ledger negative-control procedure: run the fixed candidate, temporarily reintroduce the named removed entry in an authorized isolated control copy, show failure naming that entry, restore the fixed tree, retain both identities and outputs [S2/H2]. Do not weaken an assertion or misclassify unrelated infrastructure failure as the intended detection.

Optional components and legitimate requirements can evolve through reviewed changes; the trusted expected-case selection must change explicitly with them. A new variant does not gain permission to erase a failed run, replay a completed business effect or relax tenant/authority rules. This applies the blueprint's controlled-change intent [P1] without copying its historical scaffold or claiming its proposed tests have passed.

## 8. Cross-journey ownership and bounded closure

| Owner | Reinjection |
|---|---|
| K12 / J24 | Own exact change/run/proof admission and independent review over existing tools; no new competing constitution or test framework. |
| K8 | Retain source/build/case/environment identity and distinguish evidence classes; a receipt's existence is not proof of its contents. |
| K7 / K11 / J18 | Separate run attempt, cancellation, timeout, child exit and cleanup certainty. No unsafe resource reuse or erased prior attempt. |
| K1 / K3 / J2 / J15 | Sandbox identity and permitted effects remain explicit; accepted test evidence never grants production or business-action authority. |
| J13 | Exposure cannot bypass current connector permission; test removal preserves revocation/history and one effect owner. Its mapped-core alignment and ED1-ED5 survive. |
| J23 | Delayed/background work inherits run resource scope and explicit stopping behavior; completion is not merely command return. |

**Completed:** J24_PROOF_ADMISSION_AND_RUN_ISOLATION_MAPPING, at the eight-source/named-boundary scope. **Not completed:** J24 target convergence, enforced harness/report consumer, K12 dossier, trusted branch protection/review configuration, exhaustive flag callers, or runtime/environment proof. No F228/C178/KF-REC-058 allocation.

### Exact next action: J24_SAFE_CHANGE_CONVERGENCE_REVIEW

Create `J24-SAFE-CHANGE-CONVERGENCE-REVIEW.md`; do not repeat this command/config scan. Resolve three bounded decisions in order:

1. Map the trusted change-admission boundary: review accepted OS/assurance handoff rules, actual required-check configuration where accessible, and candidate-versus-policy ownership. A settings read that requires unavailable administration permission stays an explicit evidence debt; do not substitute guessed protection.
2. Specify how existing CI/provisioning/report tools can enforce the admission contract without editing constitutional rules or weakening assertions. Include fresh versus cached proof, safe case evolution, reference/candidate switching and run-owned cleanup. Keep any implementation change separately authorized and identify an enforceable migration/withdrawal floor.
3. Backward re-audit against J13/J18/J23/J2/J15/K8/K12 and make a declared-scope J24 convergence disposition. Name the exact unresolved invariant if it cannot yet align; do not equate unexecuted tests with either passing tests or a reason to restart completed analysis.

This is a finite synthesis/review, not authorization to launch, deploy, run write-capable tests or change .github/OS/gates. Keep the programme map derived from the same canonical checkpoint.

## 9. Source manifest, external constraints and integrity

All S sources use `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

| Ref | Source / inspected scope | Blob |
|---|---|---|
| S1 | architecture/os/playbooks/truth.md, full | 7a52c8ec0ccf70d710520db2ce503c2e96c6f1dd |
| S2 | architecture/os/playbooks/burndown.md, full | 977857cc5da5595a7de82eae2523c609a808f616 |
| S3 | package.json, full | c2f5c5f4d9870bd669757406865a7896f307d873 |
| S4 | turbo.json, full | e2f5bdc85bfd2a35a5a78f476c27d2387bcd0dfc |
| S5 | .github/workflows/ci-cd.yml, complete via 1-340 and 335-end | da90b4fc3e9dfbf662c900473bc7a5da983a2d98 |
| S6 | apps/server/test/app-module-boots.integration.test.ts, full | ccbe4b1d48c566ef7eeb8626fe41a46bf23fd076 |
| S7 | apps/server/src/core/growthbook/growthbook.service.ts, full | 13fa52d9e06bae72bcdc667fc0e6719356032c6d |
| S8 | apps/server/src/core/config/gate-vacuity.spec.ts, full | 6b831c2e03c13043c3b3382b7a7799ce251cd505 |

H1: J24 source trace 001's exact package/config/social-fixture/launcher evidence, retained rather than falsely counted as eight additional fresh reads. H2: existing OS constitution, blob f2a79023740f91e4f520339a1be14036cc997da1; governing document, not proof of enforcement. Directory listings and default-branch search were path discovery only. A no-result search for numPendingTests is not proof no implementation exists elsewhere. No workflow runs, actual secrets, tenant DB contents or provider configurations were inspected.

External checks accessed 2026-09-16; separate from repository facts:

- E1: [Vitest v2 reporters](https://v2.vitest.dev/guide/reporters): machine report selection, output files and per-assertion/pending/todo fields. We use the documented v2 family to identify an integration seam, not to assert the resolved installation was tested or to prescribe newer APIs.
- E2: [Turborepo caching](https://turborepo.dev/docs/crafting-your-repository/caching) and [configuration reference](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/reference/configuration.mdx): outputs and replayed logs are distinct; outputs:[] is not a no-cache declaration. A cached green run is reused evidence, not a new execution. Exact local/CI cache events are unobserved.
- P1: user-supplied KEYFLOW v3, Execution Addendum 6.1-6.3: controlled proposals/corrections and independently verifiable components serving seamless integration. The proof receipt and current CI adaptation here are newly derived design, not claims those mechanisms are already in that blueprint or production.

Context integrity: PASS FOR THIS BOUNDED CONTINUATION. Live intelligence input resolved to 59c94b3; current machine state, handoff/rollover, START, J24 and prior canonical rules were available/read. Implementation reads stay pinned; no rebaseline. Existing packets remain unpromoted/unauthorized. The previous map input was reconstructed from the connector-read canonical state, roster, inventory and unchanged manifest, and its source fingerprint matched the published prior map before any edits. Renderer/template bytes also matched their repository blob identities. No runtime proof was inferred from that documentation-tool check.
