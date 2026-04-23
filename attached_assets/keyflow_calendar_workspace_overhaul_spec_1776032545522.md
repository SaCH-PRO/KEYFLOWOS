# KeyFlow Calendar Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **Calendar** workspace comprehensively without removing functionality. Preserve the current scheduling, booking, setup, and catalog capabilities, but reorganize the page so it feels like a premium **schedule command center** when operating and a clear **booking system builder** when configuring.

Do not remove features. Improve mode clarity, hierarchy, execution flow, and operational intelligence.

---

## 1. Product Goal

The Calendar workspace should support two distinct but connected jobs:

1. **Run bookings**
   - view and manage the schedule
   - create bookings
   - inspect booking load
   - monitor utilization
   - respond to empty slots and operational issues

2. **Configure the booking system**
   - manage services
   - manage staff
   - define availability
   - manage business hours
   - control booking readiness

The final workspace should feel:
- operational
- clear
- calm
- premium
- intelligent
- scalable

The page should stop feeling like multiple module pages crammed together and start feeling like one coherent workspace with clear internal modes.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Schedule view**
   - weekly calendar
   - month/week/day toggle
   - search
   - date navigation
   - new booking CTA

2. **Setup mode**
   - services
   - staff
   - availability/business hours
   - setup guidance

3. **Operational metrics**
   - today
   - pending
   - done
   - revenue

4. **Optimization and AI recommendation concepts**
   - empty slots
   - under-booked days
   - utilization observations

5. **Service catalog cards**
6. **Staff add flow and empty state**
7. **Business hours controls**

Do not regress any of these.

---

## 3. Core Problems to Solve

### A. The workspace is doing too many jobs inside one visual shell
The page currently mixes:
- live scheduling
- booking performance
- service catalog
- staff admin
- business-hours setup

This creates cognitive ambiguity.

### B. Internal mode separation is not strong enough
Schedule and Setup exist, but Setup is too broad and lacks clear internal organization.

### C. Schedule view lacks a dominant hero hierarchy
Metrics, optimization, recommendations, and calendar all compete somewhat for attention.

### D. Setup feels too administrative
The services, staff, and business-hours surfaces feel more like settings/forms than a high-end booking-system builder.

### E. Calendar lacks strong booking drilldown context
The live schedule view should connect clearly to:
- client
- service
- staff
- payment/revenue state
- reminder/follow-up state
- notes

### F. Recommendations are useful but under-executable
The AI and optimization layer is currently informative, but not yet action-driven enough.

---

## 4. Required Outcome

After overhaul, the Calendar workspace must support:

- clear separation between running the schedule and configuring the system
- strong schedule-first execution mode
- quick understanding of booking health and performance
- easy booking creation and drilldown
- setup of services, staff, and hours in a builder-like experience
- meaningful recommendations with direct action paths
- visible linkage between bookings, clients, and revenue

---

## 5. Information Architecture

### Primary workspace label
Use **Calendar** in the sidebar.

### Page title
Use **Bookings** only if the page is explicitly about appointments and booking operations.
That is acceptable because the workspace is Calendar and the content is Bookings.

Recommended header pairing:
- Sidebar: Calendar
- Page title: Bookings
- Subtitle: Schedule, booking health, and capacity

This is better than “Schedule, catalog & performance,” which is accurate but too broad and diffuse.

---

## 6. Final Internal Mode Structure

The current Schedule / Setup split is not enough.

Use this structure:

## Primary internal modes
1. **Schedule**
2. **Performance**
3. **Setup**

### Schedule
For live booking operations.

### Performance
For utilization, booking trends, cancellations, revenue from bookings, fill rate, and recommendations.

### Setup
For configuring the booking engine.

---

## 7. Setup Substructure

Inside **Setup**, add secondary sections:

1. **Services**
2. **Staff**
3. **Availability**
4. **Business Hours**
5. Optional future: **Booking Rules**

This is critical.
Right now Setup is too broad.
These sub-sections must be explicit.

---

## 8. Final Layout Structure

### A. Left Rail
Keep the current global workspace nav.

Optional improvement:
- visually separate core workspaces from support workspaces

---

### B. Top Header
The Bookings header should include:

- title
- short subtitle
- helper links if desired
- Share CTA
- New Booking CTA
- optional overflow for booking tools

Improve the subtitle to reflect actual use:
> Schedule, booking health, and capacity

Optional compact status line:
- 3 bookings today
- 1 pending
- utilization 62%
- next opening 2:30 PM

---

### C. Schedule Mode Layout
This should become the dominant operational surface.

Recommended structure:

1. compact KPI strip
2. priority/optimization/recommendation strip
3. calendar surface as hero
4. booking detail inspector when selected

The calendar should be the main visual center of gravity.

---

### D. Performance Mode Layout
This should separate strategic booking intelligence from the live calendar.

Recommended structure:
1. top KPI strip
2. utilization and fill-rate charts
3. underbooked day analysis
4. cancellation / no-show / pending trend cards
5. recommendation cards with action CTAs

This removes pressure from the Schedule page.

---

### E. Setup Mode Layout
This should feel like a booking-system builder.

Structure:
1. setup status / readiness banner
2. sub-navigation (Services / Staff / Availability / Business Hours)
3. builder content surface
4. contextual warnings or dependency guidance
5. optional preview / readiness indicator

---

## 9. Schedule Mode Overhaul

This is the highest-priority operational page.

### 9.1 KPI Strip
Keep metrics compact and operational.

Recommended cards:
- Today’s bookings
- Pending / unconfirmed
- Done
- Revenue
- Optional: utilization or cancellation rate

Avoid making this feel like a heavy dashboard.

### 9.2 Optimization / Action Queue
The “Schedule Optimisation” concept is strong and should be upgraded into a more actionable strip.

Example items:
- Tuesday has 6 open slots
- Friday utilization is 22%
- 2 bookings still unconfirmed
- 1 high-value client is overdue for rebooking

Each item should include:
- insight
- reason
- urgency / opportunity
- CTA

Possible CTAs:
- Send offer
- Create campaign
- Notify clients
- Open day
- Ignore / snooze

### 9.3 AI Recommendation Cards
Do not keep recommendations as passive bullets only.

Each recommendation should have:
- title
- reasoning
- expected impact
- direct action

Example:
**Low Tuesday utilization**
You have 6 empty slots and this day underperforms your weekly average by 40%.
[Send flash offer] [Create promotion] [Dismiss]

### 9.4 Calendar Surface
The weekly grid is good and should remain the hero.

Keep:
- Month / Week / Day toggle
- date navigation
- search
- Today shortcut

Improve:
- booking card readability when populated
- hover/select state
- drag/reschedule affordance if supported
- visual state for busy vs open slots
- empty-slot opportunities if relevant

### 9.5 Booking Drilldown Inspector
This is one of the biggest missing pieces.

When a booking is selected, show a right-side inspector or contextual panel with:

- client name
- service
- assigned staff
- date/time
- payment/invoice state
- reminder/confirmation status
- notes
- quick actions:
  - open client
  - message client
  - reschedule
  - cancel
  - open revenue
  - mark done / confirm

This is mandatory for making Calendar feel like a business OS module.

---

## 10. Performance Mode Overhaul

Create a dedicated performance surface so Schedule does not have to carry everything.

### Include:
- total bookings by period
- fill rate
- utilization trend
- no-show/cancellation rate
- revenue from bookings
- best-performing days
- lowest-performing days
- staff load
- service demand ranking
- underbooked future slots

### Add action-oriented insights:
- “Wednesday has recurring low demand”
- “Service X has no staff assigned during peak hours”
- “Top 5 returning clients have not booked in 30+ days”

Each major insight should offer a CTA.

This mode should feel analytical but still operational.

---

## 11. Setup Mode Overhaul

Setup must stop feeling like raw administration and instead feel like configuring a system.

### Use a builder mindset:
- readiness
- dependencies
- publish/bookable state
- completeness
- warnings
- previews

### Top setup banner
Show:
- setup mode active
- current completion status
- missing pieces blocking bookings

Example:
- 7 services configured
- 0 staff assigned
- business hours set
- 3 services not publicly bookable

---

## 12. Services Section Overhaul

The current service cards are functional but too flat.

### Required service card content
Each card should show:
- service name
- active/inactive
- price
- duration
- assigned staff count
- bookings this month
- public booking status
- availability health
- setup completeness
- primary action

### Availability health examples
- Staff assigned
- No staff assigned
- Missing hours
- Low capacity
- Fully ready

### Better card structure
Top:
- title
- status
- price

Middle:
- description snippet
- duration
- staff assigned
- monthly bookings

Bottom:
- readiness state
- actions (edit, availability, assign staff)

Optional:
- public-bookable badge
- demand signal

Goal:
Turn service cards into operational setup cards, not just a catalog listing.

---

## 13. Staff Section Overhaul

The current staff page works but is too basic.

### Improve the empty state
Explain:
- why staff matters
- what it unlocks
- what to do next

Example:
Add staff members to assign services, define working hours, and route bookings correctly.

### Future-ready staff row/card content
Each staff member should show:
- avatar / initials
- name
- role
- active/inactive
- assigned services count
- availability configured / missing
- weekly booking load
- next shift or hours summary
- edit action

### Add relationship to services
Allow user to understand:
- which services each staff member can fulfill
- whether any service lacks staff assignment

---

## 14. Availability Section

Make availability a dedicated sub-surface rather than burying it inside generic hours/forms.

### Include:
- staff-specific availability
- service capacity dependency if relevant
- default rules
- exceptions / blocked time
- optional presets

This should be more than “business open hours.”

---

## 15. Business Hours Section Overhaul

The current business-hours controls are functional but too raw.

### Improve with:
- day cards/rows
- enabled/disabled toggle
- clearer open/closed state
- more elegant time controls
- copy-to-all weekdays
- copy previous day
- quick presets
- future exception/holiday entry point

### Desired behavior
The section should be:
- fast to scan
- fast to edit
- easy to understand
- difficult to misconfigure

---

## 16. Readiness and Dependency Logic (New)

This is one of the most important upgrades for Setup.

The system should visibly identify blocking issues such as:
- service has no staff
- service missing availability
- no business hours
- booking page unavailable
- staff exists but not assigned
- active service not publicly bookable

Show these as:
- warning chips
- readiness banners
- card-level badges

Example:
**Automation Audit Call**
- Active
- 0 staff assigned
- Not publicly bookable

This creates clarity and prevents silent setup failure.

---

## 17. Search and Controls

### Schedule mode
Search should support:
- client
- service
- staff

Optional filters:
- status
- staff member
- service
- paid/unpaid
- confirmed/unconfirmed

### Setup mode
Search should support:
- service name
- staff name
- active/inactive
- readiness issues

Do not let the same search/control layer try to do everything across all modes without adaptation.

---

## 18. Visual / Interaction Rules

### Tone
The workspace must feel:
- calm
- premium
- operational
- intelligent
- less administrative

### Keep
- soft surfaces
- clear whitespace
- simple KPI rhythm
- stable top control rows

### Improve
- stronger mode separation
- stronger primary surface emphasis
- clearer CTAs in recommendation modules
- more informative setup cards
- better distinction between run vs configure states

### Avoid
- mixing too many setup forms into the main schedule view
- generic settings-page feel
- passive recommendation text with no action path
- oversized empty zones without purpose

---

## 19. Functional Integration Requirements

Calendar must visibly connect to:
- clients
- revenue / invoices
- staff
- services
- notes
- reminders
- booking status
- follow-up or rebooking opportunities

If a booking is selected, the UI should make these cross-links obvious.

This is essential for making the workspace feel part of a unified operating system.

---

## 20. Suggested Final Component Tree

```text
CalendarPage
  BookingsHeader
    Breadcrumbs
    Title + subtitle
    StatusLine
    ShareButton
    NewBookingButton

  BookingsModeTabs
    Schedule
    Performance
    Setup

  ScheduleView
    BookingKpiStrip
    BookingActionQueue
    CalendarToolbar
      DateNavigator
      Search
      Filters
      ViewToggle
      TodayButton
    CalendarGrid
    BookingInspector

  PerformanceView
    BookingPerformanceKpis
    UtilizationChart
    FillRateChart
    CancellationSummary
    ServiceDemandCards
    StaffLoadCards
    BookingInsightCards

  SetupView
    SetupReadinessBanner
    SetupSubTabs
      Services
      Staff
      Availability
      BusinessHours

    ServicesBuilder
      ServiceCard[]

    StaffBuilder
      StaffEmptyState or StaffRows

    AvailabilityBuilder
      AvailabilityRules
      Exceptions
      StaffAvailability

    BusinessHoursBuilder
      DayHoursRows
      Presets
      CopyActions
```

---

## 21. Prioritized Implementation Plan

### Phase 1 — Structural clarity
1. Add **Performance** as a first-class internal mode
2. Add Setup sub-navigation:
   - Services
   - Staff
   - Availability
   - Business Hours
3. Refine page subtitle and header status line
4. Make Schedule clearly hero the calendar surface

### Phase 2 — Operational improvements
5. Upgrade optimization block into action queue
6. Turn AI recommendations into action cards
7. Add booking drilldown inspector
8. Improve KPI semantics for schedule operations

### Phase 3 — Setup builder improvements
9. Redesign service cards with readiness and staffing state
10. Improve staff section and empty state
11. Redesign business hours section for efficiency
12. Add readiness/dependency warnings

### Phase 4 — Integration and polish
13. Connect bookings more visibly to clients and revenue
14. Add better search/filter behavior by mode
15. Refine spacing, hierarchy, microcopy, and selected states

---

## 22. Acceptance Criteria

The Calendar overhaul is successful if:

1. Users clearly understand whether they are running the schedule, reviewing performance, or configuring the booking system
2. The calendar grid feels like the dominant operational surface in Schedule mode
3. Recommendations are actionable, not merely informational
4. Services, staff, and hours feel like a builder, not generic admin forms
5. Booking drilldown exposes client, service, staff, and revenue context
6. Setup problems are visible through readiness/dependency indicators
7. No existing capability is removed
8. The workspace feels cohesive and premium rather than blended and fragmented

---

## 23. Non-Negotiables

- Do not remove Schedule mode
- Do not remove Setup mode
- Do not reduce services/staff/business hours functionality
- Do not bury booking creation
- Do not make recommendations passive only
- Do not let Setup remain a flat generic settings surface
- Do not isolate calendar from client/revenue context

---

## 24. Target Outcome Statement

The final Calendar workspace should feel like:

> a premium schedule command center for running bookings and a clear booking-system builder for configuring services, staff, availability, and capacity — with direct linkage to clients, revenue, and operational recommendations.
