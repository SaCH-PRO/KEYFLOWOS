# Book × GenAI Trace — Action Understanding / Human Feedback

Status: MICROSCOPIC TRACE COMPLETE / IMPLEMENTATION READY  
Authority: RESEARCH_ONLY  
Live base inspected: `main@ac3a6384417093f198bcc7d672b0dbc295db137c`

## Question

Can Norman-style discoverability/feedback be added without creating a second action state machine or letting the UI infer authority?

## Live canonical path

```
KeyActionProposalController
  -> KeyCortexApprovalOrchestratorService
  -> KeyActionProposalService
     -> KeyActionBoundaryService for adopted capabilities
        -> ControlRequirement / ControlEvidence / Clearance
        -> effect transaction
        -> outcomeEvidence
  -> KeyActionProposalData
  -> web key-autonomy API
  -> ProposalCard
```

Canonical truth already exists. The missing concept is a truthful projection.

## Server source record already carries

`KeyActionProposalData` includes:
- proposal identity and tenant;
- source and lineage;
- action type and payload;
- risk and lifecycle status;
- approval/rejection/execution identities and timestamps;
- execution result / failure reason;
- capability name + version;
- execution surface;
- action fingerprint;
- control requirement;
- evidence expiry;
- requester/proposer/executed-for;
- outcome evidence.

For an adopted capability, the action boundary further distinguishes:
- ControlRequirement: DENY | NONE | PRINCIPAL_CONFIRMATION | HUMAN_APPROVAL;
- ControlEvidence: CONFIRMATION | APPROVAL bound to fingerprint/principal/expiry;
- Clearance: exact current decision;
- outcomeEvidence written with the effect.

Therefore no new persistence model is justified.

## Web drift discovered

The web `KeyActionProposal` interface is behind the server contract.

It currently omits:
- capabilityName/version;
- executionSurface;
- actionFingerprint;
- controlRequirement;
- evidenceExpiresAt;
- requestedBy/proposedBy/executedFor;
- outcomeEvidence;
- several newer source types;
- `EXECUTE_TOOL`.

The UI therefore cannot faithfully explain the newer action-boundary semantics even though the server already returns them.

This is a contract-projection gap, not missing business state.

## Current UI ambiguity

`ProposalCard` primarily presents:
- PENDING / APPROVED / EXECUTED / REJECTED tabs;
- risk badge;
- generic approve/reject/execute/cancel buttons;
- raw payload/result JSON;
- a BLOCKED box whose copy says "blocked by KEY Genome readiness".

But BLOCKED may arise from autonomy/policy as well as Genome readiness. Generic status therefore does not fully communicate *why* execution is blocked.

Also:
- approval and principal confirmation are semantically distinct in the action boundary;
- EXECUTED and externally VERIFIED are not equivalent;
- outcomeEvidence may be stronger than executionResult, but the web contract ignores it.

## Canonical projection

Add a pure server-side projection derived from `KeyActionProposalData`:

`ActionUnderstandingProjection`

Minimum fields:

```ts
interface ActionUnderstandingProjection {
  phase:
    | 'PROPOSED'
    | 'AWAITING_CONFIRMATION'
    | 'AWAITING_APPROVAL'
    | 'DENIED'
    | 'CLEARED'
    | 'EXECUTING'
    | 'EXECUTED'
    | 'FAILED'
    | 'CANCELLED';

  authority: {
    requirement: 'NONE' | 'PRINCIPAL_CONFIRMATION' | 'HUMAN_APPROVAL' | 'DENY' | 'LEGACY_UNKNOWN';
    reason: string | null;
    evidenceState: 'NONE' | 'PRESENT' | 'EXPIRED_OR_STALE' | 'NOT_APPLICABLE';
  };

  effect: {
    capability: string | null;
    capabilityVersion: number | null;
    fingerprint: string | null;
    surface: string | null;
    materialSummary: string;
  };

  outcome: {
    state: 'NOT_ATTEMPTED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    verified: boolean;
    reason: string | null;
    entityRef: { type: string; id: string } | null;
  };

  reversibility: 'KNOWN_REVERSIBLE' | 'KNOWN_LIMITED' | 'UNKNOWN';
}
```

The exact names may change during implementation, but the semantic distinctions may not collapse.

## Critical derivation rules

1. `status === EXECUTED` may produce outcome SUCCEEDED only from canonical execution evidence; it does not automatically imply an independently verified external outcome.
2. If `outcomeEvidence.status` is FAILED, projection cannot say succeeded.
3. PENDING + ControlRequirement.PRINCIPAL_CONFIRMATION => AWAITING_CONFIRMATION.
4. PENDING + HUMAN_APPROVAL => AWAITING_APPROVAL.
5. DENY / BLOCKED must expose the stored/canonical reason, not generic Genome copy.
6. Legacy actions without boundary metadata use LEGACY_UNKNOWN rather than guessed modern semantics.
7. UI may format the projection; it may not recompute authority from risk level.
8. TrustExplanation may supplement "why recommended" but cannot determine action disposition.

## Smallest implementation write set

Server:
- `apps/server/src/modules/key-autonomy/key-action-proposal.types.ts`
  - projection type + optional/required projection on API data.
- new pure file under existing owner, proposed:
  `apps/server/src/modules/key-autonomy/action-understanding.projection.ts`
- focused pure projection spec.
- `apps/server/src/modules/key-autonomy/key-action-proposal.service.ts`
  - call projector from serialize; no new DB reads.

Web:
- `apps/web/src/lib/api/key-autonomy.ts`
  - synchronize the returned contract sufficiently to include the projection and current action/source values.
- `apps/web/src/app/app/key-autonomy/components/proposal-card.tsx`
  - render authority requirement, effect state and outcome truth from projection.
- focused component/contract tests if existing test convention supports them.

No schema migration.
No new controller endpoint.
No new service.
No new state machine.
No TrustExplanation ownership migration.

## Proof obligations

ACTU-P01 PENDING + principal confirmation displays confirmation, not approval.
ACTU-P02 PENDING + human approval displays approval.
ACTU-P03 DENY/BLOCKED reason comes from canonical control/failure evidence, never hardcoded Genome-only copy.
ACTU-P04 EXECUTED with no independently verified external outcome never displays "verified".
ACTU-P05 FAILED outcomeEvidence can never render success.
ACTU-P06 legacy row with missing boundary metadata remains LEGACY_UNKNOWN rather than inferred.
ACTU-P07 projection is a pure function of canonical proposal data and rebuilds identically.
ACTU-P08 tenant scoping remains entirely in existing controller/service reads.
ACTU-P09 UI change cannot alter approval/execution semantics.
ACTU-P10 mutation controls: force confirmation -> approval, or EXECUTED -> VERIFIED, and named projection tests fail.

## Stop conditions

- projection requires a new table;
- current canonical action state is insufficient and would require inventing truth;
- implementation starts changing clearance/admission semantics;
- implementation tries to derive authority from UI risk badges;
- active packet modifies the same server files and exact-head rebase changes the traced contract.

## Disposition

`KF-KEY-ACTION-UNDERSTANDING-001` is now IMPLEMENTATION_READY.

Release remains separate and must rebind to exact current main through the normal control plane.
