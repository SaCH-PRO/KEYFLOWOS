# J23 Cancellation / Supersession — Open Trace

Status: OPEN / SEARCH-SCOPED / NOT YET CANONICAL FINDING
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

## Question

Can durable work that was valid when scheduled be reliably stopped before a future attempt/effect when business intent, authority, policy or underlying state changes?

## Evidence so far

Scoped search did not find a general `AiPlan` cancellation path coupled to removal/suppression of already-enqueued `ai-plan-steps` BullMQ jobs.

Scoped search also did not find a FlowRun cancellation primitive.

`MorningBriefingService.skipBriefing()` marks the plan `completed` and steps `skipped`; this is a product-specific skip path, not evidence of a canonical cancellation contract.

Domain entities such as Booking support cancellation, but domain-state cancellation is not the same as cancellation of already-scheduled workflow/action attempts.

No `planQueue.remove(...)` / plan-step cancellation path was observed in the scoped queue search.

## Why this is not yet F141

Absence from scoped search does not prove system-wide absence. Before classification, trace:

1. AI plan controller/service mutation routes;
2. ActionDispatcher cancellation/undo semantics;
3. approval rejection paths and whether they invalidate queued work;
4. queue job removal APIs in any other service;
5. ScheduledAgentJob cancellation/delete/update routes;
6. campaign and message unscheduling routes;
7. DelegationLoop disable behavior for already-created runs/approvals;
8. cancellation after worker claim but before effect;
9. cancellation after ambiguous provider effect (`OUTCOME_UNKNOWN`).

## Target law under test

```text
CANCEL / REVOKE / SUPERSEDE
→ durable logical work state changes
→ no new worker/execution claim admitted
→ queued/delayed transport work withdrawn or made harmless
→ active effect handled by explicit cancellation/reconciliation semantics
→ history preserved
```

Cancellation must not mean deleting evidence.

No production implementation is authorized by this note.
