# KeyFlow Flows Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **Flows** workspace comprehensively without removing functionality. Preserve the current capabilities for live automations, templates, execution history, and automation creation, but evolve the page into the **cross-module intelligence and orchestration surface of the whole app**.

This workspace must not behave like a simple automation manager. It should become the place where KeyFlow understands what is happening across the business, what is already automated, what is not automated yet, what is failing, and what should happen next.

Do not remove features. Improve identity, flow visualization, execution intelligence, cross-app context, and strategic guidance.

---

## 1. Product Goal

The Flows workspace should support five connected jobs:

1. **Build automations**
   - define triggers
   - add conditions
   - add action chains
   - activate flows

2. **Monitor automation health**
   - active
   - paused
   - failed
   - skipped
   - recently triggered

3. **Understand business orchestration**
   - which modules are connected
   - what each flow affects
   - which business problems each flow solves

4. **Recommend missing automations**
   - based on real app usage
   - based on gaps in business coverage
   - based on detected patterns and risk

5. **Diagnose execution**
   - log runs
   - show results
   - show skipped/failure reasons
   - show affected records

The final workspace should feel:
- intelligent
- operational
- alive
- strategic
- premium
- system-defining

It should become the **business logic layer** of KeyFlow.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Top-level internal tabs**
   - My Automations
   - Templates
   - Activity Log

2. **Automation cards**
   - name
   - description
   - trigger
   - action sequence
   - toggle / controls

3. **Inline automation creation**
   - automation name
   - trigger
   - condition
   - action
   - preview flow

4. **Template library**
   - organized by domain
   - clear preview
   - clear activation path

5. **Activity Log concept**
   - search
   - status filters
   - execution history

6. **Cross-module template examples**
   - Quote Follow-Up Reminders
   - Lead Form → CRM → Campaign
   - Post-Booking Feedback Request
   - Cancelled Booking Re-engagement

Do not regress these.

---

## 3. Core Problems to Solve

### A. The page still feels too much like automation administration
It is clean and capable, but not yet distinctive enough to feel like the operational nervous system of the business.

### B. My Automations lacks live intelligence
The cards explain what flows do, but not enough about:
- health
- impact
- last run
- recent outcomes
- problems

### C. The builder is too form-like
It is usable, but not expressive enough as a flow-construction experience.

### D. Templates are good but not yet strategic enough
Templates need stronger framing around:
- business problem solved
- modules touched
- requirements
- expected outcomes

### E. Activity Log needs deeper diagnostic intent
It should be an observability layer, not just a status list.

### F. The page does not yet draw enough intelligence from the rest of the app
This is the largest missed opportunity.

Flows should actively use information from:
- Clients
- Calendar
- Revenue
- Content
- Audiences
- Forms
- Quotes
- Payments
- Bookings
- Segments
- Staff
- activity history

### G. Naming identity is slightly split
Sidebar says **Flows**
Page says **Automations**

That reduces brand clarity.

---

## 4. Required Outcome

After overhaul, the Flows workspace must support:

- flow creation
- flow monitoring
- cross-module orchestration visibility
- coverage intelligence across the business
- missing automation recommendations
- execution diagnostics
- a stronger, more branded identity as the system’s orchestration layer

---

## 5. Information Architecture

### Sidebar label
Use **Flows**

### Page title
Prefer **Flows** as the main page title.

Recommended:
- **Flows**
- *Automate and orchestrate how your business reacts across every module*

This is stronger than “Automations” because it is more product-defining and less generic.

If “Automations” is retained anywhere, it should be clearly subordinate to the stronger Flows identity.

---

## 6. Final Top-Level Structure

Keep and strengthen these three pillars:

1. **My Flows**
2. **Templates**
3. **Activity Log**

Rename “My Automations” to **My Flows** for consistency if possible.

---

## 7. Cross-Module Intelligence Requirement (Critical)

This is the single most important requirement in this document.

The Flows workspace must draw from information across the entire app to become more intelligent.

### Flows must be able to use state from:
- Clients / CRM
- Calendar / Bookings
- Revenue / Quotes / Invoices / Payments
- Content / Campaigns / Posts
- Audiences / Segments
- Forms / Submissions
- Staff / availability if relevant
- Activity history / timeline data

### In practice this means:
- triggers should come from all major modules
- conditions should reference cross-module context
- actions should affect multiple modules
- recommendations should be based on real usage patterns and missing automation coverage

This requirement is non-negotiable.

---

## 8. Cross-Module Trigger Model

Expose triggers from all core surfaces.

### Examples
- client created
- client stage changed
- no activity for 30 days
- booking completed
- booking cancelled
- booking scheduled
- quote sent
- quote viewed
- quote not accepted after X days
- invoice overdue
- payment received
- campaign sent
- campaign opened
- post published
- form submitted
- segment changed
- recurring billing failed
- staff assignment missing

The user should feel that Flows is aware of everything happening across the app.

---

## 9. Cross-Module Conditions

Flows should be able to reason with context from multiple modules.

### Examples
- if contact is VIP
- if invoice amount > threshold
- if quote belongs to a specific package
- if client has no booking in 30 days
- if booking was cancelled twice
- if payment is pending and no reply was sent
- if form source = website
- if audience segment = stage-changed
- if contact has overdue invoice and upcoming booking
- if campaign not opened in 14 days
- if no review request has been sent after booking

This is where the workspace becomes genuinely intelligent.

---

## 10. Cross-Module Actions

Actions should not be limited to one module.

### Examples
- create CRM task
- send email
- send WhatsApp
- tag contact
- update segment
- enroll in campaign
- create invoice
- send quote reminder
- notify staff
- create booking follow-up
- schedule re-engagement
- create content draft
- request review
- log timeline event

This should be reflected in both templates and custom flow creation.

---

## 11. Automation Coverage Intelligence (New)

Add a top-level automation coverage section that tells the user where the business is already automated and where gaps remain.

### Example coverage map
- Clients: partial coverage
- Revenue: reminders enabled
- Bookings: review flow enabled
- Content: no nurture automation
- Forms: lead routing enabled
- VIP clients: no retention automation

### Purpose
Users should immediately understand:
- which modules are covered
- which modules are under-automated
- where they should automate next

This is one of the strongest possible upgrades.

---

## 12. Flow Health Summary (New)

At the top of My Flows, add a compact control strip showing:

- Active flows
- Paused
- Failed this week
- Most triggered
- Needs attention
- Recommended to add

Optional:
- coverage % by module
- last execution time
- recent successful automations

This should be visible before the flow cards.

---

## 13. My Flows Overhaul

The current cards are readable, but they need to become more operational.

### Each flow card should show:
- flow name
- short business-problem statement
- trigger
- action chain
- modules touched
- active/paused state
- last run
- runs this week
- success/failure health
- last affected record if useful
- quick actions

### Example card
**Quote Follow-Up Reminders**
- Solves: quote conversion drop-off
- Trigger: quote.sent
- Actions: create task → send reminder email
- Modules: Revenue, Clients, Tasks
- Last run: 2 days ago
- Success rate: 100%
- Outcome: 3 follow-ups created, 1 quote converted

This is much stronger than just trigger + actions.

---

## 14. Flow Card Warnings / Alerts

Each card should optionally surface warnings such as:
- last run failed
- missing required setup
- module disconnected
- condition never matched
- flow has not run in 30 days
- dependent campaign missing
- payment gateway not configured for payment-related flow

This makes the workspace actively trustworthy.

---

## 15. Builder Overhaul

The current inline builder is a good base but too form-like.

### New builder principles
The builder should feel like constructing a **business reaction chain**.

Structure:
1. Trigger
2. Conditions
3. Action steps
4. Delays / wait logic
5. Branching / fallback (future-ready)
6. Preview / natural-language summary

### Improve visual structure
Use step blocks/cards instead of mostly flat row inputs.

Each block should clearly show:
- type
- selected item
- edit/change action
- delete/reorder if relevant

### Add natural-language summary
As the user builds, show:
> When a quote is sent, if the contact is VIP and invoice value is above TTD 500, wait 3 days, then create a follow-up task and send reminder email.

This makes the builder more human and much easier to trust.

---

## 16. Template Library Overhaul

Templates are already one of the best parts and should become even stronger.

### Each template should show:
- title
- business problem solved
- trigger
- actions
- modules touched
- setup prerequisites
- expected business outcome
- complexity level
- preview
- activate

### Example
**Lead Form → CRM → Campaign**
- Solves: missed lead follow-up
- Trigger: form submitted
- Modules: Forms, Clients, Content
- Requires: at least 1 form, 1 campaign
- Outcome: auto-create contact and start nurture
- Complexity: Easy

This turns templates into strategic recommendations, not just examples.

---

## 17. Recommended Flow Engine (New)

Template suggestions should adapt to real app state.

### The system should recommend flows like:
- forms exist but no welcome flow → suggest lead nurture
- invoices overdue but no reminder flow → suggest dunning
- bookings complete but no review flow → suggest feedback automation
- VIP segment exists but no nurture flow → suggest retention playbook
- canceled bookings exist but no reactivation flow → suggest re-engagement

### Recommendation cards should show:
- why this is recommended
- what modules it uses
- expected result
- activate / preview actions

This is one of the clearest manifestations of app-wide intelligence.

---

## 18. Activity Log Overhaul

The Activity Log should become the trust and diagnostics layer of automation.

### Each log entry should show:
- flow name
- trigger event
- result (success / failed / skipped)
- affected record(s)
- timestamp
- reason if skipped
- error if failed
- inspect / rerun / open record action

### Add filters for:
- module
- flow
- result
- date
- affected record type

### Empty state should say:
Once your flows run, you’ll be able to inspect every execution, failure, and skipped condition here.

This helps users understand that the system is observable.

---

## 19. Flow Visualization / Identity Upgrade

The Flows page should be visually more distinctive than a normal admin surface.

### Add more flow language and presentation:
- trigger → condition → action chain summaries
- modules touched chips
- execution counters
- simple chain diagrams where appropriate
- highlighted cross-module relationships

Not every flow needs a giant node graph.
But the page should clearly feel like process orchestration, not plain settings.

---

## 20. Upgrade / Entitlement Banner Handling

The Playbook Automations / Upgrade banner is acceptable, but must not dominate the core flow experience.

### Rules
- keep compact
- clearly secondary to the actual workspace
- dismissible
- do not push the core control layer too far down
- if possible, integrate entitlement messaging into template activation or feature gating, not as the visual hero

---

## 21. Search and Filter Rules

### My Flows
Allow filtering by:
- active / paused
- module touched
- last run state
- failed / warning
- trigger type
- business problem

### Templates
Allow filtering by:
- module
- complexity
- recommended
- setup-ready
- problem type

### Activity Log
Allow filtering by:
- success
- failed
- skipped
- module
- affected record
- time range

---

## 22. Functional Integration Requirements

The Flows page must visibly connect to the rest of the app.

### Flow cards should reference:
- Clients
- Bookings
- Revenue objects
- Campaigns
- Forms
- Segments
- Staff if relevant
- timelines and notifications

### Examples
- open related client
- open related invoice
- open related booking
- open related campaign
- inspect affected record

This is required for system coherence.

---

## 23. Suggested Final Component Tree

```text
FlowsPage
  FlowsHeader
    Breadcrumbs
    Title + subtitle
    GuideMeLink

  EntitlementBanner

  FlowsModeTabs
    MyFlows
    Templates
    ActivityLog

  MyFlowsView
    FlowHealthStrip
    AutomationCoverageMap
    RecommendedFlowsStrip
    SearchAndFilters
    NewFlowButton
    FlowBuilder
      TriggerBlock
      ConditionBlocks
      ActionBlocks
      DelayBlocks
      FlowPreviewSummary
    FlowCards
      FlowCard[]

  TemplatesView
    TemplateIntro
    RecommendedTemplates
    TemplateFilters
    TemplateGroupsByModule
      TemplateCard[]

  ActivityLogView
    ActivitySummary
    ActivityFilters
    ActivitySearch
    ExecutionLogList
      ExecutionLogItem[]
```

---

## 24. Prioritized Implementation Plan

### Phase 1 — Identity and intelligence foundation
1. Standardize naming around **Flows**
2. Add Flow Health Strip
3. Add Automation Coverage Map
4. Add Recommended Flows based on app state

### Phase 2 — My Flows improvements
5. Upgrade flow cards with:
   - modules touched
   - last run
   - health
   - outcome
   - warnings
6. Improve search/filtering
7. Add stronger quick actions and related-record links

### Phase 3 — Builder improvements
8. Redesign builder from flat form rows into step blocks
9. Add natural-language summary
10. Prepare for richer multi-step logic and delays

### Phase 4 — Templates and recommendations
11. Enrich templates with business problem, modules, prerequisites, outcome, complexity
12. Add adaptive recommendations from real app state

### Phase 5 — Activity Log and diagnostics
13. Upgrade execution log with detailed records and reasons
14. Add inspect / rerun / open related record actions
15. Improve empty states and log filtering

### Phase 6 — Visual distinctiveness
16. Add stronger flow visualization language
17. Refine spacing, hierarchy, chips, and live-state indicators
18. Make the page feel more signature-worthy than a normal admin screen

---

## 25. Acceptance Criteria

The Flows overhaul is successful if:

1. Users can clearly see what is automated, what is not, and what needs attention
2. The page visibly draws from all major app modules
3. Flow cards show health, impact, and recent execution context
4. Templates feel strategic, not generic
5. Recommendations adapt to real app usage and missing coverage
6. The builder feels like creating a business reaction chain, not filling a form
7. Activity Log supports trust and diagnostics
8. The page feels like the orchestration layer of the business, not just an automation manager
9. No current capability is removed

---

## 26. Non-Negotiables

- Do not remove My Flows, Templates, or Activity Log
- Do not reduce the builder to fewer capabilities
- Do not keep the page isolated from the rest of the app’s data
- Do not leave templates static and context-blind
- Do not let the page feel like generic automation settings
- Do not let the upgrade banner overpower the actual workspace

---

## 27. Target Outcome Statement

The final Flows workspace should feel like:

> the intelligent orchestration layer of KeyFlow — a premium cross-module control surface that shows what is happening across the business, what is automated, what is missing, what failed, and what the system should do next.
