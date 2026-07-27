# Tenant Isolation — Model Inventory (Phase 2A)

> Evidence-based classification of every Prisma model by tenant ownership.
> Generated from `packages/db/prisma/schema.prisma` (430 models, 12,398 lines).
> Machine-readable companions: [`tenant-model-inventory.json`](./tenant-model-inventory.json),
> [`tenant-model-inventory.csv`](./tenant-model-inventory.csv).

**Do not treat this as proof of enforcement.** It records *where a tenant key exists*,
not whether queries actually use it — that is Phase 2B.

## Method

A schema parser extracts, per model: scalar fields (name + optionality), belongs-to
relations (with FK), `deletedAt` (soft-delete), and credential-grade field names.
Classification uses **structural signals, not model names** (names are a tie-breaker
only, and low-confidence models are marked `AMBIGUOUS`). `TENANT_INDIRECT` is resolved
by following *required* belongs-to relations to a tenant-owned parent (fixpoint).

Key structural facts:
- **There is no `Workspace` model** and no `workspaceId` anywhere → `Business` is the sole
  tenant boundary; the `WORKSPACE_SCOPED` category is empty by construction.
- 342/430 models declare `businessId`; 42 declare `userId`.

## Tally

| Classification | Count | Meaning |
|---|---:|---|
| `TENANT_DIRECT` | 335 | Has `businessId` (10 of these are **optional** — see below) |
| `TENANT_INDIRECT` | 68 | Tenant ownership inherited via a required parent relation |
| `SECRET_CREDENTIAL` | 7 | Holds machine credentials (OAuth tokens, signing secrets) |
| `AMBIGUOUS` | 14 | No direct/indirect tenant key found — **manual review required** |
| `SHARED_REFERENCE` | 3 | Global templates (verify truly global) |
| `PLATFORM_GLOBAL` | 1 | `User` |
| `USER_SCOPED` | 1 | `Session` |
| `AUDIT_SYSTEM` | 1 | `AuthAuditLog` (other audit logs carry `businessId` → counted as TENANT_DIRECT) |
| **WORKSPACE_SCOPED** | 0 | No workspace concept exists |

## High-risk sets (attack-test priority)

### SECRET_CREDENTIAL (7)
| Model | Tenant key | Credential fields | Notes |
|---|---|---|---|
| `ConnectorAccount` | `businessId` | `accessTokenEncrypted`, `refreshTokenEncrypted` | ✅ encrypted at rest |
| `BankConnection` | `businessId` | `accessToken` | ⚠️ name suggests plaintext |
| `SocialConnection` | `businessId` | `refreshToken` | ⚠️ verify encryption |
| `ChannelConnection` | `businessId` | `refreshToken` | ⚠️ verify encryption |
| `SupplierConnection` | `businessId` | `credentials` (Json) | ⚠️ verify encryption |
| `Webhook` | `businessId` | `secret` | signing secret |
| `Business` | *(is the tenant root)* | **14 raw OAuth token columns** | 🔴 see Finding 1 |

### TENANT_DIRECT with **optional** `businessId` (10) — ownership not enforced by schema
`WebhookEvent, Course, Cohort, AiPlanResult, BusinessRule, ProductEvent, UserFeedback, AiQualitySignal, TriggerDefinition, KeyInteractionFeedback`
→ Rows can exist unowned; any enforcement mechanism must treat `null` businessId explicitly.

### AMBIGUOUS (14) — require manual ownership decision
`Skill, DocumentCategory, DocumentType, DocumentClause, ClauseVariant, ImpactRule, AuthRateLimit, FeatureFlag, TaskAssignment, IntegrationProvider, FeatureUsageDaily, ProductExperiment, ProductRoadmapInsight, PromptVersion`
- Likely **global reference**: `DocumentCategory/Type`, `IntegrationProvider`, `FeatureFlag`, `PromptVersion`, `ImpactRule`, `ClauseVariant`, `DocumentClause`.
- Likely **platform analytics**: `FeatureUsageDaily`, `ProductExperiment`, `ProductRoadmapInsight`.
- **`TaskAssignment`** — polymorphic (`taskType`+`taskId`); tenant ownership is via the parent task and cannot be a Prisma relation. See Finding 2.
- `AuthRateLimit` — infra/rate-limit state.

## Confirmed defects found during inventory

### Finding 1 — `Business` stores 14 OAuth tokens in plaintext columns (secret-at-rest)
`Business` carries `gmailAccessToken/RefreshToken`, `calendarAccessToken/RefreshToken`,
`driveAccessToken/RefreshToken`, `formsAccessToken/RefreshToken`, `contactsAccessToken/RefreshToken`,
`msContactsAccessToken/RefreshToken`, `bpAccessToken/RefreshToken` — **no `Encrypted` suffix**,
unlike `ConnectorAccount.accessTokenEncrypted`. These live on the most-frequently-read tenant
table. Not a cross-tenant leak, but a plaintext-credential-at-rest issue. → Phase 5 hardening
(encrypt or migrate to `ConnectorAccount`); flagged now for the record.

### Finding 2 — `TaskAssignment` in the tenant-isolation allow-list has no `businessId`
`packages/db/src/client.ts:78` lists `TaskAssignment` in `BUSINESS_ID_MODELS`, but the model
has **no `businessId` column**. When tenant context is active, the extension injects
`where.businessId` into `findMany`/`count` on `TaskAssignment`, which makes Prisma throw
(`Unknown argument businessId`). This is a **latent correctness defect** (fails closed by
erroring) and means `TaskAssignment` is *not* isolatable via the extension — its tenancy must
be enforced through the parent task. → Candidate Phase 2E fix (remove from list + scope via parent).

## Access-surface size (input to Phase 2F, not per-site verification)

Prisma operation call-sites in `apps/server/src` (excludes specs):

| op | sites | op | sites |
|---|---:|---|---:|
| findMany | 1629 | delete | 186 |
| update | 1034 | updateMany | 162 |
| findFirst | 974 | aggregate | 162 |
| create | 759 | upsert | 154 |
| count | 701 | groupBy | 99 |
| findUnique | 682 | deleteMany | 60 |

≈ **7,600 call-sites**, plus **19 raw-SQL sites** and **102 files using `$transaction`**.
Implication: a per-site repository migration across 7,600 sites is not proportionate; a
**centralized, default-on enforcement layer with an explicit bypass** is the likely correct
strategy — to be confirmed after Phase 2B/2C. `findUnique`/`update`/`delete` by global `id`
(≈ 1,900 sites) are the primary cross-tenant vector and the focus of Phase 2B.

## Unresolved (carried to 2B/2C)
- The 14 `AMBIGUOUS` + 10 optional-`businessId` models need per-model ownership decisions.
- Whether the 68 `TENANT_INDIRECT` models are actually queried through their tenant parent.
- Public-surface controllers (e.g. `payments.controller.ts`) intentionally derive `businessId`
  from a bearer record id (invoiceId) — confirm this is the only unauthenticated tenant path.
