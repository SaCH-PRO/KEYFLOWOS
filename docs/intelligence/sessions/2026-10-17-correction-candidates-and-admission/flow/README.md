# Flow P0 selective-policy correction — local candidate and proof

**Disposition: prepared and locally proved; not released, integrated, admitted, merged, or checkpointed.** Main's demonstrated defect remains until the existing P0/AUTH owner adopts a reviewed correction. This preparation creates no worker assignment or authority event.

Source main: [`98ee0202499ba87fa4ee13d58a2a9075016225bd`](https://github.com/SaCH-PRO/KEYFLOWOS/commit/98ee0202499ba87fa4ee13d58a2a9075016225bd). Runtime: Node **24.19.0**, TypeScript **5.9.3**, Nest Common **11.1.19**, Vitest **2.1.1**, Linux. This is local focused evidence, separate from hosted Node 20 and complete application proof.

## Defect and correction

`AiOversightService.getAutonomySettings` first reads typed `AutopilotSettings`. If that read throws, it records `readFailed = true`. Main then reads legacy `AiMemory`, and a parseable record returns immediately before the existing degraded guard. A permissive legacy record therefore replaces unresolved, potentially more restrictive typed authority.

The candidate changes one decision: legacy policy can return only if `!readFailed`. A typed read error reaches the existing restricted/degraded result even if legacy succeeds or explicitly contains `degraded: false`. Successful typed policy still takes precedence; a confirmed absence of the typed row still supports valid legacy policy. No API, module, schema, policy vocabulary, action adoption, or ownership rule changes.

The protected `updateAutonomySettings` path already refuses a degraded read. Correcting the resolver makes that existing refusal effective in the selective-failure case. The executed baseline performs **one synthetic AiMemory upsert and one synthetic success audit** after the typed read error; the candidate throws `ServiceUnavailableException` before either write. This does **not** demonstrate an AutopilotSettings row being overwritten. All persistence was a synthetic recorder.

## Executed comparison

The harness executes the complete real service, tool registry, role engine, job-role policy and approval-tier helpers. Nest exception classes are real. DI tokens and all database/admin/audit responses are synthetic; unexpected imports/collaborators are refused and network entry points are blocked.

| Proof | Unchanged main | Candidate | Guard removed again |
| --- | --- | --- | --- |
| Actual-service safety and compatibility matrix | 10 pass / **3 fail** of 13 | **13/13 pass** | 10 pass / **same 3 fail** |
| Expanded existing Vitest spec | 9 pass / **3 fail** of 12 | **12/12 pass**, zero skips | 9 pass / **same 3 fail** |
| Original, unmodified Vitest spec | **5/5 pass**, zero skips | Original assertions retained in expanded spec | — |

The three substantive counterexamples are:

1. **P2:** failed typed policy read plus permissive legacy produces actionable policy on main; candidate returns restricted/degraded and the real `evaluate` call refuses.
2. **W1:** an authorized owner saving one unrelated setting after that failure reaches both synthetic writes on main; candidate produces zero policy writes, zero audit writes and HTTP-class exception 503.
3. **R1:** an explicit transaction reader has the same unsafe legacy promotion on main; candidate refuses without using the shared client.

Controls preserve typed advisory precedence, typed blocklists, supported legacy after confirmed absence, ordinary defaults after two confirmed absences, both-read failure, malformed legacy, legacy read failure, a valid owner update preserving blocklists and producing one audit, and non-admin refusal before any policy I/O. The mutation restores only the old legacy-return condition; the same three requirements fail again. These are substantive safety failures, not environment failures or skips.

The expanded spec keeps every original assertion and adds seven regression cases. The original five passing tests demonstrate the missing selective-failure coverage; their previous green result was not evidence against this defect.

## Exact scope and identities

The patch changes exactly two existing files:

- `apps/server/src/modules/ai/ai-oversight.service.ts`
- `apps/server/src/modules/ai/ai-oversight-fails-closed.spec.ts`

[flow-policy-candidate.patch](flow-policy-candidate.patch) is directly applicable to the pinned source. [candidate-manifest.json](candidate-manifest.json) records base and candidate Git blob IDs, SHA-256 values and sizes. Applying the patch to a second isolated copy was checked, and the resulting bytes matched the candidate manifest. Eighteen recovered source/instruction/prior-evidence files were checked before and after preparation; the publishable manifest narrows this to the seven code/spec files needed to reproduce this package.

[results/compact-proof.json](results/compact-proof.json) records all 13 cases, the three variants, the Vitest results and limits without raw environment logs. [verification.json](verification.json) records the local scope and patch checks. Full synthetic traces remain in the working evidence directory; the compact package does not claim to reconstruct the lost earlier seven-case bundle byte for byte.

## Reproduce from an existing pinned checkout

Use a **fresh copy** of this directory so the saved results remain an immutable observation. The source checkout must contain the seven files at the exact manifest hashes; no branch change or network fetch is performed by the materializer.

```bash
python materialize-source.py /path/to/pinned-keyflowos-checkout
npm ci --prefix proof-deps --ignore-scripts --no-audit --no-fund
node run-flow-safety-proof.cjs ./fresh-results
python prepare-vitest-proof.py
FLOW_PROOF_VARIANT=original_spec node proof-deps/node_modules/vitest/vitest.mjs run --config flow-vitest.config.mjs
FLOW_PROOF_VARIANT=baseline node proof-deps/node_modules/vitest/vitest.mjs run --config flow-vitest.config.mjs
FLOW_PROOF_VARIANT=candidate node proof-deps/node_modules/vitest/vitest.mjs run --config flow-vitest.config.mjs
FLOW_PROOF_VARIANT=mutant node proof-deps/node_modules/vitest/vitest.mjs run --config flow-vitest.config.mjs
```

The baseline and mutant Vitest commands must exit **1**, each with the three named assertion failures. Original spec and candidate must exit **0** with zero skips. The standalone harness exits 0 only after verifying the expected failing-before/passing-after/failing-mutation pattern; its exit code does not label main secure. The dependency directory is proof-only, with exact direct versions and a lockfile; install scripts are disabled. It does not modify application package manifests or install a worker.

## Scope ledger and next owner action

**Declared and locally resolved:** characterize the selective authoritative-read error; prove the actual protected-write consequence; prepare the smallest resolver correction and existing-spec regressions; execute compatibility controls and an unsafe mutation; verify source/candidate identities and a directly applicable patch.

**Remaining before acceptance:** owner-authorized implementation handoff; independent candidate review; apply/rebase only against the then-current source; hosted Node 20 regression, typecheck/build and required application integration proof; normal control/admission/merge path; post-merge verification; durable programme reconciliation. No application packet credit is taken here.

**Separately retained:** the Flow client role-envelope and real CRM actor propagation correction remains with the existing D3 AUTH/TENANT backward re-audit; the Cortex `BatchResult.results[].result` consumer correction remains separate. Request-wide authority, caller mode overrides, supervised cross-field tightening, ACTION D4/D6 and temporal concurrency are not resolved by this patch. No obligations are dropped.

The optional caller `mode` argument is omitted in these governance checks. This package proves the selective resolver failure and its existing degraded write guard; it does not claim all caller authority or override paths are safe. No HTTP boundary, actual database, provider, production, real contact deletion, complete server boot, full-suite typecheck, hosted CI or deployment was exercised.

## Prior evidence and owner mapping

- [Earlier five-case characterization and peer review](https://github.com/SaCH-PRO/KEYFLOWOS/tree/d8962fda26a55f64b4727b8798b8bb3340ba5391/docs/intelligence/sessions/2026-10-17-p0-safety-review/flow)
- [Existing Flow correction readiness and separate follow-on ownership](https://github.com/SaCH-PRO/KEYFLOWOS/blob/d8962fda26a55f64b4727b8798b8bb3340ba5391/docs/intelligence/sessions/2026-10-17-worker-review-followthrough/reviews/flow-correction-readiness.md)
- [Published recovery record documenting the lost newer bundle](https://github.com/SaCH-PRO/KEYFLOWOS/blob/d8962fda26a55f64b4727b8798b8bb3340ba5391/docs/intelligence/sessions/2026-10-17-f9-review-and-proof-closeout/README.md)

Read `AGENTS.md`, `EXECUTION_CONTROL_STANDARD.md` and the existing architecture dependency map before preparing the change. The scoped directory has no nested AGENTS instructions. The retired scheduled OS cycles remain halted; this is bounded user-directed preparation. The patch adds no architecture relationship, so no scanner-generated map is refreshed.
