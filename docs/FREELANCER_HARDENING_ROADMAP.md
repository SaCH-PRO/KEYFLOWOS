# Freelancer Hardening Roadmap
## Objective: Upgrade all MODERATE features to STRONG
## Target Segment: Freelancers, Consultants, Solo Agencies

---

## PHASE 1: TIME TRACKING & BILLABLE HOURS (P0)
**Why:** Freelancers live and die by billable hours. The app has `hourlyRate` in AI settings but no way to track time.

### Backend
- [ ] Prisma schema: `TimeEntry` table (id, userId, businessId, projectId, taskId, description, startTime, endTime, durationMinutes, billable, billed, hourlyRate, invoiceId, createdAt, updatedAt)
- [ ] API: `POST /time-entries/start` — start a timer
- [ ] API: `POST /time-entries/:id/stop` — stop a timer
- [ ] API: `POST /time-entries` — manual time entry creation
- [ ] API: `PATCH /time-entries/:id` — edit time entry
- [ ] API: `DELETE /time-entries/:id` — delete time entry
- [ ] API: `GET /time-entries` — list with filters (date range, project, billable status)
- [ ] API: `GET /time-entries/summary` — daily/weekly/monthly aggregates
- [ ] API: `GET /time-entries/running` — get currently running timer
- [ ] API: `POST /time-entries/bill` — mark entries as billed and link to invoice
- [ ] Service: Auto-calculate duration from start/stop timestamps
- [ ] Service: Round to nearest 6min/15min based on settings
- [ ] Service: Running timer heartbeat (auto-stop after idle timeout)

### Frontend
- [ ] Global timer widget (floats in app header, persists across navigation)
- [ ] `/app/time-tracking` page: timesheet grid (day/week view like Toggl)
- [ ] Timer overlay: project selector, task selector, description input, start/stop
- [ ] Time entry list with inline editing
- [ ] "Bill Selected Hours" button → creates invoice line items
- [ ] Project detail page: show total hours spent vs budgeted
- [ ] Dashboard stat: "Hours logged today / this week"

### Integration
- [ ] Connect to invoices: `POST /invoices` accepts `timeEntryIds` to auto-populate line items
- [ ] Connect to projects: show time summary on project cards
- [ ] Connect to AI: KEY can "start timer on Project X" via tool call

---

## PHASE 2: PROJECT MANAGEMENT — KANBAN & GANTT (P0)
**Why:** Freelancers manage multiple client projects. Current projects module is too basic.

### Backend
- [ ] Prisma schema additions: `Project` → add `status` enum (BACKLOG, TODO, IN_PROGRESS, REVIEW, DONE, ON_HOLD), `startDate`, `endDate`, `budgetHours`, `budgetAmount`, `color`, `priority`
- [ ] Prisma schema additions: `Task` → add `status` enum, `position` (for Kanban ordering), `dependsOn` (task dependencies), `timeEstimateMinutes`, `dueDate`
- [ ] API: Enhanced project CRUD with new fields
- [ ] API: Task status transitions with validation
- [ ] API: Task reordering within columns
- [ ] API: Project timeline data (for Gantt)
- [ ] API: Task dependency chain resolution
- [ ] API: Project health score (on-time %, budget burn %)

### Frontend
- [ ] `/app/projects` Kanban board: drag-and-drop columns (Backlog → Todo → In Progress → Review → Done)
- [ ] `/app/projects/:id/gantt` Gantt chart view: tasks on timeline, dependency lines
- [ ] Project cards: progress bar, budget burn indicator, deadline countdown
- [ ] Task cards: assignee avatar, time tracked, due date badge, priority color
- [ ] Quick-add task from Kanban column
- [ ] Filter by assignee, priority, due date

---

## PHASE 3: RETAINER & MILESTONE BILLING (P0)
**Why:** Retainers are the holy grail of freelance income—predictable monthly revenue.

### Backend
- [ ] Prisma schema: `RetainerAgreement` table (id, businessId, contactId, name, monthlyAmount, startDate, endDate, includedHours, rolloverHours, status)
- [ ] Prisma schema: `RetainerPeriod` table (id, retainerId, periodStart, periodEnd, hoursUsed, hoursBilled, amountBilled, status)
- [ ] API: Retainer CRUD
- [ ] API: Auto-generate retainer invoices monthly
- [ ] API: Milestone billing for projects (milestone table with amount, dueDate, deliverables)
- [ ] API: Hours consumption tracking against retainer included hours
- [ ] API: Rollover logic (unused hours → next month, capped)
- [ ] Service: Auto-create invoice when retainer period starts
- [ ] Service: Alert when retainer hours at 75%, 90%, 100%

### Frontend
- [ ] `/app/retainers` page: list of active retainers with hours burn-down charts
- [ ] Retainer detail: monthly breakdown, hours used vs included, rollover history
- [ ] Project detail: milestone timeline with payment triggers
- [ ] Invoice creation: "Create from Retainer" option
- [ ] Dashboard alert: "Acme Corp retainer at 85% hours this month"

---

## PHASE 4: CLIENT PORTAL (P1)
**Why:** Reduce "where is my invoice/project?" emails by 80%.

### Backend
- [ ] Prisma schema: `PortalAccess` table (id, contactId, businessId, token, expiresAt, enabled)
- [ ] API: Generate portal access link for contact
- [ ] API: Portal-authenticated endpoints (read-only): invoices, projects, documents, bookings
- [ ] API: Portal settings (what contact can see)
- [ ] Middleware: Portal token validation (separate from auth)

### Frontend
- [ ] `/portal/:token` public client portal page
- [ ] Client portal sections: Project status, Invoices & Payments, Documents, Bookings, Messages
- [ ] Invoice pay button inside portal
- [ ] Project progress visualization for clients
- [ ] "Request Change" button → creates approval request
- [ ] Responsive mobile design (clients check on phones)

---

## PHASE 5: PROJECT BUDGETS & PROFITABILITY (P1)
**Why:** Freelancers need to know if a project is profitable BEFORE it goes off the rails.

### Backend
- [ ] Prisma schema: `ProjectBudget` table (id, projectId, budgetType: FIXED|HOURLY|RETAINER, budgetAmount, budgetHours, warningThreshold%)
- [ ] API: Budget CRUD linked to projects
- [ ] API: Real-time budget burn calculation (time × rate + expenses)
- [ ] API: Profitability report per project
- [ ] Service: Budget threshold alerts (email + in-app)

### Frontend
- [ ] Project detail: budget progress bar with color coding (green < 75%, yellow < 90%, red > 100%)
- [ ] Project list: profitability indicator on each card
- [ ] `/app/finance/projects` profitability dashboard
- [ ] Alert: "Website Redesign project is 95% of budget with 2 weeks left"

---

## PHASE 6: SCOPE MANAGEMENT / CHANGE ORDERS (P1)
**Why:** Scope creep is the #1 profit killer for freelancers.

### Backend
- [ ] Prisma schema: `ChangeOrder` table (id, projectId, description, originalScope, newScope, additionalAmount, additionalHours, status, approvedBy, approvedAt)
- [ ] API: Change order CRUD
- [ ] API: Auto-create approval request for change orders
- [ ] API: Change order → invoice generation

### Frontend
- [ ] Project detail: "Request Change Order" button
- [ ] Change order form: description, additional cost/hours, client approval workflow
- [ ] Client portal: pending change orders for approval
- [ ] Project history: timeline of scope changes

---

## EXECUTION ORDER

1. **Start Phase 1 (Time Tracking)** — highest freelancer impact, builds on existing task system
2. **Phase 1 + Phase 2 parallel** — Time tracking feeds Kanban tasks
3. **Phase 3 (Retainer Billing)** — monetization layer on top of time tracking
4. **Phase 4 (Client Portal)** — wraps everything in a client-facing package
5. **Phase 5 + 6 (Budgets + Change Orders)** — profitability protection

## SUCCESS METRICS
- [ ] Freelancer can track billable hours by project/task
- [ ] Freelancer can visualize all projects on Kanban board
- [ ] Freelancer can set up monthly retainer with auto-invoicing
- [ ] Client can view project status without emailing freelancer
- [ ] Freelancer gets alerts before project goes over budget
- [ ] Change orders require client approval before work begins
