# KeyFlow Network — Community, Directory, Index & B2B Orchestration Blueprint

Checkpoint: `KFN-2026-09-17-01`  
Status: **ACCEPTED PRODUCT CAPABILITY / PRE-IMPLEMENTATION / NO CODE CHANGES**

## 1. Product definition

**KeyFlow Network** is the shared inter-business layer of KEYFLOWOS.

Its job is to turn isolated businesses, organizations, suppliers and professionals into a discoverable, trusted, transactable network that KEY can reason over and orchestrate.

Core product promise:

```text
"I need something done"
→ understand the need
→ decompose the pathway
→ discover suitable entities
→ explain why they fit
→ compare trust/capability/logistics
→ request quotes / negotiate bounded options
→ select under governance
→ coordinate purchase / delivery / fulfilment
→ capture outcome evidence
→ update relationship + reputation knowledge
```

Example:

```text
Need: conference banners
→ clarify dimensions / quantity / deadline / budget
→ determine design requirement
→ find graphic designer(s)
→ create design brief
→ obtain/approve artwork
→ find printer(s) with suitable equipment/location/capacity
→ compare price, turnaround, reliability and delivery
→ request quotes
→ select provider(s)
→ issue PO/order/payment according to authority
→ track proof / printing / pickup or delivery
→ confirm fulfilment
→ rate outcome / update network evidence
```

The goal is not merely discovery. The long-term goal is **real B2B orchestration**.

## 2. Existing product seams to converge

The fixed-baseline app already contains partial implementations for:

- community posts, comments and cohorts;
- business directory search;
- business profiles and public presence;
- reviews and ratings;
- reputation snapshots;
- referrals and collaborations;
- partner relationships;
- network analytics;
- AI business/provider matching;
- supplier connections/products;
- procurement requests;
- purchase orders;
- supplier acknowledgement / fulfilment / invoicing states;
- marketplace/provider surfaces.

These should be converged, not duplicated.

## 3. Network entity model

The Network should reason about many entity types, not only KeyFlow customers.

Conceptual Entity types include:

- Business
- Organization
- Supplier
- Professional / freelancer
- Venue
- Service provider
- Manufacturer
- Distributor
- Logistics provider
- Event organizer
- Public institution
- Partner
- External/Unclaimed entity

Every known entity should carry provenance and confidence.

An entity can be:

```text
CLAIMED_KEYFLOW_ENTITY
VERIFIED_EXTERNAL_ENTITY
UNCLAIMED_DIRECTORY_ENTITY
PROVISIONAL / DISCOVERED_ENTITY
RESTRICTED / DISPUTED
```

Unclaimed external entities must never be presented as if KeyFlow verified data it merely imported or inferred.

## 4. KeyFlow Directory

The Directory becomes a first-class discovery surface across the network.

Search/filter dimensions may include:

- name;
- category/industry;
- products/services;
- skills/capabilities;
- geography;
- service radius;
- delivery area;
- remote/on-site;
- availability/capacity;
- price range;
- minimum order;
- turnaround time;
- verification status;
- KeyFlow Index dimensions;
- reviews;
- past completed work;
- partner/referral relationships;
- event participation;
- supplier/product compatibility.

Directory results should explain **why** an entity is shown.

## 5. Interactive network map

A geospatial view should allow users to explore businesses/organizations/suppliers visually.

Map layers may include:

- businesses/organizations;
- services/categories;
- suppliers;
- venues;
- logistics/delivery providers;
- event locations;
- partner networks;
- service areas;
- demand/need clusters where privacy permits.

Example:

> "Show me printers within 20 km of Port of Spain that can produce ten 8×3 ft outdoor banners within 5 days."

Map ranking must combine geography with capability/trust/capacity rather than distance alone.

Exact live location and private customer addresses are not public directory data by default.

## 6. Social community

The current community concept should mature into a useful business network rather than a generic social feed.

Core post types:

- DISCUSSION
- QUESTION
- NEED / REQUEST
- OPPORTUNITY
- COLLABORATION
- REFERRAL
- JOB / CONTRACT opportunity
- EVENT
- OFFER
- INSIGHT / RESOURCE

KEY can detect a need-style post and suggest/match providers.

Community features may include:

- follow businesses;
- comments/replies;
- saves;
- endorsements;
- cohorts/circles;
- industry/local groups;
- referrals;
- introductions;
- collaboration requests;
- direct business-to-business conversation;
- event/community discovery.

The community should optimize for **useful economic/business relationships**, not engagement addiction.

## 7. KeyFlow Index

The **KeyFlow Index** is the evidence-backed entity assessment system.

It must **not** be one opaque popularity score.

The primary representation is a multidimensional profile, conceptually:

```text
Identity / Verification
Capability Fit
Quality / Satisfaction
Reliability
Responsiveness
On-time Performance
Commercial Reliability
Fulfilment Evidence
Repeat Relationship Strength
Network Contribution
Dispute / Correction History
Freshness / Evidence Confidence
Capacity / Availability (time-sensitive)
Geographic / logistics fit (query-specific)
```

A summary score may exist for convenience, but every displayed rating/rank must be explainable.

### Source classes

Index evidence can come from:

- verified KeyFlow transactions;
- fulfilled quotes/orders/collaborations;
- payment/fulfilment evidence;
- on-time completion;
- verified reviews;
- referrals;
- repeat counterparties;
- profile verification;
- response times;
- disputes/refunds/cancellations;
- supplier/product fulfilment;
- externally sourced public data with provenance;
- claimed entity corrections.

### Critical laws

1. popularity is not quality;
2. profile completeness is not operational trust;
3. paid placement is not Index evidence;
4. advertising must not silently change organic trust ranking;
5. one bad outcome does not permanently condemn an entity;
6. old evidence decays in relevance;
7. evidence confidence/provenance is visible;
8. disputed facts can be challenged/corrected;
9. protected/sensitive personal traits are not ranking inputs;
10. query-specific fit is separate from global reputation;
11. new entities must have an exploration path and not be permanently suppressed by lack of history;
12. KeyFlow must distinguish "unknown" from "bad."

## 8. Entity profile / network passport

Every entity profile may expose:

- identity and description;
- KeyFlow Space/public site;
- products/services;
- capabilities/skills;
- operating area;
- business hours;
- delivery/service radius;
- certifications/badges where evidenced;
- verification state;
- selected Index dimensions;
- reviews;
- completed network activity summaries;
- response metrics;
- availability/capacity;
- events;
- partners/referrals;
- contact/request-quote actions.

Private commercial metrics remain private unless explicitly shared.

## 9. Need-to-pathway planning

KEY should convert a user request into a **Sourcing Pathway**.

Example input:

> "I need branded banners for my conference next month."

KEY can derive:

```text
Goal
→ requirements still missing
→ dependency graph
→ candidate tasks
→ capability types needed
→ sequencing
→ candidate providers
→ logistics
→ expected cost/time ranges
→ approval points
```

Possible pathway:

```text
Conference banner need
1. confirm sizes/quantity/venue restrictions
2. brand/design brief
3. artwork design
4. proof approval
5. material/print-spec selection
6. printer quote
7. production
8. delivery/pickup
9. onsite installation if required
```

KEY explains each step and why each provider is recommended.

## 10. Provider matching

Provider matching should use:

- semantic capability match;
- exact service/product availability;
- geography/logistics;
- capacity/current availability;
- price/budget fit;
- lead time;
- Index evidence;
- prior relationship;
- business preferences;
- conflict/exclusion rules;
- required certification/credential;
- delivery/pickup constraints.

A match explanation should be human-readable:

> "Recommended because they provide large-format outdoor printing, are 8 km from your venue, have a 92% on-time rate across 38 evidenced jobs, responded within 2.4 hours on average, and can meet your requested date."

Do not fabricate metrics when evidence is absent.

## 11. Requests / RFQ / procurement

A Sourcing Pathway can become a governed procurement occurrence.

```text
Need
→ structured brief
→ candidate providers
→ RFQ / quote requests
→ quote normalization
→ comparison
→ approval / selection
→ PO / order / contract
→ provider acknowledgement
→ fulfilment
→ invoice/payment
→ delivery/evidence
→ close / review
```

Existing ProcurementRequest / PurchaseOrder seams should be reused where semantically compatible.

## 12. Multi-provider orchestration

Some outcomes require multiple counterparties.

KEY should eventually manage a supply graph.

Example:

```text
Conference
├─ graphic designer
├─ printer
├─ venue
├─ AV supplier
├─ caterer
├─ photographer
├─ transport/logistics
└─ event staff
```

KEY coordinates dependencies:

- design must finish before printing;
- banners must arrive before setup;
- venue delivery window constrains courier;
- catering headcount follows registrations;
- AV requirements follow agenda/venue;
- payment/approval thresholds vary by supplier.

This composes K7 temporal/workflow + K11 recovery rather than creating an uncontrolled autonomous marketplace bot.

## 13. Real-world logistics

Long-term Network orchestration may include:

- pickup/delivery;
- shipping/courier;
- route selection;
- delivery windows;
- warehouse/location;
- inventory availability;
- proof of pickup/delivery;
- installation/setup dependencies;
- third-party logistics providers;
- cross-provider handoffs.

KEY should distinguish:

```text
ordered
acknowledged
ready
picked up
in transit
delivered
accepted
```

External provider evidence and local user confirmation may both contribute.

## 14. Relationships and network graph

The Business Graph should gain network edges such as:

- supplied_by;
- bought_from;
- referred_to;
- referred_by;
- partnered_with;
- collaborated_with;
- attended_event;
- sponsored;
- fulfilled_for;
- frequently_bought_with;
- geographically_near;
- service_complements;
- trusted_for_capability.

Edges have provenance, time and evidence.

This enables queries like:

> "Who in my network can introduce me to a reliable caterer?"

or:

> "Which three suppliers are most central to my event-delivery network?"

## 15. KEY proactive network behavior

Subject to business policy, KEY may:

- discover better suppliers;
- flag supplier concentration risk;
- suggest introductions;
- identify nearby providers;
- recommend partnerships;
- detect a community need matching the business's services;
- draft/submit quote responses;
- request competing quotes;
- suggest reorder/sourcing actions;
- monitor fulfilment;
- reconcile late delivery;
- propose backup suppliers;
- build sourcing pathways;
- surface new network opportunities.

KEY must not accept financially/materially binding terms outside delegated authority.

## 16. KeyFlow Network + KeyFlow Space

Each claimed business entity's primary profile links to its **KeyFlow Space**.

Thus:

```text
Network Directory / Map
→ Entity Profile
→ KeyFlow Space
→ services/products/events/bookings
→ B2B request/quote/order/relationship
```

The Network drives discovery; Space drives public presentation and transaction.

## 17. Workforce replacement

This layer targets large parts of:

- procurement admin;
- purchasing clerk;
- supplier research;
- vendor onboarding admin;
- vendor comparison;
- referral coordinator;
- business development research;
- partnership coordinator;
- logistics coordinator;
- sourcing analyst;
- local business directory/research tasks;
- quote collection/comparison;
- event supplier coordination;
- office/facilities supplier coordination.

Relationship-heavy negotiation and high-stakes supplier strategy remain human-augmented.

## 18. Product phases

### Network Foundation
- entity directory;
- claimed/unclaimed profiles;
- search;
- community;
- follow/referral/collaboration;
- KeyFlow Space linkage.

### Index & Trust
- evidence-backed Index dimensions;
- reviews;
- verification;
- correction/dispute;
- explainable matching.

### Map & Discovery
- geospatial directory;
- service areas;
- capacity/availability;
- query-specific map ranking.

### B2B Sourcing
- need decomposition;
- sourcing pathways;
- RFQ/quote comparison;
- supplier matching;
- procurement/PO integration.

### Orchestration
- multi-provider dependencies;
- logistics;
- fulfilment evidence;
- backup/recovery;
- proactive KEY network actions.

### Network Intelligence
- supply graphs;
- opportunity discovery;
- ecosystem risk;
- partnership recommendations;
- regional/industry insights with privacy-safe aggregation.
