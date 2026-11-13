# KeyFlowOS Finding Register — Command Queue Visibility Supplement

Status: CANONICAL CONTINUATION — J17 OPERATOR CONTROL / VISIBILITY
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F183 — Command Center status filters operate over an OPEN-only server result, making most advertised queue states unreachable in the main queue

**Status:** VERIFIED END-TO-END UI/API FINDING

`/app/command-center/page.tsx` loads the persistent queue as:

```text
fetchCommandItems(businessId, {
  status: 'OPEN',
  limit: 50
})
```

and stores only that response in `commandItems`.

`CommandQueueV2` then presents client-side status filters:

```text
ALL
OPEN
IN_PROGRESS
WAITING_APPROVAL
SNOOZED
COMPLETED
DISMISSED
```

but filters only the already-fetched `items` array.

Therefore:

```text
server dataset = OPEN only
→ client chooses SNOOZED / COMPLETED / WAITING_APPROVAL / ...
→ filter searches OPEN-only rows
→ empty result by construction
```

`ALL` / `Any status` is also semantically misleading because it means “all rows in the OPEN-only fetch,” not all queue statuses.

### Lifecycle consequence

Several visible queue actions move rows out of OPEN:

- snooze → `SNOOZED`;
- complete → `COMPLETED`;
- dismiss → `DISMISSED`;
- approve/execute currently → `EXECUTED`.

After the action, `loadQueue()` re-fetches `status='OPEN'`, so the row disappears from the main queue and the advertised status filters cannot retrieve it there.

This obscures operator history and makes it harder to distinguish:

```text
resolved
vs snoozed
vs dismissed
vs falsely terminalized
vs absent because never loaded
```

### Canonical distinction

```text
CLIENT FILTER VOCABULARY
!= SERVER QUERY SCOPE
```

and:

```text
ANY STATUS
!= OPEN-ONLY DATASET
```

### Why this is distinct

- F179 concerns source-health incompleteness in synthesized snapshot aggregation.
- F180 concerns false terminal execution semantics.
- F182 concerns source-state convergence of persistent work.
- F183 concerns operator visibility/retrievability across the CommandItem lifecycle.

Affected kernels: K7, K8, K11.
Affected journeys: J17, J18, J23.

---

## Target pressure

The operator queue contract should make query scope explicit and server-backed:

```text
selected status/category/time/ownership scope
→ server query
→ page/result metadata says what was included
→ client may locally refine only within that declared scope
```

If the main Command Center intentionally shows only active work, remove non-active filters from that view and provide a separate history/disposition surface. Do not present filters that cannot retrieve their states.

No production implementation is authorized by this finding.
