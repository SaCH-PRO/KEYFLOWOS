# KeyFlow Mission 2 Spec
## Unified Commerce, Sourcing, Fulfillment, and Product-to-Customer Delivery System
### AI Coder Implementation Document

### Objective
Build a **fully fledged commerce and fulfillment system** inside KeyFlow that supports **all major ways to get products to customers**, not just dropshipping.

This system must cover the full product-delivery lifecycle:
- sourcing products
- importing or creating catalog items
- pricing and listing
- selling through marketplace/storefront channels
- routing orders to the correct fulfillment path
- handling local stock, preorders, dropship suppliers, hybrid fulfillment, and direct fulfillment
- tracking shipment and delivery state
- keeping the entire system connected to Revenue, Content, Clients, Projects, Flows, Expenses, and AI

Do not build this as a narrow dropshipping add-on.
Build it as a **product-to-customer orchestration engine** for KeyFlow.

---

## 1. Product Goal

The user should be able to run product commerce through multiple fulfillment models from one operating surface.

### Supported fulfillment models
- **In-stock / local inventory fulfillment**
- **Dropshipping**
- **Preorder / made-to-order**
- **Manual/direct fulfillment**
- **Hybrid fulfillment**
- **Service + product bundle fulfillment**
- **Local pickup / local delivery**
- **Shipped delivery**
- optional future: marketplace-to-marketplace sync

### The user should be able to:
- source products from external suppliers
- create their own products manually
- import supplier products and normalize them
- list products into the marketplace/storefront
- manage pricing, margins, and fulfillment rules
- route orders automatically or manually
- manage stock and warehouses
- create purchase orders to suppliers
- track shipments and delivery outcomes
- connect customer communication, marketing, automation, and profitability around product sales

This system should feel:
- operational
- commercial
- fulfillment-aware
- intelligent
- premium
- integrated

---

## 2. Core Product Principle

This system should not be framed as:
- “a dropshipping feature”
or
- “just a marketplace module”

It should be framed as:

> **KeyFlow’s commerce and fulfillment orchestration layer**

That means it should support all major ways the business can get products into customers’ hands.

The app should help the user answer:
- what are we selling?
- where is it sourced from?
- how is it fulfilled?
- what is the margin?
- what is the risk?
- what happens after an order is placed?
- what communications, documents, automations, and financial records should follow?

---

## 3. What Must Be Supported

## Manual user capabilities
The user must be able to:
- create products manually
- import supplier products
- edit product titles, descriptions, images, and pricing
- assign fulfillment model per product/listing
- define shipping zones and rates
- define warehouses / stock locations
- manage inventory if stocked locally
- create and manage listings
- review orders
- create purchase orders
- create shipments
- track fulfillment progress
- connect products to content/promotions

## Intelligent system capabilities
The system must be able to:
- estimate landed cost
- estimate gross margin
- identify low-margin products
- identify supplier lead-time risk
- identify low-stock / out-of-stock risk
- identify unprofitable shipping combinations
- identify underperforming products
- recommend better pricing
- recommend whether a product should be stocked, preordered, or dropshipped
- recommend what to promote based on demand and margin

## Automatic system capabilities
The system must be able to:
- generate listings from normalized products
- route orders to the correct fulfillment path
- create supplier-facing purchase orders where appropriate
- update order and shipment state
- trigger customer notifications
- trigger post-purchase flows
- update revenue, expenses, and inventory states
- log all fulfillment events

## AI capabilities
The AI must be able to:
- rewrite product copy
- normalize supplier import data
- recommend retail pricing
- suggest bundles
- suggest upsells/cross-sells
- recommend which products to promote
- explain margin risk
- explain fulfillment risk
- suggest when to stock locally vs dropship
- suggest when a product should be converted into a preorder model

---

## 4. Scope Clarification

This mission covers:
- supplier connection strategy
- product import/normalization
- catalog/listing management
- order routing
- fulfillment model handling
- shipping/warehouse logic
- purchase orders
- shipment tracking states
- profitability and landed cost intelligence
- marketplace/storefront integration strategy
- cross-module communication with marketing, clients, revenue, expenses, and flows

This mission does **not** require:
- becoming a logistics carrier
- becoming a giant 3PL platform
- replacing every external supplier site
- supporting every supplier or sales channel on day one

Build for extensibility.
Launch with strong internal architecture and a small number of high-value connector types first.

---

## 5. Fulfillment Models the System Must Support

This is a mandatory architecture requirement.

Each product/listing must be able to use one of these fulfillment strategies:

### A. Stocked locally
- inventory held in a warehouse or local storage
- order decrements stock
- fulfillment comes from owned stock

### B. Dropship
- order is routed to supplier
- supplier ships directly or indirectly to customer
- no local stock required

### C. Preorder / made-to-order
- order accepted before stock exists or before build is complete
- lead time shown to customer
- fulfillment happens later

### D. Manual/direct fulfillment
- user handles delivery manually
- useful for small operations or custom items

### E. Hybrid
- use local inventory when available
- fallback to supplier or preorder if not

### F. Service + product bundle
- product sold with a related service or package
- delivery may involve Calendar, Projects, Revenue, and Content

This flexibility is non-negotiable if the system is to support “all ways to get products to customers.”

---

## 6. Architecture Overview

Build this mission as six major layers:

1. **Supplier & Source Layer**
2. **Normalized Product Layer**
3. **Listing & Commerce Layer**
4. **Order & Fulfillment Layer**
5. **Shipping, Inventory, and Warehouse Layer**
6. **Observability, Intelligence, and AI Layer**

---

## 7. Supplier & Source Layer

Do not hard-code product imports directly into the marketplace listing model.

Create a supplier/source abstraction.

### Required models
- `SupplierConnection`
- `SupplierProduct`
- `SupplierVariant` if applicable
- `SupplierOrder`
- optional `SupplierFeed` / `CatalogImportJob`

### SupplierConnection should store
- businessId
- supplier/provider type
- auth credentials or config references
- account metadata
- connection health
- import capabilities
- order submission capabilities
- last sync time

### Supplier types can include
- catalog feed source
- manual supplier
- marketplace supplier
- wholesale source
- manufacturer source
- local supplier
- dropship provider

This gives you flexibility beyond “Amazon/Alibaba only.”

---

## 8. Supplier Adapter Architecture

Build a provider-adapter pattern similar to Mission 1.

### Required adapter interface
- connect()
- validateConnection()
- importCatalog()
- fetchProduct()
- fetchAvailability()
- fetchPrice()
- createSupplierOrder()
- fetchOrderStatus()
- normalizeError()
- disconnect()

### Suggested adapters
- `SupplierCatalogAdapter`
- `SupplierOrderAdapter`
- `CarrierAdapter`
- optional `MarketplaceSalesChannelAdapter`

### Why this matters
You need clean separation between:
- where a product comes from
- how it is sold
- how it is fulfilled

---

## 9. Product Normalization Layer

A supplier product must not directly become the marketplace listing.

Build a normalized internal product layer.

### Flow should be:
Supplier Product → Normalized Product → Listing → Order → Fulfillment

### Required internal models
- `Product`
- `ProductVariant`
- `ProductSourceLink`
- `ProductCostProfile`

### Product should support
- title
- description
- media
- category
- variants
- pricing
- compare-at price if needed
- fulfillment model
- source relationships
- inventory mode
- margin data
- shipping profile
- public visibility status

### Why this matters
This lets the user:
- clean supplier data
- rewrite and rebrand
- set proper pricing
- choose fulfillment logic
- create a better storefront experience

---

## 10. Product Source Link Model

A product can have one or more sources.

### Create a model like `ProductSourceLink`
It should connect:
- normalized product
- supplier product
- supplier connection
- source cost
- lead time
- moq if relevant
- shipping assumptions
- availability state

### Benefits
- multiple supplier fallback options
- compare source costs
- compare lead times
- choose fulfillment route dynamically
- support hybrid fulfillment

This is a major intelligence advantage.

---

## 11. Listing Layer

A listing is the customer-facing selling surface.

### Listing must support
- linked normalized product
- customer-facing title and copy
- pricing
- visibility
- fulfillment strategy
- shipping zones
- tax settings
- marketplace/storefront metadata
- active/inactive state
- channel publication state if relevant

### Listing should not be treated as the same thing as:
- supplier product
- internal product source
- order
- shipment

Keep these layers separate.

---

## 12. Fulfillment Strategy on Listings

Each listing must store its intended fulfillment behavior.

### Required options
- local_stock
- dropship
- preorder
- manual
- hybrid

### Hybrid example
- use local stock if quantity > 0
- otherwise create supplier purchase order
- otherwise fall back to preorder if supplier unavailable

This is one of the most important practical differentiators of the system.

---

## 13. Order Model Requirements

Orders should be central operational records.

### Order must support:
- customer / client
- listing(s)
- quantity
- payment state
- fulfillment route
- shipment state
- preorder state if applicable
- source route chosen
- warehouse route chosen
- linked expenses/costs if available
- linked revenue state
- linked notifications / timeline / flows

### Order stages should include
- placed
- awaiting payment
- paid
- awaiting fulfillment
- routed
- supplier ordered
- picking/packing
- shipped
- delivered
- completed
- cancelled
- refunded / return-ready later

---

## 14. Fulfillment Route Model

This is critical to support all product-delivery methods.

### Create `FulfillmentRoute`
A fulfillment route should capture:
- order or order line
- selected fulfillment model
- source supplier if applicable
- warehouse if applicable
- lead time
- shipping method
- tracking state
- status
- fallback logic
- cost snapshot

### This route tells the system:
how this item gets from source to customer.

Without this, the system cannot truly support multiple fulfillment methods cleanly.

---

## 15. Purchase Order Layer

Purchase orders are essential for dropship, wholesale, and supplier-based fulfillment.

### Required model
- `PurchaseOrder`
- linked supplier
- linked order(s)
- linked product(s)
- quantity
- status
- cost
- expected ship date
- supplier reference
- notes

### Use cases
- dropship order sent to supplier
- replenishment for stock
- preorder sourcing
- hybrid fallback purchasing

Purchase orders should feed Revenue, Expenses, Flows, and projectable landed cost logic.

---

## 16. Shipping, Warehouse, and Inventory Layer

The repo already has strong primitives for these directions, so this mission should formalize them into a seamless system.

### Required concepts
- Warehouses / stock locations
- Inventory counts
- Shipping zones
- Shipping methods
- Shipment records
- Customs declarations where relevant
- preorder lead times
- delivery estimates

### Inventory modes
- tracked inventory
- untracked
- supplier-managed
- preorder-only
- hybrid tracked/supplier fallback

### Shipment records should support
- order linkage
- fulfillment route linkage
- carrier
- tracking number
- status
- shippedAt
- deliveredAt
- estimated delivery
- failure/return state later

---

## 17. Landed Cost & Margin Intelligence

This is one of the strongest commercial features you can add.

### For each supplier-linked product or fulfillment route, estimate:
- source cost
- shipping cost
- duties/customs if relevant
- transaction costs if relevant
- packaging cost if relevant
- expected landed cost
- gross margin
- margin band / risk state

### Show the user
- recommended retail price
- current margin
- margin risk by destination/zone
- whether the product is suitable for dropship, stock, or preorder

This is mandatory if the system is to be truly useful.

---

## 18. Storefront / Marketplace UX Requirements

The marketplace/storefront should allow the user to:
- publish products
- manage active/inactive listings
- expose shipping and lead time clearly
- distinguish in-stock vs preorder vs supplier-fulfilled items
- present clean product information
- support bundle and upsell logic later

### The admin side should support
- listing readiness
- fulfillment readiness
- margin readiness
- source risk
- media completeness
- content/promotional readiness

This turns product listing into an operational and strategic process.

---

## 19. Cross-Module Integration Requirements

This mission must feed deeply into the rest of the app.

### A. Revenue
Commerce must connect to:
- sales
- invoices
- payments
- recurring product subscriptions if added
- gross margin and net contribution
- quote-to-order paths where applicable

### B. Expenses
Costs from sourcing, shipping, packaging, and vendors must inform:
- margin
- profitability
- reorder decisions
- price recommendations

### C. Content
Products should be promotable through Content.
The system should support:
- create campaign for listing
- generate social launch post
- promote underperforming product
- promote high-margin product
- promote underbooked/undersold categories

### D. Clients
Customers should connect to:
- orders
- repeat purchase behavior
- segmenting
- post-purchase follow-up
- product affinity

### E. Flows
Flows should be able to:
- trigger on order placed, shipped, delivered, low stock, preorder delay, etc.
- notify customer
- create follow-up content
- create project for custom fulfillment if needed
- create review request
- trigger reorder or supplier alert

### F. Projects
If a product sale includes custom work or setup:
- order can create project
- project can link back to listing/order
- delivery can involve both product and service workflows

This is essential for making the system feel like part of the OS.

---

## 20. AI Requirements

The AI should be deeply embedded in commerce and fulfillment.

### AI should help with:
- normalize supplier data
- rewrite product copy
- write SEO-friendly titles and descriptions
- recommend pricing
- estimate attractive margin bands
- suggest bundles
- suggest upsells/cross-sells
- recommend what to stock locally vs dropship
- recommend what to promote next
- explain why a product is underperforming
- explain why a fulfillment route is risky
- summarize fulfillment delays or operational issues

### Example AI outputs
- “This supplier product can be listed at TTD 149 for an estimated 34% gross margin after shipping.”
- “This item is better suited to preorder than dropship due to long supplier lead time.”
- “This product has high margin but low content promotion; recommend launching a 3-post campaign.”
- “Vendor concentration is high for this category; consider adding a backup source.”

This is where KeyFlow can be more than just an ecommerce admin.

---

## 21. Order-to-Customer Communication Layer

Mission 2 must work with Mission 1.

### Required communications use cases
- order confirmation
- preorder confirmation
- shipment confirmation
- delivery update
- delay notice
- review request
- reorder prompt
- upsell/cross-sell campaign

These should be driven through:
- Email
- WhatsApp where appropriate
- Content/promotional campaigns
- Flows

This makes the product commercially intelligent and customer-aware.

---

## 22. Recommended Internal Models

Suggested model set:

- `SupplierConnection`
- `SupplierProduct`
- `ProductSourceLink`
- `Product`
- `ProductVariant`
- `ProductListing`
- `Order`
- `OrderLine`
- `FulfillmentRoute`
- `PurchaseOrder`
- `Shipment`
- `ShippingProfile`
- `Warehouse`
- `InventoryRecord`
- `CostProfile`
- `MarginSnapshot`

The coder may adapt names, but the separation of concerns must remain.

---

## 23. Suggested Final Commerce Workspace Structure

This system may eventually live primarily under Marketplace / Commerce / Storefront surfaces.

### Recommended internal modes
- Catalog
- Listings
- Orders
- Fulfillment
- Inventory
- Suppliers
- Insights

### Catalog
Manage normalized products.

### Listings
Manage customer-facing listings.

### Orders
Manage customer orders and payment/fulfillment state.

### Fulfillment
Manage routing, purchase orders, shipments, and delivery state.

### Inventory
Manage stock, warehouses, and availability.

### Suppliers
Manage source connections and source products.

### Insights
Show margin, demand, risk, and opportunity.

This is a scalable structure and fits the ambition better than a narrow dropshipping page.

---

## 24. Suggested Final Component Tree

```text
CommerceSystem
  CommerceHeader

  CommerceModeTabs
    Catalog
    Listings
    Orders
    Fulfillment
    Inventory
    Suppliers
    Insights

  CatalogView
    ProductList
    ProductEditor
    ProductSourceLinks
    MarginPreview

  ListingsView
    ListingReadiness
    ListingGrid
    PricingControls
    FulfillmentStrategyControls

  OrdersView
    OrderList
    OrderDetail
    PaymentState
    FulfillmentSummary

  FulfillmentView
    FulfillmentRoutes
    PurchaseOrders
    ShipmentTracker
    DelayAndRiskWarnings

  InventoryView
    WarehouseList
    StockRecords
    ReorderSignals

  SuppliersView
    SupplierConnections
    SupplierCatalogImports
    SupplierProductMapping

  InsightsView
    MarginCards
    CostPressureSignals
    SourceRiskSignals
    ProductOpportunityCards
```

---

## 25. Prioritized Implementation Plan

### Phase 1 — Core architecture
1. Build supplier/source abstraction
2. Build normalized product layer
3. Build product source linking
4. Add listing fulfillment strategy model
5. Build fulfillment route model

### Phase 2 — Order and fulfillment engine
6. Upgrade order model
7. Add purchase orders
8. Add shipment and tracking model
9. Add warehouse/inventory linkage
10. Add preorder and hybrid route logic

### Phase 3 — Commerce intelligence
11. Add landed cost model
12. Add margin and pricing intelligence
13. Add source risk and lead-time signals
14. Add AI product normalization and copy

### Phase 4 — Cross-module integration
15. Connect to Revenue
16. Connect to Expenses
17. Connect to Content
18. Connect to Flows
19. Connect to Clients
20. Connect to Projects where relevant

### Phase 5 — Customer communications
21. Add order communications hooks
22. Connect to Mission 1 email/social/messaging system
23. Add post-purchase and delay notifications

---

## 26. Acceptance Criteria

This mission is successful if:

1. The system supports more than just dropshipping and clearly handles multiple fulfillment models
2. Supplier products are separated from normalized internal products and customer-facing listings
3. Orders can be routed through the correct fulfillment path
4. Purchase orders, shipments, and inventory states are supported coherently
5. Margin and landed cost intelligence are visible and useful
6. Products, orders, and fulfillment states connect visibly to Revenue, Expenses, Content, Clients, Flows, and Projects
7. AI can meaningfully assist with sourcing, pricing, copy, and fulfillment decisions
8. The system feels like one seamless commerce/fulfillment engine, not scattered ecommerce utilities

---

## 27. Non-Negotiables

- Do not build this as dropshipping only
- Do not conflate supplier products with customer-facing listings
- Do not ignore landed cost and margin
- Do not isolate orders from fulfillment routes
- Do not isolate commerce from Revenue, Expenses, Content, and Flows
- Do not make AI a decorative add-on instead of a real commerce copilot

---

## 28. Target Outcome Statement

The final Mission 2 system should feel like:

> a premium commerce and fulfillment orchestration engine that supports every major way of getting products to customers — stocked, dropshipped, preordered, manual, or hybrid — while connecting sourcing, listings, orders, fulfillment, communications, profitability, and AI into one seamless operating system.
