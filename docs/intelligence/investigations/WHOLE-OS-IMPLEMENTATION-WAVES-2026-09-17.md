# KEYFLOWOS Implementation Waves

Status: DRAFT EXECUTION PROGRAMME / NO PRODUCTION AUTHORIZATION
Derived from WOC-2026-09-17-01.

## Wave 0 — proof substrate + bounded falsification slice

First, make verification trustworthy and prove one real external-effect slice.

Reuse the existing J23/J18 readiness decision:
OutboundDelivery → Resend email only is the preferred bounded external-effect falsification slice because it stresses effect identity, attempt ownership, provider idempotency, crash uncertainty and consequence repair without starting with money.

This is not the universal architecture. It proves which K11/K8/K9 properties survive implementation.

## Wave A — identity / authority / governed action foundations

Packets:
A1 Tenant Genesis / Membership-first compatibility
A2 Effective Authority Resolver
A3 grantability/delegation/revocation
A4 CapabilityContract adoption for selected action families
A5 ControlEvidence/Clearance/action fingerprint
A6 execution claim at selected effect boundaries

Success means later feature waves can consume one authority/action contract.

## Wave B — temporal / ingress / connector / recovery

Packets:
B1 WorkOccurrence semantics for selected existing fabrics
B2 webhook occurrence processing lifecycle
B3 connector lifecycle grant-generation fencing
B4 cancellation/supersession/waits
B5 recovery/reconciliation operator projection
B6 conversation occurrence/claim adoption
B7 Playbook library/versioning/Flow Marketplace

## Wave C — commercial / finance / subscription

Packets:
C1 commercial lifecycle/value-stage adapters
C2 booking obligation/deposit/final settlement
C3 ledger/cash/valuation convergence
C4 work/contract/document billing/acceptance
C5 commerce order/fulfilment effect identity
C6 subscription entitlement/metering/provider-cost reconciliation
C7 Growth Engine foundation: campaign/creative/audience/organic/email/SEO/attribution/paid-media control plane

## Wave D — knowledge / Command Center / public / voice / privacy

Packets:
D1 KnowledgeRevision + Blueprint/Genome materialization
D2 correction/withdrawal/learning eligibility
D3 Command Center completeness/priority projection
D4 public customer boundary, portal grant, booking concurrency
D4b KeyFlow Space + events + registration + ticketing
D4c KeyFlow Network + Index + map + B2B sourcing/orchestration
D5 voice session/transport/action/metering
D6 privacy/derived-state deletion and retention
D7 frontend projection convergence
D8 Studio/Cockpit/Flow Feed/Flow Graph/onboarding/virality experience convergence
D9 Growth Engine optimization/autopilot: experiments, budget/channel/creative reallocation, Growth Cockpit

## Wave E — withdrawal + integrated release proof

Packets:
E1 legacy writer shutdown by domain
E2 compatibility reader retirement
E3 migration reconciliation
E4 integrated end-to-end proof
E5 performance/operability
E6 controlled canary/release after authorization

## Multi-agent operating split

ChatGPT / architecture command center:
- maintains canonical target;
- issues bounded packets;
- reviews returned evidence;
- reopens architecture when falsified.

Claude Code:
- primary bounded implementer;
- reports discovered consumers/deviations;
- returns exact tests/results/diff.

Kimi Code:
- adversarial review;
- edge-case/large-context scan;
- challenge migration/proof completeness.

No coding agent may redefine kernel ownership or weaken a proof gate to fit its implementation.
