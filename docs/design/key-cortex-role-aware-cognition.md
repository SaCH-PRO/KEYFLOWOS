# KEY: expertise-lens cognition (design decisions)

Status: **decided, not yet implemented**
Date: 2026-07-30

> This file previously framed the feature as KEY adapting to the *caller's* org
> role. That was a misreading of the intent and is corrected below. This is not
> about who is asking.

## Intent

KEY is a CNS/PNS layer — cognitive organs plus a peripheral surface that plugs
into every module. It runs on the business's own AI account: every model call
routes through `AiUsageService.trackAndComplete` → `ModelGatewayService.complete`
→ `getPreferences(businessId)`, so provider and model selection are per-business.

**KEY can cover any and every professional role, and picks the best way to answer
automatically from the question or task.** Asked to reconcile accounts it thinks
like an accountant and answers with a table; asked about market position it
thinks like a strategist and answers with options and tradeoffs; asked about a
shift problem it thinks like an ops lead and answers with a checklist.

This is about KEY's own cognitive capability, not about the user's permissions.

## What exists today

Two auto-selection mechanisms, neither of which does this:

| Mechanism | Selected by | Represents |
|---|---|---|
| Persona (`jarvis`, `friday`, `titan`, `mentor`, `hustler`, …) | `getModuleConfidence(persona, module)` — subject area | tone of voice |
| `ReasoningMode` (`analytical`, `creative`, `critical`, `strategic`, `analogical`, `counterfactual`, `probabilistic`) | `selectDominantReasoningMode(selfModel)` — **KEY's own historical proficiency** | how it reasons |

Note the second: KEY currently picks *how to think* from what it has historically
been best at, not from what the question needs. Left as-is for now by decision,
but recorded because it is surprising and probably wants revisiting.

There is **no** dimension representing professional discipline, and nothing that
varies output format by task.

## Decisions

### 1. Expertise lens is a new axis

A professional discipline KEY adopts for a task — accountant, marketer, ops
manager, strategist, legal, and so on — carrying that discipline's framing,
vocabulary, standard checks, and sense of what is relevant.

It **composes with**, rather than replaces, the existing axes:

```
persona          tone of voice          user preference, independent
expertise lens   professional framing   auto-selected from the task    <- NEW
reasoning mode   inference style        currently self-proficiency driven
module           subject area           routing context
```

### 2. Output format adapts to the task

The lens selects presentation, not just thinking:

- reconciliation / variance → table
- strategy / decision → options with tradeoffs
- operational / procedural → checklist
- diagnostic → findings with evidence
- otherwise → narrative

### 3. Persona stays independent

Persona remains a user preference. The lens does not select or override it. A
user who prefers `hustler` still gets `hustler`'s voice over an accountant's
framing.

### 4. Not a permissions mechanism

The lens changes how KEY thinks and presents. It does **not** grant or restrict
access to anything. `JobRole.permissions`, `defaultApprovalTier` and
`Membership.maxApprovalTier` remain the sole authority for what a user may see or
do, enforced where they are enforced today. KEY adopting an "accountant lens"
must never widen what the caller can reach.

## Open questions

1. **Lens taxonomy** — a fixed enum, or derived from each business's own
   `JobRole` rows so lenses match that business's actual functions?
2. **Selection mechanism** — heuristic/keyword classification, a model call, or
   the existing module routing as a first approximation?
3. **Ambiguity** — when the task is unclear, does KEY pick a generalist lens,
   ask, or blend two?
4. **Observability** — is the chosen lens surfaced to the user
   ("answering as: operations"), or invisible?

## Testing

Wiring-level, not behavioural:

- a fixture set of questions each classifies to the expected lens
- output format matches the lens contract
- persona is unchanged by lens selection
- lens selection never widens data access (guards the boundary in §4)
