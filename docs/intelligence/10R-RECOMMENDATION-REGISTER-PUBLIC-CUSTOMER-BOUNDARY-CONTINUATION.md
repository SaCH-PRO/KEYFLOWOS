# KeyFlowOS Recommendation Register — Public Customer Boundary Continuation

## KF-REC-059 — Establish a Public Customer Boundary & Journey Receipt Contract

**Primary journey:** J21 Public Customer Experience  
**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

### Objective

Compose existing domains so every public customer action has a trustworthy business/subject/purpose binding and a durable semantic occurrence/effect identity without creating a universal customer-session runtime.

Target:

```text
PublishedPublicResource
→ TrustedPublicContext
→ PublicIntentOccurrence or BearerDecisionGrant
→ current domain validation
→ StateTransition / exact Capability
→ semantic EffectIdentity
→ OutcomeEvidence
→ truthful customer projection
→ recovery/reconciliation
```

### Laws

1. Public business context derives from a trusted resource/grant.
2. A bearer grant binds one business, one subject, one purpose and validity envelope.
3. Bearer possession is not Membership identity.
4. Server recomputes material offer/price/availability at commit.
5. Reservation/booking ownership is atomic where concurrency can violate capacity.
6. One customer intent maps to one semantic commercial occurrence; retries preserve identity.
7. Partial composite journeys expose prior committed descendants and resume/reconcile them.
8. Customer-visible states do not outrun source financial/operational truth.
9. Portal visibility is not acceptance authority.
10. Public attribution/analytics is evidence, not authority.
11. Existing domain owners remain authoritative; no public super-state table is required.

### Reuse

- K1/K2/K3 for identity/authority where a decision grant is material;
- K6 for transitions;
- K7/K11 for occurrences/retry;
- K8 for evidence;
- K9/J14 for external/public boundary;
- KF-REC-052/053/054 for financial/commercial/commerce truth;
- KF-REC-058 for plan/entitlement admission.

### Migration/proof

Before implementation acceptance:

- repair/reject mixed PortalAccess tenant/contact rows;
- bind portal grant creation to same-business contact;
- choose database-safe booking overlap constraint/claim and clean historical overlap;
- bind checkout retry to existing order/effect identity;
- define duplicate form-submission policy;
- prove quote/payment token revocation/expiry/current-state behavior;
- prove public UI projection parity with canonical domain states;
- negative-control wrong-business/wrong-token/replay/concurrency cases.

No production implementation is authorized by KF-REC-059.
