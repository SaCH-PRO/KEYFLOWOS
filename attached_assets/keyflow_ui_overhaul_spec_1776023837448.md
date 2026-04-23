# KeyFlow UI/UX Overhaul Specification

## Purpose
This document is intended to be fed directly into an AI coding assistant or used by a frontend engineer/designer to implement a non-destructive UI/UX overhaul of the KeyFlow application.

The overhaul must **preserve all existing functionality and features**. The goal is to improve:
- information architecture
- layout hierarchy
- navigation clarity
- visual consistency
- workflow cohesion
- premium product feel
- operational usability

Do **not** remove features. Do **not** reduce system capability. Reorganize and redesign the product so it feels like a coherent operating system rather than a collection of pages.

---

## Primary Goal
Refactor the application into a clearer product structure built around four master surfaces:

1. **Cockpit** — live business operations
2. **Workspaces** — deep execution in operational domains
3. **Studio** — setup, configuration, automation, and system design
4. **Public** — customer-facing booking, payment, intake, and profile surfaces

The redesign should preserve all features while improving discoverability, hierarchy, and contextual access.

---

## Non-Negotiable Constraints

1. Preserve all functionality.
2. Preserve all core routes/modules unless they are being renamed or reorganized.
3. Do not remove advanced controls; move them into contextual drawers, tabs, accordions, or secondary panels.
4. Do not solve clutter by hiding everything behind many clicks.
5. Keep the product flexible for future enterprise-scale growth.
6. Make the app feel like a premium, modern business operating system.

---

## Product Architecture

### 1. Cockpit
Default logged-in home.

Purpose:
- show live business state
- surface urgent work
- show activity and bottlenecks
- support quick action
- provide AI-assisted command execution

Contains:
- activity/feed stream
- urgent tasks
- approvals
- key metrics/status chips
- system alerts
- AI suggestions
- command layer

### 2. Workspaces
Operational areas for focused work.

Contains:
- Clients
- Calendar
- Revenue
- Content
- Messages
- Flows

Each workspace should consolidate related actions into a unified operational home.

### 3. Studio
Configuration and business-building surface.

Contains:
- Overview
- Business
- Services
- Automations / Playbooks
- Team
- Branding
- Integrations
- Templates
- Presence Builder

This replaces generic “Settings” language.

### 4. Public
Customer-facing surface.

Contains:
- Booking pages
- Payment pages
- Intake forms
- Public profile / presence page
- shareable public assets

This surface should have a more polished, conversion-oriented look than the internal app.

---

## Navigation Architecture

### Primary Navigation (persistent left rail)
Use a slim persistent rail.

Items:
- Cockpit
- Workspaces
- Studio
- Public
- Command / Search
- Notifications
- Profile / Account

### Secondary Navigation
Context-sensitive panel adjacent to primary rail.

#### Under Workspaces:
- Clients
- Calendar
- Revenue
- Content
- Messages
- Flows

#### Under Studio:
- Overview
- Business
- Services
- Automations
- Team
- Branding
- Integrations
- Templates
- Presence Builder

#### Under Public:
- Booking
- Payments
- Intake
- Profile
- Share Links

### Local Navigation
Per-screen local organization using:
- tabs
- segmented controls
- filter bars
- inspector toggles
- contextual action menus

---

## Layout System

Use a consistent 12-column responsive grid on desktop.

Define and standardize the following layout templates.

### Template 1: Cockpit Command Surface
Use for:
- Cockpit
- message triage
- flow monitoring
- operations overview

Structure:
- top header with title, status chips, actions
- compact top signal rail
- dominant center-left live activity region
- right contextual insight/action panel
- optional lower detail tray or analytics strip

### Template 2: Collection + Detail Workspace
Use for:
- Clients
- Bookings
- Invoices
- Revenue records
- Content assets
- forms/intake submissions

Structure:
- left filter/list panel
- center selected item workspace
- right inspector/timeline/recommendations panel

### Template 3: Builder Workspace
Use for:
- automation builder
- service setup
- branding editor
- booking page setup
- presence builder
- integrations configuration

Structure:
- left step rail / section nav
- center edit surface
- right live preview / dependency / explanation panel

### Template 4: Analytics + Health Surface
Use for:
- revenue analytics
- funnel health
- performance reporting
- operations analytics

Structure:
- top signal summary row
- large primary chart/health visualization
- grouped supporting insight panels
- lower drilldown section/table

---

## Global Header Pattern
Every major page should include:
- title
- one-line purpose/subtitle
- key status chips
- primary action
- secondary actions
- contextual filters/date scope when relevant

Example structure:
- Title: Clients
- Subtitle: Manage relationships, bookings, messages, and follow-up across your customer base.
- Chips: 18 Active, 6 Uncontacted, 4 At Risk
- Actions: Add Client, Import, Send Campaign

---

## Core Screen Blueprints

### Cockpit
Purpose: act as the business pulse layer.

Layout:
1. Top signal rail
   - bookings today
   - unpaid invoices
   - overdue follow-ups
   - unresolved messages
   - automation health

2. Main hero region
   - live activity feed / flow feed
   - grouped by relevance and type
   - each item should support in-place action

3. Right panel
   - urgent approvals
   - system alerts
   - recommended next actions
   - AI suggestions

4. Lower modules
   - flow bottlenecks
   - revenue movement
   - client response lag
   - calendar load

5. Persistent command layer
   - create
   - search
   - navigate
   - trigger actions
   - AI commands

### Clients Workspace
Use Template 2.

Left:
- search
- saved filters / segments
- client list

Center:
- selected client overview
- profile details
- current status
- notes
- current value / relationship state

Right:
- timeline
- linked bookings
- linked invoices
- messages
- suggested next actions

Tabs inside detail:
- Overview
- Activity
- Bookings
- Revenue
- Messages
- Notes
- Automations

### Revenue Workspace
Use Template 2 or 4 depending on subview.

Left:
- filters
- status groups
- record types

Center:
- selected invoice/quote/payment detail OR grouped board/table

Right:
- payment history
- reminder actions
- linked client
- ageing/risk state

Top segmented controls:
- Quotes
- Invoices
- Payments
- Overdue
- Drafts

### Calendar Workspace
Use operational scheduler layout.

Top:
- date controls
- staff/service filters
- availability controls

Center:
- calendar grid or schedule timeline

Right:
- booking detail
- customer info
- payment state
- service notes
- actions

Supporting blocks:
- conflicts
- pending confirmations
- waitlist
- staff load

### Content Workspace
Use Template 2.

Left:
- channels
- campaigns
- statuses
- drafts/scheduled/published filters

Center:
- selected campaign/content piece

Right:
- schedule status
- linked assets
- AI suggestions
- performance snapshot

Tabs:
- Drafts
- Scheduled
- Published
- Templates
- Performance

### Messages Workspace
Use Template 2.

Left:
- inbox/channel filters
- conversation list

Center:
- active conversation thread

Right:
- linked client context
- booking context
- invoice context
- quick actions
- follow-up triggers
- suggested replies/AI support

### Flows Workspace
Use Template 2 or Builder hybrid.

Left:
- playbook list
- triggers
- status filters

Center:
- selected flow visual / structure / overview

Right:
- run history
- failures/exceptions
- dependencies
- quick edit actions

Tabs:
- Overview
- Steps
- Runs
- Exceptions
- Performance

---

## Studio Screen Blueprints

### Studio Home
Show system readiness and setup progression.

Blocks:
- setup completion
- connected systems
- active playbooks
- brand readiness
- optimization suggestions
- missing critical setup items

### Business
Use Builder Template.

Include:
- business identity
- locations
- hours
- category/type
- legal/basic info

### Services
Use Builder Template.

Include:
- service list
- pricing
- duration
- staff assignment
- bundles/packages
- public display controls
- preview panel

### Automations / Playbooks
Use Builder Template.

Include:
- trigger/action flow builder
- templates library
- test mode
- logs
- dependency visibility

### Team
Include:
- members
- permissions
- schedules
- workload/assignment views

### Branding
Include:
- logo
- color system
- typography choices/presets
- public preview usage

### Integrations
Include:
- connection state
- sync health
- reconnect actions
- error state visibility
- permissions scope

### Templates
Include:
- messages
- invoices
- reviews
- confirmations
- intake templates
- preview cards/library feel

### Presence Builder
Use Builder Template.

Include:
- public profile composition
- service highlights
- trust blocks
- CTA stack
- social links
- booking/payment shortcuts
- live preview

---

## Public Surface Blueprints

### Booking Page
Goals:
- fast booking
- trust
- premium look
- mobile-first

Structure:
- service/business hero
- service selection
- availability selection
- customer detail form
- confirmation

Include:
- pricing/time clarity
- trust indicators
- elegant progress state

### Payment Page
Goals:
- clarity
- trust
- speed

Structure:
- business identity
- invoice summary
- amount/status
- payment action
- confirmation

### Public Profile / Presence
Goals:
- serve as a polished mini-site
- support conversion and credibility

Structure:
- hero identity
- CTA stack
- services
- proof/trust markers
- links/contact/booking/payment shortcuts

---

## Design System Requirements

### Foundations
Define or refine:
- spacing scale
- typography scale
- radius scale
- shadow/elevation scale
- border tokens
- semantic color tokens
- motion tokens

### Core UI primitives
Standardize:
- buttons
- inputs
- select
- badges
- tabs
- cards/panels
- tables
- dialog/drawer
- command palette
- toast/feedback

### Product patterns
Create reusable patterns for:
- page headers
- signal strips
- activity feed items
- timeline items
- inspector panels
- list/detail split views
- builder rails
- preview panels
- empty states
- analytics summary rows
- action clusters

---

## Visual Direction
The product should feel:
- calm
- premium
- operational
- modern
- intelligent
- scalable

Recommended visual language:
- deep neutral or graphite base
- restrained accent colors
- strong typography hierarchy
- tonal surface layering instead of excessive borders
- clean spacing discipline
- subtle motion
- high readability

Avoid:
- noisy dashboards
- too many equal-weight cards
- excessive glass or neon styling
- overly playful SaaS tropes
- cluttered table-first experiences

---

## Interaction and Disclosure Rules

### Always Visible
- current state
- primary actions
- key metrics
- relevant filters
- next step or urgent actions

### Contextually Visible
- related records
- recommendations
- previews
- recent history
- secondary actions

### Hidden Behind Expansion
- advanced settings
- logs
- technical metadata
- power-user options
- rarely used controls

Use:
- drawers
- accordions
- inspector tabs
- overflow menus
- expandable detail sections

Do not remove these capabilities.

---

## Motion Guidelines
Use motion only where it improves comprehension:
- panel open/close
- selection transitions
- feed updates
- builder step changes
- command launch
- success/failure state feedback

Avoid decorative or slow motion.

---

## Empty State Rules
Every empty state should include:
1. what this area is for
2. why it matters
3. what action to take first
4. what value the user gets next

Example:
“No automations yet. Create your first playbook to automate reminders, follow-ups, and review requests.”

Actions:
- Start from template
- Build from scratch
- View examples

---

## Responsive Rules

### Desktop
Primary experience.
Use full workspace layouts with inspector panels.

### Tablet
Collapse right-side inspectors into drawers where needed.
Preserve structure where possible.

### Mobile
Prioritize:
- cockpit summary
- booking/public flows
- schedule access
- messaging
- client lookup
- payment review

Do not simply shrink desktop. Adapt interaction patterns.

---

## Engineering Tasks / Implementation Plan

### Phase 1: Information Architecture
- create new top-level app shell
- implement primary/secondary navigation
- rename Settings to Studio
- define route grouping by Cockpit / Workspaces / Studio / Public

### Phase 2: Layout Infrastructure
- implement shared grid/layout primitives
- implement page header component
- implement right-side inspector shell
- implement split workspace templates
- implement builder template
- implement analytics template

### Phase 3: Signature Screens
- redesign Cockpit
- redesign Clients workspace
- redesign Revenue workspace
- redesign Studio home
- redesign Flows workspace

### Phase 4: Remaining Operational Screens
- Calendar
- Content
- Messages
- Team
- Integrations
- Templates

### Phase 5: Public Screens
- booking page
- payment page
- public profile / presence
- intake pages

### Phase 6: Polish
- motion
- empty states
- accessibility improvements
- responsive tuning
- consistency pass across all screens

---

## Expected Outcome
After implementation, the app should:
- preserve all current capability
- feel more organized and premium
- reduce cognitive overload
- improve action speed
- create clearer mental separation between operating and configuring
- make the product feel distinctive and system-like
- better support scale and future complexity

---

## Instructions for AI Coder
When implementing this overhaul:
1. Do not remove routes or features unless explicitly told.
2. Focus on shell, layout, hierarchy, and reusable patterns first.
3. Preserve business logic while reorganizing presentation.
4. Reuse existing components where possible, but standardize them into a stronger design system.
5. Prefer introducing shared layout primitives/templates over page-by-page ad hoc fixes.
6. Implement in phases so current functionality remains testable.
7. Prioritize Cockpit, Clients, Revenue, Studio, and Flows as the first major redesign targets.
8. Keep the visual direction clean, calm, high-end, and operational.

