# KEYPORTAL GitHub Issues

This directory contains import-ready GitHub issue descriptions for the KEYPORTAL build plan. Each file maps to one issue.

## How to use

1. Copy the contents of each file into a new GitHub issue.
2. Use the title from the `# Title` header.
3. Apply the labels listed under **Labels**.
4. Assign to the correct milestone.
5. Set dependencies/blockers based on the **Dependencies** section.

---

## Milestone 1: Portal Foundation

| Issue | Title | PR |
|-------|-------|----|
| [KP-1](./KP-1-create-portal-slug-route-shell.md) | Create `/portal/[slug]` route shell | PR 1 |
| [KP-2](./KP-2-build-keyportal-action-homepage.md) | Build KEYPORTAL action homepage | PR 1 |
| [KP-3](./KP-3-add-portal-services-sub-route.md) | Add `/portal/[slug]/services` sub-route | PR 2 |
| [KP-4](./KP-4-add-portal-products-sub-route.md) | Add `/portal/[slug]/products` sub-route | PR 2 |
| [KP-5](./KP-5-seo-metadata-structured-data.md) | SEO, metadata, and structured data | PR 2 |

## Milestone 2: Portal Configuration

| Issue | Title | PR |
|-------|-------|----|
| [KP-6](./KP-6-add-portalconfig-prisma-model.md) | Add `PortalConfig` Prisma model | PR 3 |
| [KP-7](./KP-7-create-portalconfig-api-owner.md) | Create PortalConfig API (owner) | PR 3 |
| [KP-8](./KP-8-build-owner-customization-ui.md) | Build owner customization UI | PR 4 |
| [KP-9](./KP-9-preview-mode.md) | Preview mode | PR 4 |
| [KP-10](./KP-10-publish-unpublish-state.md) | Publish/unpublish state | PR 4 |

## Milestone 3: Unified Catalog

| Issue | Title | PR |
|-------|-------|----|
| [KP-11](./KP-11-create-catalog-module.md) | Create `CatalogModule` | PR 5 |
| [KP-12](./KP-12-build-get-catalog-public-slug.md) | Build `GET /catalog/public/:slug` | PR 5 |
| [KP-13](./KP-13-build-catalog-normalizer.md) | Build catalog normalizer | PR 5 |
| [KP-14](./KP-14-migrate-portal-to-catalog-endpoint.md) | Migrate `/portal/[slug]` to catalog endpoint | PR 5 |
| [KP-15](./KP-15-deprecate-duplicate-listing-paths.md) | Deprecate duplicate product/service listing paths | PR 5 |

## Milestone 4: Harden Transactions

| Issue | Title | PR |
|-------|-------|----|
| [KP-16](./KP-16-stable-receipt-routes.md) | Stable receipt routes | PR 6 |
| [KP-17](./KP-17-crm-contact-linkage.md) | CRM contact linkage for all checkout flows | PR 6 |
| [KP-18](./KP-18-inventory-reservation.md) | Inventory reservation for product orders | PR 6 |
| [KP-19](./KP-19-payment-status-standardization.md) | Payment status standardization | PR 6 |
| [KP-20](./KP-20-portal-transaction-ledger.md) | Portal transaction ledger | PR 6 |

## Milestone 5: Events & Ticketing

| Issue | Title | PR |
|-------|-------|----|
| [KP-21](./KP-21-event-ticketing-prisma-models.md) | Add event and ticketing Prisma models | PR 7 |
| [KP-22](./KP-22-create-events-module.md) | Create `EventsModule` | PR 8 |
| [KP-23](./KP-23-owner-event-creation-ui.md) | Owner event creation UI | PR 9 |
| [KP-24](./KP-24-public-event-page.md) | Public event page | PR 9 |
| [KP-25](./KP-25-ticket-purchase-flow.md) | Ticket purchase flow | PR 10 |
| [KP-26](./KP-26-attendee-dashboard-checkin.md) | Attendee dashboard and check-in | PR 10 |

## Milestone 6: Promotions

| Issue | Title | PR |
|-------|-------|----|
| [KP-27](./KP-27-add-portalpromo-model.md) | Add `PortalPromo` model | PR 11 |
| [KP-28](./KP-28-promo-management-ui.md) | Promo management UI | PR 11 |
| [KP-29](./KP-29-public-promo-cards.md) | Public promo cards | PR 11 |
| [KP-30](./KP-30-promo-checkout-tracking.md) | Promo-to-checkout tracking | PR 11 |

## Milestone 7: KEYPORTAL Dashboard

| Issue | Title | PR |
|-------|-------|----|
| [KP-31](./KP-31-create-app-keyportal-shell.md) | Create `/app/keyportal` dashboard shell | PR 12 |
| [KP-32](./KP-32-overview-tab.md) | Overview tab | PR 12 |
| [KP-33](./KP-33-orders-bookings-tickets-tabs.md) | Orders, Bookings, and Tickets tabs | PR 12 |
| [KP-34](./KP-34-customers-tab.md) | Customers tab | PR 12 |
| [KP-35](./KP-35-navigation-updates.md) | Navigation updates | PR 12 |

---

## PR Sequence Summary

| PR | Scope | Issues |
|----|-------|--------|
| PR 1 | Portal Route Foundation | KP-1, KP-2 |
| PR 2 | Portal Sub-Routes | KP-3, KP-4, KP-5 |
| PR 3 | PortalConfig Schema & API | KP-6, KP-7 |
| PR 4 | Owner Customization UI | KP-8, KP-9, KP-10 |
| PR 5 | Unified Catalog | KP-11, KP-12, KP-13, KP-14, KP-15 |
| PR 6 | Harden Transactions | KP-16, KP-17, KP-18, KP-19, KP-20 |
| PR 7 | Events & Ticketing Schema | KP-21 |
| PR 8 | Events Backend | KP-22 |
| PR 9 | Events Frontend | KP-23, KP-24 |
| PR 10 | Ticket Payment & Receipt | KP-25, KP-26 |
| PR 11 | Portal Promos | KP-27, KP-28, KP-29, KP-30 |
| PR 12 | KEYPORTAL Dashboard Completion | KP-31, KP-32, KP-33, KP-34, KP-35 |
| PR 13 | Legacy Redirect & Cleanup | (covered in implementation plan) |

---

## MVP Cutline

Issues required for MVP:

- **Milestone 1:** KP-1, KP-2, KP-3, KP-4, KP-5
- **Milestone 2:** KP-6, KP-7, KP-8, KP-10
- **Milestone 3:** KP-11, KP-12, KP-13, KP-14
- **Milestone 4:** KP-16, KP-17, KP-18, KP-19, KP-20

Post-MVP:

- **Milestone 5:** KP-21–KP-26 (events & ticketing)
- **Milestone 6:** KP-27–KP-30 (promotions)
- **Milestone 7:** KP-31–KP-35 (dashboard completion)
