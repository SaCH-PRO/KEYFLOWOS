# KF-EXEC-ACTION-001 — Capability → Control → Clearance Boundary

Status: DRAFT / NO IMPLEMENTATION AUTHORIZATION
Primary kernels: K3, K5, K6, K11
Primary journeys: J2, J15, J6; consumers include J5/J22
Baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2

## Objective

Make one bounded action family prove the accepted chain:

real CapabilityContract
→ immutable material ActionEnvelope
→ effective authority + KEY autonomy/readiness/policy
→ ControlRequirement
→ ControlEvidence if needed
→ current Clearance
→ atomic ExecutionClaim
→ domain/provider effect
→ OutcomeEvidence.

This packet is the foundation for later family-by-family adoption, not an instruction to migrate every tool at once.

## Current seams

- apps/server/src/modules/capabilities/capability-contract.service.ts
- apps/server/src/modules/ai/ai-oversight.service.ts
- autonomy orchestrator
- KeyActionProposal / AiApprovalItem / ApprovalRequest / plan approval
- apps/server/src/modules/ai/action-dispatcher.service.ts
- FlowOrchestrator / direct executeToolByName path
- execution logs/idempotency services.

## Accepted invariants

1. underlying business capability identity cannot be replaced by generic EXECUTE_TOOL wrapper identity;
2. material parameters are bound into the action fingerprint;
3. human authority and KEY autonomy are separate inputs;
4. risk tier is not control requirement;
5. approval/confirmation is evidence, not Clearance;
6. material mutation/authority/policy invalidation forces reevaluation;
7. Clearance is exact, current, bounded and expiring/revocable where required;
8. ExecutionClaim is atomic and distinct from Clearance;
9. provider/domain outcome is distinct from execution claim;
10. direct conversation/voice/proactive surfaces cannot bypass the same boundary.

## Bounded first adoption family

Select one non-financial, non-destructive action family with:
- real live reachability;
- existing CapabilityContract;
- current governance path;
- deterministic domain proof;
- no provider side effect if possible.

The implementer must propose the exact family after revalidating current main and report why it is representative. Architecture must accept that family before broad expansion.

The existing external-effect KF-EXEC-EXTFX-001 remains the separate provider uncertainty falsification slice.

## Prohibited shortcuts

- no CapabilityRegistry2;
- no wrapper risk standing in for real tool risk;
- no client resubmission as immutable approval binding;
- no approval boolean detached from server action identity;
- no read-then-write execution claim where concurrent executors matter;
- no direct Flow voice/chat exception;
- no “approved” UI label treated as current executable authority.

## Migration

1. characterize exact selected family entry points;
2. canonical CapabilityContract adapter;
3. construct ActionEnvelope/fingerprint;
4. shadow governance decision vs current path;
5. create/consume ControlEvidence where required;
6. final Clearance immediately before claim/effect;
7. atomic ExecutionClaim;
8. emit outcome/evidence;
9. route selected direct surfaces through boundary;
10. compare and withdraw legacy decision path for that family.

## Acceptance proof

- wrapper cannot downgrade underlying capability;
- changed parameter invalidates old control evidence;
- approver demotion/revocation before execution rejects stale Clearance;
- policy tighten before execution reevaluates;
- simultaneous executors produce one claim/effect;
- direct Flow/voice call uses the same exact capability;
- success requires domain/provider outcome evidence appropriate to family;
- failed/unknown outcome remains recoverable under K11;
- audit trace preserves requestedBy/proposedBy/approvedBy/executedFor/executedBy as applicable.

## Non-goals

Full workflow-engine rewrite, all-capability migration, provider refunds/payments and public voice stream authentication.
