# KF-EXEC-K12-001 Change Plan

No edits are authorized yet. This is the later implementation order.

## Step 0 — Current-main characterization
Inspect current:
- root scripts;
- Turbo task cache rules;
- Vitest versions/config inheritance;
- CI test jobs/services;
- reporter formats;
- existing integration fixture/resource acquisition;
- boot child-process handling.

Output: `K12-CHARACTERIZATION-RECEIPT.yaml`.

No code changes in this step.

## Step 1 — Report schema adapter
Add a narrow adapter that consumes native Vitest JSON/JUnit output. Do not replace Vitest.

Must expose:
- fully-qualified case ID;
- suite/file;
- status;
- duration;
- skip/todo;
- collection/setup/unhandled errors.

Proof before Step 2: malformed/missing fields reject.

## Step 2 — Accepted policy manifest
Add a reviewed manifest outside candidate-generated output:
- required case IDs;
- allowed test layer/environment;
- resource class;
- freshness requirement;
- evaluator version requirement.

No dynamic "discover whatever exists and call it required."

## Step 3 — Independent evaluator
Implement verdict:
- REJECTED
- INCOMPLETE
- SATISFIED_AT_DECLARED_SCOPE

Evaluator compares manifest + report + run receipt + cleanup receipt.

## Step 4 — Resource admission
Before write-capable test setup:
- classify resource;
- prove nonproduction;
- allocate run-owned namespace/resource;
- emit resource receipt.

Write-capable collection must not precede admission.

## Step 5 — Cleanup ownership
Track:
- DB/schema/tenant fixture;
- queue namespace;
- ports/child PIDs;
- temporary files;
- provider sandbox objects if later enrolled.

Emit COMPLETE / FAILED / UNKNOWN cleanup state.

## Step 6 — CI binding
Bind only selected required proof scopes initially.
Keep ordinary local dev test commands available.

## Step 7 — Negative controls
Run deliberate:
- missing case;
- skipped case;
- duplicate substituted for missing;
- stale/cached claim;
- wrong resource;
- cleanup failure;
- candidate self-manifest edit.

No package can advance if any negative control is accepted as SATISFIED.
