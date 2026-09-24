# Canon Governance

Status: CANONICAL — v0.1

## Purpose

This document defines how KEYFLOWOS canonical documentation is created, interpreted, changed and trusted.

The canon exists to prevent four failure modes:

1. historical intent being mistaken for current implementation;
2. current implementation being mistaken for accepted architecture;
3. one agent's interpretation silently becoming system truth;
4. documentation drift becoming more authoritative than code or proof.

## Required status vocabulary

Use these labels in all canon volumes when a material statement can be mistaken for current truth:

- **[IMPLEMENTED]** — evidenced in the repository at a named revision.
- **[PROVEN]** — admitted by the forensic programme at a declared scope.
- **[TARGET]** — accepted direction not yet proven as current implementation.
- **[HISTORICAL]** — earlier strategy/design retained for intent and lineage.
- **[EXTERNAL]** — outside standard, law, research or platform contract.
- **[INFERENCE]** — reasoned synthesis, not direct evidence.
- **[OPEN]** — unresolved, contradictory or awaiting proof.
- **[DEPRECATED]** — superseded direction retained for traceability.

## Evidence rules

A canon claim is strongest when it can identify:

- repository/branch;
- commit or admitted checkpoint;
- exact code/document path;
- test/proof receipt where applicable;
- date or version for outside standards;
- unresolved limitations.

"Exists in code" is not the same as "works in production."
"Test source exists" is not the same as "test passes."
"Passes locally" is not the same as "admitted at scope."
"Approved proposal" is not the same as "portable execution clearance."
"Provider accepted request" is not the same as "business outcome occurred."

## Current-state precedence

For current behavior, use:

```text
reproduced/admitted proof
  > current code/schema/migrations
  > accepted intelligence decisions and handoff
  > generated system maps/audits
  > current strategy/product specifications
  > historical documents
  > assumptions
```

Conflicts must be recorded; lower-priority material must not be silently rewritten into agreement.

## Target-state precedence

For intended architecture, use:

```text
accepted architecture decision
  > accepted journey/kernel/packet convergence
  > current target specification
  > historical intent
```

Current code remains implementation evidence and the divergence must be visible.

## Canon change protocol

A material change should answer:

1. What changed?
2. Is the change about implementation truth, target architecture, vocabulary or external evidence?
3. What source or proof caused the change?
4. Which earlier statement is superseded?
5. Which journeys, kernels, execution packets or code surfaces are affected?
6. Does it imply implementation work?
7. Does it change production authorization? Default answer is **no** unless explicitly authorized elsewhere.

## Cross-agent operating rule

ChatGPT, Claude Code, Kimi Code and human contributors should:

- read `docs/canon/README.md` before relying on canon terminology;
- use `docs/intelligence/handoff/CURRENT-STATE.yaml` and `CURRENT-HANDOFF.md` for the active forensic/execution frontier;
- verify commit-sensitive implementation claims before coding;
- never use a historical doc to overwrite newer admitted evidence;
- preserve explicit uncertainty;
- write durable decisions back into the repository rather than depending on chat memory.

## Canon vs intelligence

`docs/intelligence/` remains the evidence-producing analytical/control system.

`docs/canon/` is the explanatory/reference system.

A useful analogy:

```text
intelligence programme = laboratory + proof ledger
canon                  = accepted textbook + reference architecture
repository code         = current machine
production runtime      = operational reality
```

None of these is a substitute for the others.

## No silent rebaseline

Creating or editing canon files does not alter:

- the forensic baseline;
- current admitted implementation revisions;
- execution packet status;
- production release authority;
- production mutation authority.

Those controls remain owned by the intelligence/control programme.

## Versioning

Canon documents should carry status/version language at the top.

Major semantic changes should be accompanied by:

- a decision record or accepted architecture evidence;
- changed source-traceability references;
- an explicit supersession note when terminology changes.

The long-term target is machine-verifiable traceability from canon assertions to code, tests, proof receipts and external standards.
