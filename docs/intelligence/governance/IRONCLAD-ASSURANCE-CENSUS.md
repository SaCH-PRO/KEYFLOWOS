# KEYFLOWOS Ironclad Assurance Census

Status: **CANONICAL WHOLE-SYSTEM GAP-DISCOVERY LAYER**  
Adopted: 2026-09-28  
Parent: `KEYFLOW-TRUST-ASSURANCE-PROGRAMME.md`  
Purpose: make unknown/unassessed system risk visible before production release  
Canonical execution packet count: **unchanged at 35**

## 1. Why this exists

KEYFLOWOS already has deep architecture, forensic traces, execution packets and proof gates. Those mechanisms are strong at proving a known semantic boundary once it has been selected.

They do not by themselves guarantee that every material failure class has been considered.

The Ironclad Assurance Census closes that gap.

Its core question is:

> Across every material way KEYFLOWOS can fail as a multi-tenant SaaS, AI system, data processor, payment-adjacent platform, integration hub and business operating system, do we have an owner, design, implementation path, proof and residual-risk disposition?

An **UNASSESSED** material domain is therefore a programme defect, not a neutral state.

## 2. State model

Every assurance domain has exactly one current state:

- **UNASSESSED** — no sufficient current characterization exists.
- **CHARACTERIZING** — evidence gathering is active; no implementation claim.
- **CHARACTERIZED** — present behavior/risk boundary is understood.
- **DESIGNED** — target control/invariant exists, but implementation is not yet proved.
- **IMPLEMENTED_NOT_PROVEN** — control exists in code/config but declared proof is incomplete.
- **PROVEN_AT_DECLARED_SCOPE** — required proof passed for the named scope/environment.
- **EXTERNALLY_VERIFIED** — independent qualified assessment exists for the named scope.
- **BLOCKED** — progress requires an unresolved dependency/decision.
- **NOT_APPLICABLE** — applicability was explicitly evaluated and evidence supports N/A.

No domain may move directly from UNASSESSED to PROVEN without characterization evidence.

## 3. Criticality

- **T0 / catastrophic:** compromise can create cross-tenant exposure, unauthorized material action, unrecoverable data/financial harm, broad credential compromise, or unsafe release.
- **T1 / critical:** major security/privacy/reliability/legal/business harm with bounded blast radius.
- **T2 / material:** substantial customer/business impact or assurance weakness.
- **T3 / quality:** important hardening, usability or operational maturity.

T0/T1 domains are release-blocking unless explicitly NOT_APPLICABLE with evidence.

## 4. Release law

Before production release authorization:

1. no T0/T1 domain may remain UNASSESSED;
2. no T0 domain may remain merely DESIGNED;
3. every T0 domain must be PROVEN_AT_DECLARED_SCOPE or EXTERNALLY_VERIFIED for the release scope;
4. every T1 domain must be at least PROVEN_AT_DECLARED_SCOPE unless a named risk acceptance has owner, rationale, expiry and compensating controls;
5. no UNKNOWN/SKIPPED proof may be represented as passing;
6. every catastrophic failure scenario must have a disposition:
   - PREVENTED,
   - DETECTED_AND_CONTAINED,
   - RECOVERABLE,
   - TRANSFERRED,
   - ACCEPTED_RESIDUAL_RISK,
   - NOT_APPLICABLE;
7. every accepted residual risk must have an owner and review/expiry condition.

This is additive to the existing 35-packet final completion contract.

## 5. Census families

The machine-readable matrix is:
`docs/intelligence/governance/IRONCLAD-ASSURANCE-MATRIX.yaml`

It covers:

1. identity/authentication/session security;
2. tenant isolation and authorization;
3. privileged/admin/support access;
4. action/approval/autonomy governance;
5. secrets/cryptography/key lifecycle;
6. application/API/input/file security;
7. webhook/queue/replay/concurrency safety;
8. integrations/OAuth/provider/subprocessor risk;
9. data inventory/minimization/residency;
10. privacy rights/retention/deletion/backup propagation;
11. AI prompt/context/tool/data governance;
12. payment/financial integrity;
13. logging/audit/evidence integrity;
14. vulnerability/supply-chain/CI-CD security;
15. infrastructure/network/DNS/environment hardening;
16. availability/performance/scaling/cost containment;
17. backup/restore/disaster recovery/business continuity;
18. incident detection/response/breach handling;
19. abuse/fraud/rate-limit/anti-automation defenses;
20. customer export/exit/data portability;
21. accessibility/browser/device/runtime integrity;
22. compliance/contract/subprocessor/insurance assurance.

## 6. Relationship to execution packets

The census does **not** create a second implementation roadmap.

For every census gap:

```text
gap
-> identify existing journey/kernel/packet owner
-> add characterization/proof obligation to that owner
-> implement through normal bounded packet sequencing
```

Only if no existing semantic owner can correctly own the risk may ChatGPT reopen architecture.

A new census finding is therefore not permission to skip dependency order.

## 7. Packet integration rule

Every active/future packet must answer:

- which census domains does this packet touch?
- does it improve, regress or leave them unchanged?
- what proof evidence changes their state?
- which catastrophic failure scenarios are exercised?
- are any new gaps discovered?
- are any previous proofs invalidated by substrate changes?

The packet return envelope should reference changed census IDs and failure-case IDs.

## 8. Catastrophic failure register

The machine-readable register is:
`docs/intelligence/governance/CATASTROPHIC-FAILURE-REGISTER.yaml`

The register is deliberately adversarial. Its purpose is not to predict that these failures will occur; it is to prevent the programme from discovering entire failure categories only after launch.

## 9. Continuous gap-hunt protocol

Run the assurance census at these points:

### A. Packet characterization
Check all touched domains and relevant catastrophic scenarios before edits.

### B. Packet admission
Update evidence/state only from accepted proof.

### C. Wave boundary
Search specifically for unowned or still-unassessed T0/T1 domains before releasing the next wave.

### D. Major architecture/product expansion
Re-run affected families when adding a new provider, payment flow, AI capability, public surface, regulated-data use or deployment architecture.

### E. Final whole-app acceptance
Reassess every census domain against final `main`; earlier proof is not automatically valid if its substrate changed.

### F. Post-launch
New incidents, near misses, vulnerability reports, provider changes and legal/regulatory applicability changes feed back into the census.

## 10. Proof quality law

A control is not PROVEN because:
- code exists;
- a unit test exists;
- CI is green;
- a UI says enabled;
- an architecture document describes the target.

Proof must match the claim.

Examples:

```text
tenant isolation claim
-> adversarial cross-tenant reads/writes/files/vector/action tests
```

```text
backup recovery claim
-> restore exercise with integrity and RPO/RTO evidence
```

```text
privacy deletion claim
-> active + derived + provider + retention + backup lifecycle evidence
```

```text
AI action safety claim
-> direct/tool/voice/conversation bypass attempts against current clearance
```

```text
payment idempotency claim
-> replay/concurrency/provider-unknown tests, not only happy-path unit tests
```

## 11. Independent assurance

Internal proof is necessary but not sufficient for every claim.

Before material GA/enterprise commitments, external assurance should include applicable:
- penetration testing;
- legal/privacy review;
- PCI scope/assessor input;
- cyber insurance underwriting;
- SOC 2 examination;
- ISO/IEC 27001 certification;
- specialist review for regulated healthcare or other regulated sectors.

External verification must always state scope/date; it is not permanent proof of future code.

## 12. Programme definition of "ironclad"

KEYFLOWOS must never claim to be impossible to compromise.

For this programme, **ironclad** means:

- no material system family is silently unassessed;
- every T0/T1 risk has a named owner and disposition;
- critical guarantees are adversarially proved;
- failures are designed to be contained/recoverable;
- security/privacy evidence survives implementation churn;
- newly discovered risk enters a controlled remediation path;
- production release is blocked by unknown critical assurance state.

That is the operating standard for the remainder of the KEYFLOWOS programme.
