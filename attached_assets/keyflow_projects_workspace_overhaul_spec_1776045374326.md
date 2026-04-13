# KeyFlow Projects Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and deepen the **Projects** workspace comprehensively without removing functionality. Preserve the current ideas of project templates, project creation, and board/status tracking, but evolve the page into a true **delivery execution workspace** tied to the rest of the app.

Projects must stop feeling like a lightweight board utility and become a first-class operational module that supports:
- delivery
- implementation
- client work
- milestones
- deadlines
- blockers
- handoffs
- linked revenue
- linked bookings
- linked automations

Do not remove features. Deepen the module so it becomes strategically valuable inside the KeyFlow operating system.

---

## 1. Product Goal

The Projects workspace should answer:

- What are we delivering?
- For which client?
- From which quote/service/package?
- What stage is the work in?
- What is blocked?
- What is due soon?
- What milestones remain?
- Who owns it?
- What revenue is attached?
- What system actions should happen next?

The final workspace should feel:
- execution-oriented
- structured
- integrated
- high-accountability
- operational
- premium

Projects should become:

> **the delivery execution workspace of the business**

not just a simple status board.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Project Templates**
2. **Simple project creation flow**
3. **Board/status concept**
4. **Low-friction project setup**
5. **Clean, calm visual structure**

Do not regress these.
Instead, build on them.

---

## 3. Core Problems to Solve

### A. Projects is too shallow for a top-level workspace
It currently feels like a simple board utility rather than a strategic part of the system.

### B. The page is creation-heavy instead of execution-heavy
Template creation and project creation dominate the top of the page instead of project intelligence and delivery state.

### C. Project cards are too weak
Cards do not show enough context, progress, risk, or linked business information.

### D. Templates are too minimal
A template with just a name and tasks is not rich enough to become a meaningful delivery framework.

### E. No visible project detail workspace exists
A serious Projects module needs a drilldown workspace with overview, tasks, milestones, notes, timeline, client linkage, revenue linkage, and automation context.

### F. Projects is not visibly connected to the rest of the app
This is one of the biggest missed opportunities.

Projects should connect to:
- Clients
- Revenue
- Calendar
- Content
- Flows
- staff/owners
- activity/timeline events

### G. Stage model is too generic
Active / In Progress / Completed / On Hold is usable, but too broad for real service delivery and implementation work.

---

## 4. Required Outcome

After overhaul, the Projects workspace must support:

- meaningful delivery tracking
- stage-by-stage execution
- project ownership and accountability
- deadline and blocker visibility
- template-driven execution
- client and revenue linkage
- booking and milestone relevance
- project-specific automation and AI recommendations
- a serious project detail experience

---

## 5. Information Architecture

### Sidebar label
Use **Projects**

### Page title
Use **Projects**

Recommended subtitle:
> Plan, deliver, track, and complete client work across your business.

This is stronger than the current generic wording because it communicates execution.

---

## 6. Role of Projects in KeyFlow

Projects should represent **delivery and fulfillment work**.

This includes examples like:
- onboarding
- implementation
- service delivery
- internal execution tied to sold work
- client fulfillment pipelines
- multi-step service packages
- milestone-based delivery

This workspace is not just for general to-dos.
It should represent structured work tied to business outcomes.

---

## 7. Final Top-Level Layout Structure

Rebuild the Projects page around this hierarchy:

1. **Project Execution Summary**
2. **Primary Actions**
3. **Project Board / List**
4. **Project Templates**
5. **Project Detail Workspace** (when a project is opened)

The current layout is too create-first.
The new layout must be execution-first.

---

## 8. Project Execution Summary (New)

At the top of the workspace, show an operational summary before any creation forms.

### Required summary signals
- Active projects
- Due this week
- Blocked
- Waiting on client
- Overdue
- Completed this month
- Unassigned / no owner
- Linked invoice milestone ready (future-ready)

### Purpose
Users should immediately understand:
- what requires attention
- what is moving
- what is at risk

### Example summary row
- Active: 8
- Due This Week: 3
- Blocked: 2
- Waiting on Client: 1
- Completed This Month: 5

This should replace the current create-first emphasis.

---

## 9. Primary Actions

Keep:
- New Project
- New Template

But reposition them as action buttons rather than hero content.

Optional additions:
- Import Project
- Start from Accepted Quote
- Assign Owner
- Broadcast only if clarified and contextual

The page should first show project state, then creation tools.

---

## 10. Stage Model Overhaul

Replace or extend the current simplistic board states.

### Recommended stage model
- **Not Started**
- **In Progress**
- **Waiting on Client**
- **Review**
- **Blocked**
- **Completed**

Optional future:
- Archived
- Cancelled

### Why
These stages reflect real delivery better than generic Active / In Progress / Completed / On Hold.

This creates more precise execution visibility.

---

## 11. Project Board Overhaul

The board remains a good idea but must become far more informative.

### Each project card should show:
- project name
- linked client
- linked service/package
- due date
- stage
- completion %
- owner
- tasks completed / remaining
- risk state
- blocked/waiting flag
- linked revenue state if relevant
- automation coverage indicator if relevant

### Card actions
- open project
- move stage
- quick note
- assign owner
- mark blocked
- more options

### Goal
Project cards should become operational mini-summaries, not title-only tiles.

---

## 12. Alternative List View (Recommended)

Add a list/table view option for larger-scale project management.

### Suggested columns
- Project
- Client
- Stage
- Owner
- Due date
- Progress
- Blocked state
- Package/Service
- Revenue state

This is useful once project volume grows.

---

## 13. Project Detail Workspace (Critical)

This is the single most important addition.

Each project must open into a deeper detail workspace.

### Required sections/tabs
- **Overview**
- **Tasks**
- **Milestones**
- **Timeline**
- **Notes**
- **Client**
- **Revenue**
- **Calendar**
- **Flows / Automation**
- **Deliverables**

This is what turns Projects into a first-class module.

---

## 14. Project Overview Tab

The overview should summarize:
- project title
- client
- package/service
- stage
- due date
- owner
- progress
- current blockers
- next milestone
- linked revenue status
- linked bookings
- automation coverage
- recommended next action

This tab should answer:
- what is this project?
- where is it right now?
- what matters next?

---

## 15. Tasks Tab

Every serious project module needs task support.

### Task capabilities
- create tasks
- assign tasks
- due dates
- status
- priority
- dependent tasks (future-ready)
- comments/notes
- grouped by milestone or phase

### Task intelligence
Show:
- overdue tasks
- tasks blocked by client input
- tasks due soon
- unassigned tasks

Projects should not be just a board of project names.

---

## 16. Milestones Tab

Projects should support milestone-based delivery.

### Milestone capabilities
- define milestone name
- due date
- completion state
- linked tasks
- linked invoice trigger if relevant
- client review/approval requirement if relevant

### Example milestones
- Discovery complete
- Draft delivered
- Client approved
- Final handoff
- Invoice issued
- Review requested

This is a major deepening requirement.

---

## 17. Timeline Tab

Use a project event/timeline view similar to Clients.

### Timeline should show:
- project created
- stage changed
- milestone completed
- task added/completed
- note added
- due date changed
- client update sent
- invoice linked
- booking linked
- flow triggered
- project blocked/unblocked

This gives the workspace memory and traceability.

---

## 18. Notes Tab

Projects need a proper place for working notes:
- internal notes
- client notes
- meeting notes
- delivery notes
- blockers / decisions

Notes should support context, not just free text dumping.

---

## 19. Client Tab

Each project should visibly link back to the relevant client.

### Show:
- client name
- stage/VIP state
- contact methods
- recent activity
- linked bookings
- relationship notes if relevant
- quick open in Clients

This is essential for integration.

---

## 20. Revenue Tab

Projects should connect to revenue state.

### Show:
- linked quote
- linked invoice(s)
- payment status
- milestone billing state
- whether accepted quote created the project
- whether completion or milestone should trigger invoice

### This enables workflows like:
- accepted quote → create project
- milestone complete → issue invoice
- project complete → send final invoice / payment reminder

This is a crucial part of deepening Projects.

---

## 21. Calendar Tab

Projects should connect to relevant time-based events.

### Show:
- kickoff booking
- review meetings
- delivery dates
- milestone due dates
- staff availability if relevant

### Quick actions
- schedule meeting
- add deadline
- view related booking

This prevents Projects from becoming time-blind.

---

## 22. Flows / Automation Tab

Projects should not be merged into Flows, but they must be flow-aware.

### Show:
- active automations touching the project
- recommended automations not enabled
- timeline of automation actions on project
- trigger coverage

### Example project-related flows
- project created → assign onboarding tasks
- milestone completed → notify client
- waiting on client for 5 days → send reminder
- project complete → request review
- project blocked → notify owner

This turns Projects into a smart delivery workspace.

---

## 23. Deliverables Tab

If the business delivers output, Projects should surface it.

### Examples
- files/documents
- drafts
- design assets
- content assets
- handoff files
- links

This is especially useful if Documents remains a connected module.

---

## 24. Template System Overhaul

Templates must become much richer.

### A project template should support:
- template name
- type/category
- default stage path
- phases
- milestone list
- default task list
- task due offsets
- owner roles
- linked service/package
- linked automation suggestions
- default deliverables
- client-facing checkpoints if relevant

### Example template
**Website Build – Starter Package**
- Stages: Not Started → In Progress → Review → Completed
- Milestones: Discovery, Wireframe, Draft, Client Review, Final Launch
- Tasks: kickoff, copy request, page draft, QA, handoff
- Linked package: Website Starter
- Suggested flows: welcome, client reminder, milestone invoice, completion review request

That is the level Projects needs.

---

## 25. Project Creation Overhaul

The current creation form is too minimal if Projects is meant to be meaningful.

### New project creation should allow:
- project name
- linked client
- linked quote/service/package
- owner
- due date
- stage
- template selection
- optional kickoff booking
- optional automation setup

### The quick version can still exist
but serious project creation should allow contextual linkage.

---

## 26. AI Integration for Projects

Projects must feed and be fed by the same AI/business context layer as the rest of the app.

### AI should help with:
- summarize project state
- identify blockers
- suggest next milestone action
- detect risk of delay
- draft client update
- recommend invoice trigger
- recommend automation
- suggest task prioritization
- detect missing linked records

### Example AI outputs
- “This project is waiting on client approval, the linked invoice has not yet been sent, and no reminder flow is active.”
- “Kickoff booking is tomorrow, but onboarding tasks are incomplete.”
- “Milestone 2 is complete. Recommend issuing invoice and scheduling review call.”

This is required for 9/10+ depth.

---

## 27. Cross-Module Integration Requirements

Projects must deeply integrate with:
- Clients
- Revenue
- Calendar
- Flows
- Documents
- optionally Content if content deliverables exist

### Required examples
- accepted quote can create a project
- project milestone can generate invoice
- project timeline can include bookings
- client activity can influence project risk
- project completion can trigger review flow
- project delay can trigger notification flow
- project can show related documents/assets

This is non-negotiable if Projects remains a top-level workspace.

---

## 28. Visual / Interaction Rules

### Tone
Projects must feel:
- execution-oriented
- high-accountability
- professional
- coordinated
- alive

### Keep
- calm layout
- board metaphor
- simple visual cleanliness

### Improve
- stronger execution-first hierarchy
- richer card content
- visible blockers and deadlines
- stronger detail workspace
- clear integration chips / linked records
- more informative templates

### Avoid
- template creation dominating the page
- title-only cards
- generic empty project states
- shallow project objects with no drilldown

---

## 29. Suggested Final Component Tree

```text
ProjectsPage
  ProjectsHeader
    Breadcrumbs
    Title + subtitle
    ProjectExecutionSummary
    PrimaryActions

  ProjectsBoardOrList
    StageColumns
      ProjectCard[]

  ProjectTemplatesPanel
    TemplateLibrary
    TemplateBuilder

  ProjectDetailWorkspace
    OverviewTab
    TasksTab
    MilestonesTab
    TimelineTab
    NotesTab
    ClientTab
    RevenueTab
    CalendarTab
    FlowsTab
    DeliverablesTab
```

---

## 30. Prioritized Implementation Plan

### Phase 1 — Structural reframe
1. Move project intelligence to the top of the page
2. Demote creation forms to action areas
3. Replace current stage model with a more useful delivery stage model

### Phase 2 — Board and card deepening
4. Upgrade project cards with real delivery context
5. Add list view option
6. Add blocked / waiting / due indicators

### Phase 3 — Project detail workspace
7. Build project detail workspace
8. Add Overview / Tasks / Milestones / Timeline / Notes
9. Add Client / Revenue / Calendar / Flows / Deliverables tabs

### Phase 4 — Template and creation overhaul
10. Deepen template model
11. Deepen project creation with linked client/quote/package/template
12. Add default task and milestone generation

### Phase 5 — Intelligence and integration
13. Add AI recommendations to projects
14. Add cross-module relationships visibly
15. Add project-related automation awareness

---

## 31. Acceptance Criteria

The Projects overhaul is successful if:

1. The workspace clearly supports delivery execution, not just project listing
2. The top of the page shows what needs attention
3. Project cards show meaningful operational context
4. Each project has a deep detail workspace
5. Templates are rich and reusable
6. Projects visibly connect to Clients, Revenue, Calendar, and Flows
7. AI can reason about project state using cross-app context
8. The module feels worthy of top-level placement
9. No current useful capability is removed

---

## 32. Non-Negotiables

- Do not leave Projects as a shallow board if it remains top-level
- Do not keep template creation minimal
- Do not keep project cards title-only
- Do not isolate Projects from Clients, Revenue, Calendar, or Flows
- Do not remove low-friction creation entirely
- Do not merge Projects fully into Flows

---

## 33. Target Outcome Statement

The final Projects workspace should feel like:

> a premium delivery execution workspace that tracks client work, milestones, blockers, deadlines, ownership, and linked revenue — while drawing intelligence from the entire KeyFlow system and contributing events back into it.
