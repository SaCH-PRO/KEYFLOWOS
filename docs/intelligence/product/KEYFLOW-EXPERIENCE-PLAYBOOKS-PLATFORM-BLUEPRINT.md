# KeyFlow Experience, Playbooks & Platform Blueprint

Checkpoint: `KFX-2026-09-17-01`  
Status: **ACCEPTED PRODUCT EXPERIENCE / PLATFORM CONTRACT**

## 1. Dual-interface model

### Studio — Build
Where a business configures:
- identity/profile;
- services/products;
- Space;
- events;
- team/authority;
- connectors;
- policies;
- Playbooks;
- KEY autonomy;
- branding;
- templates;
- Network preferences.

### Cockpit — Run
Where a business operates daily through:
- KEY conversation/voice;
- Command bar;
- Flow Feed;
- Flow Graph;
- priorities;
- approvals;
- exceptions;
- financial/operational health;
- recovery;
- current actions.

The user should not need to know which internal module owns an action.

## 2. Flow Feed

Flow Feed is an evidence-backed business activity/attention stream.

Entries may represent:
- customer/payment/booking/work events;
- approvals;
- anomalies;
- overdue work;
- supplier/network events;
- event registrations;
- recovery;
- recommendations;
- completed KEY actions.

Each entry should resolve to canonical source/evidence and available actions.

## 3. Flow Graph

Flow Graph is a visual projection of business movement and bottlenecks, for example:
```text
Leads → Qualified → Quotes → Accepted → Paid → Booked → Delivered → Repeat
```

and other domain-specific flows.

It is not an execution engine or source of truth by itself.

## 4. KEY Command

Natural-language execution layer:
```text
"Book Ana for Friday at 3"
"Follow up unpaid quotes"
"Find a printer for these banners"
"Create an event and open early-bird registration"
"Show me where projects are blocked"
```

KEY maps intent to exact CapabilityContracts and governance.

## 5. Playbook Library

KEYFLOWOS ships pre-opinionated Playbooks so users receive value without designing automations from scratch.

A Playbook version declares:
- purpose;
- triggers/occurrences;
- conditions;
- waits;
- actions;
- required capabilities;
- required connectors/data;
- control/approval requirements;
- failure/recovery behavior;
- outputs;
- version;
- compatibility.

Examples:
- 5-Star Review Flow;
- New Lead Follow-up;
- Accepted Quote → Deposit → Booking;
- Paid Invoice → Project Kickoff;
- Abandoned Registration Follow-up;
- Overdue Invoice Recovery;
- Event Reminder Sequence;
- Supplier Delay Escalation.

## 6. Playbook customization

Users may:
- activate/deactivate;
- adjust timings/templates;
- change thresholds;
- add/remove optional steps where safe;
- choose channels;
- select authority/autonomy level;
- clone;
- version;
- test/simulate.

Customization cannot bypass locked domain/governance invariants.

## 7. Flow Marketplace

Long-term platform capability:
- publishers share/sell/free-distribute Playbooks;
- businesses discover by industry/outcome;
- install one version;
- review permissions/connectors/actions before activation;
- adapt locally;
- receive update notices;
- choose whether to upgrade;
- retain provenance/version history.

Marketplace rules:
1. imported Playbook never inherits authority automatically;
2. every required capability is re-bound to local business policy;
3. connector scopes are explicit;
4. version update does not silently change active behavior;
5. publisher reputation is separate from Playbook proof;
6. installation supports sandbox/simulation;
7. dangerous/high-impact actions require control review.

KeyFlow Network may host discovery/reputation for Playbook creators, but runtime ownership remains K5/K7/K3/K11.

## 8. Zero-friction onboarding

The onboarding target is outcome-first.

A generic path:
```text
sign up
→ create/claim business
→ choose business type/goals
→ connect one or two critical channels
→ configure first offer/service
→ publish KeyFlow Space/booking surface
→ activate recommended Playbook
→ receive first real customer/business event
```

KEY should progressively configure the business rather than front-load a giant settings form.

## 9. Gamification

Allowed:
- setup progress;
- first booking/sale/payment;
- first automated workflow;
- verified profile;
- completed business-health milestones;
- evidence-backed streaks where useful.

Not allowed:
- vanity points that obscure real outcomes;
- rewards for spam;
- incentives to game the KeyFlow Index;
- gamified financial/risk decisions.

## 10. Virality / growth loops

### Public loop
Professional Space, booking, event, quote/payment and portal surfaces may display tasteful Powered by KeyFlow attribution.

### Playbook loop
Power users publish valuable Playbooks, driving creator-led adoption.

### Network loop
B2B relationships, referrals, events and Space discovery create cross-business acquisition.

### Review/referral loop
Successful completed outcomes can trigger review/referral Playbooks.

Growth mechanics must not corrupt reputation/trust ranking.

## 11. UI principle

Seamless UX comes from shared semantics, not hidden loss of domain boundaries.

Users see one coherent OS; internal modules retain correct ownership.
