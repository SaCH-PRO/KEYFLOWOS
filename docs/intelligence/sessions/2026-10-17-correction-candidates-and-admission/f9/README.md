# Portable F9 correction and review package

**Local correction proposal and reproducible evidence only.** No implementation branch, authority, worker, ready flag, production system or merge was changed. The baseline is [PR #181 artifact ff49859e70cee65e31c09277b05aca4144ff77ea](https://github.com/SaCH-PRO/KEYFLOWOS/commit/ff49859e70cee65e31c09277b05aca4144ff77ea).

The package contains the exact [three-file patch](correction.patch), [39 source identities](source-manifest.json), the original [proof summary](proof-summary.json), and the original [independent review](independent-review.md). No source tree, raw TAP transcript, dependency directory or archive is included.

## What the patch fixes

The merge-grant predicate releases a packet hold only when the existing effect reader accepts HOLD_CLEAR. Missing, wrong or unknown effects, invalid health and production-touched release messages cannot clear it.

The synthetic CLI fixture moves large scenario JSON into a temporary file while retaining inline JSON compatibility. The pagination test keeps 150 filler comments and verifies revocation on a later page during the second snapshot. Child-process launch errors are reported directly.

The reconstruction helper applies the unified diff with exact context and no fuzzy matching. It then verifies all three resulting candidate files against the exact Git blob and SHA256 values in proof-summary.json. Every other selected source file must retain its baseline bytes.

## Evidence kept separate

| Evidence | Result and scope |
|---|---|
| Historical original suites | 77 tests; 76 passed; the known Linux pagination fixture failure |
| Historical new requirements on original runtime | 17 tests; 12 passed; five intended invalid-release zero-PUT assertions failed |
| Historical corrected candidate suites | 84/84 passed, zero skips |
| Original independent review | Nine predicate checks, actual inline CLI proof, 39 source identities and three original TAP identities verified |
| New portable reconstruction | 39/39 source files verified; exact three candidate hashes reproduced |
| New portable smoke replay | 17/17 candidate CLI tests, nine/nine independent checks, inline CLI exit 0 with two snapshots and one synthetic PUT |

The original proof summary, source manifest, patch, independent review and original independent result files are preserved byte-for-byte. Their recorded executions are not relabeled as new results. Historical TAP hashes remain in the original proof summary; the raw transcripts are deliberately excluded.

[Portability evidence](portability-evidence.json) records the new reconstruction and smoke results. The first local attempt could not spawn synthetic CLI children because of sandbox EPERM. The identical bounded runner succeeded after local subprocess execution was permitted. That environment failure is retained separately.

The original independent review describes the commands used at review time. The executable wrappers in this package have since been adapted to accept explicit work/result paths; the inline wrapper now builds the equivalent synthetic positive-control scenario itself. Use the commands below, not historical workspace paths present in the original evidence.

## Reconstruct source and candidate

Requirements for the verified path: Python with pathlib.is_relative_to support, Node.js, and either an existing source export or a Git repository containing the pinned commit. No dependency install or network request is performed.

Run these commands from this package directory. Both work and result destinations must be new directories outside the publication package.

Using an existing Git repository:

    python prepare-workspace.py --git-repo "/path/to/KEYFLOWOS" --work-dir "../f9-replay-work"

Or using an existing source directory:

    python prepare-workspace.py --verified-source "/path/to/export" --work-dir "../f9-replay-work"

The source-directory option still checks every file against all 39 pinned size/Git-blob/SHA256 identities. It is not a trust shortcut. The Git option reads the exact commit with git archive, validates the complete export before writing, and never checks out or changes the repository.

**Git archive reconstruction is NOT_RUN in this preparation.** No existing Git checkout containing the required object was supplied here; the checked preparation directory is not a Git repository. Portability was verified through the existing-source path.

## Replay into new results

The bounded smoke mode was executed successfully:

    python run-proof.py --work-dir "../f9-replay-work" --results-dir "../f9-replay-results" --mode smoke

It runs the 17 candidate CLI cases, the nine independent predicate checks, and the actual inline-fixture CLI. Every CLI response, including the merge PUT, comes from the synthetic preload. The runner supplies only platform launch variables; live credentials, NODE_OPTIONS and inherited application configuration are excluded. The inline wrapper also removes inherited variables before setting its explicit dummy token.

The full historical matrix is available without overwriting its original identity:

    python run-proof.py --work-dir "../f9-replay-work" --results-dir "../f9-full-results" --mode full

Full mode re-executes the original 77-case suites, the 17 new requirements against original runtime, and the corrected 84-case suites, plus the independent checks. Its expected baseline failure is the recorded Linux behavior. This full portable mode was not rerun merely to package the already inspected proof.

Every replay creates fresh TAP/stderr/results in the specified external result directory and computes new hashes. It refuses an existing result directory and never writes proof-summary.json, source-manifest.json, or the preserved independent result files. Timing and output paths can change a replay transcript hash; do not expect a new transcript to have the historical hash.

Standalone wrapper usage, if needed:

    node independent-extra-checks.mjs "../f9-replay-work" "../new-extra-result.json"
    node independent-inline-cli.mjs "../f9-replay-work" "../new-inline-result.json"

The standalone extra checker verifies reconstructed source/candidate identities but cannot reverify omitted historical raw TAP; that fact is explicit in its output.

## Remaining qualifications

All executed local evidence here uses Node 24.19.0 / Linux. Node 20 hosted proof, Windows proof, mutation-control manifest integration, full relevant project checks and proof at the eventual published implementation head remain outstanding.

The preserved local independent review found no substantive blocker in these three candidate files. It is not admission of the existing PR, a ready transition, an exact-head merge grant, programme credit, or production/security qualification.
