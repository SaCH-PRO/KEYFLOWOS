# REST scope census — 2026-11-13 (SWEEP-P0-SCOPES)

Every member write route of `apps/server/src` (modules/, core/ and the app root; review repair
SEC-1: the first cut read modules/ only and missed core/connectors) that checks a business
membership and nothing else, with what this packet did about it. Pinned by
`apps/server/src/core/config/rest-scope-census.spec.ts`: a new membership-only write route fails
there until it carries an enforced scope (`@RequireModuleScope` on the handler and
`ModuleScopeGuard` in its chain) or gets a row here.

A GET is in the census when it starts a credential binding (second review repair SV-3): its path
names an OAuth consent start (`auth-url`, `authorize`, `oauth/start`, `oauth/url`) or its handler
builds an auth URL. It signs a state naming the business, and the provider's callback stores the
account of whoever completes the consent on that business: a write in effect, which the census
did not see while it counted write verbs only (GET .../connect/microsoft/businesses/:b/auth-url had
no row). CEN-09 holds every binding start, of any verb, to a gate: it may not be `open` or
`deferred`. A GET whose write hides in a service under another name is still not visible to the
reader; the binding start is the class the reviews found.

Round 1 class repair (CLASS B): the census also reads the call graph (CEN-10, CEN-10b, CEN-10c). A
route of any verb, and every KEY module action, whose handler reaches a provider credential write
(through injected services, helpers, connector dispatch) must reach it through settings admin or the
owner rule a ruling sets, and a member route that reaches one joins the population whatever its verb.
See "Credential writers (round 1 class repair)" below.

Source of the census: the 2026-11-13 browser sweep (BUG-001 webhooks and signing secrets, BUG-013
API keys, BUG-014 projects, BUG-015 stock and warehouses) showed the class: a STAFF member with no
access to a module wrote it because the route ran `AuthGuard` and `BusinessGuard` only.

## How to read a row

`| Class.handler | verb | path | disposition | reason |`. The dispositions:

- **applied**: this packet gated it; the reason is the enforced scope (`module:level`).
- **exempt-check**: the handler calls an authority check beyond membership, named `check:<name>`
  (the spec verifies the handler calls it), or the service applies it, named `service-check:<name>`
  (the spec verifies the name exists in the module).
- **exempt-guard**: a dedicated authority guard runs, named `guard:<Name>` (verified).
- **exempt-own**: the route acts on the caller's own record.
- **exempt-ruled**: an owner ruling keeps it open (cited).
- **deferred**: another packet owns the gate (pkt/PR195-JOURNAL-SCOPE for the Books and purchase orders).
- **open**: membership only today; the reason names the module a follow-up packet
  (SWEEP-CENSUS-*) should apply and why it was not applied mechanically here. These are the
  remaining exposure of the class.
- **secret-read** (GET): a read that would carry a secret, reviewed: how the secret is kept out.

## Summary

- Member routes without an enforced scope at this head: **753**: 750 write routes and 3
  credential-binding GETs (the Google Calendar, Gmail and Drive consent starts, each with its
  owner check). 760 write routes under modules/ at 2c49a539; the first review repair read core/
  too (+11 ConnectorController and GoogleSuiteController routes, -2 newly applied, +2 for the D-85
  plan doors that keep their service check alone): 771 at 6f4935f1; the second review repair
  applied 8 (the channel and social connection writes, SV-2: -8) and added the binding GETs (+3);
  the round 1 class repair applied 5 credential writers the call graph found (-5: Shopify connect,
  the three supplier connection writes, the channel sync from social); the round 2 class repair
  applied 7 (-7: the BYOK keys, CW-1; the destination writes, CW-2; the accounting and marketing
  pushes and the campaign trigger, WHP-1, WHP-2) and moved 2 open rows to exempt-check (the Business
  Profile location, CW-3; connector Connect, CW-4); the round 3 class repair applied the channel
  connection health check (-1, CB-1) and moved the Drive share to exempt-check (WPH2-2).
  - exempt-check: 61
  - exempt-guard: 23
  - exempt-own: 13
  - exempt-ruled: 17
  - deferred: 63 (three of them `held:` credential writers, the bank connections)
  - open: 576
- Routes gated by this packet (applied): **93**: 92 write routes and one credential-binding GET (the
  Outlook contacts consent start, SV-3; round 3: and crm read, WPH2-1); and 25 reads of the same controllers (round 2: the
  accounting summary, unsynced invoices and chart of accounts need revenue read). Beside these, the
  round 1 class repair added a settings admin check to routes that already enforced another scope
  (IntegrationHubController connect and disconnect keep `connect:write` and check settings admin in
  the handler) or a check (KeyConnectorController connect and disconnect, the Outlook branch of
  ConnectController.disconnectSource); see "Credential writers"; and round 2 added the export
  receiver rule to the connector credentials route (an export connector's binder reads what it
  receives); see "Round 2 class repair".
- Secret-bearing reads reviewed: **15**.

Applied in this packet, with real-DB tests through the HTTP routes:

| family | scope | suite |
| --- | --- | --- |
| webhooks (BUG-001) | settings read / write; the secret in the create answer and, in the list, to settings admin only (review CR-5); the receiver URL is its origin below settings write (SEC-3); every subscribed event needs read on its module, at create and when turned back on (SEC-2), and a contact event revenue read too (second review SV-1, D-100); per webhook, the secret and the full URL go only to a reader who may receive its events (SV-5); URL through the outbound-address guard | sweep-webhooks-api-keys-settings |
| webhook deliveries, every family (round 1 class repair, CLASS A; RC-1 invoice.*) | one door projects every delivery (WebhookDispatcherService.dispatch, webhook-payload.ts): every person row is the fixed person view { id, firstName, lastName, email } (name for a member or staff row), a row of a module the subscriber was not checked for is its id, no credential or contact-private key at any depth; the events are derived from the dispatcher's @OnEvent metadata and the source's emitters, every family has a read rule; round 2 (WHP-3): a person row is told by the columns only a Contact or a User row carries, never by a name, so the event record's own JSON columns (an order's shipping and billing address) go out as read | sweep-webhook-payload-projection |
| provider credential writers the call graph found (round 1 class repair, CLASS B; RC-2 Shopify) | settings admin: Shopify connect; supplier connection create / update / deactivate; the channel sync from social; the Outlook contacts disconnect; the KEY action social.connect_account / disconnect_account; settings admin added to what was there: integration hub connect / disconnect and KEY settings.configure_integration (connect write kept), KEY connector connect / disconnect (D-111 role kept, settings admin by the map, D-114) | sweep-credential-writers-scope, sweep-channel-connections-scope, key-connector-authority, settings-adapter.service.spec, social-adapter.service.spec |
| integration pushes, every export connector (round 2 class repair, CLASS A; WHP-1, WHP-2) | binding QuickBooks, Xero, Mailchimp or Klaviyo needs, beside settings admin, read on what the account receives (CONNECTOR_EXPORT_READS: revenue and crm; crm), and records the binder as the receiver; the accounting push is revenue write and the marketing push content write, each with read on what it sends, and each sends only the contacts the pushing member and the binder may both open (a legacy binding with no recorded binder is read as a non-owner's); the accounting reads need revenue read; Mailchimp's host is pinned to a data center | sweep-export-receivers-scope |
| Outlook contacts push, Drive share and tracked documents (round 3 class repair, CLASS A; WPH2-1, WPH2-2) | the Outlook consent start needs crm read beside settings admin and names its member, the callback records them as the binder, every push sends only a contact the binder may open (a legacy binding is read as a non-owner's) and the sync links only such contacts; a Drive share is the owner's (D-99); the tracked documents list follows the module reads | sweep-class-r3-scope |
| channel connection health check (round 3 class repair, CLASS B; CB-1) | settings admin; a health check keeps an admin's Disabled | sweep-class-r3-scope |
| credential writers the schema-led call graph found (round 2 class repair, CLASS B; CW-1..CW-4) | settings admin: the BYOK keys (AI preferences), the channel destination writes (a destination read answers no token); D-99 owner: the Business Profile account and location; Connect (POST authenticate on a connector not yet connected): settings admin or the Google owner rules; WhatsApp's smoke test (its passed check is Connect): settings admin | sweep-credential-writers-r2-scope, business-profile-active-location-refusal (web) |
| API keys (BUG-013) | settings read / admin (revoke: settings admin, review CR-3) | sweep-webhooks-api-keys-settings |
| connector credentials and the inbound form webhook secret (review SEC-1) | settings admin (webhook-info, POST / DELETE credentials, disconnect, reconnect; gmail and Google keep their owner rules); the handler checks read a stored JSON array as the guard does, every module none (second review SV-4) | sweep-connector-credentials-scope |
| channel and social connections (second review SV-2), the Outlook contacts consent start (SV-3) | settings admin (communications connection create / update / delete and WhatsApp connect; social manual connect, OAuth start and callback, delete; GET connect/microsoft auth-url); a channel connection's create and update write its own fields only (a businessId in the body moved the connection to another business) | sweep-channel-connections-scope |
| projects (BUG-014) | projects read / write on 33 routes (analyze-impact write, SEC-5); approve and delete a plan keep D-85's own check (CR-2) | sweep-projects-module-scope |
| marketplace bundle-order project (review SEC-4) | projects write | sweep-inventory-storefront-scope |
| marketplace stock, warehouses, listings, shipping zones, delivery config (BUG-015) | storefront write | sweep-inventory-storefront-scope |
| stock counts, goods receipts, delivery notes, Drive inventory sheet (BUG-015 family) | storefront write | sweep-inventory-storefront-scope |
| analytics (declared scope was inert) | analytics read / write | sweep-census-families |
| social connections read (tokens) | tokens stripped | sweep-census-families |

KEY parity: the KEY tool table (`CANONICAL_MODULE_TOOLS`, derived by job-role-tool-families.spec.ts)
now grants projects_complete_task / create_task / delete_task / update_task (projects write),
projects_get_budget / get_timeline (projects read) and inventory_adjust_stock /
inventory_transfer_stock (storefront write). The catalog product writes were left open because
gating them changes the legacy commerce job-role grants, pinned as an owner decision.

## Owner questions

1. API keys record no creator (no schema change in this packet). Revoking is settings admin
   (OWNER and ADMIN by role default; review repair CR-3 dropped the OWNER-only rule no ruling
   asked for). Should revoking be owner-only, or limited to the key's creator once a creator column
   exists?
2. Catalog product writes (`CatalogController`): revenue write, as `CommerceController` requires
   for the same writes? Doing it moves commerce_create_product, commerce_update_product and
   apply_storefront_recommendation from the legacy commerce job-role family to the canonical
   revenue grant (job-role-policy.service.spec.ts pins the legacy losses as an owner decision).
3. `PushNotificationController` declares settings scope it never enforces; enforcing it would
   refuse STAFF their own push subscription. Drop the decorator (own-device route)?
4. Bookings and time entries: STAFF default is read for bookings and projects, so gating their
   writes takes booking handling and own-time logging from default staff. Which do staff keep?
5. KEY agent and plan controls (`AgentController`, parts of `AiController`): STAFF default ai is
   none; may staff pause, resume or abort KEY plans?
6. Projects (review CR-7): every task write now needs projects write, so a STAFF member on role
   defaults (projects read) who is a task's assignee (D-87) can no longer move or complete it
   (PATCH .../tasks/:id/status, PATCH .../tasks/:id). May the assignee move and complete their own
   task with projects read? Not decided here: KEY's projects_complete_task / projects_update_task
   derive projects write from these routes (job-role-tool-families.spec), so an assignee path
   needs the same rule in KEY's dispatcher, which this packet does not edit.
7. Analytics (review CR-6): the analytics routes now enforce their declared analytics scope.
   Members invited through the pre-V1-07 web team form hold an 11-key explicit map with no
   `analytics` (or `operations`) key, which the guard reads as none (EXPLICIT_MAP_MISSING_KEY,
   KF-EXEC-AUTH-001), ADMINs included, so they lose the Growth tab as they already lack the
   operations routes. Backfill those maps (both keys at the role default), or keep them refused
   until an owner re-grants from the Team page?
8. Webhooks (review SEC-2): the event reads are checked when a webhook is created or turned back
   on. A webhook records no creator (no schema change here), so one keeps delivering after its
   creator's access is narrowed, until a member turns it off. Add a creator column and re-check
   at delivery? Contact events also carry contacts marked PRIVATE that a non-owner member cannot
   see (crm visibility); should contact webhooks be owner-only, or skip PRIVATE contacts? (Second
   review repair SV-1: contact events now also need revenue read, as their rows carried the stored
   money signals. Round 1 class repair: every delivery is projected, so a contact event, a booking
   event and an invoice event carry the contact as the fixed person view, id, name and email,
   whatever its visibility.)
10. Webhook person view (round 1 class repair, CLASS A): one view for every family, { id, firstName,
   lastName, email }, what every subscriber may read (the invoice routes withhold the phone from
   revenue readers). So booking events no longer carry the contact's phone (the bookings routes
   show it), and contact events carry no phone, company or CRM status. Widen the view per family
   (and the read rule with it), or keep it? The contact.* revenue-read rule (SV-1) is kept, though
   the view carries no money signal: relax it?
11. Integration hub (round 1 class repair): connect and disconnect (and the KEY action
   settings.configure_integration) now need settings admin as well as `connect:write`. `connect` is
   none for every role by deliberate decision, so on role defaults nobody binds an integration, as
   before; an explicit grant of connect write alone no longer does either. Should the binding need
   settings admin alone (then OWNER and ADMIN bind on role defaults), keeping `connect` for the
   hub's sync runs?
12. Bank connections (`FinanceController` create / update / delete, BankConnection.accessToken): a
   provider credential written by any member (ensureAccess checks membership). finance.controller.ts
   is held for the merge with pkt/PR195-JOURNAL-SCOPE, so they are `deferred` rows naming `held:`;
   after the merge they need settings admin (the call graph, CEN-10b, names them).
9. Connector authenticate (`ConnectorController.authenticate`): answered by the round 2 class repair
   (CW-4). A connector already connected still gets its status answer from any member (R0-CMF6-K04);
   otherwise authenticate is Connect, which for WhatsApp writes the connected verification that lifts
   an explicit disconnect and for the OAuth connectors answers their consent start: settings admin, the
   Gmail and Google Suite owner rules first. sync and test stay open; smoke stays open except for a
   connector whose passed check records a binding (WhatsApp; question 15).
13. Integration push receivers (round 2 class repair, CLASS A; WHP-1, WHP-2). An export connector's
   binder is now recorded (ConnectorStatus metadata.boundBy) when it saves the credentials, and every
   push sends only the contacts the pushing member and the binder may both open. Accounts bound before
   this repair have no recorded binder; their pushes are read as going to a non-owner (no PRIVATE
   contact, and no invoice of one) until a settings admin who reads them saves the credentials again.
   Is that the wanted migration, or should the owner be assumed the binder of every existing account?
   And may a PRIVATE contact ever go to an account an ADMIN bound (today only when that ADMIN may open
   the contact: its owner, or an explicit share)?
14. AI preferences (round 2, CW-1): the whole PUT .../ai/preferences is now settings admin, the
   routing mode, writing style and budget caps with the BYOK keys. Split it (settings write for the
   mode, settings admin for the keys)? A BYOK key also makes its holder's provider account the
   receiver of every AI call of the business, prompts carrying CRM and revenue context (CLASS A's
   receiver question for AI): should binding a BYOK key need read on every module, as a webhook does
   for its events, or be the owner's (D-11)?
15. WhatsApp smoke test (round 2, CW-4): POST smoke/whatsapp is now settings admin, because a passed
   check records connected and lifts an explicit disconnect (PR196-WHATSAPP-HEALTH's rule: "an explicit
   disconnect wins until Connect, Reconnect or a passed smoke test"). Keep it so, or have the smoke test
   report its check without lifting an explicit disconnect (then it can be open to members again)?
16. Marketing push default segment (seen in round 2, not changed): it selects `doNotContact: { not:
   true }`, which in SQL also excludes every contact whose flag was never set (NULL), so a default push
   skips most contacts. Count NULL as "may contact"?
17. Payment connector disconnect (seen in round 3, not changed): POST disconnect/stripe, paypal and
   wipay mark the connector row disconnected only; the owner's keys stay in Business.metaData (D-11)
   and the connectors read connectedness and charge with those keys, so the disconnect does not stop
   them (it is why their status recorders can be pinned as STATUS_DOORS: they lift nothing the
   connector reads). Should those disconnects clear the keys (owner-only, D-11), or be removed?
18. Drive files (round 3, WPH2-2): a share is now the owner's, and the tracked documents list follows
   the module reads. The Drive file routes themselves (list, get, content, rename, move, trash,
   delete) stay open to members by the W8 note on D-99, so a member with revenue none still reads an
   invoice PDF's metadata and HTML content by its id, and may trash it. Hold a tracked document's
   reads and writes to its module, or the Drive routes to a scope?
19. Accountant export email (seen in round 3, held): POST finance .../accountant-export/email is
   revenue read and sends the export to any address the sender names; `saveRecipient` writes
   Business.accountantEmail, the default receiver, under revenue read. The sender reads everything
   sent, so no read leaks, but the saved default is a receiver binding: settings admin or the owner
   for `saveRecipient`? finance.controller.ts is held for the PR195 merge.

## KEY follow-ups and seams

- KEY parity was kept by the derivation (job-role-tool-families.spec.ts green): projects_* and
  inventory_adjust_stock / inventory_transfer_stock are now canonical grants. The KEY files this
  packet does not edit (plan-step-authority.ts, flow-orchestrator.service.ts, graph-actions)
  already map projects_ to projects and inventory_ to storefront (GRAPH_ACTION_TOOL_MODULES), so the
  module is unchanged; the level now follows the route (projects_get_budget / get_timeline: read).
- Seam with pkt/PR195-JOURNAL-SCOPE: that branch lists inventory_adjust_stock and
  inventory_transfer_stock in UNGRANTED ("marketplace.controller, which is unscoped") and replaces
  the UNMAPPED `inventory` line; after both land, those two UNGRANTED entries must go (they are
  storefront write here) and the `inventory` comment kept once. Its PATCH / advance purchase-order
  routes add a method-level ModuleScopeGuard beside this packet's class-level one (it runs twice,
  harmlessly). Both branches add the same ModuleScopeGuard import line to marketplace.controller.ts.
- `MarketplaceController.createPurchaseOrder` is left unscoped by both packets (deferred here).
- Review repair: `MarketplaceController.createProjectForBundleOrder` now carries projects write on
  its handler (SEC-4), a decorator line away from the purchase-order handlers pkt/PR195-JOURNAL-SCOPE
  edits (no shared hunk).
- Review repair CR-4 had left `commerce-inventory-wrapper.tsx` and `marketplace/page.tsx` for after
  pkt/PR195-JOURNAL-SCOPE, but that branch answers the purchase-order edit only (second review
  CRV-3). The second review repair answers the rest here: a refused warehouse, stock-set or listing
  save keeps its form open with the server's refusal in it, and a refused warehouse or listing
  delete says the refusal on the page (commerce-inventory-wrapper-refusal,
  marketplace-listing-refusal). The refusal is shown inline (role alert) and these files import
  nothing new, so pkt/PR195-JOURNAL-SCOPE's `toast` and `moduleWriteRefusal` import lines and its
  purchase-order branch merge as they are (`git merge-tree` clean on both files); after the merge
  its purchase-order edit says its refusal by toast and the other saves inline.
- Second review CRV-1 / CRV-2 (web): every screen whose writes this packet newly gated reads the
  server's answer: no success toast and no row dropped on a 403 (project templates, plan detail
  reorder / execute / complete / reject / delete / approve, plan generate, Continental Ops stock
  counts / goods receipts / delivery notes, the Drive inventory-sheet link), and the connection
  screens of SV-2 (Content Studio's social disconnect; the others already showed the server's error).

## Applied (this packet)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AccountingController.pushCustomers` | POST | `/accounting/businesses/:businessId/customers/push` | applied | `revenue:write` (round 2 class repair, CLASS A, finding WHP-1): and read on what it sends, revenue and crm (check:assertMayExport, CONNECTOR_EXPORT_READS), for the member pushing and the member who bound the account (exportAudience); it sends only the contacts both may open (contactIdsEveryReceiverMayOpen) |
| `AccountingController.pushInvoice` | POST | `/accounting/businesses/:businessId/invoices/push` | applied | `revenue:write` (round 2 class repair, CLASS A, finding WHP-1): and read on what it sends, revenue and crm (check:assertMayExport), for the member pushing and the account's binder; an invoice whose contact either may not open is not sent |
| `AiController.updateAiPreferences` | PUT | `/ai/businesses/:businessId/ai/preferences` | applied | `settings:admin` (round 2 class repair, CLASS B, finding CW-1, found by the schema-led call graph: it writes, replaces and clears the business's BYOK provider keys, ai_memories settings / ai_preferences; every AI call then runs on the stored key) |
| `AnalyticsController.assessMaturity` | POST | `/api/businesses/:businessId/analytics/maturity/assess` | applied | `analytics:write` |
| `AnalyticsController.dismissInsight` | POST | `/api/businesses/:businessId/analytics/insights/:id/dismiss` | applied | `analytics:write` |
| `AnalyticsController.generateContactProjection` | POST | `/api/businesses/:businessId/analytics/projections/contacts` | applied | `analytics:write` |
| `AnalyticsController.generateInsights` | POST | `/api/businesses/:businessId/analytics/insights/generate` | applied | `analytics:write` |
| `AnalyticsController.generateRevenueProjection` | POST | `/api/businesses/:businessId/analytics/projections/revenue` | applied | `analytics:write` |
| `AnalyticsController.markInsightRead` | POST | `/api/businesses/:businessId/analytics/insights/:id/read` | applied | `analytics:write` |
| `ApiKeysController.create` | POST | `/api/businesses/:businessId/api-keys` | applied | `settings:admin` |
| `ApiKeysController.revoke` | DELETE | `/api/businesses/:businessId/api-keys/:keyId` | applied | `settings:admin` |
| `CommunicationsController.connectWhatsApp` | POST | `/communications/businesses/:businessId/whatsapp/connect` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's channel credential; the SEC-1 class) |
| `CommunicationsController.createConnection` | POST | `/communications/businesses/:businessId/connections` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's channel credential; the SEC-1 class); the body writes the connection's own fields only |
| `CommunicationsController.createDestination` | POST | `/communications/businesses/:businessId/connections/:connectionId/destinations` | applied | `settings:admin` (round 2 class repair, CLASS B, finding CW-2: it adds a page under the business's credentialed connection or replaces a page's own access token, ChannelDestination.destinationMeta); the body writes the destination's own fields only, and the answer carries no token |
| `CommunicationsController.deleteConnection` | DELETE | `/communications/businesses/:businessId/connections/:id` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's channel credential; the SEC-1 class) |
| `CommunicationsController.syncFromSocial` | POST | `/communications/businesses/:businessId/connections/sync-from-social` | applied | `settings:admin` (round 1 class repair, CLASS B, found by the call graph: it copies every social connection's token over the business's channel connection of that provider) |
| `CommunicationsController.toggleDestination` | PATCH | `/communications/businesses/:businessId/destinations/:destId/toggle` | applied | `settings:admin` (round 2 class repair, CLASS B, finding CW-2: it turns a send destination on or off) |
| `CommunicationsController.updateConnection` | PATCH | `/communications/businesses/:businessId/connections/:id` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's channel credential; the SEC-1 class); the body writes the connection's own fields only (a businessId or id in it moved or renamed the connection) |
| `ConnectorController.saveCredentials` | POST | `/connectors/businesses/:businessId/credentials/:type` | applied | `settings:admin` (review repair SEC-1: it replaces the account a connector syncs with) |
| `DeliveryNoteController.cancel` | POST | `/continental-ops/businesses/:businessId/delivery-notes/:id/cancel` | applied | `storefront:write` |
| `DeliveryNoteController.create` | POST | `/continental-ops/businesses/:businessId/delivery-notes` | applied | `storefront:write` |
| `DeliveryNoteController.fulfill` | POST | `/continental-ops/businesses/:businessId/delivery-notes/:id/fulfill` | applied | `storefront:write` |
| `DeliveryNoteController.remove` | DELETE | `/continental-ops/businesses/:businessId/delivery-notes/:id` | applied | `storefront:write` |
| `DeliveryNoteController.update` | PATCH | `/continental-ops/businesses/:businessId/delivery-notes/:id` | applied | `storefront:write` |
| `GoodsReceiptController.create` | POST | `/continental-ops/businesses/:businessId/goods-receipts` | applied | `storefront:write` |
| `GoodsReceiptController.post` | POST | `/continental-ops/businesses/:businessId/goods-receipts/:id/post` | applied | `storefront:write` |
| `GoodsReceiptController.remove` | DELETE | `/continental-ops/businesses/:businessId/goods-receipts/:id` | applied | `storefront:write` |
| `GoodsReceiptController.update` | PATCH | `/continental-ops/businesses/:businessId/goods-receipts/:id` | applied | `storefront:write` |
| `GoogleDriveController.applyPulledInventory` | POST | `/drive/businesses/:businessId/inventory-sheet/apply` | applied | `storefront:write` |
| `GoogleDriveController.createInventorySheet` | POST | `/drive/businesses/:businessId/inventory-sheet/create` | applied | `storefront:write` |
| `GoogleDriveController.linkInventorySheet` | POST | `/drive/businesses/:businessId/inventory-sheet/link` | applied | `storefront:write` |
| `GoogleDriveController.pushInventoryToSheet` | POST | `/drive/businesses/:businessId/inventory-sheet/push` | applied | `storefront:write` |
| `GoogleDriveController.unlinkInventorySheet` | DELETE | `/drive/businesses/:businessId/inventory-sheet/unlink` | applied | `storefront:write` |
| `MarketingSyncController.pushContacts` | POST | `/marketing/businesses/:businessId/lists/push-contacts` | applied | `content:write` (round 2 class repair, CLASS A, finding WHP-2): and crm read (check:assertMayExport), for the member pushing and the account's binder; only the contacts both may open are sent; Mailchimp's host is pinned to a data center (mailchimpDataCenter) |
| `MarketingSyncController.triggerCampaign` | POST | `/marketing/businesses/:businessId/lists/campaigns/:provider/:campaignId/trigger` | applied | `content:write` (round 2 class repair: the marketing routes now enforce their module; the lists and campaigns reads are content read) |
| `MarketplaceController.adjustInventory` | POST | `/marketplace/businesses/:businessId/inventory/adjust` | applied | `storefront:write` |
| `MarketplaceController.createListing` | POST | `/marketplace/businesses/:businessId/listings` | applied | `storefront:write` |
| `MarketplaceController.createProjectForBundleOrder` | POST | `/marketplace/businesses/:businessId/orders/:orderId/create-project` | applied | `projects:write` (review repair SEC-4: it creates a Project, the BUG-014 rule) |
| `MarketplaceController.createShippingZone` | POST | `/marketplace/businesses/:businessId/shipping-zones` | applied | `storefront:write` |
| `MarketplaceController.createWarehouse` | POST | `/marketplace/businesses/:businessId/warehouses` | applied | `storefront:write` |
| `MarketplaceController.deleteListing` | DELETE | `/marketplace/businesses/:businessId/listings/:listingId` | applied | `storefront:write` |
| `MarketplaceController.deleteShippingZone` | DELETE | `/marketplace/businesses/:businessId/shipping-zones/:zoneId` | applied | `storefront:write` |
| `MarketplaceController.deleteWarehouse` | DELETE | `/marketplace/businesses/:businessId/warehouses/:warehouseId` | applied | `storefront:write` |
| `MarketplaceController.importInventoryExcel` | POST | `/marketplace/businesses/:businessId/inventory/import-excel` | applied | `storefront:write` |
| `MarketplaceController.transferInventory` | POST | `/marketplace/businesses/:businessId/inventory/transfer` | applied | `storefront:write` |
| `MarketplaceController.updateDeliveryConfig` | PUT | `/marketplace/businesses/:businessId/delivery-config` | applied | `storefront:write` |
| `MarketplaceController.updateListing` | PATCH | `/marketplace/businesses/:businessId/listings/:listingId` | applied | `storefront:write` |
| `MarketplaceController.updateShippingZone` | PATCH | `/marketplace/businesses/:businessId/shipping-zones/:zoneId` | applied | `storefront:write` |
| `MarketplaceController.updateWarehouse` | PATCH | `/marketplace/businesses/:businessId/warehouses/:warehouseId` | applied | `storefront:write` |
| `MarketplaceController.upsertInventory` | POST | `/marketplace/businesses/:businessId/inventory` | applied | `storefront:write` |
| `MicrosoftOAuthController.buildAuthUrl` | GET | `/connect/microsoft/businesses/:businessId/auth-url` | applied | `settings:admin` (second review repair SV-3: a credential-binding start: its signed state names the business, and the public callback stores the Outlook contacts tokens of whoever completes the consent on it); round 3 (WPH2-1): and crm read (assertMayBindExport outlook_contacts: the account receives the business's contacts), the state names the member, and the callback records them as the account's binder |
| `CommunicationsController.healthCheck` | POST | `/communications/businesses/:businessId/connections/:id/health-check` | applied | `settings:admin` (round 3 class repair, CLASS B, CB-1: it writes the connection's healthState, the sending state a settings admin sets; a member lifted the admin's Disabled back to Connected and the delivery queue sent from the sender again; a health check now also keeps an admin's Disabled) |
| `ProjectsController.addTask` | POST | `/projects/businesses/:businessId/projects/:projectId/tasks` | applied | `projects:write` |
| `ProjectsController.analyzeImpact` | POST | `/projects/businesses/:businessId/plans/:planId/events/:eventId/analyze-impact` | applied | `projects:write` (review repair SEC-5: a metered model call on the business's AI credits) |
| `ProjectsController.completeOutAppEvent` | POST | `/projects/businesses/:businessId/plans/:planId/events/:eventId/complete` | applied | `projects:write` |
| `ProjectsController.createDeliverable` | POST | `/projects/businesses/:businessId/projects/:projectId/deliverables` | applied | `projects:write` |
| `ProjectsController.createFromTemplate` | POST | `/projects/businesses/:businessId/from-template/:templateId` | applied | `projects:write` |
| `ProjectsController.createMilestone` | POST | `/projects/businesses/:businessId/projects/:projectId/milestones` | applied | `projects:write` |
| `ProjectsController.createProject` | POST | `/projects/businesses/:businessId` | applied | `projects:write` |
| `ProjectsController.createTemplate` | POST | `/projects/businesses/:businessId/templates` | applied | `projects:write` |
| `ProjectsController.deleteDeliverable` | DELETE | `/projects/businesses/:businessId/projects/:projectId/deliverables/:deliverableId` | applied | `projects:write` |
| `ProjectsController.deleteMilestone` | DELETE | `/projects/businesses/:businessId/projects/:projectId/milestones/:milestoneId` | applied | `projects:write` |
| `ProjectsController.deleteProject` | DELETE | `/projects/businesses/:businessId/projects/:projectId` | applied | `projects:write` |
| `ProjectsController.deleteTask` | DELETE | `/projects/businesses/:businessId/tasks/:taskId` | applied | `projects:write` |
| `ProjectsController.deleteTemplate` | DELETE | `/projects/businesses/:businessId/templates/:templateId` | applied | `projects:write` |
| `ProjectsController.executeInAppEvent` | POST | `/projects/businesses/:businessId/plans/:planId/events/:eventId/execute` | applied | `projects:write` |
| `ProjectsController.generatePlan` | POST | `/projects/businesses/:businessId/plans` | applied | `projects:write` |
| `ProjectsController.rejectPlan` | POST | `/projects/businesses/:businessId/plans/:planId/reject` | applied | `projects:write` |
| `ProjectsController.reorderEvents` | POST | `/projects/businesses/:businessId/plans/:planId/events/reorder` | applied | `projects:write` |
| `ProjectsController.reorderTasks` | POST | `/projects/businesses/:businessId/projects/:projectId/tasks/reorder` | applied | `projects:write` |
| `ProjectsController.updateDeliverable` | PATCH | `/projects/businesses/:businessId/projects/:projectId/deliverables/:deliverableId` | applied | `projects:write` |
| `ProjectsController.updateMilestone` | PATCH | `/projects/businesses/:businessId/projects/:projectId/milestones/:milestoneId` | applied | `projects:write` |
| `ProjectsController.updatePlan` | PATCH | `/projects/businesses/:businessId/plans/:planId` | applied | `projects:write` |
| `ProjectsController.updatePlanEvent` | PATCH | `/projects/businesses/:businessId/plans/:planId/events/:eventId` | applied | `projects:write` |
| `ProjectsController.updateProject` | PATCH | `/projects/businesses/:businessId/projects/:projectId` | applied | `projects:write` |
| `ProjectsController.updateTask` | PATCH | `/projects/businesses/:businessId/tasks/:taskId` | applied | `projects:write` |
| `ProjectsController.updateTaskStatus` | PATCH | `/projects/businesses/:businessId/tasks/:taskId/status` | applied | `projects:write` |
| `ShopifyController.connect` | POST | `/shopify/businesses/:businessId/connect` | applied | `settings:admin` (round 1 class repair, finding RC-2: it stores the body's shop domain and access token as the business's Shopify credentials, ConnectorCredentialsService.setCredentials) |
| `SocialController.deleteConnection` | DELETE | `/social/businesses/:businessId/connections/:platform` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's social account credential; the SEC-1 class) |
| `SocialController.manualConnect` | POST | `/social/businesses/:businessId/connections/:platform/manual` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's social account credential; the SEC-1 class) |
| `SocialController.oauthCallback` | POST | `/social/businesses/:businessId/connections/:platform/oauth/callback` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's social account credential; the SEC-1 class) |
| `SocialController.oauthStart` | POST | `/social/businesses/:businessId/connections/:platform/oauth/start` | applied | `settings:admin` (second review repair SV-2: it sets, replaces or clears the business's social account credential; the SEC-1 class) (a credential-binding start, CEN-09) |
| `StockCountController.adjust` | POST | `/continental-ops/businesses/:businessId/stock-counts/:id/adjust` | applied | `storefront:write` |
| `StockCountController.create` | POST | `/continental-ops/businesses/:businessId/stock-counts` | applied | `storefront:write` |
| `StockCountController.remove` | DELETE | `/continental-ops/businesses/:businessId/stock-counts/:id` | applied | `storefront:write` |
| `StockCountController.update` | PATCH | `/continental-ops/businesses/:businessId/stock-counts/:id` | applied | `storefront:write` |
| `SupplierController.createConnection` | POST | `/supplier/businesses/:businessId/connections` | applied | `settings:admin` (round 1 class repair, CLASS B, found by the call graph: it stores the supplier's credentials, SupplierConnection.credentials) |
| `SupplierController.deleteConnection` | DELETE | `/supplier/businesses/:businessId/connections/:connectionId` | applied | `settings:admin` (round 1 class repair, CLASS B: it deactivates the supplier connection) |
| `SupplierController.updateConnection` | PATCH | `/supplier/businesses/:businessId/connections/:connectionId` | applied | `settings:admin` (round 1 class repair, CLASS B: it replaces the supplier's credentials) |
| `WebhooksController.create` | POST | `/webhooks/businesses/:businessId/webhooks` | applied | `settings:write`; and read on every subscribed event's module (SEC-2), with every contact in view and revenue read for contact events (second review SV-1, D-100) |
| `WebhooksController.remove` | DELETE | `/webhooks/businesses/:businessId/webhooks/:webhookId` | applied | `settings:write` |
| `WebhooksController.testWebhook` | POST | `/webhooks/businesses/:businessId/webhooks/:webhookId/test` | applied | `settings:write` |
| `WebhooksController.toggleWebhook` | POST | `/webhooks/businesses/:businessId/webhooks/:webhookId/toggle` | applied | `settings:write`; turning one back on takes create's event reads (SEC-2, SV-1) |

## Secret-bearing reads (reviewed)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `WebhooksController.list` | GET | `/webhooks/businesses/:businessId/webhooks` | secret-read | settings:read; the signing secret is selected for settings admin only (review repair CR-5), and below settings write the receiver URL is its origin only (SEC-3: a Slack, Zapier or Make hook's path is its credential); per webhook, the secret and the full URL go only to a reader who may receive its events (second review repair SV-5: an ADMIN bound by D-114 read the owner's invoice webhook's secret and signed forged deliveries with it) |
| `WebhooksController.deliveries` | GET | `/webhooks/businesses/:businessId/webhooks/:webhookId/deliveries` | secret-read | settings:read; each delivery's receiver URL is its origin only below settings write (review repair SEC-3), or for a reader who may not receive the webhook's events (SV-5) |
| `ConnectorController.getWebhookInfo` | GET | `/connectors/businesses/:businessId/webhook-info/:type` | secret-read | settings:admin; the inbound form webhook's signing secret (created on the first read) is its whole authentication (review repair SEC-1: a STAFF member read it and forged submissions) |
| `ConnectorController.getCredentials` | GET | `/connectors/businesses/:businessId/credentials/:type` | secret-read | secret fields answered masked (ConnectorCredentialsService.getMaskedCredentials, the last 4 only); the form schema stays open to members |
| `ApiKeysController.list` | GET | `/api/businesses/:businessId/api-keys` | secret-read | settings:read; name, prefix and scopes only (the key is hashed; the raw key is answered once at create) |
| `SocialController.listConnections` | GET | `/social/businesses/:businessId/connections` | secret-read | the OAuth access token and refresh token are stripped from every row (this packet; sweep-census-families CEN-SOC-01) |
| `SupplierController.getConnections` | GET | `/supplier/businesses/:businessId/connections` | secret-read | credentials removed from every row (SupplierService.getSupplierConnections) |
| `SupplierController.getConnection` | GET | `/supplier/businesses/:businessId/connections/:connectionId` | secret-read | credentials removed (SupplierService.getSupplierConnection) |
| `CommunicationsController.listConnections` | GET | `/communications/businesses/:businessId/connections` | secret-read | stripSecrets on every row (ChannelConnectionService.list) |
| `CommunicationsController.getConnection` | GET | `/communications/businesses/:businessId/connections/:id` | secret-read | stripSecrets (ChannelConnectionService.get) |
| `CommunicationsController.listDestinations` | GET | `/communications/businesses/:businessId/destinations` | secret-read | every credential key of a destination's destinationMeta (a page's own access token) is stripped, as the connection's token is (stripSecretsFromDestination; round 2 class repair CW-2: GET destinations answered the page token to every member) |
| `KeyConnectorController.getConnections` | GET | `/key-connector/connections` | secret-read | check:connectionView (no credential leaves the connection view) |
| `FinanceController.listBankConnections` | GET | `/finance/businesses/:businessId/bank-connections` | secret-read | BankConnectionService.strip on every row (bank-connection-secret suite); deferred to pkt/PR195-JOURNAL-SCOPE for the scope |
| `WhatsAppController.getConfig` | GET | `/whatsapp/businesses/:businessId/config` | secret-read | tokens masked (R0-SEC2, whatsapp-config-authority suite) |
| `MarketplaceController.getOrderToken` | GET | `/marketplace/businesses/:businessId/orders/:orderId/token` | secret-read | the order's customer link token, answered to members by design (the link is shared with the customer) |

## Credential writers (round 1 class repair, CLASS B)

The reviews found the SEC-1 class one route at a time: connector credentials (SEC-1), channel and
social connections (SV-2), the Outlook consent start (SV-3), Shopify connect (RC-2). Each was a
route whose path and handler name said nothing about credentials. The census spec now finds them by
what the handler does (`buildCredentialGraph` in rest-scope-census.spec.ts):

- **What a credential write is.** A Prisma write on a model that stores a provider credential, when
  its data names a credential column (in the call, or, when the data is built elsewhere, in the
  method and the same-class helpers and file constants it uses). The models and columns:
  - Business: the Google Suite and Outlook token columns (`*AccessToken`, `*RefreshToken`);
  - ConnectorStatus: `metadata.encryptedCredentials` (ConnectorCredentialsService);
  - ChannelConnection and SocialConnection: `token`, `refreshToken`;
  - ConnectorAccount: `accessTokenEncrypted`, `refreshTokenEncrypted`;
  - SupplierConnection: `credentials`;
  - BankConnection: `accessToken`, `providerItemId`;
  - IntegrationConnection: `authData`, `authDataRef`.
  Deleting or deactivating such a row also counts. So do:
  - a Business write whose `metaData` carries a credential key (WhatsApp, payment and SEO secrets);
  - raw SQL that SETs a token column;
  - a consent start: an OAuth state signer, or an OAuth session store.
- **What it is not.** A writer that only stores the provider's answer for a binding that already
  exists, or clears what no binding holds, is a refresh door, pinned by name with its reason (the
  spec fails if one stops writing):
  - the Drive, Calendar, Gmail, Google Suite and Outlook token refreshes;
  - the expired-pending Gmail sweep;
  - the orphaned Gmail token cleanup;
  - the SEO sync stamps.
  App-issued access tokens are not provider credentials: PaymentLink, PortalAccess, Quote.viewToken,
  ContactExportJob, SitePageDraft.previewToken, DriveSyncCursor. Neither is PushSubscription.auth (the
  caller's own device) or a webhook's signing secret (the server generates it at create, under
  settings write and the event reads, SV-5).
- **The graph.** It follows:
  - calls on `this` (with superclasses);
  - typed injected properties (constructor and property injection, `@Inject(X)`);
  - top-level helper functions;
  - connector dispatch: a call on a local of an interface several classes implement goes to every
    implementation;
  - a method name only one class defines.
- **The rule (CEN-10b, CEN-10c).** Every route that reaches a credential write must reach it only
  through:
  - settings admin enforced on the route; or
  - a pinned check that dominates the call. The check runs in an earlier statement of a block that
    encloses the call, or in both branches of an `if`; a check in a sibling branch does not count.
    The pinned checks:
    - settings admin as ModuleScopeGuard reads it (assertMemberModuleLevel, and for a KEY command
      assertCommandActorModuleLevel);
    - assertConnectorSettingsAdmin;
    - the Google owner rule (D-99);
    - the Gmail owner rule (D-11, D-42);
    - the business owner (D-11);
    - the WhatsApp config owner (D-11);
    - the SEO connector owner (D-94);
    - for a public callback, the signed state its start minted (verifyState, consumeOAuthSession).
  A role-only check does not count (D-114). This applies to member and public routes of every verb,
  and to every KEY connector adapter's `execute`. The only exception is a route whose file another
  branch holds, as a `deferred` row naming `held:`.

What the graph found at c875b446 (beyond what the reviews had fixed). Each is fixed here with a
real-DB test, except the bank connections:

| route or action | wrote | now |
| --- | --- | --- |
| ShopifyController.connect (RC-2) | ConnectorStatus encrypted credentials (shop domain and token from the body) | settings admin |
| SupplierController create / update / delete connection | SupplierConnection.credentials, its deactivation | settings admin |
| IntegrationHubController connect / disconnect | IntegrationConnection.authDataRef, its deactivation (connect write alone) | connect write kept and settings admin (check:assertMemberModuleLevel in the handler) |
| CommunicationsController.syncFromSocial | every social token copied over the channel connections | settings admin |
| ConnectController.disconnectSource (outlook_contacts branch) | Business.msContacts tokens cleared (the Google branch had its owner rule) | settings admin in that branch |
| KeyConnectorController connect / disconnect | IntegrationConnection.authData (OWNER or ADMIN by role only) | D-111 and settings admin by the map (D-114) |
| KEY social.connect_account / disconnect_account (SocialAdapterService) | SocialConnection token (any member KEY admitted) | settings admin on the command's actor |
| KEY settings.configure_integration (SettingsAdapterService) | IntegrationConnection (connect write alone) | connect write kept and settings admin on the command's actor |
| FinanceController create / update / delete bank connection | BankConnection.accessToken (membership only) | held: finance.controller.ts belongs to the PR195 merge; settings admin after it |

Every other route the graph reaches is guarded:
- the connector credential routes and the channel and social connection writes (settings admin,
  SEC-1, SV-2);
- the Google consent starts, callbacks and disconnects (owner, D-99);
- Gmail (owner, D-11, D-42);
- the business profile's payment secrets (owner, D-11);
- WhatsApp config (owner, D-11);
- GA4 and Search Console (owner, D-94);
- the Microsoft consent start (settings admin, SV-3) and its callback (signed state).
Not covered by the reader:
- tRPC routers, which are unmounted unless TRPC_ENABLED=1 (D-68);
- WebSocket gateways and queue processors;
- dynamic `moduleRef.get` resolution whose result is called through a local not named by a unique
  method.

## Round 2 class repair (CLASS A integration pushes, CLASS B schema-led call graph)

**CLASS B (CW-5).** The round 1 graph's leaves were a fixed list of models and columns, its calls
resolved through `this`, typed properties, helpers and connector dispatch only, and its raw SQL rule
matched access_token and refresh_token. The round 2 hunt put ten shapes through it and each passed
CEN-*; CW-1..CW-3 were live instances. Now (rest-scope-census.spec.ts):
- the leaves are every schema column whose name says it holds a secret (SECRET_COLUMN over
  packages/db/prisma/schema.prisma: token, secret, password, api_key, credential, refresh, auth_data,
  encrypted), less the app-issued tokens excused by name with a reason (NOT_PROVIDER_CREDENTIALS:
  PaymentLink, PortalAccess, Quote.viewToken, ContactExportJob, SitePageDraft.previewToken, the Drive and
  People sync cursors, the webhook signing secret, trade-secret text), plus BINDING_RULES: the account,
  location and calendar ids the owner's Google tokens act on (Business.bpAccountId, bpLocationId,
  calendarId), a channel destination's meta and its creation, deletion or deactivation, a channel
  connection's providerMeta, the BYOK keys in ai_memories, and a ConnectorStatus row's deletion,
  deactivation or metadata replacement; a new secret-named column joins with no edit here (CEN-10e);
- BINDING_WRITERS pins the writes that bind by what they record (WhatsAppConnector.recordConnected);
- raw SQL, tagged or called, execute or query, is a leaf when it SETs a credential column or a JSON
  column naming a credential key, or deletes, inserts or deactivates a credential row;
- the graph follows chained receivers (`this.registry.get(t)!.disconnect()`), local, destructured and
  class aliases of a Prisma delegate, events (an emit goes to every `@OnEvent` listener of it), and a
  distinctive method name a few classes define (`resolved.connector.pushInvoice()`);
- CEN-10d parses the hunt's shapes beside the real source and fails if the reader misses one or
  reports its settings-admin twin; CEN-10f requires every connector whose smoke test reaches a binding
  write to be named in CONNECTORS_BINDING_ON_CHECK.

What the schema-led graph found (each fixed here with a real-DB test, sweep-credential-writers-r2-scope):

| route | wrote | now |
| --- | --- | --- |
| AiController.updateAiPreferences (CW-1) | the BYOK provider keys (ai_memories settings / ai_preferences) | settings admin |
| CommunicationsController.createDestination, toggleDestination (CW-2) | ChannelDestination.destinationMeta (a page's own access token), a new destination, isActive | settings admin; GET destinations answers no token |
| ConnectController.setBpActiveLocation (CW-3) | Business.bpAccountId, bpLocationId | the D-99 owner rule (GOOGLE_CONNECT_OWNER_ONLY) |
| ConnectorController.authenticate (CW-4) | WhatsApp's connected verification (lifts an explicit disconnect) | not yet connected: settings admin, Google owner rules first; connected: the status answer, open |
| ConnectorController.smoke for WhatsApp (CW-4) | the same verification | settings admin (CONNECTORS_BINDING_ON_CHECK) |

The full CLASS B inventory at this head (every route the graph reaches, member or public, any verb;
the KEY entries SettingsAdapterService.execute and SocialAdapterService.execute are guarded): settings
admin enforced on the route (connector credentials save and webhook-info, Shopify connect, the channel
connection writes and WhatsApp connect, the destination writes, the social connection writes, the
supplier connection writes, the Outlook consent start, the AI preferences); a pinned check in the
handler or its service (assertConnectorSettingsAdmin: connector delete, disconnect, reconnect;
assertConnectorBindingAuthority: authenticate, smoke; assertGoogleConnectOwner: the Calendar, Drive and
Google Suite starts, settings and disconnects, the Google Contacts source, the Business Profile location;
assertConnectAuthority: the Gmail start and confirm, the mailbox disconnect; assertBusinessOwner: the
business profile's payment secrets; assertConfigOwner: WhatsApp config; assertConnectorOwner: GA4 and
Search Console; assertMemberModuleLevel settings admin: the integration hub, the Outlook source
disconnect; requireConnectorAdmin: KEY connector connect and disconnect; verifyState and
consumeOAuthSession: the public callbacks); `held:` (the bank connections, FinanceController).

**CLASS A (WHP-1, WHP-2, WHP-3).** The dispatcher's one door (round 1) covers every webhook family:
the events are the dispatcher's 17 `@OnEvent` listeners (contact.created, contact.updated,
contact.merged, booking.created, booking.confirmed, booking.completed, invoice.paid, invoice.reopened,
invoice.sent, invoice.overdue, post.published, store_order.created, store_order.paid,
store_order.shipped, store_order.delivered, store_order.cancelled; derived from Nest's metadata and
the source, WPP-01) and every webhook-family event the source emits (WPP-03 subscribes one webhook to
all of them); each family maps to its module in webhook-events.ts (WPP-02). WHP-3: the projector told a
person row by a name, which also names the recipient in an order's own address; it now tells one by
the columns only a Contact or User row carries (WPP-07, WPP-08).

The integration pushes sat outside that door. The census spec now follows every route to the code that
sends people or money rows out (an outbound POST, PUT or PATCH in a method that reads a Contact,
Invoice, Booking, order, payment or quote: the export graph, CEN-11). What it finds, and the rule each
send now answers to:

| send | destination | rule |
| --- | --- | --- |
| QuickbooksConnector.pushInvoice, pushCustomer | the realm in the stored credentials | export: binding needs revenue and crm read (assertMayBindExport) and records the binder; POST accounting .../push is revenue write, assertMayExport, and sends only the contacts the pusher and the binder may both open |
| XeroConnector.pushInvoice, pushCustomer | the tenant in the stored credentials | the same |
| MailchimpConnector.subscribeContacts | the account of the stored key, at <dc>.api.mailchimp.com (dc validated) | export: binding needs crm read; POST marketing .../push-contacts is content write, assertMayExport, the same contact filter |
| KlaviyoConnector.subscribeContacts | the account of the stored key | the same |
| GoogleContactsSyncService.pushContact | the owner's Google account | destination pinned (OUTBOUND_DESTINATIONS): D-99, the owner reads every contact |
| OutlookContactsSyncService.pushContact | the Outlook account a settings admin connected | (round 3, WPH2-1: no longer pinned; the receiver is the account's binder, see below) |
| PaymentsService.createStripeCheckout, createWipayCheckout | the business's own payment account | destination pinned: a payer's checkout; the keys are the owner's profile secrets (D-11) or the platform's |

Other outbound senders carry no people or money rows to a member-chosen account: the social publishers
(the business's own posts, to destinations a settings admin binds), the WhatsApp and email sends (to
the contact they name), the Google Calendar sync (the owner's account, D-99), the AI providers (the
BYOK keys are settings admin now; question 14), the KEY connector health checks (the Mailchimp server
prefix is pinned to a data center like the connector's), Chatwoot and diagnostics (platform hosts) and
SlackService (no caller).

## Round 3 class repair (CLASS A every outbound sender, CLASS B call-graph census)

**CLASS A.** Round 2's export graph pinned the Outlook contacts push as a safe destination. It also could
not see a send that hands out a stored file. Two live instances followed:

- WPH2-1. Every `contact.updated` reached `OutlookContactsSyncService.pushContact`, which PATCHed the
  contact to the Microsoft account in the stored token. That account belongs to whoever completed the
  consent, a settings admin since SV-3, which includes an ADMIN whose map says crm none (D-114). The
  callback recorded no binder. The pin's reason ("the sync maps only contacts its principals may
  write") was about the sync's principals, not the account's receiver. When the owner ran a routine
  sync, the owner's PRIVATE contacts were linked to the binder's mailbox, and every later edit went
  there.
- WPH2-2. `POST /drive/.../files/:fileId/share` was membership only. It granted a Drive permission
  with the owner's token (D-99), of any type (`anyone` included) and any role. So a STAFF member with
  every module none could hand the invoice PDFs to their own account. The `GET generated-documents`
  list showed the file ids to any member.

The rule now, with real-DB tests through the routes and the real event bus
(sweep-class-r3-scope, R3O-01..06 and R3D-01..03):

| send | destination | rule now |
| --- | --- | --- |
| OutlookContactsSyncService.pushContact (every contact.updated: CRM edits, imports, enrichment, KEY CRM actions, flows) | the Microsoft account whose consent was completed | Starting the consent needs settings admin and crm read (`assertMayBindExport`, `CONNECTOR_EXPORT_READS.outlook_contacts`). The signed state names the member. The callback re-checks that member and records them as the binder (`ConnectorStatus metadata.boundBy`). A state that names no binder binds nothing. Before any send, the push runs `assertReceiversMayOpenContacts`: the binder may open the contact, by crm visibility, which also applies to a contact in the trash. A binding with no recorded binder is read as a non-owner's (TEAM and SHARED only). If the binder may no longer read crm, nothing is sent. The sync links, and writes from the mailbox into, only a contact the binder may open; a mailbox tombstone deletes only such a contact. |
| GoogleDriveService.shareFile (POST .../files/:fileId/share) | the account or domain named, or anyone | The owner rule (`assertGoogleConnectOwner`, D-99): a grant made with the owner's Google account is the owner's, and the owner reads every record a file holds. |
| GET .../generated-documents (the handles to those files) | the member | A tracked document is listed only to a member who reads its module (`GENERATED_DOCUMENT_MODULES`): revenue for invoice, quote, payment, journal and report; expenses for expense. Asking for one type needs read on its module. |

The census reader now holds the class (CEN-11, CEN-11b):

- An export leaf is the send call itself, so a check inside the method that dominates the call
  guards it.
- A POST to a file's `/permissions` counts as an export ("hands out a stored business file").
- An exporter that is not a connector class is named in `EXPORT_ACCOUNTS`, with:
  - the account type it sends to;
  - the routes that bind that account, each of which must run `assertMayBindExport` or the owner
    rule;
  - the callback that must record the binder.
- `OUTBOUND_DESTINATIONS` keeps only:
  - the owner's Google Contacts push (D-99);
  - the payer checkouts on the business's own payment accounts.

Every outbound sender of `apps/server/src`, by what it sends and to whom (77 files with a fetch, axios,
HttpService or provider SDK call; the census's CLASS A inventory):

| sender | sends | to | handled by |
| --- | --- | --- | --- |
| WebhookDispatcherService (17 listeners: contact.created / updated / merged, booking.created / confirmed / completed, invoice.paid / reopened / sent / overdue, post.published, store_order.created / paid / shipped / delivered / cancelled) | the event's record | the subscriber's URL | A single projector, `projectWebhookPayload`, is applied recursively to the whole payload: person keys and rows with Contact or User columns are reduced to the person view; another module's rows are reduced to their id; no credential or private CRM key is sent. Every family has a read rule in webhook-events.ts, checked when a webhook is created or re-enabled. WPP-03 subscribes one webhook to every event name in the source and checks for no non-allowlisted key: literal emits, constants, status maps and buffered names. |
| QuickBooks, Xero (pushInvoice, pushCustomer); Mailchimp, Klaviyo (subscribeContacts) | invoices and customers; contacts | the account in the stored credentials | Round 2: binding checks the export reads, the binder is recorded, and only contacts every receiver may open are sent. |
| OutlookContactsSyncService.pushContact | a contact's name, email, phone, company and job title | the binder's Microsoft account | Round 3 (above). |
| GoogleContactsSyncService.pushContact | the same | the owner's Google account | D-99 destination. |
| GoogleDriveService.shareFile | a grant on a stored file | any account, or the public | Round 3: the owner rule. |
| GoogleDriveService uploads (save-document, generated documents, inventory sheet push), Drive create, rename, move, trash and delete | business documents | the owner's Drive (D-99) | The owner reads everything. The file routes stay open to members by the W8 note on D-99 (question 18). |
| PaymentsService checkouts (Stripe, WiPay, PayPal) | the invoice a payer pays | the business's own payment account | Destination (D-11 owner keys, or the platform's). |
| Gmail sends (invoices, quotes, receipts, reminders), email adapter, WhatsApp and Meta adapters, KEY inbox replies | a message | the contact the record names | The record's own subject, by the sending module's write scope. No member-chosen account receives it. |
| Social publishers (Facebook, Instagram, LinkedIn, TikTok, X) | the business's posts | the business's destinations | Destinations are settings admin (round 2, CW-2). |
| Google Calendar sync | bookings | the owner's calendar (D-99) | The owner reads everything. |
| AI model gateway, Langfuse, code executor, document parsing, ElevenLabs | prompts and content | the platform's providers, or a BYOK key | BYOK keys are settings admin (round 2, CW-1; question 14). |
| Apollo enrichment | a contact's email and name | the platform's Apollo key | The enrich route enforces crm; a platform processor. |
| AccountantExportEmailService (FinanceController, revenue:read) | the accountant export ZIP | the email the sender names, or the saved default | The sender reads everything sent. The route is held by pkt/PR195-JOURNAL-SCOPE (question 19). |
| OAuth token exchanges and refreshes, provider health checks and syncs (GETs), Supabase auth, RISC, currency rates, HIBP, Chatwoot replies, diagnostics, SlackService (no caller), contract asset fetches | no people or money rows | provider and platform hosts | Not a send of records. |

**CLASS B.** The round 3 hunt passed fifteen shapes through the reader with all 18 CEN cases green (CM-1,
CM-2, CM-3). It also found one live instance:

- CB-1. `POST .../connections/:id/health-check` recomputed `healthState` from the token facts. Any
  member could therefore lift the `Disabled` a settings admin had set, and DeliveryQueueService
  would send from that sender again.

Now:

- `CommunicationsController.healthCheck` is settings admin.
- `ChannelConnectionService.runHealthCheck` keeps an admin's `Disabled`; only PATCH connections/:id
  lifts it (R3H-01..03).

Reader changes in rest-scope-census.spec.ts:

- A check is its pinned declaration, `CheckRule.decl` (`Class.method` or `fn:<name>@<file>`). It is
  resolved through:
  - `this`;
  - a typed property or local;
  - an import;
  - a same-file function.

  So a file-local no-op named after a check checks nothing.
- A check that answers null (`verifyState`, `consumeOAuthSession`) counts only through a falsy test
  of its result that ends in throw or return.
- A check that names a business counts only for a write to that business: the route's :businessId,
  or the business the guarded call carries, directly or through one local.
- Calls are followed through:
  - typed locals;
  - `moduleRef.get(X)`;
  - an injection token: its `{ provide, useClass }` binding, or its interface's implementers, else
    by name;
  - a method's declared return class.

  A COMMON method name (create, update, delete) resolves when the receiver's class is known.
- Event names and SQL are read through constants (file or imported, a constant map's member, a
  status map's values).
- These writes are read as leaves:
  - the `*AndReturn` forms;
  - nested relation writes on credential models;
  - INSERT ... ON CONFLICT DO UPDATE SET;
  - an INSERT's column list.
- New binding leaves:
  - the payment and sending account ids in Business.metaData (wipayAccountNumber, wipayDeveloperId,
    paypalClientId, paypalSandbox, stripePublishableKey, phoneNumberId, wabaId);
  - a ConnectorStatus status lift (`*lift`: 'connected' in an update);
  - `ChannelConnection.healthState`.
- `STATUS_DOORS` pins the writers that only record a provider call the stored credentials passed:
  each connector's trackActivity, and the Gmail, Google Contacts, Google Forms and Outlook syncs.
  CEN-10h checks that each door still writes, and that its connector either removes the credentials
  on disconnect or reads its connectedness from them. WhatsApp's health reads the stored status, so
  WhatsApp could never be a door.
- CEN-10d holds every round 2 and round 3 hunt shape, and two guarded twins.

The full CLASS B inventory at this head comes from the graph: 59 routes reach a credential or binding
write, member or public, any verb. Through each one's guard:

- **settings admin enforced** (20): the AI preferences; communications connection create, update and
  delete, WhatsApp connect, sync from social, the destination create and toggle, and the health
  check; connector credentials save and webhook-info; the Outlook consent start; Shopify connect;
  social manual connect, OAuth start and callback, and delete; supplier connection create, update
  and delete.
- **a pinned check dominating the write** (36):
  - `assertConnectorSettingsAdmin`: connector delete credentials, disconnect, reconnect.
  - `assertConnectorBindingAuthority`: authenticate, smoke.
  - `assertGoogleConnectOwner`, the Google starts and their settings and disconnects:
    - Calendar via bookings and calendar;
    - Drive;
    - Google Suite;
    - CRM Google;
    - the Google Contacts source;
    - the Business Profile location.
  - `assertConnectAuthority` and `connectStanding`: the Gmail start, confirm and disconnect.
  - `assertBusinessOwner`: the business profile's payment secrets and account ids.
  - `assertConfigOwner`: WhatsApp config.
  - `assertConnectorOwner`: GA4 and Search Console.
  - `assertMemberModuleLevel` settings admin: the integration hub connect and disconnect.
  - `requireConnectorAdmin` with settings admin: KEY connector connect and disconnect.
  - The public callbacks, through `verifyState` / `consumeOAuthSession` with their null gates:
    Calendar (bookings and calendar), Gmail, Drive, Google Suite, Microsoft, CRM Google.
- **`held:`** (3): the bank connections. finance.controller.ts belongs to the PR195 merge; they need
  settings admin after it.

The KEY entries (SettingsAdapterService, SocialAdapterService, and every adapter that reaches a door)
are guarded (CEN-10c).

## Census by controller

### ActionsController (`actions/actions.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ActionsController.bookingFollowup` | POST | `/actions/booking-followup` | open | membership only; follow-up SWEEP-CENSUS: crm write (send-receipt: revenue write); each sends a customer message |
| `ActionsController.remindContact` | POST | `/actions/remind-contact` | open | membership only; follow-up SWEEP-CENSUS: crm write (send-receipt: revenue write); each sends a customer message |
| `ActionsController.sendReceipt` | POST | `/actions/send-receipt` | open | membership only; follow-up SWEEP-CENSUS: crm write (send-receipt: revenue write); each sends a customer message |

### AdminBusinessController (`admin-platform/admin-business.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminBusinessController.gdprDelete` | POST | `/api/admin/businesses/:businessId/gdpr-delete` | exempt-guard | guard:AdminGuard (platform admin, not a business member route) |

### AgentController (`ai/agent.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AgentController.abortPlan` | POST | `/ai/businesses/:businessId/agent/states/:planId/abort` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.backfillSemanticMemory` | POST | `/ai/businesses/:businessId/agent/memory/backfill` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.createAgentTrigger` | POST | `/ai/businesses/:businessId/agent/triggers` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.markMessageProcessed` | POST | `/ai/businesses/:businessId/agent/messages/:messageId/processed` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.pausePlan` | POST | `/ai/businesses/:businessId/agent/states/:planId/pause` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.processDocument` | POST | `/ai/businesses/:businessId/agent/documents/process` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.resumePlan` | POST | `/ai/businesses/:businessId/agent/states/:planId/resume` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.triggerPatternScan` | POST | `/ai/businesses/:businessId/agent/patterns/scan` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.undoAction` | POST | `/ai/businesses/:businessId/agent/undo/:undoId` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |
| `AgentController.updateAgentTrigger` | PUT | `/ai/businesses/:businessId/agent/triggers/:triggerId` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY plan controls; plan steps are held to the creator's module scopes at run time (D-71, D-73), the control routes are not; STAFF default ai is none, so gating asks whether staff may pause or abort KEY plans (owner question) |

### AiController (`ai/ai.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiController.approvePlan` | POST | `/ai/businesses/:businessId/ai/plans/:planId/approve` | exempt-check | check:assertMayRunGraphAction (each step held to the member's module scopes, D-71) |
| `AiController.assignThreadRole` | POST | `/ai/businesses/:businessId/inbox/:threadId/assign-role` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.blockSuggestionCategory` | POST | `/ai/businesses/:businessId/ai/suggestions/:category/block` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.chat` | POST | `/ai/businesses/:businessId/ai/chat` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.createGoal` | POST | `/ai/businesses/:businessId/goals` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.createPlan` | POST | `/ai/businesses/:businessId/ai/plan` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.deleteGoal` | DELETE | `/ai/businesses/:businessId/goals/:goalId` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.deleteMemory` | DELETE | `/ai/businesses/:businessId/ai/memory/:category/:key` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.dismissSuggestion` | POST | `/ai/businesses/:businessId/ai/suggestions/:suggestionId/dismiss` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.executeAllBriefingCards` | POST | `/ai/businesses/:businessId/briefing/:planId/execute-all` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.executeKeyCommand` | POST | `/ai/businesses/:businessId/key/command` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.generateBusinessModel` | POST | `/ai/businesses/:businessId/ai/business-model` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.instantiateWorkflow` | POST | `/ai/businesses/:businessId/ai/workflows/:templateKey/instantiate` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.parseIntent` | POST | `/ai/businesses/:businessId/ai/intent` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.profileChat` | POST | `/ai/businesses/:businessId/ai/profile/chat` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.profileConfirm` | POST | `/ai/businesses/:businessId/ai/profile/confirm` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.profileReset` | POST | `/ai/businesses/:businessId/ai/profile/reset` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.rebalance` | POST | `/ai/businesses/:businessId/ai/rebalance` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.refreshSuggestions` | POST | `/ai/businesses/:businessId/ai/suggestions/refresh` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.replyToThread` | POST | `/ai/businesses/:businessId/inbox/:threadId/reply` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.resolveApproval` | POST | `/ai/businesses/:businessId/ai/approvals/:approvalId/resolve` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.resolveApprovalsBatch` | POST | `/ai/businesses/:businessId/ai/approvals/batch-resolve` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.resolveThread` | POST | `/ai/businesses/:businessId/inbox/:threadId/resolve` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.seoScore` | POST | `/ai/businesses/:businessId/ai/seo-score` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.simulate` | POST | `/ai/businesses/:businessId/ai/simulate` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.skipBriefing` | POST | `/ai/businesses/:businessId/briefing/:planId/skip` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.summarizePatterns` | POST | `/ai/businesses/:businessId/ai/memory/summarize-patterns` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.triggerJourney` | POST | `/ai/businesses/:businessId/journeys/:key/trigger` | exempt-check | check:assertJourneyContactsVisible (CRM visibility of every contact the journey touches) |
| `AiController.undoPlanStep` | POST | `/ai/businesses/:businessId/ai/plans/:planId/steps/:stepId/undo` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateAgentConfig` | PUT | `/ai/businesses/:businessId/ai/agent-config` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateAutopilotRule` | PUT | `/ai/businesses/:businessId/autopilot-rules/:ruleId` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateBusinessPlan` | PUT | `/ai/businesses/:businessId/ai/business-plan/:planId` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateGoal` | PUT | `/ai/businesses/:businessId/goals/:goalId` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateGoalProgress` | POST | `/ai/businesses/:businessId/goals/:goalId/progress` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateGovernanceSettings` | PUT | `/ai/businesses/:businessId/ai/governance` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.updateRoutingConfig` | PUT | `/ai/businesses/:businessId/ai/routing-config` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.upsertMemory` | PUT | `/ai/businesses/:businessId/ai/memory` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |
| `AiController.upsertMemoryBulk` | PUT | `/ai/businesses/:businessId/ai/memory/bulk` | open | membership only; follow-up SWEEP-CENSUS: ai write (governance, routing, agent config and preferences: settings write); KEY surfaces; tools run through the member authority map (D-119, D-131) but these routes check membership only |

### BlueprintOnboardingController (`ai/blueprint-onboarding.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BlueprintOnboardingController.onboardingChat` | POST | `/blueprint/businesses/:businessId/onboarding-chat` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding chat writes the business blueprint |
| `BlueprintOnboardingController.onboardingReset` | POST | `/blueprint/businesses/:businessId/onboarding-reset` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding chat writes the business blueprint |

### AiFlowController (`ai/flow.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiFlowController.clearSession` | POST | `/ai/businesses/:businessId/flow/sessions/:sessionId/clear` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |
| `AiFlowController.confirmAction` | POST | `/ai/businesses/:businessId/flow/confirm` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |
| `AiFlowController.deleteSession` | DELETE | `/ai/businesses/:businessId/flow/sessions/:sessionId` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |
| `AiFlowController.executePlan` | POST | `/ai/businesses/:businessId/flow/execute-plan/:planId` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |
| `AiFlowController.flowChat` | POST | `/ai/businesses/:businessId/flow/chat` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |
| `AiFlowController.flowChatStream` | POST | `/ai/businesses/:businessId/flow/chat/stream` | exempt-ruled | KEY chat is every member's surface; each tool it runs is held to the member authority map, fail-closed for unmapped tools (D-119, D-131) |

### GraphActionsController (`ai/graph-actions.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GraphActionsController.executeAction` | POST | `/actions/businesses/:businessId/execute` | exempt-check | check:assertMayRunGraphAction (the tool's module scope, GRAPH_ACTION_TOOL_MODULES) |
| `GraphActionsController.planAction` | POST | `/actions/businesses/:businessId/plan` | open | membership only; follow-up SWEEP-CENSUS: ai write; planning only; execution is checked (assertMayRunGraphAction) |

### OutputTemplateController (`ai/output-template.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OutputTemplateController.create` | POST | `/api/ai/businesses/:businessId/output-templates` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |
| `OutputTemplateController.preview` | POST | `/api/ai/businesses/:businessId/output-templates/preview` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |
| `OutputTemplateController.remove` | DELETE | `/api/ai/businesses/:businessId/output-templates/:id` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |
| `OutputTemplateController.resetCategory` | POST | `/api/ai/businesses/:businessId/output-templates/reset/:category` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |
| `OutputTemplateController.setDefault` | POST | `/api/ai/businesses/:businessId/output-templates/:id/set-default` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |
| `OutputTemplateController.update` | PUT | `/api/ai/businesses/:businessId/output-templates/:id` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide KEY output templates |

### ApprovalController (`approvals/approval.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ApprovalController.approve` | POST | `/businesses/:businessId/approvals/:approvalId/approve` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |
| `ApprovalController.cancel` | DELETE | `/businesses/:businessId/approvals/:approvalId` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |
| `ApprovalController.create` | POST | `/businesses/:businessId/approvals` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |
| `ApprovalController.delegate` | POST | `/businesses/:businessId/approvals/:approvalId/delegate` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |
| `ApprovalController.escalate` | POST | `/businesses/:businessId/approvals/:approvalId/escalate` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |
| `ApprovalController.reject` | POST | `/businesses/:businessId/approvals/:approvalId/reject` | open | membership only; follow-up SWEEP-CENSUS: operations write; approval decisions; approver identity is the service rule |

### AutomationController (`automation/automation.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AutomationController.aiGenerateFlow` | POST | `/automation/businesses/:businessId/ai/generate-flow` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.createPlaybook` | POST | `/automation/businesses/:businessId/playbooks` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.keyBuildFlow` | POST | `/automation/businesses/:businessId/key/build` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.keyExecuteFlow` | POST | `/automation/businesses/:businessId/key/execute` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.keyInterpretFlow` | POST | `/automation/businesses/:businessId/key/interpret` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.keyTalkFlow` | POST | `/automation/businesses/:businessId/key/talk` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.testRunPlaybook` | POST | `/automation/businesses/:businessId/playbooks/:playbookId/test-run` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |
| `AutomationController.updatePlaybook` | PATCH | `/automation/businesses/:businessId/playbooks/:playbookId` | open | membership only; follow-up SWEEP-CENSUS: automations write; playbooks and KEY-built flows |

### AutopilotController (`autopilot/autopilot.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AutopilotController.createTask` | POST | `/autopilot/businesses/:businessId/tasks` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.executeAction` | POST | `/autopilot/businesses/:businessId/actions/:actionId/execute` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.generateDraft` | POST | `/autopilot/businesses/:businessId/actions/:actionId/draft` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.generateSetupTasks` | POST | `/autopilot/businesses/:businessId/tasks/generate-setup` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.keyBuildDelegation` | POST | `/autopilot/businesses/:businessId/key/build` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.keyExecuteDelegation` | POST | `/autopilot/businesses/:businessId/key/execute` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.keyInterpretDelegation` | POST | `/autopilot/businesses/:businessId/key/interpret` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.keyTalkDelegation` | POST | `/autopilot/businesses/:businessId/key/talk` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.runLoop` | POST | `/autopilot/businesses/:businessId/loops/:loopId/run` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.updateLoop` | PATCH | `/autopilot/businesses/:businessId/loops/:loopId` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |
| `AutopilotController.updateSettings` | PATCH | `/autopilot/businesses/:businessId/settings` | open | membership only; follow-up SWEEP-CENSUS: automations write; ModuleScopeGuard runs but these handlers declare no scope; siblings carry automations write |

### BlueprintController (`blueprint/blueprint.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BlueprintController.inferFromEvents` | POST | `/blueprint/businesses/:businessId/infer/events` | open | membership only; follow-up SWEEP-CENSUS: settings write; the business blueprint and genome DNA |
| `BlueprintController.inferFromOnboarding` | POST | `/blueprint/businesses/:businessId/infer/onboarding` | open | membership only; follow-up SWEEP-CENSUS: settings write; the business blueprint and genome DNA |
| `BlueprintController.update` | PATCH | `/blueprint/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: settings write; the business blueprint and genome DNA |
| `BlueprintController.updateDnaSection` | PATCH | `/blueprint/businesses/:businessId/genome/dna/:section` | open | membership only; follow-up SWEEP-CENSUS: settings write; the business blueprint and genome DNA |

### BookingsAiController (`bookings/bookings-ai.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BookingsAiController.aiNoShowPredictor` | POST | `/bookings/businesses/:businessId/ai-no-show-predictor` | open | membership only; follow-up SWEEP-CENSUS: bookings read; AI analyses (POST, compute only) |
| `BookingsAiController.aiRevenueInsights` | POST | `/bookings/businesses/:businessId/ai-revenue-insights` | open | membership only; follow-up SWEEP-CENSUS: bookings read; AI analyses (POST, compute only) |
| `BookingsAiController.aiScheduleOptimizer` | POST | `/bookings/businesses/:businessId/ai-schedule-optimizer` | open | membership only; follow-up SWEEP-CENSUS: bookings read; AI analyses (POST, compute only) |
| `BookingsAiController.aiSearch` | POST | `/bookings/businesses/:businessId/ai-search` | open | membership only; follow-up SWEEP-CENSUS: bookings read; AI analyses (POST, compute only) |

### BookingsController (`bookings/bookings.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BookingsController.getCalendarAuthUrl` | GET | `/bookings/businesses/:businessId/calendar/auth-url` | exempt-check | check:assertGoogleConnectOwner (a credential-binding start, CEN-09; the Google Calendar consent is the owner's, D-99) |
| `BookingsController.addToWaitlist` | POST | `/bookings/businesses/:businessId/waitlist` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.batchServices` | POST | `/bookings/businesses/:businessId/services/batch` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.cancelWaitlistEntry` | POST | `/bookings/businesses/:businessId/waitlist/:entryId/cancel` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.convertWaitlistEntry` | POST | `/bookings/businesses/:businessId/waitlist/:entryId/convert` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.createBooking` | POST | `/bookings/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.createExternalCalendarEvent` | POST | `/bookings/businesses/:businessId/calendar/events` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.createInvoiceFromBooking` | POST | `/bookings/businesses/:businessId/bookings/:bookingId/create-invoice` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.createService` | POST | `/bookings/businesses/:businessId/services` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.createStaff` | POST | `/bookings/businesses/:businessId/staff` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.deleteExternalCalendarEvent` | DELETE | `/bookings/businesses/:businessId/calendar/events/:eventId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.deleteService` | DELETE | `/bookings/businesses/:businessId/services/:serviceId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.deleteStaff` | DELETE | `/bookings/businesses/:businessId/staff/:staffId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.disconnectCalendar` | POST | `/bookings/businesses/:businessId/calendar/disconnect` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `BookingsController.offerWaitlistSlot` | POST | `/bookings/businesses/:businessId/waitlist/:entryId/offer` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.rescheduleBooking` | POST | `/bookings/businesses/:businessId/bookings/:bookingId/reschedule` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.resolveCalendarConflict` | POST | `/bookings/businesses/:businessId/calendar/conflicts/:conflictId/resolve` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.scanCalendarConflicts` | POST | `/bookings/businesses/:businessId/calendar/conflicts/scan` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.setStaffAvailability` | POST | `/bookings/businesses/:businessId/staff/:staffId/availability` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.syncBookingToCalendar` | POST | `/bookings/businesses/:businessId/bookings/:bookingId/sync-calendar` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateBooking` | PATCH | `/bookings/businesses/:businessId/bookings/:bookingId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateBookingNotes` | POST | `/bookings/businesses/:businessId/bookings/:bookingId/notes` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateBookingStatus` | POST | `/bookings/businesses/:businessId/bookings/:bookingId/status` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateCalendarSettings` | PATCH | `/bookings/businesses/:businessId/calendar/settings` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `BookingsController.updateExternalCalendarEvent` | PATCH | `/bookings/businesses/:businessId/calendar/events/:eventId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateReminderSettings` | PATCH | `/bookings/businesses/:businessId/reminder-settings` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |
| `BookingsController.updateService` | PATCH | `/bookings/businesses/:businessId/services/:serviceId` | open | membership only; follow-up SWEEP-CENSUS: bookings write; STAFF default bookings is read, so gating takes booking handling from default staff (owner question) |

### BusinessAssetsController (`business-assets/business-assets.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessAssetsController.create` | POST | `/businesses/:businessId/business-assets` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `BusinessAssetsController.remove` | DELETE | `/businesses/:businessId/business-assets/:assetId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `BusinessAssetsController.update` | PATCH | `/businesses/:businessId/business-assets/:assetId` | open | membership only; follow-up SWEEP-CENSUS: content write |

### BusinessGenesisController (`business-genesis/business-genesis.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessGenesisController.analyzeIdea` | POST | `/business-genesis/businesses/:businessId/analyze-idea` | open | membership only; follow-up SWEEP-CENSUS: settings write; genesis documents for the business |
| `BusinessGenesisController.generateDocumentPack` | POST | `/business-genesis/businesses/:businessId/generate-document-pack` | open | membership only; follow-up SWEEP-CENSUS: settings write; genesis documents for the business |
| `BusinessGenesisController.generateMarketStrategy` | POST | `/business-genesis/businesses/:businessId/generate-market-strategy` | open | membership only; follow-up SWEEP-CENSUS: settings write; genesis documents for the business |
| `BusinessGenesisController.generateRiskRegister` | POST | `/business-genesis/businesses/:businessId/generate-risk-register` | open | membership only; follow-up SWEEP-CENSUS: settings write; genesis documents for the business |
| `BusinessGenesisController.generateRoadmap` | POST | `/business-genesis/businesses/:businessId/generate-roadmap` | open | membership only; follow-up SWEEP-CENSUS: settings write; genesis documents for the business |
| `BusinessGenesisController.submitAnswers` | POST | `/business-genesis/businesses/:businessId/answers` | exempt-check | check:assertProfileAnswersOwner (D-11) |

### GenomeChatController (`business-genesis/genome-chat.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GenomeChatController.applyUpdates` | POST | `/genome-chat/businesses/:businessId/apply-updates` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `GenomeChatController.sendMessage` | POST | `/genome-chat/businesses/:businessId/messages` | open | membership only; follow-up SWEEP-CENSUS: settings write |

### ConstitutionVersionController (`business-genome/constitution-version.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConstitutionVersionController.archive` | POST | `/business-genome/businesses/:businessId/constitution/versions/:version/archive` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `ConstitutionVersionController.generate` | POST | `/business-genome/businesses/:businessId/constitution/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write |

### GenomeEvolutionController (`business-genome/genome-evolution.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GenomeEvolutionController.approve` | POST | `/business-genome/businesses/:businessId/evolution-proposals/:id/approve` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `GenomeEvolutionController.create` | POST | `/business-genome/businesses/:businessId/evolution-proposals` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `GenomeEvolutionController.edit` | PATCH | `/business-genome/businesses/:businessId/evolution-proposals/:id` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `GenomeEvolutionController.generateFromTemporalFlow` | POST | `/business-genome/businesses/:businessId/evolution-proposals/generate-from-temporal-flow` | open | membership only; follow-up SWEEP-CENSUS: settings write |
| `GenomeEvolutionController.reject` | POST | `/business-genome/businesses/:businessId/evolution-proposals/:id/reject` | open | membership only; follow-up SWEEP-CENSUS: settings write |

### KeyGenomeController (`business-genome/key-genome/key-genome.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyGenomeController.accept` | POST | `/business-genome/businesses/:businessId/key-genome/signals/:signalId/accept` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.acceptRecommendation` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/accept` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.applyRecommendation` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/apply` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.cancelExperiment` | POST | `/business-genome/businesses/:businessId/key-genome/experiments/:experimentId/cancel` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.completeExperiment` | POST | `/business-genome/businesses/:businessId/key-genome/experiments/:experimentId/complete` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.computeDepartment` | POST | `/business-genome/businesses/:businessId/key-genome/departments/:code/compute` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.computeDepartments` | POST | `/business-genome/businesses/:businessId/key-genome/departments/compute` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.computeMarketingGrowthSnapshot` | POST | `/business-genome/businesses/:businessId/key-genome/marketing-growth/snapshot/compute` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.computeOperationsSnapshot` | POST | `/business-genome/businesses/:businessId/key-genome/operations/snapshot/compute` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.createContentStrategy` | POST | `/business-genome/businesses/:businessId/key-genome/marketing-growth/content-strategy` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.createExperiment` | POST | `/business-genome/businesses/:businessId/key-genome/experiments` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.createGrowthChannel` | POST | `/business-genome/businesses/:businessId/key-genome/marketing-growth/channels` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteContentStrategy` | DELETE | `/business-genome/businesses/:businessId/key-genome/marketing-growth/content-strategy/:strategyId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteCustomerSegment` | DELETE | `/business-genome/businesses/:businessId/key-genome/customer-sales/segments/:segmentId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteDeliveryCapability` | DELETE | `/business-genome/businesses/:businessId/key-genome/operations/capabilities/:capabilityId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteGrowthChannel` | DELETE | `/business-genome/businesses/:businessId/key-genome/marketing-growth/channels/:channelId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteOperationalProcess` | DELETE | `/business-genome/businesses/:businessId/key-genome/operations/processes/:processId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.deleteSalesMotion` | DELETE | `/business-genome/businesses/:businessId/key-genome/customer-sales/motions/:motionId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.dismissRecommendation` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/dismiss` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.escalateRecommendation` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/escalate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateCustomerSalesRecommendations` | POST | `/business-genome/businesses/:businessId/key-genome/customer-sales/recommendations/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateCustomerSalesSignals` | POST | `/business-genome/businesses/:businessId/key-genome/customer-sales/signals/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateMarketingGrowthRecommendations` | POST | `/business-genome/businesses/:businessId/key-genome/marketing-growth/recommendations/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateMarketingGrowthSignals` | POST | `/business-genome/businesses/:businessId/key-genome/marketing-growth/signals/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateOperationsRecommendations` | POST | `/business-genome/businesses/:businessId/key-genome/operations/recommendations/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateOperationsSignals` | POST | `/business-genome/businesses/:businessId/key-genome/operations/signals/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.generateRecommendations` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/generate` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.ignoreRecommendation` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/ignore` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.merge` | POST | `/business-genome/businesses/:businessId/key-genome/signals/:signalId/merge` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.reject` | POST | `/business-genome/businesses/:businessId/key-genome/signals/:signalId/reject` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.review` | POST | `/business-genome/businesses/:businessId/key-genome/signals/:signalId/review` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.seedDepartments` | POST | `/business-genome/businesses/:businessId/key-genome/departments/seed` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.setOutcomeLearningWindow` | PUT | `/business-genome/businesses/:businessId/key-genome/outcome-windows/:domain` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.startExperiment` | POST | `/business-genome/businesses/:businessId/key-genome/experiments/:experimentId/start` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.trackRecommendationOutcome` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/track-outcome` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.updateContentStrategy` | PATCH | `/business-genome/businesses/:businessId/key-genome/marketing-growth/content-strategy/:strategyId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.updateGrowthChannel` | PATCH | `/business-genome/businesses/:businessId/key-genome/marketing-growth/channels/:channelId` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.upsertCustomerSegment` | POST | `/business-genome/businesses/:businessId/key-genome/customer-sales/segments` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.upsertDeliveryCapability` | POST | `/business-genome/businesses/:businessId/key-genome/operations/capabilities` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.upsertOperationalProcess` | POST | `/business-genome/businesses/:businessId/key-genome/operations/processes` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |
| `KeyGenomeController.upsertSalesMotion` | POST | `/business-genome/businesses/:businessId/key-genome/customer-sales/motions` | open | membership only; follow-up SWEEP-CENSUS: settings write; finance signals and recommendations already need revenue write (requireSignalAction / requireRecommendationAction, D-128); the rest is membership only |

### CalendarController (`calendar/calendar.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CalendarController.keyExecuteCalendar` | POST | `/calendar/businesses/:businessId/key/execute` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `CalendarController.keyInterpretCalendar` | POST | `/calendar/businesses/:businessId/key/interpret` | open | membership only; follow-up SWEEP-CENSUS: bookings write; requireUser only |
| `CalendarController.patchSyncSettings` | PATCH | `/calendar/businesses/:businessId/sync/settings` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `CalendarController.syncConnect` | POST | `/calendar/businesses/:businessId/sync/google/connect` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `CalendarController.syncDisconnect` | POST | `/calendar/businesses/:businessId/sync/google/disconnect` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `CalendarController.syncGoogleCalendarToTemporalFlow` | POST | `/calendar/businesses/:businessId/sync/google/temporal-flow` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `CalendarController.syncResync` | POST | `/calendar/businesses/:businessId/sync/google/resync` | exempt-check | check:assertGoogleConnectOwner (D-99) |

### CatalogController (`catalog/catalog.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CatalogController.batchServices` | POST | `/catalog/businesses/:businessId/services/batch` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.bulkUpdateProducts` | PATCH | `/catalog/businesses/:businessId/products/bulk` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.createProduct` | POST | `/catalog/businesses/:businessId/products` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.createService` | POST | `/catalog/businesses/:businessId/services` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.deleteProduct` | DELETE | `/catalog/businesses/:businessId/products/:productId` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.deleteService` | DELETE | `/catalog/businesses/:businessId/services/:serviceId` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.updateProduct` | PATCH | `/catalog/businesses/:businessId/products/:productId` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |
| `CatalogController.updateService` | PATCH | `/catalog/businesses/:businessId/services/:serviceId` | open | membership only; follow-up SWEEP-CENSUS: revenue write (products, as CommerceController) / bookings write (services); withdrawn from this packet: gating the product writes moves commerce_create_product, commerce_update_product and apply_storefront_recommendation out of the legacy commerce job-role family, pinned as an owner decision in job-role-policy.service.spec.ts (owner question) |

### ChangeOrderController (`change-orders/change-order.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ChangeOrderController.create` | POST | `/change-orders/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: projects write |
| `ChangeOrderController.delete` | DELETE | `/change-orders/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write |
| `ChangeOrderController.update` | PATCH | `/change-orders/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write |

### CommerceInsightsController (`commerce/commerce-insights.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommerceInsightsController.captureMarginSnapshot` | POST | `/commerce/businesses/:businessId/products/:productId/insights/snapshot` | open | membership only; follow-up SWEEP-CENSUS: revenue read; AI insights (POST, compute only) |
| `CommerceInsightsController.identifyOpportunities` | POST | `/commerce/businesses/:businessId/ai-product-opportunities` | open | membership only; follow-up SWEEP-CENSUS: revenue read; AI insights (POST, compute only) |
| `CommerceInsightsController.recommendFulfillmentStrategy` | POST | `/commerce/businesses/:businessId/products/:productId/ai-fulfillment-strategy` | open | membership only; follow-up SWEEP-CENSUS: revenue read; AI insights (POST, compute only) |
| `CommerceInsightsController.recommendPricing` | POST | `/commerce/businesses/:businessId/products/:productId/ai-pricing-recommendation` | open | membership only; follow-up SWEEP-CENSUS: revenue read; AI insights (POST, compute only) |
| `CommerceInsightsController.rewriteProductCopy` | POST | `/commerce/businesses/:businessId/products/:productId/ai-copy` | open | membership only; follow-up SWEEP-CENSUS: revenue read; AI insights (POST, compute only) |

### CommerceController (`commerce/commerce.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommerceController.confirmGmailConnection` | POST | `/commerce/businesses/:businessId/gmail/confirm` | exempt-check | check:assertConnectAuthority (the mailbox is the owner's, D-42) |
| `CommerceController.disconnectGmail` | DELETE | `/commerce/businesses/:businessId/gmail` | exempt-check | service-check:GMAIL_OWNER_ONLY (GmailService.disconnectGmail, D-42) |
| `CommerceController.getGmailAuthUrl` | GET | `/commerce/businesses/:businessId/gmail/auth-url` | exempt-check | check:assertConnectAuthority (a credential-binding start, CEN-09; GMAIL_OWNER_ONLY, D-11, D-42) |
| `CommerceController.setDocumentTemplate` | PATCH | `/commerce/businesses/:businessId/document-templates` | exempt-check | check:isProfileOwner (D-11, R0-09g) |

### DocumentTemplateController (`commerce/document-template/document-template.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DocumentTemplateController.create` | POST | `/commerce/document-templates/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: revenue write |
| `DocumentTemplateController.delete` | DELETE | `/commerce/document-templates/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: revenue write |
| `DocumentTemplateController.setDefault` | POST | `/commerce/document-templates/businesses/:businessId/:id/set-default` | open | membership only; follow-up SWEEP-CENSUS: revenue write |
| `DocumentTemplateController.update` | PATCH | `/commerce/document-templates/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: revenue write |

### DriveIntakeController (`commerce/drive-intake.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DriveIntakeController.sync` | POST | `/drive/businesses/:businessId/sync` | exempt-check | check:assertGoogleConnectOwner (D-99, D-132) |

### CommunicationsController (`communications/communications.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommunicationsController.aiGenerateDraft` | POST | `/communications/businesses/:businessId/content-ai/generate-draft` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiRewrite` | POST | `/communications/businesses/:businessId/content-ai/rewrite` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiShortenExpand` | POST | `/communications/businesses/:businessId/content-ai/shorten-expand` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestAudienceSegments` | POST | `/communications/businesses/:businessId/content-ai/suggest-audience-segments` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestChannels` | POST | `/communications/businesses/:businessId/content-ai/suggest-channels` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestContentIdeas` | POST | `/communications/businesses/:businessId/content-ai/suggest-content-ideas` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestCta` | POST | `/communications/businesses/:businessId/content-ai/suggest-cta` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestHashtags` | POST | `/communications/businesses/:businessId/content-ai/suggest-hashtags` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestPreviewText` | POST | `/communications/businesses/:businessId/content-ai/suggest-preview-text` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestSubjects` | POST | `/communications/businesses/:businessId/content-ai/suggest-subjects` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.aiSuggestTime` | POST | `/communications/businesses/:businessId/content-ai/suggest-time` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.cancel` | POST | `/communications/businesses/:businessId/deliveries/:deliveryId/cancel` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.createContent` | POST | `/communications/businesses/:businessId/content` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.deleteContent` | DELETE | `/communications/businesses/:businessId/content/:id` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.expandAudience` | POST | `/communications/businesses/:businessId/audience/expand` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.listWhatsAppPhones` | POST | `/communications/businesses/:businessId/whatsapp/list-phones` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.publishNow` | POST | `/communications/businesses/:businessId/content/:id/publish` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.reschedule` | PATCH | `/communications/businesses/:businessId/deliveries/:deliveryId/reschedule` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.retry` | POST | `/communications/businesses/:businessId/deliveries/:deliveryId/retry` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.retryAllFailed` | POST | `/communications/businesses/:businessId/content/:id/retry-all` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.schedule` | POST | `/communications/businesses/:businessId/content/:id/schedule` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.updateContent` | PATCH | `/communications/businesses/:businessId/content/:id` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.upsertVariant` | POST | `/communications/businesses/:businessId/content/:id/variants` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.validateEmailSend` | POST | `/communications/businesses/:businessId/email/validate-send` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |
| `CommunicationsController.verifyWhatsAppConnection` | POST | `/communications/businesses/:businessId/whatsapp/verify-connection` | open | membership only; follow-up SWEEP-CENSUS: content write (connections: connect write) |

### MessageIntakeController (`communications/message-intake.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MessageIntakeController.approve` | POST | `/communications/businesses/:businessId/message-intake/:intakeId/approve` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `MessageIntakeController.reject` | POST | `/communications/businesses/:businessId/message-intake/:intakeId/reject` | open | membership only; follow-up SWEEP-CENSUS: crm write |

### OmnichannelController (`communications/omnichannel.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OmnichannelController.approveDraft` | POST | `/api/communications/businesses/:businessId/drafts/:id/approve` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.createTrigger` | POST | `/api/communications/businesses/:businessId/triggers` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.generateReplyDraft` | POST | `/api/communications/businesses/:businessId/threads/:threadId/generate-reply` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.markDraftSent` | POST | `/api/communications/businesses/:businessId/drafts/:id/sent` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.recordConsent` | POST | `/api/communications/businesses/:businessId/consent` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.rejectDraft` | POST | `/api/communications/businesses/:businessId/drafts/:id/reject` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.scoreIntent` | POST | `/api/communications/businesses/:businessId/intents/:id/score` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.seedTriggers` | POST | `/api/communications/businesses/:businessId/triggers/seed` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.sendDraft` | POST | `/api/communications/businesses/:businessId/drafts/:id/send` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.toggleTrigger` | PATCH | `/api/communications/businesses/:businessId/triggers/:id/toggle` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |
| `OmnichannelController.updateDraft` | PATCH | `/api/communications/businesses/:businessId/drafts/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write; ModuleScopeGuard runs but no handler declares a scope |

### CommunityController (`community/community.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommunityController.addComment` | POST | `/businesses/:businessId/community/posts/:postId/comments` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.applyToOpportunity` | POST | `/businesses/:businessId/community/opportunities/:id/apply` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.closeOpportunity` | POST | `/businesses/:businessId/community/opportunities/:id/close` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createCollabRequest` | POST | `/businesses/:businessId/community/collab-requests` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createCollaboration` | POST | `/businesses/:businessId/community/collaborations` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createConnection` | POST | `/businesses/:businessId/community/connections` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createEndorsement` | POST | `/businesses/:businessId/community/endorsements` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createOpportunity` | POST | `/businesses/:businessId/community/opportunities` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createPost` | POST | `/businesses/:businessId/community/posts` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createQuoteRequest` | POST | `/businesses/:businessId/community/quote-requests` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createReferral` | POST | `/businesses/:businessId/community/referrals` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.createReview` | POST | `/businesses/:businessId/community/reviews` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.deleteComment` | DELETE | `/businesses/:businessId/community/comments/:commentId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.deleteOpportunity` | DELETE | `/businesses/:businessId/community/opportunities/:id` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.deletePost` | DELETE | `/businesses/:businessId/community/posts/:postId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.deleteReview` | DELETE | `/businesses/:businessId/community/reviews/:reviewId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.dismissRelationshipInsight` | POST | `/businesses/:businessId/community/relationship-insights/dismiss` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.draftIntroMessage` | POST | `/businesses/:businessId/community/intro-draft` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.joinCohort` | POST | `/businesses/:businessId/community/cohorts/:cohortId/join` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.leaveCohort` | DELETE | `/businesses/:businessId/community/cohorts/:cohortId/leave` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.likePost` | POST | `/community/posts/:postId/like` | open | membership only; follow-up SWEEP-CENSUS: content write; bare post id: a like by the caller |
| `CommunityController.markAllNotificationsRead` | POST | `/businesses/:businessId/community/notifications/read-all` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.markNotificationRead` | PATCH | `/businesses/:businessId/community/notifications/:notificationId/read` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.markReferralOutcome` | PATCH | `/businesses/:businessId/community/referrals/:referralId/outcome` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.matchProvidersForNeed` | POST | `/businesses/:businessId/community/need-matches` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.proposePartnerProgram` | POST | `/businesses/:businessId/community/partner-programs` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.publishResource` | POST | `/businesses/:businessId/community/resources` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.recordAiSuggestionEvent` | POST | `/businesses/:businessId/community/ai-suggestion-events` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.recordProfileView` | POST | `/community/profile-views/:viewedBusinessId` | exempt-own | records the caller viewing another business profile (OptionalAuthGuard) |
| `CommunityController.recordResourceDownload` | POST | `/businesses/:businessId/community/resources/:id/download` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.removeConnection` | DELETE | `/businesses/:businessId/community/connections` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.removeEndorsement` | DELETE | `/businesses/:businessId/community/endorsements` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.respondToCollabRequest` | PATCH | `/businesses/:businessId/community/collab-requests/:requestId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.respondToCollaboration` | PATCH | `/businesses/:businessId/community/collaborations/:collabId/respond` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.respondToOpportunityApplication` | PATCH | `/businesses/:businessId/community/opportunity-applications/:id/respond` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.respondToPartnerProgram` | PATCH | `/businesses/:businessId/community/partner-programs/:id/respond` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.respondToQuoteRequest` | PATCH | `/businesses/:businessId/community/quote-requests/:requestId/respond` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.restoreRelationshipInsight` | DELETE | `/businesses/:businessId/community/relationship-insights/dismiss/:targetBusinessId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.saveBusiness` | POST | `/businesses/:businessId/community/saved` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.sendMessage` | POST | `/businesses/:businessId/community/messages` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.submitMatchFeedback` | POST | `/businesses/:businessId/community/match-feedback` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.terminatePartnerProgram` | POST | `/businesses/:businessId/community/partner-programs/:id/terminate` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.unsaveBusiness` | DELETE | `/businesses/:businessId/community/saved/:savedBusinessId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.updateEndorsement` | PATCH | `/businesses/:businessId/community/endorsements` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.updateOpportunity` | PATCH | `/businesses/:businessId/community/opportunities/:id` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.updatePost` | PATCH | `/businesses/:businessId/community/posts/:postId` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.updateReferralStatus` | PATCH | `/businesses/:businessId/community/referrals/:referralId/status` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |
| `CommunityController.withdrawApplication` | POST | `/businesses/:businessId/community/opportunity-applications/:id/withdraw` | open | membership only; follow-up SWEEP-CENSUS: content write; cross-business community actions (posts, connections, referrals, reviews); community posts are marketing under D-95's trash rule |

### ConnectorController (`core/connectors/connector.controller.ts`)

Read since the review repair (SEC-1). POST credentials is applied (above); GET webhook-info is a
reviewed secret read (above).

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConnectorController.deleteCredentials` | DELETE | `/connectors/businesses/:businessId/credentials/:type` | exempt-check | check:assertConnectorSettingsAdmin (settings admin, review repair SEC-1: it clears the connector's stored credentials); gmail and the Google Suite connections keep their owner rules first (GMAIL_OWNER_ONLY D-11, GOOGLE_CONNECT_OWNER_ONLY D-99) |
| `ConnectorController.disconnect` | POST | `/connectors/businesses/:businessId/disconnect/:type` | exempt-check | check:assertConnectorSettingsAdmin (settings admin: a connector's disconnect clears its stored credentials, QuickBooksConnector.disconnect); gmail and the Google Suite connections keep their owner rules first |
| `ConnectorController.reconnect` | POST | `/connectors/businesses/:businessId/reconnect/:type` | exempt-check | check:assertConnectorSettingsAdmin (settings admin: it disconnects first); gmail and the Google Suite connections keep their owner rules first |
| `ConnectorController.authenticate` | POST | `/connectors/businesses/:businessId/authenticate/:type` | exempt-check | check:assertConnectorBindingAuthority (round 2 class repair, finding CW-4): a connector that is already connected gets its status answer from any member (R0-CMF6-K04); otherwise Connect binds (WhatsApp's connected verification lifts an explicit disconnect) or starts a binding (the OAuth consent start it answers): settings admin, gmail's and the Google Suite connections' owner rules first (D-11, D-42, D-99) |
| `ConnectorController.runHealthCheck` | POST | `/connectors/businesses/:businessId/health-check/run` | open | membership only; follow-up SWEEP-CENSUS: settings read; it runs provider checks and writes health rows, no credential |
| `ConnectorController.smoke` | POST | `/connectors/businesses/:businessId/smoke/:type` | open | membership only for the connectors whose check binds nothing (R0-CMF6-K05 pins it open); gmail: GMAIL_OWNER_ONLY (D-11); a connector whose passed check records a binding (CONNECTORS_BINDING_ON_CHECK: WhatsApp, round 2 CW-4) takes Connect's rule, assertConnectorBindingAuthority (settings admin); follow-up SWEEP-CENSUS: settings write for the rest |
| `ConnectorController.sync` | POST | `/connectors/businesses/:businessId/sync/:type` | open | membership only (gmail and Google Suite: owner rules, D-11, D-99); follow-up SWEEP-CENSUS: the synced module's write (crm for contact sources, revenue for accounting); R0-CMF6-K05 and V94D-F02 pin it open for other connectors |
| `ConnectorController.test` | POST | `/connectors/businesses/:businessId/test/:type` | open | membership only; follow-up SWEEP-CENSUS: settings read; a credential check, no write (R0-CMF6-K04, V94D-F02 pin it open) |
| `ConnectorController.updateInboxConfig` | PATCH | `/connectors/businesses/:businessId/inbox-config/:type` | open | membership only; follow-up SWEEP-CENSUS: settings write; Key Inbox processing settings only (R0-CMF6-M02 decided it open) |

### GoogleSuiteController (`core/connectors/google-suite.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GoogleSuiteController.buildAuthUrl` | POST | `/connect/google-suite/businesses/:businessId/auth-url` | exempt-check | check:assertGoogleConnectOwner (every Google connection is started by the owner, D-99; gmail through GmailService.assertConnectAuthority, D-11) |

### ProjectsController (`projects/projects.controller.ts`)

Every other route is applied (above).

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ProjectsController.approvePlan` | POST | `/projects/businesses/:businessId/plans/:planId/approve` | exempt-check | service-check:assertMayGovernPlans (owner ruling D-85: OWNER/ADMIN or projects:write; review repair CR-2: a handler scope refused the OWNER or ADMIN whose explicit map holds projects below write, which D-85 admits) |
| `ProjectsController.deletePlan` | DELETE | `/projects/businesses/:businessId/plans/:planId` | exempt-check | service-check:assertMayGovernPlans (owner ruling D-85, as approve; only a draft plan is deleted) |

### ConnectController (`connect/connect.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConnectController.backfillConnectorForm` | POST | `/connect/businesses/:businessId/connector-forms/:source/:leadFormId/backfill` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.backfillFormResponses` | POST | `/connect/businesses/:businessId/forms/:formId/backfill` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.cancelBpScheduled` | DELETE | `/connect/businesses/:businessId/business-profile/scheduled-posts/:id` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.createBpPost` | POST | `/connect/businesses/:businessId/business-profile/posts` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.createForm` | POST | `/connect/businesses/:businessId/forms` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.deleteConnectorFormMapping` | DELETE | `/connect/businesses/:businessId/connector-forms/:source/:externalFormId/mapping` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.deleteForm` | DELETE | `/connect/businesses/:businessId/forms/:formId` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.deleteFormMapping` | DELETE | `/connect/businesses/:businessId/forms/:formId/mapping` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.disconnectSource` | DELETE | `/connect/businesses/:businessId/contact-sources/:source` | exempt-check | check:assertGoogleConnectOwner (google_contacts, D-99) and check:assertMemberModuleLevel (outlook_contacts: settings admin, it clears the Outlook tokens whose consent start is settings admin, SV-3; round 1 class repair, CEN-10b) |
| `ConnectController.parseSignature` | POST | `/connect/businesses/:businessId/contact-sources/parse-signature` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.processNewFormResponses` | POST | `/connect/businesses/:businessId/forms/:formId/process-new` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.replyBpReview` | POST | `/connect/businesses/:businessId/business-profile/reviews/reply` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.resyncSource` | POST | `/connect/businesses/:businessId/contact-sources/:source/resync` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `ConnectController.saveConnectorFormMapping` | POST | `/connect/businesses/:businessId/connector-forms/:source/:externalFormId/mapping` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.saveContactsRules` | PUT | `/connect/businesses/:businessId/contacts/mapping-rules` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.saveFormMapping` | POST | `/connect/businesses/:businessId/forms/:formId/mapping` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.saveOutlookRules` | PUT | `/connect/businesses/:businessId/outlook-contacts/mapping-rules` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.scheduleBpPost` | POST | `/connect/businesses/:businessId/business-profile/scheduled-posts` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.setBpActiveLocation` | POST | `/connect/businesses/:businessId/business-profile/active-location` | exempt-check | check:assertGoogleConnectOwner (D-99; round 2 class repair, finding CW-3: it moves the account and location the owner's Google Business Profile tokens act on, Business.bpAccountId and bpLocationId, as calendarId is the owner's on the calendar settings doors) |
| `ConnectController.setSignatureParsing` | PUT | `/connect/businesses/:businessId/contact-sources/signature-parsing` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ConnectController.syncAllSources` | POST | `/connect/businesses/:businessId/contact-sources/sync-all` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `ConnectController.syncContacts` | POST | `/connect/businesses/:businessId/contacts/sync` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `ConnectController.syncOutlookContacts` | POST | `/connect/businesses/:businessId/outlook-contacts/sync` | open | membership only; follow-up SWEEP-CENSUS: connect write |

### ContentOpsController (`content-ops/content-ops.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ContentOpsController.assign` | POST | `/businesses/:businessId/content-requests/:requestId/assign` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.cancel` | DELETE | `/businesses/:businessId/content-requests/:requestId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.create` | POST | `/businesses/:businessId/content-requests` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.createDriveDoc` | POST | `/businesses/:businessId/content-requests/:requestId/drive-doc` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.createDriveFolder` | POST | `/businesses/:businessId/content-requests/:requestId/drive-folder` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.deliver` | POST | `/businesses/:businessId/content-requests/:requestId/deliver` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.generateInvoice` | POST | `/businesses/:businessId/content-requests/:requestId/generate-invoice` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.review` | POST | `/businesses/:businessId/content-requests/:requestId/review` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.startProduction` | POST | `/businesses/:businessId/content-requests/:requestId/start-production` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.submit` | POST | `/businesses/:businessId/content-requests/:requestId/submit` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.submitForReview` | POST | `/businesses/:businessId/content-requests/:requestId/submit-for-review` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.update` | PATCH | `/businesses/:businessId/content-requests/:requestId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `ContentOpsController.uploadDeliverables` | POST | `/businesses/:businessId/content-requests/:requestId/upload-deliverables` | open | membership only; follow-up SWEEP-CENSUS: content write |

### ReceiptController (`continental-ops/receipt.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ReceiptController.create` | POST | `/continental-ops/businesses/:businessId/receipts` | open | membership only; follow-up SWEEP-CENSUS: module to be named (not classified) |
| `ReceiptController.remove` | DELETE | `/continental-ops/businesses/:businessId/receipts/:id` | open | membership only; follow-up SWEEP-CENSUS: module to be named (not classified) |
| `ReceiptController.update` | PATCH | `/continental-ops/businesses/:businessId/receipts/:id` | open | membership only; follow-up SWEEP-CENSUS: module to be named (not classified) |

### ConversionController (`conversion/conversion.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConversionController.assignSalesRep` | PATCH | `/conversion/businesses/:businessId/contacts/:contactId/sales-rep` | exempt-check | check:assertContactVisible (CRM visibility of the contact) |
| `ConversionController.convertLeadMagnet` | POST | `/conversion/public/lead-magnets/:businessId/:slug/convert` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `ConversionController.createLeadMagnet` | POST | `/conversion/businesses/:businessId/lead-magnets` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `ConversionController.setCommission` | PATCH | `/conversion/businesses/:businessId/sales-reps/:repId/commission` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `ConversionController.setSubConfig` | PATCH | `/conversion/businesses/:businessId/products/:productId/subscription-config` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `ConversionController.setUpsells` | PATCH | `/conversion/businesses/:businessId/products/:productId/upsells` | open | membership only; follow-up SWEEP-CENSUS: crm write |

### CrmSequenceController (`crm/crm-sequence.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CrmSequenceController.advanceEnrollment` | POST | `/crm/businesses/:businessId/sequences/:id/enrollments/:enrollmentId/advance` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.createSequence` | POST | `/crm/businesses/:businessId/sequences` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.deleteSequence` | DELETE | `/crm/businesses/:businessId/sequences/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.duplicateSequence` | POST | `/crm/businesses/:businessId/sequences/:id/duplicate` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.enrollContacts` | POST | `/crm/businesses/:businessId/sequences/:id/enroll` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.promoteVariant` | POST | `/crm/businesses/:businessId/sequences/:id/nodes/:nodeId/promote-variant` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.unenrollContact` | POST | `/crm/businesses/:businessId/sequences/:id/enrollments/:enrollmentId/unenroll` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.updateAttributionSettings` | PATCH | `/crm/businesses/:businessId/sequences/settings/attribution` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `CrmSequenceController.updateSequence` | PATCH | `/crm/businesses/:businessId/sequences/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write |

### DeviceController (`device/device.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DeviceController.approveIntake` | PATCH | `/api/device/businesses/:businessId/intakes/:id/approve` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.createCapture` | POST | `/api/device/businesses/:businessId/captures` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.createContactFromCard` | POST | `/api/device/businesses/:businessId/contacts-from-card` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.createVoiceSession` | POST | `/api/device/businesses/:businessId/voice-sessions` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.endVoiceSession` | PATCH | `/api/device/businesses/:businessId/voice-sessions/:id/end` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.processCapture` | POST | `/api/device/businesses/:businessId/captures/:id/process` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.rejectIntake` | PATCH | `/api/device/businesses/:businessId/intakes/:id/reject` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |
| `DeviceController.saveVoicePreference` | POST | `/api/device/businesses/:businessId/voice-preferences` | open | membership only; follow-up SWEEP-CENSUS: crm write (captures, contacts from cards) / operations write (intakes); ModuleScopeGuard runs but no handler declares a scope |

### DiagnosticsController (`diagnostics/diagnostics.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DiagnosticsController.runFull` | POST | `/api/diagnostics/run` | exempt-check | check:assertSuperAdmin (platform diagnostics) |
| `DiagnosticsController.runSingleCheck` | POST | `/api/diagnostics/check/:name` | exempt-check | check:assertSuperAdmin (platform diagnostics) |

### DocumentsController (`documents/documents.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DocumentsController.deleteInstance` | DELETE | `/documents/businesses/:businessId/instances/:instanceId` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.deleteOrgStandard` | DELETE | `/documents/businesses/:businessId/standards/:standardId` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.detectImpact` | POST | `/documents/businesses/:businessId/detect-impact` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.generateDocument` | POST | `/documents/businesses/:businessId/generate` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.importFromDrive` | POST | `/documents/businesses/:businessId/instances/:instanceId/import-from-drive` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.linkDriveFile` | PATCH | `/documents/businesses/:businessId/instances/:instanceId/drive-link` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.markDriveSynced` | PATCH | `/documents/businesses/:businessId/instances/:instanceId/drive-synced` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.pullFromDrive` | POST | `/documents/businesses/:businessId/instances/:instanceId/pull-from-drive` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.resolveReview` | PATCH | `/documents/businesses/:businessId/reviews/:reviewId` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.sendDocumentEmail` | POST | `/documents/businesses/:businessId/instances/:instanceId/send-email` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.tweakDocument` | POST | `/documents/businesses/:businessId/instances/:instanceId/tweak` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.updateSection` | PATCH | `/documents/businesses/:businessId/instances/:instanceId/sections/:sectionKey` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.updateStatus` | PATCH | `/documents/businesses/:businessId/instances/:instanceId/status` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |
| `DocumentsController.upsertOrgStandard` | POST | `/documents/businesses/:businessId/standards` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_* maps to operations in the KEY member map |

### EducationController (`education/education.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EducationController.enrollInCourse` | POST | `/businesses/:businessId/education/enroll/:courseId` | open | membership only; follow-up SWEEP-CENSUS: own-record review; course enrolment and progress may be the member's own (not verified) |
| `EducationController.updateProgress` | PATCH | `/businesses/:businessId/education/progress/:courseId` | open | membership only; follow-up SWEEP-CENSUS: own-record review; course enrolment and progress may be the member's own (not verified) |

### EmailMarketingController (`email-marketing/email-marketing.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EmailMarketingController.cancelSchedule` | POST | `/businesses/:businessId/campaigns/:id/cancel-schedule` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.createCampaign` | POST | `/businesses/:businessId/campaigns` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.deleteCampaign` | DELETE | `/businesses/:businessId/campaigns/:id` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.preSendValidation` | POST | `/businesses/:businessId/campaign-intelligence/pre-send-validation/:campaignId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.scheduleCampaign` | POST | `/businesses/:businessId/campaigns/:id/schedule` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.sendCampaign` | POST | `/businesses/:businessId/campaigns/:id/send` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.unsubscribeContact` | POST | `/marketing/businesses/:businessId/unsubscribe/:contactId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `EmailMarketingController.updateCampaign` | PATCH | `/businesses/:businessId/campaigns/:id` | open | membership only; follow-up SWEEP-CENSUS: content write |

### MarketingAiController (`email-marketing/marketing-ai.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketingAiController.aiAudience` | POST | `/marketing/businesses/:businessId/marketing/ai-audience` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiCampaignContent` | POST | `/marketing/businesses/:businessId/marketing/ai-campaign-content` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiFormOptimizer` | POST | `/marketing/businesses/:businessId/marketing/ai-form-optimizer` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiPerformance` | POST | `/marketing/businesses/:businessId/marketing/ai-performance` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiSearch` | POST | `/marketing/businesses/:businessId/marketing/ai-search` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiStrategy` | POST | `/marketing/businesses/:businessId/marketing/ai-strategy` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.aiSubjectLines` | POST | `/marketing/businesses/:businessId/marketing/ai-subject-lines` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingAiController.submitMarketingBrief` | POST | `/marketing/businesses/:businessId/marketing/submit-brief` | open | membership only; follow-up SWEEP-CENSUS: content write |

### EventsController (`events/events.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EventsController.checkIn` | POST | `/businesses/:businessId/events/:eventId/attendees/:attendeeId/check-in` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.createAttendee` | POST | `/businesses/:businessId/events/:eventId/attendees` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.createEvent` | POST | `/businesses/:businessId/events` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.createTicketType` | POST | `/businesses/:businessId/events/:eventId/ticket-types` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.deleteAttendee` | DELETE | `/businesses/:businessId/events/:eventId/attendees/:attendeeId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.deleteEvent` | DELETE | `/businesses/:businessId/events/:eventId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.deleteTicketType` | DELETE | `/businesses/:businessId/events/:eventId/ticket-types/:ticketTypeId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.undoCheckIn` | DELETE | `/businesses/:businessId/events/:eventId/attendees/:attendeeId/check-in` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.updateAttendee` | PATCH | `/businesses/:businessId/events/:eventId/attendees/:attendeeId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.updateEvent` | PATCH | `/businesses/:businessId/events/:eventId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `EventsController.updateTicketType` | PATCH | `/businesses/:businessId/events/:eventId/ticket-types/:ticketTypeId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |

### EvidenceController (`evidence/evidence.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EvidenceController.delete` | DELETE | `/evidence/:evidenceId` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `EvidenceController.predictRequirement` | POST | `/businesses/:businessId/evidence/predict-requirement` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `EvidenceController.submit` | POST | `/businesses/:businessId/evidence` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `EvidenceController.verify` | POST | `/evidence/:evidenceId/verify` | open | membership only; follow-up SWEEP-CENSUS: operations write |

### AdminFeatureFlagsController (`feature-flags/feature-flags.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminFeatureFlagsController.update` | PUT | `/api/admin/feature-flags/:key` | exempt-check | check:assertSuperAdmin (platform feature flags) |

### FinanceController (`finance/finance.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FinanceController.applyBankRules` | POST | `/finance/businesses/:businessId/bank-rules/apply` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.applyBankRulesToAccount` | POST | `/finance/businesses/:businessId/accounts/:accountId/bank-rules/apply` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.archiveAccount` | DELETE | `/finance/businesses/:businessId/accounts/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.archiveCoa` | DELETE | `/finance/businesses/:businessId/chart-of-accounts/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.bulkCreateExchangeRates` | POST | `/finance/businesses/:businessId/exchange-rates/bulk` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.cancelRecurringJournal` | POST | `/finance/businesses/:businessId/recurring-journal-entries/:id/cancel` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.closeAccountingPeriod` | POST | `/finance/businesses/:businessId/accounting-periods/:id/close` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.completeReconciliation` | POST | `/finance/businesses/:businessId/reconciliations/:id/complete` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createAccount` | POST | `/finance/businesses/:businessId/accounts` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createAccountingPeriod` | POST | `/finance/businesses/:businessId/accounting-periods` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createBankConnection` | POST | `/finance/businesses/:businessId/bank-connections` | deferred | held: finance.controller.ts is held for the merge with pkt/PR195-JOURNAL-SCOPE; after it, settings admin (round 1 class repair, CEN-10b: it stores a bank connection with its provider access token, BankConnection.accessToken, a provider credential); pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createBankRule` | POST | `/finance/businesses/:businessId/bank-rules` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createCoa` | POST | `/finance/businesses/:businessId/chart-of-accounts` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createExchangeRate` | POST | `/finance/businesses/:businessId/exchange-rates` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createFixedAsset` | POST | `/finance/businesses/:businessId/fixed-assets` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createJournalEntry` | POST | `/finance/businesses/:businessId/journal-entries` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createReconciliation` | POST | `/finance/businesses/:businessId/reconciliations` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createRecurringJournal` | POST | `/finance/businesses/:businessId/recurring-journal-entries` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createReserve` | POST | `/finance/businesses/:businessId/reserves` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.createTaxRate` | POST | `/finance/businesses/:businessId/tax-rates` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteAccountingPeriod` | DELETE | `/finance/businesses/:businessId/accounting-periods/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteBankConnection` | DELETE | `/finance/businesses/:businessId/bank-connections/:id` | deferred | held: finance.controller.ts is held for the merge with pkt/PR195-JOURNAL-SCOPE; after it, settings admin (round 1 class repair, CEN-10b: it removes a bank connection and its provider access token, BankConnection.accessToken, a provider credential); pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteBankRule` | DELETE | `/finance/businesses/:businessId/bank-rules/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteExchangeRate` | DELETE | `/finance/businesses/:businessId/exchange-rates/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteFixedAsset` | DELETE | `/finance/businesses/:businessId/fixed-assets/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteRecurringJournal` | DELETE | `/finance/businesses/:businessId/recurring-journal-entries/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteReserve` | DELETE | `/finance/businesses/:businessId/reserves/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.deleteTaxRate` | DELETE | `/finance/businesses/:businessId/tax-rates/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.depreciateFixedAsset` | POST | `/finance/businesses/:businessId/fixed-assets/:id/depreciate` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.dismissIntelAction` | POST | `/finance/businesses/:businessId/intelligence/actions/:id/dismiss` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.disposeFixedAsset` | POST | `/finance/businesses/:businessId/fixed-assets/:id/dispose` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.fileTaxLiability` | POST | `/finance/businesses/:businessId/tax-liabilities/:id/file` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.fileTaxLiabilityAlias` | POST | `/finance/businesses/:businessId/tax/liabilities/:id/file` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.ignoreBankRow` | POST | `/finance/businesses/:businessId/bank-transactions/:bankTransactionId/ignore` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.importBankCsv` | POST | `/finance/businesses/:businessId/accounts/:accountId/bank-transactions/import` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.manualMatch` | POST | `/finance/businesses/:businessId/bank-transactions/:bankTransactionId/match` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.patchSettings` | PATCH | `/finance/businesses/:businessId/settings` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.payTaxLiability` | POST | `/finance/businesses/:businessId/tax-liabilities/:id/pay` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.payTaxLiabilityAlias` | POST | `/finance/businesses/:businessId/tax/liabilities/:id/pay` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.recomputeTaxLiabilities` | POST | `/finance/businesses/:businessId/tax-liabilities/recompute` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.recomputeTaxLiabilitiesAlias` | POST | `/finance/businesses/:businessId/tax/liabilities/recompute` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.reopenAccountingPeriod` | POST | `/finance/businesses/:businessId/accounting-periods/:id/reopen` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.resolveIntelAction` | POST | `/finance/businesses/:businessId/intelligence/actions/:id/resolve` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.runAutoMatch` | POST | `/finance/businesses/:businessId/accounts/:accountId/bank-transactions/auto-match` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.runIntelScan` | POST | `/finance/businesses/:businessId/intelligence/scan` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.runRecurringJournal` | POST | `/finance/businesses/:businessId/recurring-journal-entries/:id/run` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.saveImportProfile` | POST | `/finance/businesses/:businessId/accounts/:accountId/import-profile` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.setStatementSources` | POST | `/finance/businesses/:businessId/accounts/:accountId/statement-sources` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.sweepStatementSource` | POST | `/finance/businesses/:businessId/accounts/:accountId/statement-sources/:source/sweep` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.syncBankConnection` | POST | `/finance/businesses/:businessId/bank-connections/:id/sync` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.unmatch` | POST | `/finance/businesses/:businessId/bank-transactions/:bankTransactionId/unmatch` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateAccount` | PATCH | `/finance/businesses/:businessId/accounts/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateAccountingPeriod` | PATCH | `/finance/businesses/:businessId/accounting-periods/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateBankConnection` | PATCH | `/finance/businesses/:businessId/bank-connections/:id` | deferred | held: finance.controller.ts is held for the merge with pkt/PR195-JOURNAL-SCOPE; after it, settings admin (round 1 class repair, CEN-10b: it replaces a bank connection's provider access token, BankConnection.accessToken, a provider credential); pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateBankRule` | PATCH | `/finance/businesses/:businessId/bank-rules/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateCoa` | PATCH | `/finance/businesses/:businessId/chart-of-accounts/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateFixedAsset` | PATCH | `/finance/businesses/:businessId/fixed-assets/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateRecurringJournal` | PATCH | `/finance/businesses/:businessId/recurring-journal-entries/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateReserve` | PATCH | `/finance/businesses/:businessId/reserves/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |
| `FinanceController.updateTaxRate` | PATCH | `/finance/businesses/:businessId/tax-rates/:id` | deferred | pkt/PR195-JOURNAL-SCOPE gates the Books doors (D-146; this packet does not edit finance.controller.ts); ensureAccess checks membership only |

### FlowSignalController (`flow-signal/flow-signal.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FlowSignalController.actionRequired` | POST | `/flow-signals/businesses/:businessId/:id/action-required` | open | membership only; follow-up SWEEP-CENSUS: automations write |
| `FlowSignalController.resolve` | POST | `/flow-signals/businesses/:businessId/:id/resolve` | open | membership only; follow-up SWEEP-CENSUS: automations write |
| `FlowSignalController.snooze` | POST | `/flow-signals/businesses/:businessId/:id/snooze` | open | membership only; follow-up SWEEP-CENSUS: automations write |

### FlowController (`flow/flow.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FlowController.updateCrossModuleWorkflow` | PATCH | `/api/flows/businesses/:businessId/cross-module-workflows/:workflowKey` | open | membership only; follow-up SWEEP-CENSUS: automations write |

### GamificationController (`gamification/gamification.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GamificationController.updateStreak` | POST | `/gamification/businesses/:businessId/streak` | open | membership only; follow-up SWEEP-CENSUS: own-record review; a streak update |

### GoogleDriveController (`google-drive/google-drive.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GoogleDriveController.createDoc` | POST | `/drive/businesses/:businessId/docs` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.createFolder` | POST | `/drive/businesses/:businessId/folders` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.createSheet` | POST | `/drive/businesses/:businessId/sheets` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.deleteFile` | DELETE | `/drive/businesses/:businessId/files/:fileId` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.getAuthUrl` | GET | `/drive/businesses/:businessId/auth-url` | exempt-check | check:assertGoogleConnectOwner (a credential-binding start, CEN-09; D-99) |
| `GoogleDriveController.disconnect` | DELETE | `/drive/businesses/:businessId/disconnect` | exempt-check | check:assertGoogleConnectOwner (D-99) |
| `GoogleDriveController.emailContent` | POST | `/drive/businesses/:businessId/email-content` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.exportHtml` | POST | `/drive/businesses/:businessId/export-html` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.move` | PATCH | `/drive/businesses/:businessId/files/:fileId/move` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.rename` | PATCH | `/drive/businesses/:businessId/files/:fileId/rename` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.saveDocument` | POST | `/drive/businesses/:businessId/save-document` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.share` | POST | `/drive/businesses/:businessId/files/:fileId/share` | exempt-check | check:assertGoogleConnectOwner (round 3 class repair, CLASS A, WPH2-2: a grant made with the owner's Drive token hands a stored business file, an invoice PDF naming the client and the amounts, to the account named or to anyone; it is the owner's, D-99, and the owner reads every record a file holds; it was membership only) |
| `GoogleDriveController.trash` | PATCH | `/drive/businesses/:businessId/files/:fileId/trash` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.untrash` | PATCH | `/drive/businesses/:businessId/files/:fileId/untrash` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.updateFileContent` | PATCH | `/drive/businesses/:businessId/files/:fileId/content` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |
| `GoogleDriveController.uploadGeneratedDocument` | POST | `/drive/businesses/:businessId/generated-documents` | open | membership only; follow-up SWEEP-CENSUS: operations write; documents_ / drive_ map to operations in the KEY member map |

### GovernanceController (`governance/governance.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GovernanceController.createRisk` | POST | `/governance/businesses/:businessId/risks` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `GovernanceController.deleteRisk` | DELETE | `/governance/businesses/:businessId/risks/:id` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `GovernanceController.updateRisk` | PATCH | `/governance/businesses/:businessId/risks/:id` | open | membership only; follow-up SWEEP-CENSUS: operations write |

### GrowthIntelligenceController (`growth-intelligence/growth-intelligence.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GrowthIntelligenceController.backfill` | POST | `/growth-intelligence/businesses/:businessId/journeys/backfill` | open | membership only; follow-up SWEEP-CENSUS: analytics write |
| `GrowthIntelligenceController.recomputeAttribution` | POST | `/growth-intelligence/businesses/:businessId/attribution/recompute` | open | membership only; follow-up SWEEP-CENSUS: analytics write |
| `GrowthIntelligenceController.regenerate` | POST | `/growth-intelligence/businesses/:businessId/insights/regenerate` | open | membership only; follow-up SWEEP-CENSUS: analytics write |
| `GrowthIntelligenceController.updateInsight` | POST | `/growth-intelligence/businesses/:businessId/insights/:insightId/status` | open | membership only; follow-up SWEEP-CENSUS: analytics write |

### HelpdeskController (`helpdesk/helpdesk.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `HelpdeskController.createTicket` | POST | `/helpdesk/businesses/:businessId/tickets` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `HelpdeskController.deleteTicket` | DELETE | `/helpdesk/businesses/:businessId/tickets/:ticketId` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `HelpdeskController.updateTicket` | PATCH | `/helpdesk/businesses/:businessId/tickets/:ticketId` | open | membership only; follow-up SWEEP-CENSUS: operations write |

### IdentityController (`identity/identity.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `IdentityController.bootstrap` | POST | `/identity/bootstrap` | exempt-own | the caller's own sign-in bootstrap (R0-SEC) |
| `IdentityController.changePassword` | POST | `/identity/change-password` | exempt-own | the caller's own user (password, logout, profile) or a business the caller creates |
| `IdentityController.createBusiness` | POST | `/identity/businesses` | exempt-own | creates a new business the caller then owns (no existing business written) |
| `IdentityController.generateField` | POST | `/identity/businesses/:businessId/ai-generate-field` | open | membership only; follow-up SWEEP-CENSUS: settings write; AI field suggestions for the business profile (writes nothing; the profile PATCH is owner-only, D-11) |
| `IdentityController.generateProfile` | POST | `/identity/businesses/:businessId/generate-profile` | open | membership only; follow-up SWEEP-CENSUS: settings write; AI profile generation; the profile PATCH is owner-only (D-11) |
| `IdentityController.logout` | POST | `/identity/logout` | exempt-own | the caller's own user (password, logout, profile) or a business the caller creates |
| `IdentityController.updateBusiness` | PATCH | `/identity/businesses/:businessId` | exempt-check | check:assertBusinessOwner (D-11, D-116, D-125) |
| `IdentityController.updateMe` | PATCH | `/identity/me` | exempt-own | the caller's own user (password, logout, profile) or a business the caller creates |
| `IdentityController.upsertGuidanceSubProfile` | PATCH | `/identity/businesses/:businessId/guidance/:subProfile` | open | membership only; follow-up SWEEP-CENSUS: settings write; a business guidance sub-profile |

### KeyActionProposalController (`key-autonomy/key-action-proposal.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyActionProposalController.approve` | POST | `/key-autonomy/businesses/:businessId/actions/proposals/:proposalId/approve` | open | membership only; follow-up SWEEP-CENSUS: ai write; ModuleScopeGuard runs but these handlers declare no scope |
| `KeyActionProposalController.cancel` | POST | `/key-autonomy/businesses/:businessId/actions/proposals/:proposalId/cancel` | open | membership only; follow-up SWEEP-CENSUS: ai write; ModuleScopeGuard runs but these handlers declare no scope |
| `KeyActionProposalController.create` | POST | `/key-autonomy/businesses/:businessId/actions/proposals` | open | membership only; follow-up SWEEP-CENSUS: ai write; ModuleScopeGuard runs but these handlers declare no scope |
| `KeyActionProposalController.execute` | POST | `/key-autonomy/businesses/:businessId/actions/proposals/:proposalId/execute` | open | membership only; follow-up SWEEP-CENSUS: ai write; ModuleScopeGuard runs but these handlers declare no scope |
| `KeyActionProposalController.reject` | POST | `/key-autonomy/businesses/:businessId/actions/proposals/:proposalId/reject` | open | membership only; follow-up SWEEP-CENSUS: ai write; ModuleScopeGuard runs but these handlers declare no scope |

### KeyGenomeBridgeController (`key-autonomy/key-genome-bridge.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyGenomeBridgeController.bridgeRecommendationAction` | POST | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/bridge-action` | open | membership only; follow-up SWEEP-CENSUS: ai write |

### KeyConnectorController (`key-connector/key-connector.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyConnectorController.connectProvider` | POST | `/key-connector/providers/:key/connect` | exempt-check | check:requireConnectorAdmin (OWNER or ADMIN, D-111, and settings admin by the explicit map, D-114: binding a provider connection stores its credentials; round 1 class repair, CEN-10b) |
| `KeyConnectorController.disconnectProvider` | DELETE | `/key-connector/connections/:id` | exempt-check | check:requireConnectorAdmin (OWNER or ADMIN, D-111, and settings admin by the explicit map, D-114: removing a provider connection clears its credentials; round 1 class repair, CEN-10b) |
| `KeyConnectorController.executeAiCommand` | POST | `/key-connector/ai/command` | exempt-check | check:requireConnectorWriter (OWNER or ADMIN, D-111) |
| `KeyConnectorController.triggerSync` | POST | `/key-connector/sync/:id/trigger` | exempt-check | check:requireConnectorWriter (OWNER or ADMIN, D-111) |

### KeyCortexAuditController (`key-cortex/key-cortex-audit.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexAuditController.runEval` | POST | `//api/v1/cortex/eval/run` | open | membership only; follow-up SWEEP-CENSUS: ai write |

### KeyCortexGoalsController (`key-cortex/key-cortex-goals.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexGoalsController.createGoal` | POST | `//api/v1/cortex/goals` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.createPlanFromCommand` | POST | `//api/v1/cortex/plans` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.createPlanFromGoal` | POST | `//api/v1/cortex/goals/:goalId/plans` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.createTriggerRule` | POST | `//api/v1/cortex/triggers` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.deleteGoal` | DELETE | `//api/v1/cortex/goals/:goalId` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.executePlan` | POST | `//api/v1/cortex/plans/:planId/execute` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |
| `KeyCortexGoalsController.updateTriggerRule` | PATCH | `//api/v1/cortex/triggers/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write; goals_ maps to projects in the KEY member map |

### KeyCortexController (`key-cortex/key-cortex.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexController.approveAction` | POST | `/api/v1/cortex/actions/approve` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.chat` | POST | `/api/v1/cortex/chat` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.consciousChat` | POST | `/api/v1/cortex/conscious/chat` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.createMonitor` | POST | `/api/v1/cortex/monitors` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.createSession` | POST | `/api/v1/cortex/sessions` | exempt-own | a KEY session for the caller |
| `KeyCortexController.deleteSession` | DELETE | `/api/v1/cortex/sessions/:id` | exempt-check | check:requireOwnSession (the caller's own KEY session) |
| `KeyCortexController.documentAsk` | POST | `/api/v1/cortex/documents/ask` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.documentCompare` | POST | `/api/v1/cortex/documents/compare` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.documentDelete` | DELETE | `/api/v1/cortex/documents/:id` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.documentExtract` | POST | `/api/v1/cortex/documents/extract` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.documentUpload` | POST | `/api/v1/cortex/documents` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.evolutionTune` | POST | `/api/v1/cortex/evolution/tune` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.executeBatch` | POST | `/api/v1/cortex/batch` | exempt-guard | guard:CortexMemberAuthorityGuard; check:assertDirectCommands |
| `KeyCortexController.executeCommand` | POST | `/api/v1/cortex/execute` | exempt-guard | guard:CortexMemberAuthorityGuard; check:assertDirectCommands |
| `KeyCortexController.flowApplyTemplate` | POST | `/api/v1/cortex/flows/apply-template` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.flowCreate` | POST | `/api/v1/cortex/flows` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.flowDelete` | DELETE | `/api/v1/cortex/flows/:id` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.flowExecute` | POST | `/api/v1/cortex/flows/:id/execute` | exempt-guard | guard:CortexMemberAuthorityGuard |
| `KeyCortexController.flowGenerate` | POST | `/api/v1/cortex/flows/generate` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.flowToggle` | POST | `/api/v1/cortex/flows/:id/toggle` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.flowUpdate` | PUT | `/api/v1/cortex/flows/:id` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.generateInsights` | POST | `/api/v1/cortex/insights` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.listen` | POST | `/api/v1/cortex/voice/listen` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.phoneAnalyze` | POST | `/api/v1/cortex/phone/analyze` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.phoneCall` | POST | `/api/v1/cortex/phone/call` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.phoneScript` | POST | `/api/v1/cortex/phone/script` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.queryModule` | POST | `/api/v1/cortex/query` | exempt-guard | guard:CortexMemberAuthorityGuard (the member's module scope on the queried module) |
| `KeyCortexController.recordFeedback` | POST | `/api/v1/cortex/feedback` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.rollback` | POST | `/api/v1/cortex/rollback` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.sandboxApply` | POST | `/api/v1/cortex/sandbox/apply` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.sandboxAuto` | POST | `/api/v1/cortex/sandbox/auto` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.sandboxExecute` | POST | `/api/v1/cortex/sandbox/execute` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.sandboxExplain` | POST | `/api/v1/cortex/sandbox/explain` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.sandboxGenerate` | POST | `/api/v1/cortex/sandbox/generate` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.speak` | POST | `/api/v1/cortex/voice/speak` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.switchPersonality` | POST | `/api/v1/cortex/personalities/switch` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.toggleMonitor` | POST | `/api/v1/cortex/monitors/:id/toggle` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.updateAutonomyProfile` | PATCH | `/api/v1/cortex/autonomy-profile` | exempt-guard | guard:AutonomyProfileWriteGuard |
| `KeyCortexController.updateMonitor` | PATCH | `/api/v1/cortex/monitors/:id` | open | membership only; follow-up SWEEP-CENSUS: ai write; KEY cortex routes; module tools are held to the member authority map where CortexMemberAuthorityGuard runs |
| `KeyCortexController.updateSession` | PATCH | `/api/v1/cortex/sessions/:id` | exempt-check | check:requireOwnSession (the caller's own KEY session) |

### KeyflowCommandController (`keyflow-command/keyflow-command.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyflowCommandController.createNote` | POST | `/keyflow/businesses/:businessId/notes` | open | membership only; follow-up SWEEP-CENSUS: ai write |
| `KeyflowCommandController.deleteNote` | DELETE | `/keyflow/businesses/:businessId/notes/:noteId` | open | membership only; follow-up SWEEP-CENSUS: ai write |
| `KeyflowCommandController.generateBrief` | POST | `/keyflow/businesses/:businessId/notes/:noteId/brief` | open | membership only; follow-up SWEEP-CENSUS: ai write |
| `KeyflowCommandController.transcribe` | POST | `/keyflow/businesses/:businessId/voice/transcribe` | open | membership only; follow-up SWEEP-CENSUS: ai write |
| `KeyflowCommandController.tts` | POST | `/keyflow/businesses/:businessId/voice/tts` | open | membership only; follow-up SWEEP-CENSUS: ai write |
| `KeyflowCommandController.updateNote` | PUT | `/keyflow/businesses/:businessId/notes/:noteId` | open | membership only; follow-up SWEEP-CENSUS: ai write |

### KeystoreAdminController (`keystore/keystore-admin.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeystoreAdminController.activateListing` | POST | `/keystore/admin/listings/:id/activate` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.archiveListing` | DELETE | `/keystore/admin/listings/:id/archive` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.createListing` | POST | `/keystore/admin/listings` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.deliverFiles` | POST | `/keystore/admin/orders/:id/deliver` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.pauseListing` | POST | `/keystore/admin/listings/:id/pause` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.sendMessage` | POST | `/keystore/admin/orders/:id/messages` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.updateListing` | PATCH | `/keystore/admin/listings/:id` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreAdminController.updateOrderStatus` | PATCH | `/keystore/admin/orders/:id/status` | open | membership only; follow-up SWEEP-CENSUS: storefront write |

### KeystoreController (`keystore/keystore.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeystoreController.acceptQuote` | POST | `/keystore/orders/:id/accept-quote` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreController.cancelOrder` | POST | `/keystore/orders/:id/cancel` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreController.createOrder` | POST | `/keystore/orders` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreController.rateOrder` | POST | `/keystore/orders/:id/rate` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `KeystoreController.sendMessage` | POST | `/keystore/orders/:id/messages` | open | membership only; follow-up SWEEP-CENSUS: storefront write |

### LeadFormsController (`lead-forms/lead-forms.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `LeadFormsController.createForm` | POST | `/businesses/:businessId/lead-forms` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `LeadFormsController.deleteForm` | DELETE | `/businesses/:businessId/lead-forms/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `LeadFormsController.toggleActive` | POST | `/businesses/:businessId/lead-forms/:id/toggle` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `LeadFormsController.updateForm` | PATCH | `/businesses/:businessId/lead-forms/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write |

### LivekitController (`livekit/livekit.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `LivekitController.createVoiceSession` | POST | `/livekit/businesses/:businessId/voice-session` | exempt-own | the caller's own KEY voice session (rate limited per member) |
| `LivekitController.endVoiceSession` | POST | `/livekit/businesses/:businessId/voice-session/:sessionId/end` | exempt-own | the caller's own KEY voice session (rate limited per member) |

### MarketingController (`marketing/marketing.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketingController.createCampaign` | POST | `/marketing/businesses/:businessId/campaigns` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingController.deleteCampaign` | DELETE | `/marketing/businesses/:businessId/campaigns/:id` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketingController.updateCampaign` | PATCH | `/marketing/businesses/:businessId/campaigns/:id` | open | membership only; follow-up SWEEP-CENSUS: content write |

### MarketplaceController (`marketplace/marketplace.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketplaceController.activatePreorderRoute` | POST | `/marketplace/businesses/:businessId/fulfillment-routes/:routeId/activate-preorder` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.advancePurchaseOrderStatus` | POST | `/marketplace/businesses/:businessId/purchase-orders/:poId/advance` | deferred | pkt/PR195-JOURNAL-SCOPE gates it (expenses write, D-146) |
| `MarketplaceController.createCustomsDeclaration` | POST | `/marketplace/businesses/:businessId/customs` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.createOrder` | POST | `/marketplace/businesses/:businessId/orders` | open | membership only; follow-up SWEEP-CENSUS: storefront write; an operator order; created paid it goes through the paid door with revenue write (D-77); creation itself is not ruled |
| `MarketplaceController.createPreOrder` | POST | `/marketplace/businesses/:businessId/pre-orders` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.createPurchaseOrder` | POST | `/marketplace/businesses/:businessId/purchase-orders` | deferred | purchase orders are pkt/PR195-JOURNAL-SCOPE's (its receipt doors need expenses write); create is not gated there yet: a follow-up names the module |
| `MarketplaceController.createShipment` | POST | `/marketplace/businesses/:businessId/shipments` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.fulfillOrder` | POST | `/marketplace/businesses/:businessId/orders/:orderId/fulfill` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.processPostPurchaseJobs` | POST | `/marketplace/businesses/:businessId/post-purchase/process` | open | membership only; follow-up SWEEP-CENSUS: storefront write |
| `MarketplaceController.promoteProductToContent` | POST | `/marketplace/businesses/:businessId/products/:productId/promote` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `MarketplaceController.routeOrder` | POST | `/marketplace/businesses/:businessId/orders/:orderId/route` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.updateCustomsDeclaration` | PATCH | `/marketplace/businesses/:businessId/customs/:declId` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.updateFulfillmentRoute` | PATCH | `/marketplace/businesses/:businessId/fulfillment-routes/:routeId` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.updateOrderStatus` | PATCH | `/marketplace/businesses/:businessId/orders/:orderId/status` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.updatePreOrder` | PATCH | `/marketplace/businesses/:businessId/pre-orders/:preOrderId` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |
| `MarketplaceController.updatePurchaseOrder` | PATCH | `/marketplace/businesses/:businessId/purchase-orders/:poId` | deferred | pkt/PR195-JOURNAL-SCOPE gates it (expenses write, D-146) |
| `MarketplaceController.updateShipment` | PATCH | `/marketplace/businesses/:businessId/shipments/:shipmentId` | exempt-ruled | order fulfilment stays open to every member (D-112: fulfilment status changes stay open; marking PAID and refunds have their own revenue doors, D-77, D-112) |

### MomentumController (`momentum/momentum.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MomentumController.actionRecommendation` | POST | `/momentum/businesses/:businessId/recommendations/:id/action` | exempt-check | check:assertRecommendationVisible (CRM visibility of the recommendation's contact) |
| `MomentumController.dismissRecommendation` | POST | `/momentum/businesses/:businessId/recommendations/:id/dismiss` | exempt-check | check:assertRecommendationVisible |
| `MomentumController.generateDraft` | POST | `/momentum/businesses/:businessId/recommendations/:id/draft` | exempt-check | check:assertRecommendationVisible; check:assertContactVisible |
| `MomentumController.runDailySweep` | POST | `/momentum/businesses/:businessId/sweep` | open | membership only; follow-up SWEEP-CENSUS: crm write |
| `MomentumController.snoozeRecommendation` | POST | `/momentum/businesses/:businessId/recommendations/:id/snooze` | exempt-check | check:assertRecommendationVisible |

### NotificationsController (`notifications/notifications.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `NotificationsController.markAllRead` | PATCH | `/notifications/businesses/:businessId/read-all` | exempt-check | check:resolveTimelineViewer (the member's own view of the business notifications, D-63) |
| `NotificationsController.markRead` | PATCH | `/notifications/businesses/:businessId/:id/read` | exempt-check | check:resolveTimelineViewer (the member's own view of the business notifications, D-63) |
| `NotificationsController.updatePreferences` | PATCH | `/notifications/businesses/:businessId/customer-preferences` | open | membership only; follow-up SWEEP-CENSUS: settings write; business-wide customer notification preferences |

### OnboardingConciergeController (`onboarding-concierge/onboarding-concierge.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OnboardingConciergeController.autoConfigure` | POST | `/onboarding-concierge/businesses/:businessId/auto-configure` | exempt-check | check:assertProfileOwner (D-11) |
| `OnboardingConciergeController.chat` | POST | `/onboarding-concierge/businesses/:businessId/chat` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.detectBusinessType` | POST | `/onboarding-concierge/businesses/:businessId/detect-type` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.dismiss` | POST | `/onboarding-concierge/businesses/:businessId/dismiss` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.markComplete` | POST | `/onboarding-concierge/businesses/:businessId/complete` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.resume` | POST | `/onboarding-concierge/businesses/:businessId/resume` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.saveOnboardingStep` | POST | `/onboarding-concierge/businesses/:businessId/onboarding-step` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |
| `OnboardingConciergeController.seedDemoData` | POST | `/onboarding-concierge/businesses/:businessId/seed-demo` | exempt-check | check:seedDemoDataAsOwner (OWNER only, D-84) |
| `OnboardingConciergeController.snoozeNudge` | POST | `/onboarding-concierge/businesses/:businessId/nudges/:nudgeId/snooze` | open | membership only; follow-up SWEEP-CENSUS: settings write; onboarding is owner-led (D-03); the owner-only steps check it (assertProfileOwner, seed-demo D-84) |

### PhoneVoiceController (`phone-voice/phone-voice.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PhoneVoiceController.outbound` | POST | `/api/v1/cortex/phone/outbound` | open | membership only; follow-up SWEEP-CENSUS: crm write |

### PortalController (`portal/portal.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PortalController.createAccess` | POST | `/portal/businesses/:businessId/access` | open | membership only; follow-up SWEEP-CENSUS: crm write; portal_ maps to crm in the KEY member map |
| `PortalController.revokeAccess` | DELETE | `/portal/businesses/:businessId/access/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write; portal_ maps to crm in the KEY member map |
| `PortalController.updateSettings` | PATCH | `/portal/businesses/:businessId/access/:id` | open | membership only; follow-up SWEEP-CENSUS: crm write; portal_ maps to crm in the KEY member map |

### PublicPresenceController (`public-events/presence.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PublicPresenceController.runAggregator` | POST | `/businesses/:businessId/presence/aggregate` | open | membership only; follow-up SWEEP-CENSUS: content write; aggregates presence stats |

### PushNotificationController (`push-notifications/push-notification.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PushNotificationController.sendTest` | POST | `/api/businesses/:businessId/push/test` | exempt-own | the member's own device push subscription; its @RequireModuleScope('settings') is inert (no ModuleScopeGuard) and enforcing it would refuse every STAFF member their own push (owner question: drop the decorator) |
| `PushNotificationController.subscribe` | POST | `/api/businesses/:businessId/push/subscribe` | exempt-own | the member's own device push subscription; its @RequireModuleScope('settings') is inert (no ModuleScopeGuard) and enforcing it would refuse every STAFF member their own push (owner question: drop the decorator) |
| `PushNotificationController.unsubscribe` | POST | `/api/businesses/:businessId/push/unsubscribe` | exempt-own | the member's own device push subscription; its @RequireModuleScope('settings') is inert (no ModuleScopeGuard) and enforcing it would refuse every STAFF member their own push (owner question: drop the decorator) |

### RetainerController (`retainers/retainer.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `RetainerController.create` | POST | `/retainers/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: revenue write; retainers_ maps to revenue in the KEY member map |
| `RetainerController.createPeriod` | POST | `/retainers/businesses/:businessId/:id/periods` | open | membership only; follow-up SWEEP-CENSUS: revenue write; retainers_ maps to revenue in the KEY member map |
| `RetainerController.delete` | DELETE | `/retainers/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: revenue write; retainers_ maps to revenue in the KEY member map |
| `RetainerController.update` | PATCH | `/retainers/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: revenue write; retainers_ maps to revenue in the KEY member map |
| `RetainerController.updatePeriod` | PATCH | `/retainers/businesses/:businessId/:retainerId/periods/:periodId` | open | membership only; follow-up SWEEP-CENSUS: revenue write; retainers_ maps to revenue in the KEY member map |

### RiscAdminController (`risc/risc-admin.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `RiscAdminController.eraseUserEvents` | POST | `/admin/risc/users/:userId/erase` | exempt-check | check:SUPER_ADMIN (platform RISC erasure, refused to anyone else in the handler) |

### SeoController (`seo/seo.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SeoController.addKeyword` | POST | `/seo/businesses/:businessId/keywords` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.autoGenerateBriefs` | POST | `/seo/businesses/:businessId/briefs/auto-generate` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.connectGa4` | POST | `/seo/businesses/:businessId/connectors/ga4` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.connectGsc` | POST | `/seo/businesses/:businessId/connectors/gsc` | exempt-guard | guard:SeoAdminGuard; the connection is the owner's (assertConnectorOwner, D-94) |
| `SeoController.detectIssues` | POST | `/seo/businesses/:businessId/issues/detect` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.disconnectGa4` | DELETE | `/seo/businesses/:businessId/connectors/ga4` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.disconnectGsc` | DELETE | `/seo/businesses/:businessId/connectors/gsc` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.generateBrief` | POST | `/seo/businesses/:businessId/briefs/generate` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.removeKeyword` | DELETE | `/seo/businesses/:businessId/keywords/:keywordId` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.resolveIssue` | PATCH | `/seo/businesses/:businessId/issues/:issueId/resolve` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.syncGa4` | POST | `/seo/businesses/:businessId/connectors/ga4/sync` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.syncGsc` | POST | `/seo/businesses/:businessId/connectors/gsc/sync` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.syncPages` | POST | `/seo/businesses/:businessId/pages/sync` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |
| `SeoController.updateBriefStatus` | PATCH | `/seo/businesses/:businessId/briefs/:briefId` | exempt-guard | guard:SeoAdminGuard (the SEO routes are held to the owner and admins by their own guard) |

### ShopifyController (`shopify/shopify.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ShopifyController.syncAll` | POST | `/shopify/businesses/:businessId/sync/all` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ShopifyController.syncCustomers` | POST | `/shopify/businesses/:businessId/sync/customers` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ShopifyController.syncOrders` | POST | `/shopify/businesses/:businessId/sync/orders` | open | membership only; follow-up SWEEP-CENSUS: connect write |
| `ShopifyController.syncProducts` | POST | `/shopify/businesses/:businessId/sync/products` | open | membership only; follow-up SWEEP-CENSUS: connect write |

### PresenceController (`site/presence/presence.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PresenceController.createPreview` | POST | `/site/presence/businesses/:businessId/preview` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.delegateInsight` | POST | `/site/presence/businesses/:businessId/insights/:insightId/delegate` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.publish` | POST | `/site/presence/businesses/:businessId/publish` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.regenerateInsights` | POST | `/site/presence/businesses/:businessId/insights/regenerate` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.saveDraft` | PUT | `/site/presence/businesses/:businessId/draft` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.syncActionCards` | POST | `/site/presence/businesses/:businessId/action-cards/sync` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |
| `PresenceController.unpublish` | DELETE | `/site/presence/businesses/:businessId/publish` | open | membership only; follow-up SWEEP-CENSUS: content write; the business web presence; publishing the profile is owner-only (D-11, in the service) |

### SiteController (`site/site.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SiteController.aggregateConversionFunnel` | POST | `/site/businesses/:businessId/conversion-funnel/aggregate` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.createPromoCode` | POST | `/site/businesses/:businessId/promo-codes` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.deletePromoCode` | POST | `/site/businesses/:businessId/promo-codes/:promoId/delete` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.detectAbandonedCarts` | POST | `/site/businesses/:businessId/abandoned-carts/detect` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.generateCaseStudy` | POST | `/site/businesses/:businessId/case-studies/generate` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.getAiConversionAdvice` | POST | `/site/businesses/:businessId/conversion-advice` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.moderateReview` | PATCH | `/site/businesses/:businessId/reviews/:reviewId` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.publishCaseStudy` | POST | `/site/businesses/:businessId/case-studies/:caseStudyId/publish` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.unpublishCaseStudy` | POST | `/site/businesses/:businessId/case-studies/:caseStudyId/unpublish` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.updateIntakeStatus` | PATCH | `/site/businesses/:businessId/intake/:id` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.updateOrderStatus` | PATCH | `/site/businesses/:businessId/orders/:orderId/status` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.updatePromoCode` | PATCH | `/site/businesses/:businessId/promo-codes/:promoId` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.updateQualificationConfig` | PUT | `/site/businesses/:businessId/qualification-config` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |
| `SiteController.updateStorefrontConfig` | PUT | `/site/businesses/:businessId/storefront` | open | membership only; follow-up SWEEP-CENSUS: content write / storefront write |

### SocialController (`social/social.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SocialController.createPost` | POST | `/social/businesses/:businessId/posts` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.deletePost` | DELETE | `/social/businesses/:businessId/posts/:postId` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.postNow` | POST | `/social/businesses/:businessId/posts/now` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.publish` | POST | `/social/businesses/:businessId/posts/:postId/publish` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.schedulePost` | POST | `/social/businesses/:businessId/posts/schedule` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.testConnection` | POST | `/social/businesses/:businessId/connections/:platform/test` | open | membership only; follow-up SWEEP-CENSUS: content write |
| `SocialController.updatePost` | PATCH | `/social/businesses/:businessId/posts/:postId` | open | membership only; follow-up SWEEP-CENSUS: content write |

### SopController (`sop/sop.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SopController.create` | POST | `/sop/businesses/:businessId/sops` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `SopController.delete` | DELETE | `/sop/businesses/:businessId/sops/:id` | open | membership only; follow-up SWEEP-CENSUS: operations write |
| `SopController.update` | PATCH | `/sop/businesses/:businessId/sops/:id` | open | membership only; follow-up SWEEP-CENSUS: operations write |

### SubscriptionsController (`subscriptions/subscriptions.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SubscriptionsController.activateSubscription` | POST | `/subscriptions/businesses/:businessId/activate` | exempt-check | service-check:SUBSCRIPTION_OWNER_ONLY (plan changes are the owner's, SubscriptionsService) |
| `SubscriptionsController.cancelSubscription` | POST | `/subscriptions/businesses/:businessId/cancel` | exempt-check | service-check:SUBSCRIPTION_OWNER_ONLY (plan changes are the owner's, SubscriptionsService) |
| `SubscriptionsController.createCheckout` | POST | `/subscriptions/businesses/:businessId/checkout` | exempt-check | service-check:SUBSCRIPTION_OWNER_ONLY (plan changes are the owner's, SubscriptionsService) |
| `SubscriptionsController.recordSubscriptionPayment` | POST | `/subscriptions/businesses/:businessId/record-payment` | exempt-check | service-check:SUBSCRIPTION_OWNER_ONLY (plan changes are the owner's, SubscriptionsService) |
| `SubscriptionsController.startTrial` | POST | `/subscriptions/businesses/:businessId/trial` | exempt-check | service-check:SUBSCRIPTION_OWNER_ONLY (plan changes are the owner's, SubscriptionsService) |

### SupplierController (`supplier/supplier.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SupplierController.createProductFromSupplier` | POST | `/supplier/businesses/:businessId/supplier-products/:supplierProductId/create-product` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.createProductSourceLink` | POST | `/supplier/businesses/:businessId/products/:productId/source-links` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.createProductVariant` | POST | `/supplier/businesses/:businessId/products/:productId/variants` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.createSupplierProduct` | POST | `/supplier/businesses/:businessId/connections/:connectionId/products` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.deleteProductSourceLink` | DELETE | `/supplier/businesses/:businessId/source-links/:linkId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.deleteProductVariant` | DELETE | `/supplier/businesses/:businessId/product-variants/:variantId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.deleteSupplierProduct` | DELETE | `/supplier/businesses/:businessId/supplier-products/:supplierProductId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.updateProductSourceLink` | PATCH | `/supplier/businesses/:businessId/source-links/:linkId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.updateProductVariant` | PATCH | `/supplier/businesses/:businessId/product-variants/:variantId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.updateSupplierProduct` | PATCH | `/supplier/businesses/:businessId/supplier-products/:supplierProductId` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |
| `SupplierController.upsertProductCostProfile` | PUT | `/supplier/businesses/:businessId/products/:productId/cost-profile` | open | membership only; follow-up SWEEP-CENSUS: storefront write; suppliers_ maps to storefront in the KEY member map |

### TaskAssignmentController (`task-assignments/task-assignment.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TaskAssignmentController.assign` | POST | `/businesses/:businessId/task-assignments` | open | membership only; follow-up SWEEP-CENSUS: team write; people_ maps to team in the KEY member map |
| `TaskAssignmentController.bulkAssign` | POST | `/businesses/:businessId/task-assignments/bulk` | open | membership only; follow-up SWEEP-CENSUS: team write; people_ maps to team in the KEY member map |
| `TaskAssignmentController.recommend` | POST | `/businesses/:businessId/task-assignments/recommend` | open | membership only; follow-up SWEEP-CENSUS: team write; people_ maps to team in the KEY member map |
| `TaskAssignmentController.transfer` | POST | `/businesses/:businessId/task-assignments/transfer` | open | membership only; follow-up SWEEP-CENSUS: team write; people_ maps to team in the KEY member map |
| `TaskAssignmentController.unassign` | DELETE | `/businesses/:businessId/task-assignments` | open | membership only; follow-up SWEEP-CENSUS: team write; people_ maps to team in the KEY member map |

### TemplatesController (`templates/templates.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TemplatesController.applyTemplate` | POST | `/businesses/:businessId/templates/:templateId/apply` | exempt-check | check:assertProfileOwner (D-11) |

### TemporalFlowController (`temporal-flow/temporal-flow.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TemporalFlowController.analyze` | POST | `/temporal-flow/businesses/:businessId/analyze` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `TemporalFlowController.compactMemory` | POST | `/temporal-flow/businesses/:businessId/memory/compact` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `TemporalFlowController.create` | POST | `/temporal-flow/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `TemporalFlowController.detectPatterns` | POST | `/temporal-flow/businesses/:businessId/memory/detect-patterns` | open | membership only; follow-up SWEEP-CENSUS: bookings write |
| `TemporalFlowController.resolve` | PATCH | `/temporal-flow/businesses/:businessId/:eventId/resolve` | open | membership only; follow-up SWEEP-CENSUS: bookings write |

### TimeEntryController (`time-tracking/time-entry.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TimeEntryController.billTimeEntries` | POST | `/time-entries/businesses/:businessId/bill` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |
| `TimeEntryController.create` | POST | `/time-entries/businesses/:businessId` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |
| `TimeEntryController.delete` | DELETE | `/time-entries/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |
| `TimeEntryController.startTimer` | POST | `/time-entries/businesses/:businessId/start` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |
| `TimeEntryController.stopTimer` | POST | `/time-entries/businesses/:businessId/stop/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |
| `TimeEntryController.update` | PATCH | `/time-entries/businesses/:businessId/:id` | open | membership only; follow-up SWEEP-CENSUS: projects write; time entries are often the member's own; owner question whether projects read may log own time |

### TrashController (`trash/trash.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TrashController.permanentDelete` | DELETE | `/api/businesses/:businessId/trash/:model/:id` | exempt-check | check:assertMayWrite (write on the trashed record's own module, D-95) |
| `TrashController.restore` | POST | `/api/businesses/:businessId/trash/:model/:id/restore` | exempt-check | check:assertMayWrite (write on the trashed record's own module, D-95; the class @RequireModuleScope('settings') is inert) |

### UploadsController (`uploads/uploads.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `UploadsController.requestUploadUrl` | POST | `/uploads/request-url` | exempt-own | a signed upload URL for the caller (no business data written) |

### VoiceController (`voice/voice.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `VoiceController.synthesize` | POST | `/voice/businesses/:businessId/tts` | open | membership only; follow-up SWEEP-CENSUS: ai write |

### WhatsAppController (`whatsapp/whatsapp.controller.ts`)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `WhatsAppController.saveConfig` | PATCH | `/whatsapp/businesses/:businessId/config` | exempt-check | check:assertConfigOwner (the sending identity is the owner's, D-11, R0-SEC2b) |
| `WhatsAppController.sendFromDrawer` | POST | `/whatsapp/businesses/:businessId/messages` | exempt-guard | guard:WhatsAppOperationsScopeGuard (operations scope on the send routes) |
| `WhatsAppController.sendMessage` | POST | `/whatsapp/businesses/:businessId/send` | exempt-guard | guard:WhatsAppOperationsScopeGuard (operations scope on the send routes) |
| `WhatsAppController.testConnection` | POST | `/whatsapp/businesses/:businessId/test` | exempt-guard | guard:WhatsAppOperationsScopeGuard (operations scope on the send routes) |
