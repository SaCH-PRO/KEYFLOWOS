# Claude Code Handoff — KF-EXEC-K12-001

Do not modify application/domain behavior.

## First reads
1. root `AGENTS.md`
2. current continuity files
3. execution packet
4. this package folder
5. J24/K12 proof architecture sources

## Before edits return characterization
Return:
- current HEAD;
- package manager/Node/Vitest/Turbo versions;
- root test scripts;
- CI test job topology;
- Vitest config inheritance;
- current reporter capabilities;
- cache behavior;
- integration resource acquisition order;
- boot child-process behavior;
- all source drift vs fixed baseline relevant to K12.

## Allowed implementation scope after authorization
Only proof/test/tooling/CI/resource-isolation code needed by this package.

## Forbidden
- production business logic changes;
- weakening tests/gates;
- replacing Vitest/Turbo;
- using production resources;
- editing accepted policy from generated candidate output;
- touching architecture/os without separate authorization.

## Stop immediately if
- current main materially changes proof architecture;
- safe resource classification cannot precede setup;
- required reporter identity cannot be derived reliably;
- implementation requires weakening existing negative controls.

## Return envelope additions
Include:
```yaml
package_level_before:
package_level_after:
proof_manifest:
runner_reports:
resource_leases:
cleanup_receipts:
negative_control_results:
evaluator_verdict:
debug_event_samples:
```
