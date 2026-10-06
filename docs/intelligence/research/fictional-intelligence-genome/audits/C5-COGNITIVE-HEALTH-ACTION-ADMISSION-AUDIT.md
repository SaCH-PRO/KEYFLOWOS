# C5 — Cognitive Health -> Action Admission Audit

Status: RESEARCH_ONLY
Programme: KIGP-001
Audit date: 2026-10-06

## Question
Does KEY's measured cognitive/system health currently tighten execution authority, and what is the correct owner for degraded/safe-mode behavior?

## Observed repository reality
- `KeyCortexHomeostasisService` is scheduled and measures execution integrity, response latency and body integrity, converting sustained deviation into endocrine signals.
- Cognitive triage consumes body/endocrine state as deliberation/caution input.
- `AiOversightService` has a degraded flag distinguishing unavailable governance settings from normal defaults and has fail-closed tests.
- Business Genome uses BLOCKING/DEGRADED/OPTIONAL readiness semantics and module automation eligibility.
- Capability -> Control -> Clearance is the current fail-closed action boundary for bounded capabilities.

## Findings
### C5-F1 — homeostasis does not prove a hard execution gate
Homeostasis intentionally changes how carefully KEY thinks rather than directly acting on business admission.
Disposition: TRUE GAP relative to the KIGP degraded-cognition -> reduced-autonomy law.

### C5-F2 — existing degradation signals have different meanings
- homeostatic degradation: KEY performance/body condition;
- AiOversight degraded: governance/settings read failure;
- Genome degradation/blocking: business-data readiness;
- connector health: external integration condition.
Disposition: RELATED DISTINCT. Do not collapse these into one boolean.

### C5-F3 — action boundary is the correct candidate enforcement seam
Disposition: ADOPT EXISTING OWNER for any future health-dependent admission rule.

### C5-F4 — no canonical global SAFE_MODE contract is proven
Disposition: TRUE GAP / DEFER IMPLEMENTATION until semantics are defined.

## Candidate health taxonomy
- COGNITIVE_HEALTH
- BODY_HEALTH
- GOVERNANCE_HEALTH
- BUSINESS_READINESS

Each may expose READY / DEGRADED / UNAVAILABLE / STALE where meaningful.

## Candidate invariant
For material/high-risk effects:
- unavailable required governance/evaluator/authority state -> DENY or require human;
- degraded cognitive/body state -> tighten control or reduce eligible autonomy according to explicit policy;
- low-risk deterministic read-only functions may remain available.

## Recommended next steps
1. Trace where endocrine/triage outputs influence planner/tool exposure today.
2. Trace AiOversight degraded behavior through every action surface.
3. Enumerate action surfaces not yet on Capability -> Control -> Clearance.
4. Define health-to-control mapping as a pure contract before wiring.
5. Define SAFE_MODE only as a composition of existing health/authority controls after proof.
