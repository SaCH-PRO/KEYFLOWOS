# Architecture Registries (Stage 0 — convergence plan)

Machine-readable maps of the platform as it exists in code. Regenerate with:

```bash
node scripts/architecture/generate-registries.js
```

Do not edit the YAML by hand — it's a build artifact. These files are the inputs
for Stage 1+ boundary rules and CI drift checks.

| File | Contents |
|---|---|
| `module-registry.yaml` | Every server module, its class, whether it's imported at root (`registeredInAppModule`) or via another module (`registeredVia`), service/controller counts. Candidates for removal: modules with neither. |
| `route-registry.yaml` | Every `/app/**` page route and whether it appears in the nav. |
| `event-registry.yaml` | Every emitted/subscribed event name with publisher/subscriber files. `published-only` events have no consumers (review: dead or intended external); `listened-only` events have listeners but no producer (review: stale listeners). |
| `capability-registry.yaml` | All FLOW_TOOLS with family, risk tier, risk level, manual route, changed entities — the seed for the platform Capability contract. |
| `data-ownership.yaml` | Every Prisma model and the module that references it most (approximate canonical owner), plus top consumers and unreferenced models. |
