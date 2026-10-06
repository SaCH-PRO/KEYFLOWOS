# Book × GenAI Trace — Cognitive Routing Honesty

Status: MICROSCOPIC TRACE COMPLETE / IMPLEMENTATION READY  
Authority: RESEARCH_ONLY  
Live base inspected: `main@ac3a6384417093f198bcc7d672b0dbc295db137c`

## Canonical owner

`apps/server/src/modules/key-cortex/cognitive-triage.service.ts`

Existing live tiers:
- reflex
- standard
- deliberate

The service already:
- makes no model call to choose effort;
- uses deterministic/pure classification;
- falls back to standard on triage failure;
- keeps `tool-calling` across tiers;
- explicitly whitelists reflex greetings/sign-offs;
- documents and protects against the historical false-reflex class such as:
  - "ok delete that contact"
  - "ok cancel the booking"
  - terse confirmation words that may authorize prior actions.

Therefore the research does not justify a second router.

## Existing strength

The code already encodes an important law discovered by the book × GenAI convergence:

> linguistic simplicity is not semantic safety.

A bare confirmation is intentionally excluded from reflex because its meaning depends on prior conversational state.

## Remaining research-derived gap

Current effort scoring is mostly based on:
- complexity;
- data requirement;
- time horizon;
- urgency;
- emotional weight;
- attachment presence;
- optional standing "body" state.

It does not yet expose a canonical, deterministic input for **effect materiality / authority uncertainty / evidence conflict**.

The next packet should not attempt to make regex infer all business risk.

It should add a small explicit routing context supplied by callers that already know whether the turn is effect-bearing or authority-sensitive.

## Minimal contract

Proposed optional input:

```ts
interface CognitiveRiskContext {
  effectIntent:
    | 'NONE'
    | 'REVERSIBLE'
    | 'MATERIAL'
    | 'DESTRUCTIVE_OR_PERMISSION';
  pendingControl:
    | 'NONE'
    | 'CONFIRMATION'
    | 'APPROVAL'
    | 'DENIED_OR_UNRESOLVED';
  evidenceState:
    | 'SUFFICIENT'
    | 'INCOMPLETE'
    | 'CONTRADICTORY'
    | 'UNKNOWN';
}
```

Names may change. Semantics may not collapse.

The input is advisory for **effort tier only**.
It grants zero execution authority.

## Routing floors

- any pending confirmation/approval => not reflex;
- DENIED_OR_UNRESOLVED => not reflex and may force deliberate if user asks for consequential continuation;
- MATERIAL or DESTRUCTIVE_OR_PERMISSION => at least standard;
- material + incomplete/contradictory evidence => deliberate;
- NONE + ordinary greeting may remain reflex.

The route should still be bounded and cheap.

## Caller seam

Do not make `CognitiveTriageService` query databases or AutonomyOrchestrator.

The caller should pass risk context only when it already possesses canonical metadata.

If a live caller cannot provide reliable metadata without broad coupling, the packet should implement the type + local floors only at the first safe call site, then expand later.

## Exact first write-set hypothesis

Primary:
- `apps/server/src/modules/key-cortex/cognitive-triage.service.ts`
- existing/focused `cognitive-triage.service.spec.ts` or nearest current spec

Caller:
- `apps/server/src/modules/ai/flow-orchestrator.service.ts`, the recovered live call site invoking `triage(businessId, message, Boolean(attachments?.length))`.
- exact release-base search must still confirm no new caller exists before release.

No schema.
No new service.
No ModelGateway redesign.
No AutonomyOrchestrator change.
No second triage engine.

## Proof obligations

COG-LIVE-P01 "hi" with no risk remains reflex.
COG-LIVE-P02 "delete it" with destructive risk context is never reflex.
COG-LIVE-P03 bare "yes" with pending confirmation is never reflex.
COG-LIVE-P04 material + contradictory evidence reaches deliberate floor.
COG-LIVE-P05 routing-context absence preserves today's tested behavior.
COG-LIVE-P06 triage exception still falls back to standard.
COG-LIVE-P07 risk context changes effort tier only; no authority/execution field is produced.
COG-LIVE-P08 tool-calling category is preserved unless a separately authorized routing packet changes it.
COG-LIVE-P09 no extra model call is added to choose effort.
COG-LIVE-P10 mutation control: remove confirmation/destructive floor and protected test fails.

## Interaction with AUTH-FAIL-CLOSED

This packet does not repair authority.

It assumes authority/effect systems remain independent and fail closed. A deliberate answer cannot grant an action permission.

## Disposition

`KF-COG-ROUTING-HONESTY-001` is IMPLEMENTATION_READY pending exact release-base caller search and write-set collision check.
