# Contradiction Register Supplement — J12 Document Evidence Promotion Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED

## C169 — Payment-evidence semantics imply qualifying evidence while the reachable path accepts an unverified transient document assertion as a successful payment

### Contradiction

The product/domain shape presents document-derived payment evidence as evidence that can justify a successful payment and stronger Invoice/financial truth. The reachable implementation, however, allows a transient extraction or raw-text fallback assertion — including an explicitly low-confidence fallback — to flow directly into `CommerceService.recordPayment()` without an observed evidence-admission decision that proves the assertion is sufficiently strong for that consumer and claimed state.

```text
semantic expectation:
qualifying PaymentCompletionEvidence
→ Payment SUCCESSFUL
→ Invoice/financial truth

reachable path:
transient/low-confidence document assertion
→ no observed admission/verification gate
→ Payment SUCCESSFUL
→ Invoice/financial truth
```

The system therefore treats the existence of extracted payment-like fields as though the evidence qualification step had already occurred, while no durable boundary decision has been observed.

### Why this is not merely a financial-truth contradiction

J7/KF-REC-052 owns what a financial claim means and how strong its evidence must be. C169 concerns the earlier J12/K8 boundary where a document assertion is admitted as the evidence object that downstream financial logic consumes.

### Why this is not merely a knowledge-provenance contradiction

K4/KF-REC-049 owns generic provenance, revision and consumer-specific epistemic eligibility. C169 is the concrete cross-domain contradiction where that missing qualification allows an assertion to cross into payment-completion evidence and trigger durable financial effects.

### Canonical pairing

- Finding: `F219`
- Contradiction: `C169`
- Journey: `KF-JOURNEY-012 — Document / Evidence Lifecycle`
- Primary kernel: K8 Evidence & Outcome
- Delegations: KF-REC-049 epistemics/provenance; KF-REC-052 financial claim strength; KF-REC-048 replay/effect identity

No runtime proof was executed in this forensic pass.
