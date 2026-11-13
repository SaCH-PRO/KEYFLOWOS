# KF-EXEC-K12-001 Failure Matrix

| Failure point | External effect possible? | Certainty | Retry? | Required action |
|---|---:|---|---|---|
| manifest missing/invalid | no | known | after fix | reject before runner |
| source SHA mismatch | no | known | after rebuild | reject |
| resource preflight cannot classify | unsafe possibility | unknown | no automatic | reject/quarantine |
| resource classified prod/shared | dangerous | known | no | reject before collection |
| runner collection/setup error | fixture effects possible | partial | after cleanup | reject |
| required case missing | no new domain effect assumed | known | after scope fix | reject |
| required case skipped/todo | no | known | after fix | reject |
| runner cancelled/shard missing | possible fixture state | incomplete | after cleanup | INCOMPLETE |
| cached output claimed fresh | no new run | known | rerun uncached | reject |
| child process hangs | maybe local test resources | partial | after termination/cleanup | incomplete/reject |
| cleanup fails | test resources may persist | known/unknown | no reuse | quarantine lease |
| evaluator crashes | proof unknown | unknown | yes after evaluator fix | INCOMPLETE |
| negative control unexpectedly satisfies | evaluator untrustworthy | known | no downstream proof | reject evaluator |
