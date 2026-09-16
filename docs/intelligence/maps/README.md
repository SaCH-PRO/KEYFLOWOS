# Living programme map

The [programme map](PROGRAMME-MAP.md) is a generated view over existing repository intelligence, not another authority or an app-completion score. Its interactive companion is produced by the same generator.

## Refresh from a repository checkout

Use Python with PyYAML available in the authoring environment. This utility is documentation tooling; no application dependency or package manifest is changed.

```bash
python docs/intelligence/tools/build-programme-map.py
python docs/intelligence/tools/build-programme-map.py --check
```

The first command produces `PROGRAMME-MAP.md`, `PROGRAMME-MAP.json` and `PROGRAMME-MAP.html` in this directory. The second checks all three without rewriting and fails if any output is missing or stale. After a fresh checkout, generate once before using `--check` because the local JSON/HTML are intentionally not tracked.

Track the Markdown and the generator/template sources. The larger JSON/HTML are reproducible local viewing artifacts, not second state registers. Open the generated HTML in a browser permitted to open local files. It is self-contained, has no external JavaScript/fonts, and performs no automatic network requests.

After every material tranche, update the authoritative state and dossiers first, regenerate, check, and commit the Markdown with matching continuity. A new local JSON can also be imported using the viewer's **Load updated JSON** control. This changes only the displayed snapshot, never the repository or application. There is no background refresh, scheduled job, hosted dashboard or live GitHub connection installed by this work.

## Sources and semantics

| Input | Responsibility |
|---|---|
| `handoff/CURRENT-STATE.yaml` | Current phase, frontier, recorded pool status, debts, proof limits and recent milestone references |
| `03-ANALYSIS-MAP.md` | Canonical numbered journey/kernel names and IDs only; its old active-constellation prose is not the current frontier |
| `journeys/` and `kernels/` | Dossier existence, not proof of target convergence or runtime correctness |
| `investigations/J13-INTEGRATION-TEST-MANIFEST.yaml` | Designed cases, bindings and slice dependencies; not all historical application tests |

The five display buckets are deliberately conservative: current investigation, explicitly recorded provisional target alignment, mature evidence pool without a fresh closure certification, existing dossier only, and no dedicated dossier. Raw recorded status and evidence scope remain visible on each card. An existing dossier is not an implemented feature. A missing dedicated dossier does not imply no related work exists. A source test or designed case is not an executed test result.

The only percentage is dossier coverage: existing dedicated journey dossiers divided by canonical journeys. `overall_completion_percent` remains null. No fraction derived from findings, status labels or gate counts is presented as the percentage of KEYFLOWOS finished.

## Validation and safe operation

The generator reads source files and writes only its generated outputs. It does not import application code, execute a test runner, access secrets, call providers, start a server, run Git writes or deploy anything. It rejects duplicate IDs, mismatched coverage or baselines, inconsistent case counts, incomplete case mapping and cyclic slice dependencies.

`--snapshot <file>` accepts an explicitly prepared connector-retrieved source bundle where no checkout is available; it is not a substitute for proving there is a repository checkout. The initial tranche used this mode. Snapshot provenance must identify its source commit, unchanged evidence inputs and newly authored state/dossier additions.

See [MAP-VALIDATION.md](MAP-VALIDATION.md) for the initial authoring-tool validation. No claim of KEYFLOWOS application/provider proof follows from those checks.

## Adding or refining the map

Change the canonical source when status, evidence or coverage changes. Change `tools/programme-map.template.html` only for presentation; do not hard-code a new completion status into a card. Change `tools/build-programme-map.py` only for explicit derivation rules and retain the source/evidence boundaries. Regenerate after either change.

New categories or proof metrics require stated semantics, denominator and evidence source. Unknowns remain unknown. Preserve the existing 25 journey and 12 kernel identities; do not create new canonical IDs for presentation groups.
