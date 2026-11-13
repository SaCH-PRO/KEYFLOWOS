# Module Contract — Public Commercial Surfaces v1

**Status:** DRAFT FOR CHARACTERIZATION / NOT AN IMPLEMENTATION DIRECTIVE
**Source main:** `b1948d2797e1bae3660a3d7173abb75397e05aad`
**Scope:** externally reachable storefront/catalog, shareable invoice/quote/receipt and payment entry points, public-link access and their relation to the internal tenant ledger.

## 1. Customer outcome
A customer may reach only the catalog, quote, invoice or checkout information deliberately published or shared to them, see correct amounts and receive truthful next steps. A public link never grants access to unrelated tenant resources.

## 2. Code owners to verify
| Concern | Initial code location | Verification |
|---|---|---|
| Public/catalog and commercial endpoints | `apps/server/src/modules/commerce/commerce.controller.ts` and related controllers | Public product route observed around line 62; enumerate all |
| Shared invoice/quote/receipt reads | `apps/server/src/modules/commerce/` | Audit shareable status and access checks |
| Storefront UI | `apps/web/src/` public routes | Inventory routes, tokens and cache behavior |
| Payment-provider callbacks | commerce/checkout or payment modules | Trace trust, signature and idempotency |
| Catalog/product/order models | `packages/db/prisma/schema.prisma` | Confirm tenant ownership and public fields |
| External notifications | email/payment/receipt services | Public delivery rules and privacy |

Paths are candidate owners, not a verified exhaustive enumeration. Exact controllers and blob anchors must be supplied by read-only characterization.

## 3. Public contract
Discover exact routes and whether each uses authenticated session, public slug, signed token, share link, order key or provider webhook. Enumerate publication and expiration controls, rate limits, search-index/cache behavior, allowed customer fields, currency/tax totals, pricing changes and receipt status.

## 4. UI contract
Responsive catalog and public document views display only expressly allowed data. Checkout or payment initiation must not claim confirmed settlement before authenticated provider evidence. Error/expired links give neutral responses without private data leakage.

## 5. Invariants
- Tenant and resource isolation covers public direct-ID endpoints, not just business-prefixed endpoints.
- All share tokens are unguessable, time/scoped where required, revocable and not used as blanket business membership.
- Public record projections never expose internal notes, staff details, financial metadata or private contacts.
- Price and inventory claims reconcile with current authoritative server-side values; stale caches cannot finalize underpriced charges.
- Payment callback is verified, replay-resistant and not trusted based solely on client redirect.
- Rate limiting, PII minimization and abuse protections apply where authentication does not.
- Customer-visible receipt/paid status is backed by persisted eligible payments.

## 6. Pilot proof matrix
| ID | Required proof |
|---|---|
| PC-P01 | Published product visible; unpublished data denied |
| PC-P02 | Cross-tenant ID and guessed URL reveal no private records |
| PC-P03 | Shared document valid scope works; expired/revoked link fails |
| PC-P04 | Customer projection excludes internal/PII fields |
| PC-P05 | Price, tax, inventory and currency verified before order/payment |
| PC-P06 | Forged/replayed provider callback cannot mark an invoice paid |
| PC-P07 | Network retries do not duplicate charges/orders/payments |
| PC-P08 | Client success redirect alone does not create settlement |
| PC-P09 | Public content caching and rate limits tested |
| PC-P10 | Existing no-provider storefront/catalog remains navigable |

## 7. Return
Produce read-only route/source ledger and test gaps, map public-to-private trust crossings and list proposed negative controls. No live payments, deployment, secrets, code edits, PR, merge or issue #80 directive authorized.
