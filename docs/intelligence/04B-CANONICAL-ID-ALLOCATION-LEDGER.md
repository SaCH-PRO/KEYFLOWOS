# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-10

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

## Current ranges

```text
Findings:         F001–F227
Contradictions:   C001–C177
Recommendations: KF-REC-001–KF-REC-057
```

Next free IDs:

```text
F228 / C178 / KF-REC-058
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
