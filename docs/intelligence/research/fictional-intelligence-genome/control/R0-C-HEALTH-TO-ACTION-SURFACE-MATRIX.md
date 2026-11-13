# R0-C — Health Signal -> Action Surface Matrix

Status: RESEARCH_ONLY / CONTROL
Date: 2026-10-06

## Distinct health domains
| Health domain | Current signal owner | Current proven effect |
|---|---|---|
| cognitive/execution health | KeyCortexHomeostasisService | endocrine humility/malaise; caution |
| body/organ health | interoception/homeostasis | body-integrity signal |
| governance health | AiOversightService | degraded/fail-closed settings semantics |
| business readiness | Business Genome | BLOCKING/DEGRADED/OPTIONAL; automationAllowed |
| connector health | ConnectorStatus/health monitor | connector availability/state |

## Action surfaces to pressure-test
1. KeyCortex action boundary / proposal path.
2. Flow tool execution.
3. KeyCommandService approved-plan execution.
4. automation/autopilot/delegation paths.
5. connector-triggered actions.
6. direct domain endpoints that can cause material effects.

## Current convergence
Homeostasis is not an authority source. It is evidence that may tighten a control requirement.
Governance-health failure is different: missing/untrusted authority/policy information must fail closed.
Business readiness is domain eligibility, not cognitive health.
Connector health is effect-path availability, not permission.

## Candidate pure decision
`deriveControl(capability, authority, autonomy, cognitiveHealth, bodyHealth, governanceHealth, businessReadiness)`

The function may only tighten a requirement. Health state may never grant authority.

## Negative controls
- healthy cognition must not bypass approval;
- degraded cognition must not create authority;
- unavailable governance state must not silently use permissive defaults;
- a broken connector must not be reported as successful execution;
- low-risk reads should not be globally disabled merely because an unrelated organ is degraded.

## Next proof
Enumerate which of the six action surfaces already call the canonical action boundary and which bypass it.
