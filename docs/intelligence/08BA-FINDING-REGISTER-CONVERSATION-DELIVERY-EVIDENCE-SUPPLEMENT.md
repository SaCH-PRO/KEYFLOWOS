# KeyFlowOS Finding Register — Conversation Delivery Evidence Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after F224.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.
Production implementation remains READ-ONLY / UNAUTHORIZED.
Runtime proof has NOT been executed.

Canonical sequence continues after F224.

---

## F225 — outbound conversational state collapses provider acceptance into `SENT` without a canonical delivery/read/rejection reconciliation lifecycle

**Status:** VERIFIED CODE-LEVEL / EVIDENCE-SEMANTIC FINDING

### WhatsApp

`WhatsAppService.sendViaTwilio()` returns `success:true` when Twilio accepts the HTTP request and may return a provider SID.

`WhatsAppService.sendViaMeta()` returns `success:true` when the Meta messages endpoint accepts the request and may return a WAMID.

Both `sendMessage()` and `deliverRow()` immediately persist the local row as:

```text
status = SENT
sentAt = now
wamid = provider message id
```

The inspected WhatsApp webhook DTO/parser recognizes inbound `messages[]` but not Meta delivery `statuses[]`. Repository-wide search found no Twilio `MessageStatus` / `SmsStatus` / `statusCallback` consumer. Therefore the observed conversation state does not advance from provider acceptance through provider delivery/read/failure callbacks.

### Gmail / KeyInbox

`GmailService.sendEmail()` returns a Gmail message ID after the Gmail send API accepts the request. `KeyInboxReplySenderService` persists that happy-path result as `sendStatus=SENT` with `providerMessageId`.

Repository search found no Gmail watch/history/pubsub delivery/bounce reconciliation path feeding KeyInbox message state. The KeyInbox client vocabulary is currently:

```text
DRAFT | QUEUED | SENT | FAILED | NOT_SUPPORTED
```

and does not represent provider-accepted versus delivered/read/bounced separately.

### Why this is distinct from existing roots

- F090 concerns local execution/sent evidence being recorded when no external provider send occurred.
- F099/F100 concern external-effect ownership / queued replay concurrency.
- F149 concerns provider rejection versus ambiguous transport failure.
- F159 concerns provider success followed by local persistence failure authorizing duplicate retry.

F225 concerns a different boundary: **even on the normal happy path, the durable conversational evidence model stops at provider acceptance while the product-facing state says `SENT`, with no canonical downstream delivery/read/rejection reconciliation in the inspected channels.**

### Target law

```text
OUTBOUND MESSAGE INTENT
→ EFFECT CLAIM
→ SEND ATTEMPT
→ PROVIDER_ACCEPTED(providerMessageId)
→ DELIVERY STATUS OCCURRENCES
   - DELIVERED, when provider proves it
   - READ, when provider proves it
   - BOUNCED / REJECTED / UNDELIVERABLE, when provider proves it
   - UNKNOWN, when certainty is lost
→ BUSINESS RESPONSE / BUSINESS OUTCOME remains distinct
```

Provider IDs should bind status callbacks to the canonical outbound message/effect identity. UI vocabulary must reflect the strongest evidence actually held rather than collapsing provider acceptance into a stronger delivery implication.

Affected kernels: K8 Evidence & Outcome, K9 Integration & External Reality, K11 Recovery & Reliability.
Affected journeys: J5, J13, J18, J22.

Related contradiction: C175.

No production implementation is authorized by this supplement.
