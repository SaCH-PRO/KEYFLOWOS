# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-16

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation. Never delete or reuse an allocated identity.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F178 J16/K4 knowledge lineage
F179–F184 J17 operator-control lineage
F185–F196 J7 Financial Truth
F197–F205 J3/J4 commercial-to-cash
F206–F214 J10 Commerce/Fulfilment
F215–F218 J11 Contract/Obligation/Renewal
F219–F221 J12 Document/Evidence Lifecycle
F222–F227 J5 Conversation → Business Action lineage (F227 also opens J13 Connector Lifecycle pressure)
F228 J8 source-time-to-invoice allocation / K10 Financial Truth
```

```text
C096–C110 temporal/external/recovery lineage
C111–C128 J16/K4 contradictions
C129–C134 J17 contradictions
C135–C146 J7 contradictions
C147–C155 J3/J4 contradictions
C156–C164 J10 contradictions
C165–C168 J11 contradictions
C169–C171 J12 Document/Evidence Lifecycle
C172–C177 J5 Conversation → Business Action contradictions (C177 also opens J13 Connector Lifecycle pressure)
C178 J8 billed-entry completeness versus invoice-line allocation
```

Current recommendation range is through `KF-REC-057`.

## Mature recommendation anchors

```text
KF-REC-035 ingress occurrence direction
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
KF-REC-054 Commerce & Fulfilment Contract
KF-REC-055 Contract Integrity & Renewal Contract
KF-REC-056 Document Evidence & Revision Integrity Contract
KF-REC-057 Conversation Occurrence, Processing & Action Contract
```

## J10 Commerce / Fulfilment allocations

F206–F214 / C156–C164 are pooled under `KF-REC-054 — Commerce & Fulfilment Contract`.

## J11 Contract / Obligation / Renewal allocations

- F215 / C165 — incomplete/non-reconstructable authoritative Contract revision history.
- F216 / C166 — uncertain AI extraction can become authoritative Contract/renewal truth without promotion evidence.
- F217 / C167 — generic Contract edit/status presence can falsely discharge renewal work.
- F218 / C168 — Contract retention semantics do not constrain destructive delete.

Target: `KF-REC-055 — Contract Integrity & Renewal Contract`.

## J12 Document / Evidence Lifecycle allocations

- F219 / C169 — transient document extraction/raw-text assertion can be admitted directly as successful payment evidence without explicit consumer-specific evidence admission — `08AV` / `09AV`.
- F220 / C170 — Google Drive recognizes a newer source revision but canonical ingestion dedupes only by stable object identity, suppressing the new revision as the prior occurrence — `08AW` / `09AW`.
- F221 / C171 — mounted DocumentInstance hard delete can destroy version/approval/review evidence and detach surviving change history without a document-disposition decision — `08AX` / `09AX`.

## J12 target allocation

- `KF-REC-056 — Document Evidence & Revision Integrity Contract` — `10O`.
- J12 is provisionally converged / target-aligned, runtime proof not executed.

## J5 Conversation → Business Action allocations

- F222 / C172 — one external conversational occurrence can be processed under contradictory ownership/lifecycle semantics by KeyInbox, MessageIntake and ConversationalAI — `08AY` / `09AY`.
- F223 / C173 — model-supplied confidence can convert a human quick-confirm requirement into autonomous execution; model confidence is incorrectly accepted as control evidence — `08AZ` / `09AZ`.
- F224 / C174 — MessageIntake executes material child effects before resolving the pending human approval/authority that is supposed to authorize those effects — `08AZ` / `09AZ`.
- F225 / C175 — outbound conversational state collapses provider acceptance into `SENT` without canonical delivery/read/rejection reconciliation — `08BA` / `09BA`.
- F226 / C176 — the execution-capable Phone Voice WebSocket accepts query-declared tenant identity without observed stream-level authentication/trusted tenant resolution, even though the initial Twilio HTTP webhook is authenticated — `08BB` / `09BB`.
- F227 / C177 — connector `disconnected` state is not a load-bearing revocation boundary for external ingress; retained WhatsApp routing/config may continue admitting provider-authenticated occurrences after disconnect — `08BC` / `09BC`.

### J5 pooling

- `KF-REC-057 — Conversation Occurrence, Processing & Action Contract` — `10P`.
- Pre-pooling trace: `investigations/J5-CONVERSATION-PRE-POOLING-CONVERGENCE-TRACE.md`.
- Backward re-audit: `investigations/J5-J14-J15-J18-J13-J22-J2-J16-J17-CONVERSATION-ACTION-BACKWARD-REAUDIT.md`.
- Status: **PROVISIONALLY CONVERGED / TARGET-ALIGNED** through F222–F227 / C172–C177 / KF-REC-057.
- Reopen triggers: full J13 Connector Lifecycle dossier, full J22 KEY Voice dossier, runtime proof, or later contradictory implementation evidence.

KF-REC-057 owns only:

```text
ConversationOccurrence identity at the J5 boundary
ConversationProcessingPolicyDecision
consumer-specific occurrence/action claims
conversation action causal linkage
conversation-facing provider/delivery evidence vocabulary
reference to current channel/session binding generation
```

It explicitly delegates:

```text
generic ingress authenticity/dedup/replay/ack       → KF-REC-035 / J14
human authority / action governance / clearance      → J15 / K2 / K3
capability/state-transition mechanics                → K5 / K6
temporal primitives                                  → K7
generic evidence/outcome semantics                   → K8 / KF-CONCEPT-042
connector lifecycle/runtime                          → J13 / K9
recovery/idempotency/execution claims                → KF-REC-048 / J18 / K11
voice transport/session authentication               → J22 / K1 / K9
Business Graph / Genome resolution                   → KF-REC-049 / K4
operator attention                                   → KF-REC-051 / J17
```

Reuse decisions retained:

```text
legacy Meta aiHandled recurrence / second semantic representation → F222/C172
MessageIntake duplicate KeyInbox collision/orphan thread           → F222/C172 + J18/KF-REC-048 pressure
MessageIntake error items disappearing from reviewing queue        → J18/KF-REC-048 pressure; no new ID
Generalized Ingestion error-state service retry                    → favorable recovery seam, but UI/governance still inconsistent
Generalized Ingestion pending approval not resolved before effects → strengthens F224/C174
non-throwing child success:false followed by parent approved       → F152/KF-REC-048 manifestation; no new ID
provider accepted / local persistence failed                       → F159 + J18/KF-REC-048
provider rejection vs ambiguous transport outcome                  → F149
exact-action clearance / approval binding generally                → J15/K3 lineage unless conversation-specific mechanism proven
generic direct Flow reachability from voice                        → F043/F054; F226 is specifically the tenant-bearing realtime transport boundary
connector authentication/tenant routing valid after disconnect     → F227/C177 lifecycle-revocation root
key_inbox.action_executed emitted with no direct listener           → K8/KF-REC-048 pressure; insufficient for F228 without stronger causal break
```

The final line above is a preserved historical J5 allocation decision. It does not reserve F228 for that subject; the current J8 allocation below uses that formerly free ID for an independently established root.

## J8 source-time allocation allocation

Checkpoint: `J8-CSB-2026-09-16-01`.

- **F228 / C178** — `invoiceUnbilledTime` can overwrite a repeated alternate-rate group while marking every selected source entry billed. Billed ID count and reported source minutes therefore do not establish priced invoice-line allocation conservation.
- Finding home: `08BD-FINDING-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md`.
- Contradiction home: `09BD-CONTRADICTION-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md`.
- Primary kernel K10; primary journey J8; adjacent J7/J3/J18 and K6/K8/K11.
- Evidence: static code and exact numerical counterexample at `8f173bfe79f1418159cf4099ea18b0d60d203ec2`, first traced in J8 M002. Not a reproduced customer incident or executed application test.
- Comparison: `investigations/J8-COMPLETION-SCOPE-AND-BILLING-CONTRACT-REVIEW.md`, section 3. Compared actual financial F185–F196 definitions, commercial F200 lineage, F217/F219 boundaries and existing concept/recommendation ownership. `RELATED DISTINCT`; no second ledger or generic recovery engine.
- Target consumption: existing KF-REC-052/K10 financial truth and KF-REC-048/K11 recovery, with J8 WC/WB scope/allocation contract. **No KF-REC-058 or new concept allocated.**
- Other J8 completion/assignment/approval witnesses remain explicitly preserved in M001/M002/the review; no omnibus finding is allocated by analogy.

Earlier checkpoints saying F228/C178 were unallocated are historical state. Do not reuse them or regress current ranges from an older handoff.

## Current ranges

```text
Findings:         F001–F228
Contradictions:   C001–C178
Recommendations: KF-REC-001–KF-REC-057
```

Next free IDs:

```text
F229 / C179 / KF-REC-058
```

## Agent pre-allocation gate

```text
LOAD 04A + 04B
→ CHECK CURRENT ranges
→ SEARCH semantic equivalents
→ classify SAME / SPECIALIZATION / RELATED DISTINCT / ALIAS / HISTORICAL / GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate next unused ID
→ one canonical home definition
→ update 04B + CURRENT + HANDOFF + ROLLOVER
```

No production implementation is authorized by this ledger.


## J20 Plan / Subscription / AI Cost allocations

Checkpoint: `J20-CONV-2026-09-17-01`.

- **F229 / C179** — customer AI allowance and customer overage use different frozen billable populations.
- **F230 / C180** — AI allowance/overage/provider-budget windows use calendar month rather than the declared subscription-period identity.
- **F231 / C181** — direct ModelGateway/modality paths can bypass AiUsageService admission/metering while ModelGateway budget spend reads AiUsageLog instead of the complete provider-cost evidence population.
- Finding home: `08BE-FINDING-REGISTER-PLAN-SUBSCRIPTION-AI-METERING-SUPPLEMENT.md`.
- Contradiction home: `09BE-CONTRADICTION-REGISTER-PLAN-SUBSCRIPTION-AI-METERING-SUPPLEMENT.md`.
- Target: **KF-REC-058 — Subscription Entitlement, Metering & Cost Reconciliation Contract**, home `10Q-RECOMMENDATION-REGISTER-ENTITLEMENT-METERING-CONTINUATION.md`.
- Comparison: `investigations/J20-ENTITLEMENT-METERING-CONVERGENCE-REVIEW.md`.
- Evidence: fixed-baseline static source; no runtime billing incident or executed provider/model test claimed.

Current ranges after J20:

```text
Findings:         F001–F231
Contradictions:   C001–C181
Recommendations: KF-REC-001–KF-REC-058
```

Next free IDs:

```text
F232 / C182 / KF-REC-059
```


## J21 Public Customer Experience allocations

Checkpoint: `J21-CONV-2026-09-17-01`.

- F232 / C182 — PortalAccess business/contact co-membership is not established before bearer token issuance.
- F233 / C183 — public booking slot availability is not atomically owned across concurrent read-before-create requests.
- Recommendation: KF-REC-059 — Public Customer Boundary & Journey Receipt Contract.
- Homes: `08BF-...`, `09BF-...`, `10R-...`.
- Comparison owner: `J21-PUBLIC-CUSTOMER-EXPERIENCE-MICROTRACE-001.md`.

Current ranges: F233 / C183 / KF-REC-059. Next free F234 / C184 / KF-REC-060.


## J22 KEY Voice allocation

Checkpoint: J22-CONV-2026-09-17-01.

Anti-duplication review found no genuinely new finding/contradiction root beyond F226/C176, F224/C174, F222/C172, F225/C175 and F231/C181.

Allocated:
- KF-REC-060 — Voice Session & Modality Contract
- home: 10S-RECOMMENDATION-REGISTER-VOICE-SESSION-MODALITY-CONTINUATION.md
- evidence: KF-JOURNEY-022-KEY-VOICE.md and J22-KEY-VOICE-MICROTRACE-001.md

Canonical ranges after J22:
- findings through F233;
- contradictions through C183;
- recommendations through KF-REC-060.

Next free: F234 / C184 / KF-REC-061.
