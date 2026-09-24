---
applyTo: "apps/server/**/*.ts,packages/api/**/*.ts,packages/shared/**/*.ts"
---

For backend/server changes:
- verify tenant scoping on every read/write path that touches tenant-owned data;
- inspect authentication and authorization separately; authenticated does not imply authorized;
- check DTO/input validation, unsafe defaults, and privilege escalation paths;
- review database writes for transaction boundaries, partial failure, duplicate side effects, and retry safety;
- check event emission for ordering, duplication, and consistency with committed state;
- inspect exception handling for swallowed failures or accidental information disclosure;
- flag API contract changes that can break web, workers, or integrations;
- prefer tests that prove denial paths and cross-tenant isolation, not only happy paths.
