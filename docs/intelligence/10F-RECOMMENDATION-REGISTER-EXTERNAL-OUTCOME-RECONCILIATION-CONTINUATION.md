# KeyFlowOS Recommendation Register — External Outcome Reconciliation Continuation

Status: CANONICAL CONTINUATION OF `10D-RECOMMENDATION-REGISTER-WORKFLOW-DEFINITION-CONTROL-CONTINUATION.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical recommendation sequence continues after KF-REC-047.

Note: the draft `10E-RECOMMENDATION-REGISTER-MISFIRE-POLICY-CONTINUATION.md` was removed because it duplicated the pre-existing canonical KF-REC-045 missed-schedule recommendation. Git history preserves the superseded draft.

---

## KF-REC-048 — Make `OUTCOME_UNKNOWN` and provider reconciliation first-class external-effect semantics

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K9 Integration & External Reality, K11 Recovery & Reliability

A local transport error after a state-changing provider request is not proof that the provider did nothing.

Target effect lifecycle:

```text
ExecutionClaim
→ ProviderAttempt
   ├─ rejected-before-effect → RETRYABLE_FAILED / FAILED_FINAL
   ├─ provider accepted      → AWAITING_EXTERNAL
   ├─ final success receipt  → SUCCEEDED
   ├─ final failure receipt  → FAILED_FINAL
   └─ acknowledgement lost   → OUTCOME_UNKNOWN
                               ↓
                         reconciliation
```

### Required properties

```text
stable logical effect identity
provider-specific request/receipt identity where available
attempt identity
provider lifecycle state
last evidence timestamp
reconciliation method
retry-safety classification
terminal OutcomeEvidence
```

### Reconciliation mechanisms may include

- provider status callback/webhook;
- provider resource lookup/polling by receipt ID;
- provider history/search with stable application correlation where supported;
- domain ledger/reconciliation evidence;
- human/operator verification for effects that cannot be queried safely.

### Retry rule

```text
DEFINITE FAILURE + retry-safe policy
→ retry same logical effect

OUTCOME_UNKNOWN
→ reconcile first
→ do not create a fresh effect identity merely because local transport failed
```

This complements KF-REC-027 ExecutionClaim and KF-REC-044 durable causal/effect identity across handoffs.

### Product projection

Internal sophistication need not burden the user. Typical states can remain:

```text
Sending…
Sent to provider
Delivered
Failed
Checking status…
Needs verification
```

But product state must never confidently say `Failed` or `Cancelled` when the external effect is genuinely unknown.

### Reference properties

Twilio's outbound status callbacks / message-status lookup and periodic reconciliation guidance are useful reference behavior. Google guidance on safe retry of state-changing/non-idempotent requests supports separating ambiguous outcome from ordinary failure.

Affected journeys: J5, J6, J9, J10, J13, J14, J18, J23.

No production implementation is authorized by this continuation.
