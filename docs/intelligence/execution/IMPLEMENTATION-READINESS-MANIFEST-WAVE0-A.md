# KEYFLOWOS Implementation Readiness Manifest — Wave 0 + Wave A

Checkpoint: IRP-2026-09-17-01
Status: DRAFT PACKETS COMPLETE / PRODUCTION IMPLEMENTATION NOT AUTHORIZED

## Wave 0

1. KF-EXEC-K12-001 — Proof Admission & Isolation Substrate
2. existing KF-EXEC-EXTFX-001 — OutboundDelivery → Resend effect certainty slice

These establish trustworthy proof and falsify generic recovery/effect assumptions against one real provider effect.

## Wave A

3. KF-EXEC-TENANT-001 — Membership-First Tenant Genesis Compatibility
4. KF-EXEC-AUTH-001 — Effective Authority Resolver Foundation
5. KF-EXEC-ACTION-001 — Capability → Control → Clearance Boundary

Recommended dependency order:

K12-001
→ EXT FX slice can run in parallel with tenant characterization after proof substrate exists
→ TENANT-001
→ AUTH-001
→ ACTION-001 selected family
→ re-audit returned implementation evidence
→ only then issue broader Wave B/C packets.

## Claude Code handoff

For an authorized packet Claude must:
- load AGENTS.md + canonical continuity + packet;
- compare current main to the packet baseline;
- report source drift before edits;
- implement only bounded scope;
- return exact changed files/migrations/tests/results;
- report newly discovered consumers;
- stop on target contradiction.

## Kimi adversarial review

Kimi should challenge:
- missed writers/readers;
- migration ambiguity;
- concurrency windows;
- false proof;
- accidental authority expansion;
- compatibility/rollback assumptions;
- hidden direct execution paths.

Kimi's objections return to the architecture command center; they do not silently redefine the packet.

## Authorization boundary

These packets are ready to hand to coding agents after explicit implementation authorization.

Their existence means:
WE KNOW WHAT TO TRY AND HOW TO PROVE IT.

It does not mean:
PRODUCTION CODE MAY NOW BE CHANGED.
