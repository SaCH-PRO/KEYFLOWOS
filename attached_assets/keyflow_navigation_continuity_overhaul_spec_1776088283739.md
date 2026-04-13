# KeyFlow Navigation Continuity & Redirect Architecture Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign the app’s **navigation continuity, redirect behavior, studio routing, settings pathways, and return-flow architecture** so the product feels like one coherent operating system instead of a set of fragmented pages.

This document focuses on one major experience problem:

> users are being redirected into settings, studios, or configuration flows in a way that breaks context, interrupts tasks, and makes it hard to return to what they were doing.

The goal is to create a **context-preserving workflow system** across the entire app.

Do not remove functionality. Re-architect navigation so setup, configuration, creation, inspection, and execution all feel connected, intelligible, and reversible.

---

## 1. Product Goal

The navigation system should help users always answer:

- Where am I?
- Why am I here?
- What was I trying to do?
- What do I need to complete?
- How do I return to what I was doing?
- Will I lose work if I leave?

The final navigation experience should feel:
- continuous
- predictable
- guided
- premium
- reversible
- context-aware

The product should preserve flow state instead of forcing users to mentally reconstruct it.

---

## 2. Core Problem Statement

The current app likely has fragmentation across three navigation layers:

1. **Global workspace navigation**
   - Clients
   - Calendar
   - Revenue
   - Content
   - Flows
   - Projects
   - Expenses
   - etc.

2. **Internal module navigation**
   - tabs
   - submodes
   - detail panels
   - setup vs live operations

3. **Studio / builder / settings redirect navigation**
   - create screens
   - setup screens
   - settings pages
   - prerequisites
   - detached builder routes

The main problem is not the existence of these layers.
The problem is that they currently do not preserve task continuity strongly enough.

---

## 3. Core UX Failures to Eliminate

### A. Forced redirect to settings
The user starts a task and is sent elsewhere to configure prerequisites.

### B. No explicit return path
The user lands in setup/settings and has no clear “return to where you were” mechanism.

### C. Loss of source context
The user forgets:
- which module they came from
- which record they were working on
- which tab they were on
- what action they intended to complete

### D. Studio pages feel detached
Builders, composers, editors, and setup flows can feel like separate products if they do not preserve parent context.

### E. Browser back is doing too much work
Relying on browser back is not enough for an app-level navigation system.

### F. Settings is being used as a dumping ground
Too many prerequisite problems are likely solved by “send user to settings.”

This should be replaced by contextual setup patterns wherever possible.

---

## 4. Required Outcome

After overhaul, users should be able to:

- start a task inside a module
- resolve prerequisites without losing context
- understand why they were redirected if redirection is unavoidable
- clearly return to the exact previous working state
- resume interrupted tasks
- move between workspaces and studios without disorientation
- always know whether they are:
  - working
  - configuring
  - inspecting
  - setting up
  - resuming

This applies system-wide.

---

## 5. Navigation Architecture Principle

Use this rule as a foundation:

> **A user should remain in their current workflow context unless there is a strong reason to leave it.**

If they must leave it:

> **The system must preserve their source context, explain the redirect, and provide a clear return path.**

This is the single most important principle in this document.

---

## 6. Distinguish Three Destination Types

Every internal route/surface should be classified as one of the following:

### A. Working Surfaces
Primary execution pages where users do their core work.

Examples:
- compose post
- edit invoice
- manage booking
- work on project
- update client
- review automation

### B. Configuration Surfaces
Pages or panels for defining rules, prerequisites, or infrastructure.

Examples:
- payment gateways
- business hours
- channel connections
- templates
- permissions
- invoice branding

### C. Detail / Inspection Surfaces
Pages or panels for reviewing a record in context.

Examples:
- invoice detail
- project detail
- client detail
- expense record
- automation log item

These surface types should feel different in navigation behavior and visual framing.

---

## 7. Context Preservation Model (Critical)

Whenever a user opens:
- a studio
- a builder
- a setup page
- a settings panel
- a detail page
- a prerequisite flow

the system must preserve:

- source workspace
- source subtab/mode
- source selected record
- source filters
- source action intent
- draft state if present

### Example source state
- Workspace: Content
- Mode: Create & Schedule
- Submode: Compose
- Draft: Social Post #draft_temp_23
- Action intent: Publish
- Missing prerequisite: connected channel

This state must survive redirects and setup interruptions.

---

## 8. Return Path Architecture

The app should support a real app-level return system.

### Required return patterns
- Back to Clients
- Return to Campaign Draft
- Back to Invoice #INV-123
- Back to Calendar Setup
- Back to Project: Website Build
- Resume Post Draft
- Return to Service Setup

### Rules
- do not use only a generic back arrow
- use origin-aware labels
- preserve scroll/filter/tab state when possible
- preserve draft state where relevant

This is much better than relying on browser history.

---

## 9. Origin-Aware Breadcrumbs

Standard breadcrumbs are not enough.

Current pattern:
- Home > Content > Calendar

This tells location, but not the user’s task continuity.

### Add origin-aware context such as:
- Opened from Revenue > Invoice Draft
- Opened from Clients > Sachin Dookie
- Opened from Calendar > Bookings > Setup
- Opened from Content > Campaign Draft

### Use cases
Especially important for:
- settings redirects
- builders
- detail views
- modals that expand into full pages
- studio routes

---

## 10. Task Continuity Layer (New)

Introduce a third navigation layer beneath:
- global workspace nav
- module tab nav

This third layer represents **task continuity**.

### It should show:
- current task
- source context
- unsaved/draft state
- step or setup status
- return-to-origin CTA

### Example task continuity header
**Connecting a channel**
Opened from: Content > Create & Schedule > Social Draft  
After setup: return to draft and continue publishing  
[Back to Draft]

This removes the feeling of teleportation.

---

## 11. Replace Forced Settings Redirects with Contextual Setup

This is the highest-value practical change.

### Instead of:
- send user away to Settings

### Prefer:
- inline setup block
- right-side drawer
- modal
- bottom sheet
- compact prerequisite wizard
- contextual checklist

### Best for:
- channel connection
- staff assignment
- payment method setup
- invoice template setup
- business hours
- budget alerts
- campaign prerequisites
- automation prerequisites

This keeps users anchored in the task they started.

---

## 12. When Full Redirect Is Unavoidable

Sometimes a full page redirect will still be necessary.

### In those cases, the destination must clearly explain:
- why the user is here
- what they were trying to do
- what is missing
- what happens after completion
- how to return

### Example banner
You’re here because publishing a social post requires at least one connected channel.  
Complete this setup, then return directly to your draft.

Actions:
- [Connect Channel]
- [Back to Draft]

This is mandatory for redirect trust.

---

## 13. Resume Previous Task System

Introduce resumable task memory across modules.

### Examples
- Resume invoice draft
- Resume post draft
- Resume campaign setup
- Resume automation builder
- Resume booking setup
- Resume project template editing

### Use cases
This is especially important when:
- prerequisites interrupt work
- the user leaves temporarily
- a studio route is multi-step
- a configuration flow is non-trivial

The app should not require users to manually reconstruct unfinished work.

---

## 14. Studio / Builder Surface Rules

Studio, composer, builder, and editor pages must always show:

- parent module
- current object/task
- source/origin
- save/draft state
- back-to-origin action
- whether this is:
  - creation
  - editing
  - configuration
  - preview
  - prerequisite resolution

### Example
**Campaign Builder**
Module: Content  
Opened from: Content > Campaigns  
State: Draft saved 2 mins ago  
[Back to Campaigns]

This makes large builder surfaces intelligible.

---

## 15. Settings Architecture Overhaul

Settings should no longer behave like one monolithic fallback destination.

### Split settings into:
1. **Global settings**
   - account-wide preferences
   - password
   - appearance
   - broad system settings

2. **Module setup**
   - Revenue setup
   - Calendar setup
   - Content channel setup
   - Projects template setup
   - Expense budget settings

3. **Contextual setup**
   - setup invoked inside a current workflow
   - resolved inline where possible

### Rule
Configuration should live as close as possible to the module or task it serves.

---

## 16. Navigation Rules by Module

### Clients
- opening related invoices, bookings, projects, campaigns should preserve client context
- returning from related pages should offer “Back to Client”

### Calendar
- service setup, staff assignment, hours, booking configuration should preserve booking/schedule context
- setup should preferably use drawers and contextual panels

### Revenue
- invoice template setup, gateway setup, branding setup should preserve invoice or payment workflow context
- sending invoice should not feel interrupted permanently by setup

### Content
- channel connection and publishing prerequisites should preserve composer or campaign context
- draft resumption is mandatory

### Flows
- template activation, configuration prerequisites, and related-module editing should preserve flow-builder context

### Projects
- template editing, client linkage, revenue linkage, and automation linkage should preserve project context

### Expenses
- category creation, budget setup, vendor linking, and receipt workflows should preserve current expense or budget context

---

## 17. Recommended Redirect Pattern Library

Use the following preferred hierarchy for prerequisite handling:

### Pattern 1 — Inline Fix
User remains on page, sees missing requirement, resolves immediately.

### Pattern 2 — Contextual Drawer
User opens side drawer, completes setup, returns automatically.

### Pattern 3 — Focused Modal Wizard
User completes one or two setup steps without leaving current context.

### Pattern 4 — Dedicated Setup View with Return Banner
Used only when complexity is high and full-page space is required.

### Pattern 5 — Full Settings Redirect
Use only as a last resort, always with origin preservation and return CTA.

This should be enforced app-wide.

---

## 18. Navigation Selling Points to Strengthen

This navigation overhaul is not just UX cleanup.
It can become a product advantage.

### Selling point 1
**Context-preserving workflows**
Users do not lose their place when configuring prerequisites.

### Selling point 2
**In-place setup architecture**
Most setup happens inline, not through disruptive settings redirects.

### Selling point 3
**Origin-aware navigation**
Every studio, builder, and setup flow knows where the user came from.

### Selling point 4
**Resumable work**
Interrupted drafts and workflows can always be resumed.

### Selling point 5
**Cross-module continuity**
Clients, Calendar, Revenue, Content, Flows, Projects, Expenses all behave consistently.

This makes the whole app feel premium and intelligent.

---

## 19. Visual / Interaction Rules

### All redirected or setup-heavy surfaces must visually communicate:
- where the user came from
- whether this is setup vs work
- what they need to do
- how to return
- whether draft/progress is preserved

### Keep:
- calm, minimal surfaces
- clear CTA hierarchy
- readable breadcrumbs

### Improve:
- more explicit return CTAs
- more informative setup banners
- less ambiguous “settings-like” transitions
- clearer distinction between builder vs setup vs detail surfaces

### Avoid:
- hard teleports
- sudden settings dumps
- generic back buttons only
- silent loss of draft or selection state
- contextless redirects

---

## 20. Suggested Final Component Tree

```text
AppShell
  GlobalWorkspaceNav
  ModuleContextHeader
  TaskContinuityHeader

TaskContinuityHeader
  OriginLabel
  CurrentTaskLabel
  ProgressOrDraftState
  ReturnToOriginButton

RedirectExplainerBanner
  WhyYouAreHere
  MissingRequirement
  WhatHappensAfterCompletion
  PrimarySetupAction
  BackToOriginAction

ContextualSetupDrawer
  SetupStepContent
  SaveAndReturnAction

ResumeTaskSystem
  DraftRegistry
  PreviousTaskRegistry
  ResumePrompt
```

---

## 21. Technical / State Requirements

The coder should implement a consistent state model for task continuity.

### Required preserved state
- workspace
- route
- submode/tab
- selected entity
- filters/sort
- draft id
- unsaved changes indicator
- task intent
- originating CTA

### Examples
- publish_post
- send_invoice
- activate_flow
- create_booking
- assign_staff
- configure_budget

### Return logic should prefer:
- exact origin state
- if origin state invalid, nearest valid parent view
- if entity deleted/unavailable, explain and return to parent module

---

## 22. Error and Edge-Case Handling

### If return target no longer exists
Show:
- explanation
- nearest valid fallback
- module-level return CTA

### If draft exists but source record changed
Show:
- resume draft
- discard and reopen live record
- duplicate as new draft

### If setup completed in another tab/session
Auto-refresh the originating flow and offer:
- continue now
- reopen previous task

This improves resilience.

---

## 23. Prioritized Implementation Plan

### Phase 1 — Navigation continuity foundation
1. Define source-context schema
2. Add origin-aware return model
3. Add task continuity header pattern
4. Add redirect explainer banner pattern

### Phase 2 — Replace bad redirects
5. Audit all current settings redirects
6. Reclassify them as:
   - inline fix
   - drawer
   - modal
   - dedicated setup view
7. Convert the highest-friction redirects first

### Phase 3 — Resume systems
8. Add draft/task resumption registry
9. Add resume prompts across builder/studio flows
10. Add unsaved state preservation patterns

### Phase 4 — Module-specific upgrades
11. Content channel setup continuity
12. Revenue billing/template setup continuity
13. Calendar setup continuity
14. Flows builder continuity
15. Projects and Expenses setup continuity

### Phase 5 — polish
16. Standardize visual behavior across all modules
17. Improve copy and banner messaging
18. Ensure consistent back/return behavior app-wide

---

## 24. Acceptance Criteria

The navigation overhaul is successful if:

1. Users no longer feel abruptly teleported into settings or setup pages
2. Every redirect explains why it happened and how to return
3. Studio/builder pages clearly show origin and current task
4. Prerequisites are resolved inline or contextually whenever possible
5. Drafts and interrupted workflows can be resumed
6. Browser back is no longer the only way to recover context
7. Navigation behavior is consistent across modules
8. The app feels like one coherent operating system instead of stitched-together pages

---

## 25. Non-Negotiables

- Do not redirect users to settings without explanation and return path
- Do not rely only on browser back
- Do not let builder/studio routes feel detached from parent modules
- Do not lose draft/task context during setup interruptions
- Do not solve most prerequisite issues with hard redirects
- Do not keep settings monolithic and context-blind

---

## 26. Target Outcome Statement

The final navigation system should feel like:

> a premium, context-preserving workflow architecture where setup, execution, inspection, and creation all happen with continuity, guided logic, clear return paths, and minimal disruption — so the user always knows where they are, why they are there, and how to continue what they started.
