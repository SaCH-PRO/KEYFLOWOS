# KEY Capability Map

A **derived, evidence-grounded** map of everything KEY can do, organized by business
domain, with each capability assigned an execution **mode** (manual / assisted /
agentic) and each domain scored for coverage against a target capability set.

This is the seed artifact for the **M0 capability model** in the governed
agent/skill architecture. It exists to answer four questions with data, not opinion:

1. **Do we cover the whole business?** — coverage by domain.
2. **Manual, smart, or AI — per capability?** — the *mode*, derived from governance signals.
3. **What integration + UI does each mode imply?** — from each tool's manual route + the existing approval queue.
4. **What's missing?** — the gap register.

## Files

| File | What it is |
|---|---|
| `generate.js` | The generator. Mines the two source registries and emits everything below. Pure derivation — no LLM. |
| `key-capability-map.seed.json` | **Machine-loadable** model. Load this as the initial capability model in M0. |
| `KEY_CAPABILITY_MAP.md` | **Human-readable** coverage map, mode legend, gap register, and per-domain tool tables. |
| `key-capability-map.html` | **Browsable** colour-coded operator console (filter by mode, expand domains). |

> All four are regenerated from source. Do **not** hand-edit the `.json`, `.md`, or
> `.html` — change `generate.js` (taxonomy, mode rules, target list) and re-run.

## Sources of truth

The map is projected from the two capability registries already in the repo:

- `apps/server/src/modules/ai/flow-tool-registry.ts` — `FLOW_TOOLS`, the governed
  executables. Each carries `family`, `riskTier`, and a CI-enforced
  `manualEquivalentRoute` (the manual-UI floor).
- `apps/server/src/modules/key-cortex/key-cortex-capability-registry.service.ts` —
  the declared cortex module capabilities, each with a `requiresApproval` flag.

## How the mode is derived

Mode is **derived, never chosen** — the governance layer decides, not the model:

| Rule | Mode |
|---|---|
| `read` family, or `organize` @ tier 1 | 🟢 **Agentic** — safe to run autonomously |
| `draft` / `crud` / `execute` @ tier 1–2 | 🔵 **Assisted** — AI acts, human-reviewable |
| tier 3, or cortex `requiresApproval` | 🟡 **Assisted + Approval** — gated by the approval queue |
| tier 4 (money / destructive / irreversible) | 🔴 **Human-gated** — AI proposes, human executes |

The invariant: **KEY may create intelligence, but not authority.** 🔴 Human-gated
capabilities must never be promoted to autonomous execution, regardless of evidence.

## How the gap register works

`generate.js` holds a curated list of target capabilities a complete business OS
should have (`TARGETS`). Each is keyword-checked against **every** tool and
capability name/description across both registries. Only *unmatched* targets are
reported as gaps — so the list is a grounded "build or synthesize" backlog, not an
assertion. Proposed mode is what each gap *would* take once built.

## Regenerate

```bash
node docs/architecture/capability-map/generate.js
```

Run this whenever `flow-tool-registry.ts` or the cortex capability registry changes,
and commit the regenerated outputs alongside the source change.

## How M0 consumes this

- Load `key-capability-map.seed.json` as the initial capability model.
- Every skill and agent registered later **declares which capability id(s) it covers**.
- Coverage then becomes computable and self-reportable ("KEY can complete 82% of this
  workflow; missing: …") — the beginning of capability-level self-awareness.
- The `mode` field is the governance contract each capability inherits.
