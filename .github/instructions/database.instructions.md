---
applyTo: "packages/db/**,**/prisma/**,**/*.sql"
---

For database and Prisma changes:
- check tenant isolation, ownership relations, uniqueness, referential integrity, and soft-delete semantics;
- identify destructive or irreversible migrations and require explicit migration/backfill/rollback reasoning;
- review nullable/default changes for historical rows and partially migrated environments;
- check indexes and constraints for correctness before suggesting performance-only changes;
- look for N+1/query fan-out, unbounded scans, race-prone read-then-write logic, and missing transactions;
- verify schema changes are reflected in generated/client-facing types and all affected consumers;
- flag any migration or data mutation that assumes production authorization when none is recorded.
