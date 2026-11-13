# R0-B — Capability Registry Equivalence Control

Status: RESEARCH_ONLY / CONTROL
Date: 2026-10-06

## Current owners
| Layer | Owner | Role |
|---|---|---|
| canonical executable catalogue | FLOW_TOOLS | semantic catalogue seed |
| semantic projection | CapabilityContractService | capability identity/contract |
| cortex runtime gate | KeyCortexToolRegistryService | execution/gating projection |
| cortex bridge | KeyCortexEfferentBridgeService | mirrors FLOW_TOOLS into cortex |
| legacy/parallel registry | KeyToolRegistryService | 14 hand-registered tools; command fallback |

## Proven contradiction
The repository still allows `KeyCommandService.executeApprovedPlan` to fall back to `KeyToolRegistryService`. Therefore capability ownership is not fully converged even though FLOW_TOOLS is documented as canonical.

## Required equivalence inventory
For every KeyToolRegistryService entry capture:
- legacy name;
- FLOW_TOOLS semantic equivalent;
- cortex registry equivalent;
- handler destination;
- input/output compatibility;
- risk/autonomy semantics;
- audit semantics;
- disposition: SAME / ALIAS / SPECIALIZED / OBSOLETE / MISSING.

## Admission rule
Do not delete the fallback and do not add CapabilityRegistryV2 until the inventory proves behavioral equivalence and tests the replacement route.

## Target invariant
One semantic capability identity can be resolved consistently from chat, cortex, automation, command and action-boundary surfaces.
