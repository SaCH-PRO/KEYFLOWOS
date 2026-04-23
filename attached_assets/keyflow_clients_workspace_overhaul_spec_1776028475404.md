# KeyFlow Clients Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **Clients** workspace comprehensively without removing functionality. Preserve the current 3-zone architecture, improve operational intelligence, strengthen hierarchy, enrich client triage, and turn the page from a contact browser into a true **client intelligence and action workspace**.

---

## 1. Product Goal

The Clients page should evolve from:

- a contact list with a profile panel

into:

- a client operations workspace that helps users:
  - triage relationships
  - identify next actions
  - understand client health
  - communicate efficiently
  - review timeline/history
  - connect client records to revenue, bookings, tasks, notes, and workflow state

The page should feel:
- calm
- premium
- intelligent
- operational
- scalable

Do **not** remove existing features. Reorganize, enrich, and prioritize.

---

## 2. Existing Strengths to Preserve

Keep these core strengths intact:

1. **3-zone layout**
   - Left: workspace nav
   - Center: quick add + list/selection surface
   - Right: selected client inspector / activity / detail

2. **Right-side inspector pattern**
   - expandable sections
   - timeline mode
   - communication actions
   - stage control

3. **Accordion / progressive disclosure model**
   - good for complex client data
   - prevents the UI from becoming overloaded

4. **Communication quick actions**
   - Email
   - Call
   - WhatsApp
   - Compose

5. **Timeline / notes / tasks / events capability**

6. **Stage control**
   - Lead
   - Prospect
   - Client
   - Lost

7. **Quick add contact entry point**

Do not regress these.

---

## 3. Current Problems to Solve

### A. The center pane is underpowered
The center pane currently feels too passive and too empty relative to the sophistication of the right panel.

Symptoms:
- too much dead space under the list
- list cards are too light in metadata
- no real action queue or triage block
- weak sense of “what matters now”

### B. The page lacks a strong operational hero state
The page does not strongly answer:
- who needs action?
- what is urgent?
- what is at risk?
- who is high value?
- what should the user do next?

### C. The right panel is rich but too collapsed by default
The modularity is good, but the default state can feel too hidden and passive.

### D. The AI recommendation block is underpowered
It currently behaves more like a utility card than a real decision-assist surface.

### E. Contact list rows are too shallow
Rows need more business-state metadata so the list becomes a triage surface rather than just a selector.

### F. Relationship health is not surfaced strongly enough
The workspace needs stronger first-glance signals for:
- health
- momentum
- risk
- revenue state
- booking state
- follow-up state

### G. The page title and identity need to align
Sidebar says **Clients** while the page title may still refer to **Contacts**. Resolve this conceptual drift.

---

## 4. Required Outcome

After overhaul, the Clients workspace must support:

- fast scanning of who needs action
- easy selection of a client
- rich context for the selected client
- timeline/history review
- immediate communication
- health/risk understanding
- clear recommended next action
- integrated awareness of bookings/revenue/tasks
- scalable expansion as more CRM depth is added

---

## 5. Information Architecture

Use this final structure.

### Page identity
Use **Clients** as the primary label.

Optional subtitle:
> Manage relationships, follow-ups, health, and client activity across your pipeline.

Avoid splitting between “Clients” and “Contacts” unless there is a deliberate deeper data model distinction.

---

## 6. Final Layout Structure

### A. Left Rail
No major change required.

Keep:
- Workspaces navigation

Improve:
- separate core workspaces from secondary/support workspaces visually if possible

Possible grouping:
- Core: Clients, Calendar, Revenue, Content, Flows
- Support: Projects, Expenses, Reports, Documents

---

### B. Center Pane
Redesign this zone. It is the biggest opportunity.

Structure the center pane as:

1. **Header summary band**
2. **Priority / action queue strip**
3. **Quick add contact**
4. **Search + filters + view controls**
5. **Segment chips**
6. **Client list**
7. Optional empty/insight extension area when selection exists

---

### C. Right Pane
Preserve the selected client inspector, but upgrade its default logic and section hierarchy.

Structure:
1. client identity card
2. stage + status + health summary
3. recommended next action / AI insight
4. communication action bar
5. log interaction CTA
6. smart-expanded accordion sections
7. timeline / notes / tasks / event mode

---

## 7. Header Summary Band (New)

Add a compact operational summary at the top of the Clients workspace.

Required metrics:
- Active clients
- Follow-ups due
- At risk
- New this week
- High value

Design:
- compact pill/card strip
- visually lightweight but clearly scannable
- do not make it a giant dashboard

Purpose:
- orient the user immediately
- make the page feel operational, not passive

Example:
- Active: 52
- Follow-ups: 7
- At Risk: 3
- New This Week: 5
- High Value: 9

---

## 8. Priority / Action Queue (Major Upgrade)

The current “Actions” concept should become a proper priority strip or queue.

This should be one of the most important modules on the page.

### Purpose
Surface who needs attention and why.

### Show items like:
- Jillian Hart — follow-up overdue by 3 days
- Darius Henry — invoice unpaid, no response
- Sachin Dookie — profile only 46% complete
- New lead added today — outreach not started
- Prospect inactive for 14 days

### Item structure
Each item should show:
- client name
- reason for flag
- urgency level
- one-click action

### Actions
- Open client
- Send message
- Log interaction
- Create task
- Mark resolved

### Behavior
- collapsed summary state allowed
- expanded queue view recommended
- sorted by urgency + value

This is critical.

---

## 9. Search / Filter / Command Band

Restructure the control row into clear subgroups.

### Group 1: Search
- search contacts/clients

### Group 2: Filters
- status/stage
- owner
- activity age
- has booking
- has unpaid invoice
- tag(s)

### Group 3: Bulk actions
- select all
- assign
- tag
- export
- archive
- merge/dedupe if available

### Group 4: View controls
- list
- compact list
- detail-first mode if desired

Avoid a random row of low-context icons.

---

## 10. Segment Chips

Keep and improve the quick segment chips:
- High Value
- Needs Follow-up
- New This Week
- At Risk
- No Activity 30d

Make them feel like operational views, not passive filters.

### Requirements
- clear active state
- count badges
- one-click filtering
- reflect true business logic
- persist visually when active

Optional additions:
- Unassigned
- Incomplete Profile
- Upcoming Booking
- Overdue Invoice

---

## 11. Client List Redesign

The list rows/cards need to become more operational.

### Current issue
Rows mostly communicate identity, not enough business state.

### Required row content
Each row should show a combination of:
- avatar / initials
- name
- company or relationship label
- current stage
- last interaction age
- follow-up due indicator
- booking indicator
- unpaid invoice indicator
- high value marker
- owner/assignee if relevant
- completion score if relevant
- preferred channel if known

Do not overload every row.
Use iconography + concise metadata.

### Recommended row hierarchy
Line 1:
- name
- stage badge
- value badge / score
- urgent flags

Line 2:
- company / descriptor
- last activity
- next action due / booking summary / invoice state

Line 3 (optional small metadata strip):
- tags
- owner
- preferred channel

### Row behavior
- stronger selected state
- hover action reveal
- quick action affordances only when useful
- preserve readable spacing

Goal:
Turn the list into a triage surface.

---

## 12. Quick Add Contact

Keep Quick Add, but improve it.

### Current role
Useful but basic.

### New version
Allow ultra-fast capture with optional inline fields:
- name
- phone or email
- stage
- source

### UX goals
- fast enough for spontaneous entry
- not modal-heavy
- expandable if more detail needed

Optional:
- “Quick Add” default collapsed row
- opens inline mini-form

---

## 13. Right Pane: Top Identity Module

Keep this module, but strengthen it.

### Include
- avatar / initials
- name
- company
- contact methods
- created date / relationship age
- completion score
- key badges (VIP, at risk, booked, overdue, etc.)
- favorite/pin if supported

### Add compact summary chips
- stage
- relationship health
- last active
- next booking / no booking
- unpaid / paid state

Do not let this become too busy. Prioritize clarity.

---

## 14. Relationship Health Strip (New / Strongly Recommended)

Add a compact health layer near the top of the right panel.

### Show:
- Relationship Health
- Momentum
- Revenue Status
- Booking Status
- Completion Status

Could be:
- chips
- mini bars
- status dots with labels

Example:
- Health: Strong
- Momentum: Warming
- Revenue: Outstanding invoice
- Booking: Next booking in 2d
- Profile: 46% complete

This is one of the most important upgrades.

---

## 15. Recommended Next Action / AI Module Redesign

The current AI recommendation block should become more concrete.

### Instead of generic copy
Do not use:
- “Analyse this contact and suggest next steps”

### Use explicit action intelligence
Show:
- **Recommended next action:** WhatsApp follow-up
- **Reason:** No response in 4 days after stage change
- **Confidence / impact:** High
- Primary button: Draft message
- Secondary button: View reasoning

Alternative examples:
- Create follow-up task
- Confirm booking
- Send payment reminder
- Re-engage inactive lead

### Requirements
- contextual
- not decorative
- tied to real client state
- visible near the top
- able to open more detailed AI reasoning

---

## 16. Communication Action Bar

Keep:
- Email
- Call
- WhatsApp
- Compose

But make the bar more intelligent.

### New behavior
One action may become primary depending on context.

Examples:
- if preferred channel is WhatsApp → emphasize WhatsApp
- if no phone number → disable Call
- if invoice overdue → prioritize Compose reminder
- if booking tomorrow → prioritize confirmation action

### Optional additions
- More menu for templates / automation launch
- quick recent channel indicator

Goal:
Make communication actions context-aware.

---

## 17. Stage Selector Improvement

Keep:
- Lead
- Prospect
- Client
- Lost

But tie stage changes to workflow consequences.

### After stage change, surface:
- resulting recommendation
- created task
- triggered automation
- timeline event
- expected next step

Example:
Changed to Prospect
→ Suggested next action: Send intro
→ Follow-up due in 2 days
→ Logged in timeline

The stage control should feel like a workflow state engine, not just a label toggle.

---

## 18. Accordion Inspector Sections

Keep the accordion model. It is structurally strong.

### Recommended default order
1. Metrics
2. Momentum
3. Financial Summary
4. Recent Activity
5. Professional
6. Social & Referral
7. Contact Methods
8. Address
9. Preferences
10. Custom Fields

### Recommended default open sections
Always open by default:
- Metrics
- Momentum
- Recent Activity

Contextually auto-open when relevant:
- Financial Summary if invoice/debt exists
- Contact Methods if incomplete
- Preferences if populated and useful

Remain collapsed:
- Address
- Custom Fields
- less frequently used metadata sections

### Each section should show:
- concise preview even when collapsed
- completion / presence indicator
- warning state if something matters

Example:
Financial Summary (collapsed preview):
- 1 unpaid invoice • TTD 450 outstanding

Contact Methods:
- 2 methods • WhatsApp preferred

This makes collapsed sections informative.

---

## 19. Timeline / Notes / Tasks / Activity Mode

This is already a strong feature. Improve the controls and density.

### Required capabilities
Tabs or segmented modes:
- All
- Notes
- Tasks
- Calls
- Emails
- Messages / WhatsApp
- Events

### Improve
- clearer active states
- stronger spacing
- better separation between mode tabs and event-type filters
- clearer count pills
- better chronology readability

### Timeline entries should support
- event type
- timestamp
- summary
- linked action if relevant
- actor/source if available

Example entries:
- Task created — Follow up after stage change
- Status changed — Lost → Client
- Invoice sent — TTD 1200
- Booking confirmed — 14 Apr 2026, 3:00 pm

The timeline should feel like the client’s operational story.

---

## 20. Center Pane Optional Context Block

When a client is selected, consider adding a compact context module above the list or between list sections showing:
- latest booking
- latest invoice
- last note
- pending task
- preferred channel

This can help bridge the currently weak center pane.

This is optional, but recommended if space allows.

---

## 21. Empty Space Reduction

Reduce the feeling of unused space in the center pane.

Approaches:
- denser list with richer metadata
- action queue above list
- contextual block when a client is selected
- filtered sections like “Needs Attention” and “Recent”

Avoid filling space with decorative content. Add meaningful operational content.

---

## 22. Visual / Interaction Rules

### Tone
The workspace must feel:
- calm
- premium
- focused
- intelligent
- not noisy

### Keep
- soft elevation
- rounded panels
- light visual rhythm
- clean whitespace

### Improve
- stronger hierarchy between summary, queue, list, inspector
- clearer selected row state
- better active tab/filter contrast
- more legible micro-copy
- more informative collapsed accordions

### Avoid
- giant dashboards
- too many equal-priority cards
- icon-only ambiguity
- excessive decorative AI styling

---

## 23. Functional Integration Requirements

The selected client should visibly support integration with:

- bookings
- revenue / invoices
- notes
- tasks
- communication history
- automations / flow events
- stage history
- data completeness

If not all are currently available, structure the UI so the page is ready for them.

---

## 24. Suggested Final Component Tree

```text
ClientsPage
  ClientsHeader
    Breadcrumbs
    Title + subtitle
    SummaryMetricsStrip
  ClientsActionQueue
  QuickAddClient
  ClientsToolbar
    Search
    Filters
    BulkActions
    ViewControls
  SegmentChips
  ClientsContentLayout
    ClientListPane
      ClientRow[]
    ClientInspectorPane
      ClientIdentityCard
      RelationshipHealthStrip
      RecommendedNextActionCard
      CommunicationActionBar
      LogInteractionButton
      InspectorAccordion
        MetricsSection
        MomentumSection
        FinancialSummarySection
        RecentActivitySection
        ProfessionalSection
        SocialReferralSection
        ContactMethodsSection
        AddressSection
        PreferencesSection
        CustomFieldsSection
      ClientTimelineTabs
        All
        Notes
        Tasks
        Calls
        Emails
        Messages
        Events
      ClientTimeline
```

---

## 25. Prioritized Implementation Plan

### Phase 1 — Structural and high-impact
1. Rename page identity consistently to **Clients**
2. Add top summary metrics strip
3. Redesign Actions into priority queue
4. Enrich client list rows
5. Improve right pane default open/close logic
6. Upgrade AI module into Recommended Next Action

### Phase 2 — Intelligence and workflow behavior
7. Add relationship health strip
8. Make communication action bar context-aware
9. Connect stage changes to visible workflow consequences
10. Improve timeline controls and readability

### Phase 3 — Density and refinement
11. Improve quick add flow
12. Add collapsed accordion preview text
13. Add optional center context block
14. Tune spacing, microcopy, selected states, and count pills

---

## 26. Acceptance Criteria

The page overhaul is successful if:

1. A user can immediately see who needs attention
2. The center pane feels active and informative, not empty
3. Client rows communicate business state, not just identity
4. The right pane feels like a live client command center
5. AI recommendations are concrete and actionable
6. Timeline/history is easy to parse and useful
7. Important sections are visible by default without overwhelming the UI
8. No existing major capability is removed
9. The page feels like a premium operational workspace, not a CRUD CRM page

---

## 27. Non-Negotiables

- Do not remove existing client data capabilities
- Do not flatten the right inspector into a generic profile page
- Do not replace the list/detail model with a full-page detail takeover
- Do not make the top of the page into a bloated dashboard
- Do not reduce communication actions
- Do not hide important context behind too many clicks

---

## 28. Target Outcome Statement

The final Clients workspace should feel like:

> a premium client intelligence and action surface that helps the user decide who matters, what needs action, and what to do next — while preserving deep detail, history, communication, and growth capacity.
