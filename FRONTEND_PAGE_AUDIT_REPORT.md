# KEYFLOWOS Frontend Page Audit

## Summary

- **Pages audited:** 79
- **Breadcrumb matches:** 52 Exact · 12 Partial · 15 Mismatch
- **Stub buttons / links:** 5 across 3 pages
- **Low UI flatness (≤2/5):** 31 pages
- **Top systemic issues:**
  1. Most /app/build/* hub pages are `ModuleShell` placeholders showing "content coming soon" with flat UI.
  2. Several flow-hub and settings pages lack explicit page titles (heading detection failed).
  3. Section cards in `/app/financial-flow` and `/app/governance-flow` still point to `href="#"` (unimplemented routes).
  4. Breadcrumb labels sometimes diverge from page headings (e.g., Command Center → Cockpit, Calls → Call Tasks).

---

## /app/command-center

- **File:** `apps\web\src\app\app\command-center\page.tsx`
- **Page heading:** Command Center
- **Breadcrumb:** Home > Cockpit
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Cockpit" does not align with heading "Command Center".
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/key

- **File:** `apps\web\src\app\app\key\page.tsx`
- **Page heading:** KEY Worker
- **Breadcrumb:** Home > KEY
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 5/5
- **Fix recommendations:**

## /app/capture

- **File:** `apps\web\src\app\app\capture\page.tsx`
- **Page heading:** Capture
- **Breadcrumb:** Home > Capture
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 5/5
- **Fix recommendations:**

## /app/finance

- **File:** `apps\web\src\app\app\finance\page.tsx`
- **Page heading:** (redirect page)
- **Breadcrumb:** Home > Financial Flow > Books
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/financial-flow

- **File:** `apps\web\src\app\app\financial-flow\page.tsx`
- **Page heading:** Financial Flow
- **Breadcrumb:** Home > Financial Flow
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** 2 found
  - Line 107: `{ label: "Safe to Spend", href: "#", icon: ShieldCheck, desc: "Know what cash is truly available" },`
  - Line 108: `{ label: "Money Moves", href: "#", icon: Zap, desc: "Actions to improve cashflow" },`
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Wire or remove 2 stub button/link(s).
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/finance/revenue

- **File:** `apps\web\src\app\app\finance\revenue\page.tsx`
- **Page heading:** Revenue
- **Breadcrumb:** Home > Financial Flow > Books > Revenue
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/expenses

- **File:** `apps\web\src\app\app\expenses\page.tsx`
- **Page heading:** Expenses
- **Breadcrumb:** Home > Financial Flow > Expenses
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** 1 found
  - Line 351: `onClick={() => {}}`
- **UI flatness score:** 5/5
- **Fix recommendations:**
  - Wire or remove 1 stub button/link(s).

## /app/finance/expenses

- **File:** `apps\web\src\app\app\finance\expenses\page.tsx`
- **Page heading:** Expenses
- **Breadcrumb:** Home > Financial Flow > Books > Expenses
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/budgeting

- **File:** `apps\web\src\app\app\budgeting\page.tsx`
- **Page heading:** Budgeting
- **Breadcrumb:** Home > Financial Flow > Budgeting
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/reports

- **File:** `apps\web\src\app\app\reports\page.tsx`
- **Page heading:** Reports
- **Breadcrumb:** Home > Financial Flow > Reports
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 5/5
- **Fix recommendations:**

## /app/finance/reports

- **File:** `apps\web\src\app\app\finance\reports\page.tsx`
- **Page heading:** Reports
- **Breadcrumb:** Home > Financial Flow > Books > Reports
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/temporal-flow

- **File:** `apps\web\src\app\app\temporal-flow\page.tsx`
- **Page heading:** Temporal Flow
- **Breadcrumb:** Home > Temporal Flow
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/calendar

- **File:** `apps\web\src\app\app\calendar\page.tsx`
- **Page heading:** Calendar
- **Breadcrumb:** Home > Calendar
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/bookings

- **File:** `apps\web\src\app\app\bookings\page.tsx`
- **Page heading:** Bookings
- **Breadcrumb:** Home > Calendar
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Calendar" does not align with heading "Bookings".
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/projects

- **File:** `apps\web\src\app\app\projects\page.tsx`
- **Page heading:** Projects
- **Breadcrumb:** Home > Projects
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/call-tasks

- **File:** `apps\web\src\app\app\call-tasks\page.tsx`
- **Page heading:** Call Tasks
- **Breadcrumb:** Home > Calls
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Calls" does not align with heading "Call Tasks".
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/people-flow

- **File:** `apps\web\src\app\app\people-flow\page.tsx`
- **Page heading:** People Flow
- **Breadcrumb:** Home > People Flow
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/crm

- **File:** `apps\web\src\app\app\crm\page.tsx`
- **Page heading:** (redirect page)
- **Breadcrumb:** Home > Network
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/network/contacts

- **File:** `apps\web\src\app\app\network\contacts\page.tsx`
- **Page heading:** Contacts
- **Breadcrumb:** Home > Network > Contacts
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/connect/contacts

- **File:** `apps\web\src\app\app\connect\contacts\page.tsx`
- **Page heading:** Google Contacts
- **Breadcrumb:** Home > Connect > Contacts
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/crm/sequences

- **File:** `apps\web\src\app\app\crm\sequences\page.tsx`
- **Page heading:** Sequences
- **Breadcrumb:** Home > Network > Sequences
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/intelligence

- **File:** `apps\web\src\app\app\intelligence\page.tsx`
- **Page heading:** Intelligence
- **Breadcrumb:** Home > Intelligence
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/helpdesk

- **File:** `apps\web\src\app\app\helpdesk\page.tsx`
- **Page heading:** Helpdesk
- **Breadcrumb:** Home > Service
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Service" does not align with heading "Helpdesk".
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/commerce

- **File:** `apps\web\src\app\app\commerce\page.tsx`
- **Page heading:** Revenue
- **Breadcrumb:** Home > Financial Flow > Revenue
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/crm/deals

- **File:** `apps\web\src\app\app\crm\deals\page.tsx`
- **Page heading:** Deals
- **Breadcrumb:** Home > Network > Deals
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/marketing

- **File:** `apps\web\src\app\app\marketing\page.tsx`
- **Page heading:** Content
- **Breadcrumb:** Home > Content
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/marketing-flow

- **File:** `apps\web\src\app\app\marketing-flow\page.tsx`
- **Page heading:** Marketing Flow
- **Breadcrumb:** Home > Marketing Flow
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/marketing/lists

- **File:** `apps\web\src\app\app\marketing\lists\page.tsx`
- **Page heading:** Marketing lists
- **Breadcrumb:** Home > Content > Lists
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/content-ops

- **File:** `apps\web\src\app\app\content-ops\page.tsx`
- **Page heading:** Content Operations
- **Breadcrumb:** Home > Content
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/social

- **File:** `apps\web\src\app\app\social\page.tsx`
- **Page heading:** Social Composer
- **Breadcrumb:** Home > Social
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/operations

- **File:** `apps\web\src\app\app\operations\page.tsx`
- **Page heading:** Operations
- **Breadcrumb:** Home > Operations
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/governance-flow

- **File:** `apps\web\src\app\app\governance-flow\page.tsx`
- **Page heading:** Governance Flow
- **Breadcrumb:** Home > Governance Flow
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** 2 found
  - Line 31: `{ label: "Risks", href: "#", icon: AlertTriangle, desc: "Risk register and mitigation" },`
  - Line 32: `{ label: "Audit Logs", href: "#", icon: FileText, desc: "Business event history" },`
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Wire or remove 2 stub button/link(s).
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/approvals

- **File:** `apps\web\src\app\app\approvals\page.tsx`
- **Page heading:** Approvals
- **Breadcrumb:** Home > Approvals
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/settings/compliance

- **File:** `apps\web\src\app\app\settings\compliance\page.tsx`
- **Page heading:** Compliance & Consent
- **Breadcrumb:** Home > Studio > Compliance
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/system/compliance

- **File:** `apps\web\src\app\app\build\system\compliance\page.tsx`
- **Page heading:** Compliance
- **Breadcrumb:** Home > Build > System > Compliance
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/intelligence/compliance

- **File:** `apps\web\src\app\app\intelligence\compliance\page.tsx`
- **Page heading:** Compliance
- **Breadcrumb:** Home > Intelligence > Compliance
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/growth

- **File:** `apps\web\src\app\app\growth\page.tsx`
- **Page heading:** Growth
- **Breadcrumb:** Home > Growth
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/store

- **File:** `apps\web\src\app\app\store\page.tsx`
- **Page heading:** {storeName}
- **Breadcrumb:** Home > Presence
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Presence" does not align with heading "{storeName}".

## /app/storefront-intelligence

- **File:** `apps\web\src\app\app\storefront-intelligence\page.tsx`
- **Page heading:** Storefront Intelligence
- **Breadcrumb:** Home > Storefront Intelligence
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/documents

- **File:** `apps\web\src\app\app\documents\page.tsx`
- **Page heading:** (redirect page)
- **Breadcrumb:** Home > Documents
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/goals

- **File:** `apps\web\src\app\app\goals\page.tsx`
- **Page heading:** Goals
- **Breadcrumb:** Home > Goals
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/blueprint

- **File:** `apps\web\src\app\app\blueprint\page.tsx`
- **Page heading:** Business Blueprint
- **Breadcrumb:** Home > Blueprint
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/business/blueprint

- **File:** `apps\web\src\app\app\build\business\blueprint\page.tsx`
- **Page heading:** Blueprint
- **Breadcrumb:** Home > Build > Business > Blueprint
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/presence

- **File:** `apps\web\src\app\app\presence\page.tsx`
- **Page heading:** (not detected)
- **Breadcrumb:** Home > Presence
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.
  - Add an explicit H1/title via UnifiedPageShell/PageHeader/ModuleShell/WorkspaceShell/FlowShell.

## /app/build/business/presence

- **File:** `apps\web\src\app\app\build\business\presence\page.tsx`
- **Page heading:** Presence
- **Breadcrumb:** Home > Build > Business > Presence
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/templates

- **File:** `apps\web\src\app\app\templates\page.tsx`
- **Page heading:** Business Templates
- **Breadcrumb:** Home > Templates
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/business/templates

- **File:** `apps\web\src\app\app\build\business\templates\page.tsx`
- **Page heading:** Templates
- **Breadcrumb:** Home > Build > Business > Templates
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/settings/profile

- **File:** `apps\web\src\app\app\settings\profile\page.tsx`
- **Page heading:** (redirect page)
- **Breadcrumb:** Home > Studio > Profile
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/build/system/account

- **File:** `apps\web\src\app\app\build\system\account\page.tsx`
- **Page heading:** Account
- **Breadcrumb:** Home > Build > System > Account
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/settings/business

- **File:** `apps\web\src\app\app\settings\business\page.tsx`
- **Page heading:** (not detected)
- **Breadcrumb:** Home > Studio > Business
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**
  - Add an explicit H1/title via UnifiedPageShell/PageHeader/ModuleShell/WorkspaceShell/FlowShell.

## /app/build/system/workspace

- **File:** `apps\web\src\app\app\build\system\workspace\page.tsx`
- **Page heading:** Workspace
- **Breadcrumb:** Home > Build > System > Workspace
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/settings/team

- **File:** `apps\web\src\app\app\settings\team\page.tsx`
- **Page heading:** Team
- **Breadcrumb:** Home > Studio > Team
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/structure

- **File:** `apps\web\src\app\app\structure\page.tsx`
- **Page heading:** Structure
- **Breadcrumb:** Home > Structure
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/settings/connections

- **File:** `apps\web\src\app\app\settings\connections\page.tsx`
- **Page heading:** Connections
- **Breadcrumb:** Home > Studio > Connections
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/system/connections

- **File:** `apps\web\src\app\app\build\system\connections\page.tsx`
- **Page heading:** Connections
- **Breadcrumb:** Home > Build > System > Connections
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/settings/ai

- **File:** `apps\web\src\app\app\settings\ai\page.tsx`
- **Page heading:** L4 AI Settings
- **Breadcrumb:** Home > Studio > AI
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 5/5
- **Fix recommendations:**

## /app/build/system/ai

- **File:** `apps\web\src\app\app\build\system\ai\page.tsx`
- **Page heading:** AI
- **Breadcrumb:** Home > Build > System > AI
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/settings/developers

- **File:** `apps\web\src\app\app\settings\developers\page.tsx`
- **Page heading:** Developer Settings
- **Breadcrumb:** Home > Studio > Developers
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/build/system/developers

- **File:** `apps\web\src\app\app\build\system\developers\page.tsx`
- **Page heading:** Developers
- **Breadcrumb:** Home > Build > System > Developers
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/connect

- **File:** `apps\web\src\app\app\connect\page.tsx`
- **Page heading:** KeyFlow Connect
- **Breadcrumb:** Home > Connect
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/connect

- **File:** `apps\web\src\app\app\build\connect\page.tsx`
- **Page heading:** Connect
- **Breadcrumb:** Home > Build > Connect
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/google

- **File:** `apps\web\src\app\app\build\connect\google\page.tsx`
- **Page heading:** Google
- **Breadcrumb:** Home > Build > Connect > Google
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/microsoft

- **File:** `apps\web\src\app\app\build\connect\microsoft\page.tsx`
- **Page heading:** Microsoft
- **Breadcrumb:** Home > Build > Connect > Microsoft
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/payments

- **File:** `apps\web\src\app\app\build\connect\payments\page.tsx`
- **Page heading:** Payments
- **Breadcrumb:** Home > Build > Connect > Payments
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/accounting

- **File:** `apps\web\src\app\app\accounting\page.tsx`
- **Page heading:** Accounting sync
- **Breadcrumb:** Home > Accounting
- **Breadcrumb matches heading:** Partial
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/connect/accounting

- **File:** `apps\web\src\app\app\build\connect\accounting\page.tsx`
- **Page heading:** Accounting
- **Breadcrumb:** Home > Build > Connect > Accounting
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/marketing

- **File:** `apps\web\src\app\app\build\connect\marketing\page.tsx`
- **Page heading:** Marketing
- **Breadcrumb:** Home > Build > Connect > Content
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Content" does not align with heading "Marketing".
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/social

- **File:** `apps\web\src\app\app\build\connect\social\page.tsx`
- **Page heading:** Social
- **Breadcrumb:** Home > Build > Connect > Social
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/connect/forms

- **File:** `apps\web\src\app\app\connect\forms\page.tsx`
- **Page heading:** Forms
- **Breadcrumb:** Home > Connect > Forms
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**

## /app/build/connect/forms

- **File:** `apps\web\src\app\app\build\connect\forms\page.tsx`
- **Page heading:** Forms
- **Breadcrumb:** Home > Build > Connect > Forms
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/build/connect/whatsapp

- **File:** `apps\web\src\app\app\build\connect\whatsapp\page.tsx`
- **Page heading:** WhatsApp
- **Breadcrumb:** Home > Build > Connect > WhatsApp
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/flows

- **File:** `apps\web\src\app\app\flows\page.tsx`
- **Page heading:** Flows
- **Breadcrumb:** Home > Flows
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 5/5
- **Fix recommendations:**

## /app/build/automate/flows

- **File:** `apps\web\src\app\app\build\automate\flows\page.tsx`
- **Page heading:** Flows
- **Breadcrumb:** Home > Build > Automate > Flows
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/workflows

- **File:** `apps\web\src\app\app\workflows\page.tsx`
- **Page heading:** (redirect page)
- **Breadcrumb:** Home > Workflows
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.

## /app/build/automate/workflows

- **File:** `apps\web\src\app\app\build\automate\workflows\page.tsx`
- **Page heading:** Workflows
- **Breadcrumb:** Home > Build > Automate > Workflows
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 2/5
- **Fix recommendations:**
  - Elevate UI with cards/shadows/rounded corners, structured spacing, and empty-state polish.
  - Placeholder page — ModuleShell shows 'content coming soon'; add real content or remove from nav until implemented.

## /app/community

- **File:** `apps\web\src\app\app\community\page.tsx`
- **Page heading:** Community
- **Breadcrumb:** Home > Community
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/learn

- **File:** `apps\web\src\app\app\learn\page.tsx`
- **Page heading:** MasterClass
- **Breadcrumb:** Home > Learn
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Learn" does not align with heading "MasterClass".
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

## /app/marketplace

- **File:** `apps\web\src\app\app\marketplace\page.tsx`
- **Page heading:** Commerce
- **Breadcrumb:** Home > Marketplace
- **Breadcrumb matches heading:** No
- **Stub buttons:** None detected
- **UI flatness score:** 4/5
- **Fix recommendations:**
  - Breadcrumb last crumb "Marketplace" does not align with heading "Commerce".

## /app/procurement/suppliers

- **File:** `apps\web\src\app\app\procurement\suppliers\page.tsx`
- **Page heading:** Suppliers
- **Breadcrumb:** Home > Procurement > Suppliers
- **Breadcrumb matches heading:** Exact
- **Stub buttons:** None detected
- **UI flatness score:** 3/5
- **Fix recommendations:**
  - Add subtle depth (shadows/borders), tighten spacing, and polish empty states.

