---
kind: ledger
gate: apps/server/src/core/config/doc-debt-ledger.spec.ts
writers: [burndown-cycle, truth-cycle]
---

# Documentation debt — prose known to be false

Docs whose claims are disproven by the tree. A row leaves when the doc is
fixed, archived, or deleted (the disposition says which). New stale docs found
by any cycle are ADDED here only via PR — a growing ledger is reviewed, a
shrinking one is not. Machine-read by the gate; keep the table exactly:
`| doc | false claim | disproving command | disposition |`.

| doc | false claim | disproving command | disposition |
|---|---|---|---|
| architecture/architecture-risks.md | R3/R21 tenant-isolation rows self-flagged stale by the doc's own warning banner (claims ~23% coverage; actual 87%) | `node scripts/os/ledger-sizes.mjs` → tenant partition 303/348 | fix |
| docs/CAPABILITY_MAP_2026-08-09.md | headline counts 245 tools / 439 models | `node scripts/os/count-flow-tools.mjs` (286); `grep -c '^model ' packages/db/prisma/schema.prisma` (440) | archive (dated analysis; add a superseded banner pointing at docs/architecture/capability-map/) |
