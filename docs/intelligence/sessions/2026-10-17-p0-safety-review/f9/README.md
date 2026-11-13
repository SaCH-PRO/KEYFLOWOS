# F9 portable evidence probes

These scripts characterize the existing merge-authority defect in `SaCH-PRO/KEYFLOWOS` at **`98ee0202499ba87fa4ee13d58a2a9075016225bd`**. They are investigation evidence, not a correction, a product test suite, a release, or permission to merge.

## Reproduce locally

Requirements: a local Git checkout at the pinned commit, Node.js (verified with **v24.19.0**), Git, and Bash with `sed`, `head`, and `tr` for the gate step. No dependency installation or repository/network fetch is performed.

From this package directory, choose an output directory **outside** the source checkout:

```bash
F9_CHECKOUT="/path/to/KEYFLOWOS-checkout"
F9_OUT_DIR="/path/to/f9-probe-output"
node probe.mjs --checkout "$F9_CHECKOUT" --out "$F9_OUT_DIR"
node run-cli-probe.mjs --checkout "$F9_CHECKOUT" --out "$F9_OUT_DIR"
node gate-step-probe.mjs --checkout "$F9_CHECKOUT" --out "$F9_OUT_DIR"
```

Alternatively export `F9_CHECKOUT` and `F9_OUT_DIR` and omit the arguments. Paths may contain spaces. Package location and working directory are not hard-coded. `probe-config.mjs` checks Git HEAD and the hashes of all 12 source files listed in `source-manifest.json` before source execution; a mismatch stops the probe. It creates only the requested output directory and synthetic evidence files.

Use **`run-cli-probe.mjs`** for the CLI diagnostic. It starts the real pinned `auto-merge-admitted.mjs --merge` with `network-fixture.mjs` loaded first, a synthetic token, and the synthetic repository `local/f9-fixture`. The child's environment does not inherit real GitHub credentials. The preload replaces global `fetch`; every response is an in-memory fixture, unexpected requests throw, and there is **no network passthrough**. The recorded PUT is a mock request, not a GitHub merge. Do not remove the preload or run the source merger separately to reproduce this evidence.

## Expected results at this source revision

| Diagnostic | Expected characterization |
|---|---|
| `probe.mjs` | Both accepted review statuses remain eligible across six absent/false/malformed artifact-grant values each: **12 unsafe accepted cases**. Six independent controls still deny: draft, correction status, missing live independent review, base drift, pending required check, and wrong packet identity. |
| `run-cli-probe.mjs` | `ACCEPT_FOR_ADMISSION`, both artifact merge-authority fields false, passing independent Copilot review: **two complete snapshots and one mocked merge PUT**, with no current control-room authority read in this fixture. Expected secure merge count is zero. |
| `gate-step-probe.mjs` | The exact non-draft admission shell step exits **0, 0, 1** for `ACCEPT_FOR_ADMISSION`, `READY_TO_MERGE`, and `CORRECTION_REQUIRED`, respectively, with both synthetic artifact grants false. |

The scripts intentionally assert the observed unsafe behavior. A successful diagnostic run means the defect was reproduced, not repaired. If these assertions stop matching, reassess the new evidence rather than treating the old finding as proved.

The matrix's final same-head recheck varies synthetic artifact bits while holding the head constant. It demonstrates that those bits are uninspected; **it is not a real revocation-race reproduction**, because committed artifact contents cannot vary at one real immutable head. The mocked request trace and source analysis separately establish the missing current-authority input. Nor do these probes establish that self-authored artifact booleans would be a sufficient future authority source.

The gate diagnostic executes only the named step's shell body. It does not run all GitHub CI, evaluate the workflow's event condition, or establish branch-protection settings. No original standalone gate wrapper was retained; this package adds a wrapper that extracts the exact pinned block and substitutes only the synthetic base-SHA expression before executing the same three recorded cases.

## Evidence layout and portability validation

- `recorded/` contains the seven original JSON files copied byte for byte and the original admission log preserved losslessly as the UTF-8 `stdout` string in `existing-admission-tests.json`. Decoding that string reproduces the exact original bytes, including its trailing blank lines. `packaging-provenance.json` records the original hashes, the log-storage mapping and the original/portable script hashes.
- `source-manifest.json` extends the original provenance to cover the complete imported local module graph, both inspected workflows, and the source of the archived admission suite.
- `portability-results/` contains the fresh results, CLI request trace, extracted gate shell script and `portability-validation.json`. The six generated gate-fixture files are omitted from the durable package because the wrapper recreates them exactly; the result and source extraction are retained.
- The original admission-suite log records **39 passed, zero failed, zero skipped**. It was preserved, **not rerun during packaging**.

Each diagnostic completed successfully **once** during portability validation. The five fresh result/trace JSON files matched their original recorded values exactly after JSON parsing. The matrix had 12 unsafe accepts and six preserved denials; the CLI trace had 15 mocked requests including one mocked merge; the gate step retained its 0/0/1 outcomes.

This executor initially returned `EPERM` when an extra Node launcher tried to spawn a diagnostic, and again when the sandboxed CLI wrapper tried to start the source Node process. Neither attempt executed the source CLI. The matrix then ran directly; the isolated CLI wrapper and gate wrapper completed through explicitly approved subprocess-enabled execution. The package's fixture and assertions were not weakened to accommodate this environment limitation. A host that restricts subprocess creation must authorize the same isolated local commands; do not bypass the mock boundary.

All supplied business, packet, repository, review, branch and action data are synthetic. The checkout was read only. No actual API requests, current authority mutations, repository fixes, worker actions, merge, deployment or production effects were performed.
