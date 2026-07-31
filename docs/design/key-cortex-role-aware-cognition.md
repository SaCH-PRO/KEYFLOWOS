# KEY: role-aware cognition (design decisions)

Status: **decided, not yet implemented**
Date: 2026-07-30

## Intent

KEY is a CNS/PNS layer — cognitive organs plus a peripheral surface that plugs
into every module. It runs on the business's own AI account: every model call
routes through `AiUsageService.trackAndComplete` → `ModelGatewayService.complete`
→ `getPreferences(businessId)`, so provider and model selection are per-business.

KEY should be able to think as any employee, from CEO to floor staff.

## What already exists

The org hierarchy is fully modelled. Cortex simply does not read it.

```
JobRole {
  name                 "CEO", "Floor Staff", ...
  level         Int    hierarchy 0-10
  permissions   Json   { module: "read|write|admin" }
  defaultApprovalTier  Int
}
```

`JobRole` → `OrgAssignment` → `Membership.permissionScopes` + `Membership.maxApprovalTier`.
`structure.service.ts` already syncs JobRole permissions onto Membership when a
role changes.

## The gap

Verified by inspection:

- `CortexQuery` and `CortexSession` carry `userId`, `persona`, `voice`, `mood`,
  `provider` — **no role field**
- Persona is selected by `getModuleConfidence(persona, module)` — by subject
  matter, not by who is asking
- The entire `key-cortex` module has **zero** references to `Membership`,
  `OWNER`, `ADMIN`, `STAFF`, or `JobRole`

So today a floor-staff member and the CEO asking the same question receive
identical cognition.

## Decisions

### 1. Scope: tone and framing only

Role shapes how KEY *speaks* — vocabulary, altitude, what it leads with. It does
**not** change what data KEY surfaces, and it does **not** gate actions.

**Consequence, stated explicitly:** this is not a security control and must never
be described or relied upon as one. `JobRole.permissions`, `defaultApprovalTier`
and `Membership.maxApprovalTier` continue to be enforced wherever they are
enforced today. Adding role to cortex prompts changes presentation only. If data
or autonomy gating is ever wanted, that is a separate, deliberate piece of work
with its own threat model.

### 2. Persona stays independent

The 8 personas (`jarvis`, `friday`, `jarvis_dark`, `nova`, `titan`, `ghost`,
`mentor`, `hustler`) remain a user preference. Job role does not select, suggest,
or override persona. Role affects framing; persona affects voice; they compose.

### 3. Always the caller's real role

Role is resolved server-side from the authenticated caller's `Membership` →
`OrgAssignment` → `JobRole`. It is never taken from the request body, and there
is no simulation mode — KEY cannot be asked to reason as someone more senior.

This keeps the surface trivially safe: a client cannot influence it at all.

## Implementation sketch

1. Resolve `{ roleName, roleLevel }` for `(businessId, userId)` from the DB,
   cached per session.
2. Carry it on `CortexSession` (not on `CortexQuery` — it must not be
   client-supplied).
3. Use it only in prompt construction: framing/altitude hints.
4. Absent role (no assignment) degrades to today's behaviour.

## Testing

Wiring-level, not behavioural:

- role is resolved from the DB, never read from request input
- a request body carrying a role field is ignored
- prompt framing differs between two roles for the same query
- persona is unchanged by role
- no data or action differs by role (guards the tone-only boundary)
