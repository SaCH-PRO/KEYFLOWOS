# KeyFlowOS Contradiction Register — Command Queue Visibility Supplement

Status: CANONICAL CONTINUATION — J17 OPERATOR CONTROL / VISIBILITY
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C133 — multi-status Command Queue controls vs OPEN-only loaded dataset

**Status:** VERIFIED ACTIVE CONTRADICTION

The main Command Center UI advertises a status vocabulary including:

```text
ANY / OPEN / IN_PROGRESS / WAITING_APPROVAL / SNOOZED / COMPLETED / DISMISSED
```

while the page fetches only:

```text
CommandItem.status = OPEN
```

before those client-side filters execute.

The contradiction is:

```text
UI SAYS THESE STATES ARE BROWSABLE HERE
vs
API QUERY HAS ALREADY EXCLUDED THEM
```

A row that leaves OPEN after snooze, complete, dismiss, approve or execute disappears from the loaded queue, so the same view cannot reliably explain what happened to it.

### Target resolution

Either:

1. make filter selection drive the server query with explicit scope metadata; or
2. declare the main queue active-only and move lifecycle/history states to a separate history surface.

Do not retain a client filter vocabulary broader than the dataset it can retrieve.

Affected kernels: K7, K8, K11.
Affected journeys: J17, J18, J23.

No production implementation is authorized by this contradiction.
