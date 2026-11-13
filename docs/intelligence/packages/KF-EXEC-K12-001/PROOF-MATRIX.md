# KF-EXEC-K12-001 Proof Matrix

| ID | Invariant | Layer | Negative control | Expected verdict |
|---|---|---|---|---|
| K12-P01 | exact case identity | unit/tooling | omit one required ID | REJECTED |
| K12-P02 | duplicate cannot replace missing | unit/tooling | duplicate a passing ID | REJECTED |
| K12-P03 | skipped/todo is not proof | runner fixture | mark required case skip/todo | REJECTED |
| K12-P04 | setup/collection errors explicit | runner fixture | throw in setup/collection | REJECTED |
| K12-P05 | cache freshness honest | Turbo fixture | replay cached report as fresh | REJECTED |
| K12-P06 | unsafe resource blocked pre-setup | integration harness | prod-like/shared URL | REJECTED before write setup |
| K12-P07 | concurrent isolation | integration harness | two simultaneous runs | disjoint leases |
| K12-P08 | cleanup gates reuse | integration harness | force cleanup failure | lease quarantined |
| K12-P09 | manifest/evaluator independence | tooling/CI | candidate edits local expected list | no self-certification |
| K12-P10 | evaluator sensitivity | tooling | deliberately failing negative control | REJECTED |
| K12-P11 | cancelled shard incomplete | CI/tooling | remove/cancel shard | INCOMPLETE |
| K12-P12 | source identity exact | tooling | report from different SHA | REJECTED |

All K12 proof artifacts must themselves be reproducible from a fresh nonproduction environment before K12 may reach L5.
