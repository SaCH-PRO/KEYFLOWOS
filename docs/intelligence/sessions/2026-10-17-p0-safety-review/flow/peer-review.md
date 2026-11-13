# Flow authority findings — independent source validation

**Repository:** `SaCH-PRO/KEYFLOWOS`
**Pinned main:** `98ee0202499ba87fa4ee13d58a2a9075016225bd`
**Reviewed checkout:** `/tmp/keyflow-p0-review`
**Characterization evidence reviewed:** `flow-policy-probes.cjs` and `flow-policy-probe-result.json` in `/tmp/kf-flow-review`.

## Scope and conclusion

Both characterized findings are supported by the actual source. The probe uses the real compiled oversight, role, job-role-policy and registry code, plus the exact extracted `selectToolsForRequest` method, with synthetic policy I/O and dependency tokens. This peer review independently followed the surrounding request and effect paths. It did not repeat the tests, issue HTTP/model requests, touch a database, evaluate a real business policy, or execute a tool effect. No repository fixes, new tracking IDs, remote mutations, worker dispatches, deployment or merge were performed.

These are separate Flow authority contracts; this report does not widen PR155 or release another action-boundary capability.

## 1. Primary policy failure can promote a permissive legacy policy

In `apps/server/src/modules/ai/ai-oversight.service.ts`, a present typed `AutopilotSettings` row takes precedence (333–345). A failed typed read sets `readFailed = true` (347–363), but a parseable legacy `AiMemory` value returns immediately (366–373). That return bypasses the restricted/degraded result at 382–392.

The characterization therefore correctly distinguishes these cases:

| Typed policy read | Legacy policy read | Observed decision |
|---|---|---|
| Successful advisory policy | Permissive | Denied |
| **Throws** | **Permissive** | **Allowed, without a degraded marker** |
| Throws | Throws | Denied, degraded |
| Absent row | Permissive | Allowed under supported legacy behavior |
| Throws | Malformed JSON | Denied, degraded |

The existing `ai-oversight-fails-closed.spec.ts:33–45` makes both stores throw together with one `readThrows` option. Its failure checks at 66–75 and 101–116 therefore do not exercise the selective primary-error/legacy-success case.

**Assessment:** a conditional, high-impact policy-authority downgrade. Failure to read the preferred authority is treated as permission to use a lower-priority value without freshness or equivalence evidence. This is not a finding that all legacy support is unsafe: a successfully observed absent primary row and a legitimate legacy policy remain a deliberate supported case. A database outage preventing both reads is already denied. The probe does not establish production policy divergence or a caller's ability to cause the selective read failure.

The missing marker also bypasses the intended `updateAutonomySettings` degraded-read refusal at 431–436. That is a source-level consequence, not an executed probe result. The subsequent write at 446–449 targets **AiMemory**, so this evidence does not prove permanent erasure of the typed policy.

**Existing correction owner:** `AiOversightService.getAutonomySettings` and its fails-closed specification. Preserve the distinction between absent policy, failed read, and explicitly authorized fallback. Meaningful correction controls include selective primary failure plus permissive legacy, successful typed-policy precedence, supported absent-primary legacy behavior, both-failure/malformed-legacy denial, and refusal of the protected read-modify-write after an unresolved authoritative read failure.

## 2. Client page context can substitute its own role authority

The envelope finding is confirmed at ingress, tool selection, and governance. The conditional CRM effect path has no additional adopted-capability clearance:

| Boundary | Source evidence |
|---|---|
| Public ingress | `apps/server/src/modules/ai/flow.controller.ts:22–44` and `59–79` accept inline object bodies and forward `body.pageContext` to chat/stream. |
| Authentication and business access | The routes use `AuthGuard` and `BusinessGuard`; `apps/server/src/core/auth/business.guard.ts:33–39` permits the business owner or a member. This is business access, not a job-role or CRM-delete grant. |
| Selection | `apps/server/src/modules/ai/flow-orchestrator.service.ts:1284–1305` substitutes envelope filtering for crew filtering. Chat and stream supply the envelope at 1619–1623 and 2028–2032. |
| Execution decision | `apps/server/src/modules/ai/ai-oversight.service.ts:229–244` gives the envelope branch precedence over the no-granting-role denial. Streaming passes the envelope to evaluation at `flow-orchestrator.service.ts:2298`. |
| Further clearance | `flow-orchestrator.service.ts:2483–2490` preserves the legacy decision for non-adopted tools. `apps/server/src/modules/key-autonomy/action-boundary/action-envelope.ts:21–30` adopts only `helpdesk_create_ticket`. |
| CRM adapter | `flow-orchestrator.service.ts:2859–2864` calls `softDeleteContact({ businessId, contactId })` **without `actorUserId`**. |
| Domain permission/effect | `apps/server/src/modules/crm/crm.service.ts:837–853` checks per-user delete permission only when `actorUserId` exists. The effect at 861 sets `deletedAt`; 874 emits the deletion event. |

The probe correctly shows that no built-in crew role permits `crm_delete_contact`; the ordinary general crew denies it; and an invented envelope with wildcard tools and an inflated tier makes it selectable and allowed without confirmation under business autonomy level 4. The real business blocklist and advisory-mode controls still deny it. A client-supplied `jobRoleId` is not verified by the pure `JobRolePolicyService` evaluator.

**Assessment:** a high-impact authenticated, within-business role-authority bypass. A real effect remains conditional on an authorized business-member session, a sufficiently permissive business policy, available chat dependencies, model selection of the tool, valid arguments and a contact in that business. The probe proves selection and policy decisions; source tracing supports the remaining effect path. This is not proof of a real deletion, unauthenticated access, cross-tenant access, hard deletion or bypass of all business policy.

## Existing finding attribution and correction boundaries

This envelope defect is already recorded in `docs/CAPABILITY_MAP_2026-08-09.md:113` and `808`. Its proposed correction at 219 is to make `pageContext` a validated DTO in `flow.controller.ts`. The current work supplies fresh proof and a concrete conditional CRM effect trace for that existing record, not a new tracking identity.

The immediate owners are Flow's HTTP ingress and authority propagation. Public page context must not confer authority; runtime validation must actually reject or strip nested authority fields. Where position authority is intended, it should be derived from the verified principal and business on the server and carried separately from display/context hints.

Preserve the legitimate server producer: `apps/server/src/modules/structure/staff-chat-bridge.service.ts:102–106` derives the envelope from the resolved assignment, and 118–127 passes it into Flow. Blanket removal of envelope support would remove that intended behavior. Omitted CRM actor propagation is a contributing defense gap owned by the existing Flow-to-CRM path and CRM access checks. None of these conclusions requires expanding ACTION-001 adoption or changing PR155.
