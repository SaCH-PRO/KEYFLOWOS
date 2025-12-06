KeyFlow CRM Execution Spec
==========================

1. Execution Plan (text)
-----------------------
The CRM must be rebuilt as a flagship suite—an always-on profiler, action hub, and intelligence layer—built directly from the Blueprint mandate. Start by auditing the current CRM data surface (contacts, notes, tasks, invoices, bookings) and ensuring the Prisma schema plus services normalize emails/phones, soft-delete everything, and expose typed clients via `PrismaService`. Next, extend the backend modules with explicit, documented hooks (events, automation wiring, Flow listeners) so that every new payment, booking, automation action, or contact change flows through the CRM as a stateful signal. In parallel, shape the frontend command surfaces (Cockpit CRM panel, search, AI hints) so users see scores, patterns, and prompts without leaving the CRM space. AI-driven flows remain stubbed for now—log the hook points and keep placeholders until the rest of the infrastructure is complete.

2. Prioritized CRM Wishlist
---------------------------
- **Scored leads**: Calculate a reliable “lead score” using bookings completed in the last 14 days, paid invoices, unpaid invoices, and overdue tasks. Surface the score on the contact record and in search results so users can instantly pick high-value prospects.
- **Behavioral patterns**: Show service affinity (which services/bookings this contact books most often), payment reliability, and time-between-interactions. Use this to nudge segmented Playbooks (“High-frequency VIP”, “Delayed payment follow-up”).
- **Overdue reminders**: Track the oldest unpaid invoice, overdue bookings (unconfirmed), and stale tasks per contact. Push these into a “Next Action” queue instead of forcing users to hunt for them.
- **Service affinity view**: For the business, list services generating the most revenue/booking volume, then highlight which contacts are “top fans” per service so sales efforts can focus on tightening those relationships.
- **Segment intelligence**: Auto-generate segments such as “New leads this week”, “Cold leads with unpaid invoices”, and “Top clients (paid + frequent bookings)”. Allow quick filters so the CRM acts like a search-ready intelligence layer rather than a passive list.
- **Streamlined input**: Normalize every form submission (bookings, imports, manual contact edits) to enforce trimmed/lower-cased emails and digits-only phones, automatically tag the source (booking form, automation, public link), and update meta fields (e.g., `lastInteractionAt`, `leadScore`).

3. CRM Flow Panel Sketch (Cockpit)
----------------------------------
- **Search bar**: Top-aligned command-style search that filters across contacts by name, email, phone, tags, and segments. Includes autocomplete suggestions for “/leadScore>70” or “#segment:silver” so operators can quickly narrow to business-critical contacts.
- **Shared timeline**: A two-column live stream showing the latest contact events, notes, bookings, tasks, invoices, and payments. Each entry shows time, type badge (event/note/task), and context actions (view contact, mark task done, send reminder).
- **AI-suggested next actions** (stubbed): show up to three heuristics (e.g., “Follow up with lead not touched in 4 days” or “Invoice overdue by 5 days—send reminder”) sourced from the wishlist logic. For now, render stub cards that log their intended hook points for future AI wiring.
- **High-potential spotlight**: Highlight the top 3 contacts by score, bookings this week, or revenue contribution. Each card shows contact photo (if available), score, unpaid balance, status badge, and a CTA (call, book, tag).
- **Global integration cues**: Embed indicators showing related module activities (Invoices paid via Commerce, Bookings pending confirmation, Projects triggered) to reinforce the CRM as the command center.
- **Data contract**: Backend exposes `ContactDetail` with `meta` (leadScore, lastInteractionAt, outstandingBalance), `events`, `notes`, `tasks`, `bookings`, and `invoices`. Add `segments` array and `tags` set for quick filtering. Provide dedicated endpoints for `crm/segments` and `crm/highlights`.

4. Module Hooks & Events Map
---------------------------
- **Contact updates**: CRM service emits `contact.updated` with `{ contactId, businessId, fromStatus?, toStatus? }`; automation listens to add tags or tasks. All updates should refresh `lastInteractionAt` and recalc `leadScore`.
- **Contact creation/merge**: Trigger `contact.created` and `contact.merged` events so AutomationService can tag new leads and Flow listeners can seed segments.
- **Invoice lifecycle**: Commerce module should emit `invoice.sent`, `invoice.paid`, `invoice.overdue`. CRM consumes these to update meta (outstandingBalance, unpaid count) and to push the contact into the “Next Action” queue. `invoice.paid` also triggers Flow listeners (e.g., booking confirmation, gamification toggles).
- **Booking lifecycle**: Bookings module emits `booking.created`, `booking.confirmed`, `booking.cancelled`. CRM uses these to keep the timeline up to date, record service affinity, and promote a contact to `CLIENT` status via automation if bookings exceed a threshold.
- **Task interactions**: Task completion emits `contact.task.completed`. CRM recalculates `nextDueTaskAt` and updates `overdueTasks`.
- **Tag/segment updates**: When segments change (e.g., logic in Flow listener or automation), emit `contact.segment.updated` so UI filters stay in sync.
- **Automation triggers**: Hook automation actions (follow-up, tag, event logging) through the CRM API so other modules can re-use them without duplicating logic.

5. AI Stub Log
--------------
AI features remain placeholders. Document the intended hook points for later expansion:
- **Next-action cards**: “Lead stale” or “Invoice overdue” heuristics driven by meta + segments.
- **Flow Feed prompts**: Convert events (`invoice.paid`, `booking.created`) into textual cues like “Invoice #123 paid—send review request”.
- **Predictive segments**: Future stub to label contacts as “high-likelihood to buy” using booking/invoice history once event listeners are robust.
Keep these stubs as comments or TODOs in code until the rest of the CRM, Commerce, and Bookings integrations fully deliver their signals.
