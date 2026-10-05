# Architecture Registries (Stage 0 — convergence plan)

Machine-readable maps of the platform as it exists in code. Regenerate with:

```bash
node scripts/architecture/generate-registries.js
```

Do not edit generated registry YAML by hand — it is build output. These files are inputs
for boundary rules, drift checks, and the Living System Atlas.

| File | Contents |
|---|---|
| `module-registry.yaml` | Every server module, its class, whether it's imported at root (`registeredInAppModule`) or via another module (`registeredVia`), service/controller counts. Candidates for removal: modules with neither. |
| `route-registry.yaml` | Every `/app/**` page route and whether it appears in the nav. |
| `event-registry.yaml` | Every emitted/subscribed event name with publisher/subscriber files. `published-only` events have no consumers (review: dead or intended external); `listened-only` events have listeners but no producer (review: stale listeners). |
| `capability-registry.yaml` | All FLOW_TOOLS with family, risk tier, risk level, manual route, changed entities — the seed for the platform Capability contract. |
| `data-ownership.yaml` | Every Prisma model and the module that references it most (approximate ownership evidence), plus top consumers and unreferenced models. |

## Living System Atlas

`architecture/atlas/` is the semantic navigation layer over the existing architecture memory.

Start with:

- `architecture/atlas/README.md` — authority rules, atlas layers, master maps and execution/development models.
- `architecture/atlas/atlas.yaml` — machine-readable atlas manifest.
- `architecture/atlas/MISSION-CONTROL-INTEGRATION.md` — convergence contract between the Atlas and the existing owner/admin Mission Control surface.

The atlas is an **overlay, not a replacement source of truth**. It links business outcomes,
journeys, kernels, KEY cognition, runtime execution, repository implementation, development
control and evidence. Generated ownership remains approximate until semantic ownership is
reviewed. Runtime edges remain unproven until supported by reachable execution evidence.
