# KEYFLOWOS Capability & Workforce Replacement Blueprint

Checkpoint: `KFW-2026-09-17-01`  
Status: **CANONICAL WORKFORCE-REPLACEMENT PRODUCT LAYER / PRE-IMPLEMENTATION**

## 1. Objective

KEYFLOWOS is designed to reduce or eliminate roles whose primary workload is moving information, coordinating routine work, monitoring status, scheduling, documenting, following up, comparing options, preparing routine artifacts, reconciling deterministic records and executing bounded digital procedures.

Replacement is responsibility-based, not title-based.

## 2. Automation classes

- **A0 — Human-only / expert-led:** software assists but does not own the decision/work.
- **A1 — Human-led, KEY-assisted:** KEY prepares/recommends; human executes.
- **A2 — Supervised automation:** KEY executes after approval or within narrow policy.
- **A3 — Policy-autonomous:** KEY executes within delegated limits and reports.
- **A4 — Fully autonomous routine digital work:** no human touch unless exception occurs.

A role may contain tasks across several classes.

## 3. Workforce map

| Role/function | Target level | Responsibilities KEYFLOWOS can absorb |
|---|---|---|
| Data entry clerk | A4 | capture, normalize, update, classify, route |
| Meeting scheduler | A4 | availability, invitations, reschedule, reminders |
| Appointment coordinator | A4 | booking lifecycle, reminders, changes |
| CRM administrator | A3/A4 | hygiene, dedupe, lifecycle updates, routing |
| Sales coordinator | A3/A4 | follow-up, quote prep, scheduling, pipeline admin |
| Lead qualifier | A3 | scoring, enrichment, routing, initial response |
| SDR routine outreach | A2/A3 | research, sequences, booking; escalate complex objections |
| Receptionist digital/phone | A3 | FAQs, booking, routing, status, basic voice |
| L1 customer support | A3/A4 | status, FAQs, routine actions, escalation |
| Executive assistant | A2/A3 | briefs, reminders, follow-through, scheduling, drafting |
| Admin assistant | A3/A4 | records, forms, reminders, routine coordination |
| Operations coordinator | A3 | task/status monitoring, follow-up, escalation |
| Project coordinator | A3/A4 | schedules, actions, dependencies, updates |
| Junior project manager | A2/A3 | plans/status/risk prompts; stakeholder judgment remains human |
| Billing clerk | A4 | invoice generation, reminders, payment linkage |
| AR clerk | A3/A4 | dunning, receipts, allocation, escalation |
| AP/procurement admin | A2/A3 | bill/PO/admin, supplier records, approvals |
| Reconciliation clerk | A3 | matching, discrepancy surfacing, repair proposals |
| Bookkeeping admin | A2/A3 | routine posting/reconciliation/report prep |
| Financial analyst routine | A1/A2 | reporting, variance, scenarios; interpretation retained |
| Marketing assistant | A3 | calendar, drafts, scheduling, campaign ops |
| Social media coordinator | A2/A3 | publishing, routine engagement, reporting |
| Junior copywriter | A1/A2 | drafts/variants; brand judgment retained |
| Campaign operator | A3 | segmentation, execution, monitoring |
| Reporting analyst | A3 | dashboards, briefs, anomaly reporting |
| Business analyst routine | A2/A3 | KPI/flow analysis, recommendation prep |
| Contract administrator | A3/A4 | storage, obligations, renewals, routing |
| Renewal coordinator | A4 | tracking, reminders, standard outreach |
| Document controller | A4 | taxonomy, versions, evidence, retrieval |
| Supplier researcher | A3/A4 | discovery, screening, matching |
| Procurement administrator | A3 | RFQ, comparison, PO admin, monitoring |
| Purchasing clerk | A2/A3 | routine purchase workflow within limits |
| Referral/partnership coordinator | A2/A3 | matching, introductions, tracking |
| Logistics coordinator | A2/A3 | tracking, scheduling, exception routing |
| Event registration admin | A4 | forms, ticketing, confirmations, attendee data |
| Ticketing admin | A4 | inventory, issuance, status, reminders |
| Event communications coordinator | A3/A4 | invitations, updates, reminders, follow-up |
| Event operations coordinator | A2/A3 | vendor/task coordination, check-in/admin |
| SaaS/integration admin | A2/A3 | health, reconnect workflows, sync monitoring |
| QA/recovery monitor | A3 | incident detection, retry/reconciliation queues |
| HR administrator routine | A2/A3 | onboarding docs, scheduling, records |
| Recruiter coordination | A2/A3 | sourcing/screening/scheduling; interviews human |
| Legal/compliance admin | A1/A2 | evidence, routing, templates, reminders |
| Senior accountant/tax adviser | A0/A1 | KEY prepares evidence; licensed judgment retained |
| Lawyer | A0/A1 | research/drafting assistance only for substantive legal judgment |
| CEO/founder | A1/A2 | KEY compresses admin/analysis; vision/final authority remains human |
| Senior relationship sales | A1/A2 | KEY prepares and coordinates; trust/negotiation human |
| Skilled practitioner | variable | admin/business operations automated; core service depends on profession |
| Physical worker/field technician | A0/A1 | scheduling/instructions/evidence support; physical work remains human |

## 4. Department replacement thesis

### Front office
KEY + Space can absorb reception, routine support, booking, basic sales intake and customer admin.

### Revenue operations
KEY can absorb lead routing, CRM hygiene, follow-up, quote/admin, billing, collections and reporting.

### Operations
KEY can absorb coordination, task chasing, dependency tracking, exception monitoring and routine project admin.

### Finance administration
KEY can absorb invoice/payment/reconciliation/report-prep workload while preserving expert accounting authority.

### Marketing operations
KEY can absorb production scheduling, publishing, segmentation, reporting and routine lifecycle campaigns.

### Procurement / network operations
KEY Network can absorb supplier research, RFQs, comparison, procurement admin, logistics monitoring and partner discovery.

### Event administration
KEY Space can absorb registration/ticketing, attendee communications, check-in admin, reporting and supplier coordination.

### Executive support
KEY/Cockpit can absorb briefing, prioritization, reminders and follow-through.

## 5. Management-by-exception target

The ideal operating mode is:

```text
routine work handled automatically
→ exceptions, approvals and strategic choices surfaced
→ owner/specialist intervenes only where human judgment is valuable
```

Cockpit should therefore show:
- approvals;
- exceptions;
- unresolved uncertainty;
- decisions;
- opportunities;
- material risks;
- relationship-sensitive cases.

It should not force humans to manually traverse every underlying module.

## 6. Measurement framework

During implementation, each capability should be tagged with:
- worker responsibility replaced;
- automation class A0-A4;
- average human touches before/after;
- exception rate;
- approval rate;
- cycle-time reduction;
- error/rework rate;
- business outcome;
- safety/proof requirement.

This allows KEYFLOWOS to quantify actual workforce compression rather than market vague "AI efficiency."
