# C3 — Capability Ownership Audit

Status: RESEARCH_ONLY
Programme: KIGP-001
Audit date: 2026-10-06

## Question
Which registry/contract actually owns executable capability identity, and where are duplicate registries still live?

## Observed repository reality
- `FLOW_TOOLS` is documented and tested as the canonical catalogue of executable tools; generated architecture capability inventory derives from it.
- `CapabilityContractService` projects canonical tool definitions into semantic capability definitions and is used by the action boundary.
- `KeyCortexToolRegistryService` is a cortex runtime execution/gating registry. The efferent bridge mirrors canonical flow tools into it; organ adapters can also register cortex-side capabilities.
- `KeyToolRegistryService` remains a separate AI-module registry with hand-registered tools and is still reachable as a `KeyCommandService` fallback.

## Findings
### C3-F1 — semantic execution catalogue is converging on FLOW_TOOLS
Disposition: ADOPT EXISTING OWNER.

### C3-F2 — CapabilityContractService is the semantic projection, not a second catalogue
Disposition: ADOPT AS CONTRACT PROJECTION.

### C3-F3 — cortex registry is a runtime projection/gate
Disposition: SPECIALIZATION / RUNTIME PROJECTION.

### C3-F4 — KeyToolRegistryService is genuine duplicate/legacy risk
Disposition: DUPLICATE_RISK / MIGRATION TARGET. Do not add another Capability Fabric registry until this path is reconciled.

### C3-F5 — capability identity and execution implementation are already separable
Disposition: confirms the KIGP law: Capability != implementation.

### C3-F6 — advanced Capability Fabric semantics should attach to the canonical contract
Compatibility, genealogy, derivation, synthesis, health and outcome-history are not proven canonical today.
Disposition: FUTURE EXTENSION only after registry convergence.

## Canonical target shape
FLOW_TOOLS
  -> CapabilityContractService
      -> semantic identity / risk / owner / manual equivalent
  -> runtime projections
      -> KeyCortexToolRegistryService
      -> chat/tool definitions
      -> action boundary
  -> concrete handler/effect

KeyToolRegistryService:
  -> classify each entry:
     SAME / compatibility alias / specialized non-flow capability / obsolete
  -> migrate or explicitly retain with rationale.

## Recommended next steps
1. Generate exact current inventory of FLOW_TOOLS, cortex-only organ capabilities and KeyToolRegistryService tools.
2. Map names/aliases and handler destinations.
3. Eliminate fallback ambiguity in KeyCommandService after equivalence is proven.
4. Preserve one semantic CapabilityContract identity across chat, cortex, automation and external action surfaces.
5. Add genealogy/synthesis only after canonical registry convergence.
