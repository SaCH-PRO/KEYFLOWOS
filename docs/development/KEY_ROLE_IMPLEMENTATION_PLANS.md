# KEY Role Implementation Plans

**Goal:** Turn the replaceability matrix into a concrete engineering roadmap.  
- **Part 1** covers every **R (Replaceable)** role and defines a premium, verified, end-to-end KEY service for it.  
- **Part 2** prioritizes the **P (Partially Replaceable)** roles, deconstructs them into duties, and plans robust KEY support that maximizes user results while keeping humans in the loop.

---

## Part 1 — R Roles: Premium Service Plans

For each R role the objective is: **KEY performs the work, the user only reviews exceptions.** Each plan includes the service definition, backend capabilities, integrations, UI strategy, and end-to-end verification.

### R-1. Data Entry Clerk

**Premium service definition**
KEY ingests any document, image, email, form, or message and writes clean, validated records into the right module without the user copying and pasting.

**Backend capabilities to build/verify**
- Unified ingestion queue (`IngestionItem`) honored across all connectors.
- Document AI extraction (receipts, business cards, forms, PDFs) with confidence scores.
- Field mapping from extracted data to CRM, expenses, invoices, projects, inventory.
- Duplicate detection by fuzzy match + business rules.
- Confidence threshold: ≥90% auto-write, 70–90% ask user, <70% queue for review.

**Integrations**
- Device capture, Google Drive, Gmail, WhatsApp, email/SMS, web forms, scanner/email attachments.

**UI strategy**
- “Data Inbox” view: cards showing extracted fields, source preview, one-click confirm/edit/reject.
- Bulk approve / bulk edit for high-volume sessions.
- “Confidence filter” so users only see items below threshold.
- Mobile-first capture experience.

**End-to-end verification**
1. Upload 100 receipts → KEY creates expenses with ≥95% accuracy.
2. Receive business card via device capture → contact created in CRM within 5 seconds.
3. Forward an invoice email → invoice drafted and linked to customer.
4. Verify duplicate prevention and audit log.

---

### R-2. File / Records Clerk

**Premium service definition**
Every document is automatically tagged, filed, versioned, searchable, and linked to the relevant business record.

**Backend capabilities**
- Document classification model (invoice, contract, receipt, ID, etc.).
- Auto-tagging by entity extraction (business, contact, project, date, amount).
- Folder/tag taxonomy synced across modules.
- Retention policy engine and audit trail.

**Integrations**
- Google Drive, file uploads, email attachments, device captures.

**UI strategy**
- Universal document search with filters (entity, type, date range).
- Document detail page: preview, linked records, tags, version history.
- “File this for me” command in KEY chat.

**End-to-end verification**
1. Upload a contract → tagged as `contract`, linked to business/contact, version saved.
2. Search by contact name → all related documents returned.
3. Verify retention rules execute on schedule.

---

### R-3. Transcriptionist

**Premium service definition**
Any audio or video is converted to accurate, timestamped, speaker-labeled text and linked to the source meeting or record.

**Backend capabilities**
- STT pipeline with speaker diarization.
- Punctuation, paragraphing, and domain vocabulary tuning.
- Secure temporary audio storage (replace placeholder S3 path).
- Auto-link to meetings, voice sessions, or uploaded files.

**Integrations**
- Upload API, voice sessions, meeting recordings, phone call recordings.

**UI strategy**
- Transcript viewer with synced audio/text, search, and export.
- “Transcribe” action on any audio/video attachment.
- Cost/length preview before processing.

**End-to-end verification**
1. Upload 30-min meeting recording → transcript generated with speaker labels.
2. Verify transcript search and export to PDF/DOCX.
3. Confirm audio is deleted after retention period.

---

### R-4. Notetaker

**Premium service definition**
KEY attends meetings (voice or transcript), extracts decisions, action items, owners, and deadlines, and writes them into the command queue.

**Backend capabilities**
- Meeting transcript ingestion.
- Decision/action item extraction model.
- Owner/deadline inference from context.
- Auto-create command items, tasks, calendar events.

**Integrations**
- Google Meet/Zoom transcript ingestion, voice sessions, manual uploads.

**UI strategy**
- Meeting notes page: summary, decisions, action items, transcript.
- Inline edit of extracted action items before pushing to command queue.
- “Start meeting notes” button in KEY command center.

**End-to-end verification**
1. Feed a meeting transcript → KEY extracts ≥80% of action items correctly.
2. Confirm each action item becomes a command item with owner and due date.
3. Verify reminders trigger before deadlines.

---

### R-5. Meeting Scheduler

**Premium service definition**
User describes who and what; KEY finds the best slot, sends invites, handles reschedules, and adds context to the calendar event.

**Backend capabilities**
- Natural-language parsing of scheduling requests.
- Calendar free/busy lookup across connected calendars.
- Time-zone handling and buffer-time rules.
- Reschedule/cancel with notifications.
- Include meeting brief (participants, last contact, relevant docs).

**Integrations**
- Google Calendar, Outlook, booking links.

**UI strategy**
- “Schedule a meeting” command in KEY chat.
- Visual slot picker when KEY is uncertain.
- Conflict card showing alternative slots.

**End-to-end verification**
1. User types “Meet Acme Corp next Tuesday afternoon” → invite sent.
2. Reschedule request handled automatically with all attendees notified.
3. Verify booking link integration and timezone correctness.

---

### R-6. Expense Report Processor

**Premium service definition**
User captures receipts; KEY categorizes, matches to policies, flags anomalies, and submits reports for approval or auto-approval.

**Backend capabilities**
- Receipt OCR + line-item extraction.
- Policy rule engine (per-diem, mileage, allowed categories).
- Corporate card matching.
- Multi-currency handling and FX.
- Approval workflow or auto-approval under policy.

**Integrations**
- Device capture, bank/card feeds, accounting exports (QuickBooks/Xero).

**UI strategy**
- Expense capture camera + manual entry.
- “Expense report ready to submit” card with total, policy flags, missing receipts.
- Manager approval view with one-click approve/reject.

**End-to-end verification**
1. Snap 10 receipts → KEY creates expenses with correct category and amount.
2. Submit report → manager gets approval request, accounting export created.
3. Verify policy violation flagged before submission.

---

### R-7. Accounts Receivable Clerk

**Premium service definition**
KEY invoices customers, sends payment links, follows up on overdue accounts, records payments, and reconciles deposits.

**Backend capabilities**
- Recurring invoice generation.
- Payment-link generation (Stripe/WiPay/PayPal).
- Dunning schedule with escalations.
- Auto-record payments and mark invoices paid.
- Deposit reconciliation.

**Integrations**
- Stripe, WiPay, PayPal, bank feeds.

**UI strategy**
- AR aging dashboard.
- “Invoice now” and “Send reminder” buttons on customer record.
- Payment confirmation notifications.

**End-to-end verification**
1. Create subscription → invoice generated and emailed automatically.
2. Customer clicks payment link → payment recorded, invoice marked paid.
3. Overdue invoice triggers reminder sequence.
4. Verify reconciliation report matches deposits.

---

### R-8. Lead Qualifier

**Premium service definition**
Inbound leads are scored, enriched, deduplicated, and routed to the right salesperson or nurture sequence instantly.

**Backend capabilities**
- Lead scoring model (demographic + behavioral + source).
- Auto-enrichment from email domain, social, public data.
- Deduplication against existing contacts.
- Routing rules (territory, product, capacity).
- Auto-create contact/deal/opportunity.

**Integrations**
- Web forms, WhatsApp, email, social, business card capture.

**UI strategy**
- Lead queue with score, source, enrichment, suggested owner.
- “Accept / Reject / Reassign” actions.
- Lead quality analytics over time.

**End-to-end verification**
1. Submit web form → lead scored, enriched, routed within seconds.
2. Duplicate submission detected and merged.
3. Verify routing rules respect territory/capacity.

---

### R-9. Sales Coordinator

**Premium service definition**
KEY handles the administrative backbone of sales: scheduling demos, sending follow-ups, updating CRM, preparing materials, and tracking deal next steps.

**Backend capabilities**
- CRM update automation from emails/meetings.
- Follow-up sequence execution.
- Demo scheduling with calendar integration.
- Proposal/quote document assembly.
- Deal stage progression alerts.

**Integrations**
- CRM, calendar, email, document templates.

**UI strategy**
- Deal page with KEY-suggested next actions.
- “Send follow-up” one-click buttons.
- Activity timeline auto-generated from meetings/emails.

**End-to-end verification**
1. Sales rep marks demo complete → KEY sends thank-you email, updates stage.
2. No activity for 5 days → KEY suggests follow-up and drafts it.
3. Verify CRM fields updated correctly.

---

### R-10. Contract Administrator

**Premium service definition**
KEY stores contracts, extracts key terms, alerts before renewals/expirations, routes approvals, and maintains version control.

**Backend capabilities**
- Contract upload and OCR.
- Key term extraction (parties, dates, amounts, termination clauses).
- Renewal/expiration calendar.
- Approval workflow for new contracts.
- Version control and audit trail.

**Integrations**
- Google Drive, email attachments, e-signature (DocuSign/SignWell).

**UI strategy**
- Contract registry with filter/search.
- Renewal alert cards in Command Center.
- Contract detail page: terms, linked records, timeline.

**End-to-end verification**
1. Upload contract → terms extracted and displayed.
2. 30-day renewal alert fires.
3. Approval workflow completes with audit log.

---

### R-11. Vendor Onboarding Specialist

**Premium service definition**
KEY collects vendor documents, verifies required fields, runs checks, creates vendor records, and notifies stakeholders.

**Backend capabilities**
- Onboarding form builder.
- Document checklist and expiration tracking.
- Verification rules (tax ID, insurance, banking).
- Auto-create vendor/contact record.
- Approval routing.

**Integrations**
- Email, forms, document storage, identity/tax verification APIs.

**UI strategy**
- Vendor onboarding status dashboard.
- Vendor self-service portal for document upload.
- “Missing items” reminder automation.

**End-to-end verification**
1. Invite vendor → vendor uploads docs → KEY checks completeness.
2. Missing doc triggers reminder.
3. Complete vendor auto-created with approval audit.

---

### R-12. SaaS / LMS / Training Administrator

**Premium service definition**
KEY provisions users, manages access reviews, enrolls learners, tracks completions, and reports on usage.

**Backend capabilities**
- User provisioning/deprovisioning rules.
- Access review workflows.
- Course enrollment and reminder sequences.
- Completion tracking and certification.
- Usage reports.

**Integrations**
- Identity providers, LMS APIs, internal auth.

**UI strategy**
- User management grid with KEY-suggested actions.
- Access review cards: approve/remove access.
- Training dashboard: enrollments, completions, overdue.

**End-to-end verification**
1. New hire added → KEY provisions default app access.
2. Quarterly access review → manager approves/revokes.
3. Course due date triggers reminder and records completion.

---

### R-13. Reservation Agent

**Premium service definition**
Customers can book, modify, or cancel reservations through any channel; KEY updates inventory and sends confirmations.

**Backend capabilities**
- Booking engine with availability rules.
- Multi-channel booking (web, WhatsApp, email, phone/voice).
- Modification/cancellation with policy enforcement.
- Waitlist and overbooking protection.
- Confirmation and reminder messages.

**Integrations**
- Calendar, WhatsApp, email, voice, payment.

**UI strategy**
- Booking calendar view.
- Customer self-service booking page.
- Reservation cards in KEY Inbox for exceptions.

**End-to-end verification**
1. Customer books via WhatsApp → reservation created.
2. Customer modifies booking → availability updated.
3. No-show triggers cancellation/fee policy.

---

### R-14. Board Secretary

**Premium service definition**
KEY generates meeting minutes, tracks board resolutions, manages action items, and maintains governance documents.

**Backend capabilities**
- Meeting transcript ingestion.
- Resolution/action item extraction.
- Board document package assembly.
- Voting/sign-off workflow.
- Secure document distribution.

**Integrations**
- Calendar, email, document storage, e-signature.

**UI strategy**
- Board portal: meetings, minutes, resolutions, action items.
- “Generate minutes” button from transcript/recording.
- Voting/sign-off UI for directors.

**End-to-end verification**
1. Board meeting transcript → minutes drafted with resolutions.
2. Action items tracked until completion.
3. Signed minutes stored with audit trail.

---

### R-15. Project Coordinator

**Premium service definition**
KEY maintains project schedules, notes, action items, reminders, and status updates so the project manager focuses on stakeholder management.

**Backend capabilities**
- Project/task CRUD from natural language.
- Dependency tracking and critical path alerts.
- Meeting notes → tasks.
- Status report generation.
- Reminder and escalation sequences.

**Integrations**
- Calendar, email, documents, command queue.

**UI strategy**
- Project hub with timeline, tasks, risks, notes.
- “Update status” command in KEY chat.
- Automated status report card.

**End-to-end verification**
1. User says “Create project Alpha with milestones X, Y, Z” → project created.
2. Meeting notes generate tasks assigned to owners.
3. Status report emailed weekly with accurate progress.

---

## Part 2 — P Roles: Prioritized Deconstruction & Implementation Plans

### Selection Criteria

From the large P list, we prioritize roles that are:
1. **Common** — exist in most businesses.
2. **High-yield** — save significant hours or money.
3. **Strategically beneficial** — improve customer experience, cash flow, or decision quality.
4. **Digitally tractable** — inputs/outputs flow through KEYFLOWOS modules.

### Prioritized P Roles (Tier 1)

1. Executive Assistant
2. Bookkeeper
3. SDR / BDR
4. L1 / L2 Customer Support Agent
5. Social Media Manager / Responder
6. Email Marketer / Content Marketer
7. Operations Coordinator
8. Project Manager (administrative)
9. Inventory Manager
10. Procurement Buyer
11. HR Administrator
12. Recruiter (sourcing/screening)
13. IT Support Technician
14. Paralegal / Contract Analyst
15. Medical Receptionist / Biller / Coder
16. Field Service Dispatcher / Coordinator
17. E-commerce Manager
18. Front Desk / Concierge
19. Restaurant Manager (back office)
20. UX Designer / Technical Writer / QA Engineer

---

### P-1. Executive Assistant

**Deconstructed duties**
- Calendar management
- Inbox triage and drafting
- Meeting prep (briefs, agendas)
- Travel booking
- Expense submission
- Task/reminder management
- Stakeholder follow-up

**Core skills KEY can handle**
- Free/busy lookup, scheduling, rescheduling
- Email summarization, draft replies, priority tagging
- Context assembly for meetings
- Expense capture and report submission
- Reminder sequences

**Human retains**
- Sensitive political judgment
- Complex travel disruption handling
- Relationship management

**Implementation modules**
- Calendar connector
- Key Inbox with priority scoring
- Command Center briefing
- Expense module
- Voice/chat command interface

**UI strategy**
- “Executive Dashboard”: calendar, inbox highlights, action items, meeting briefs.
- Swipe-able inbox cards: reply, defer, delegate, ignore.
- Meeting brief card shown 15 min before each meeting.
- Voice command: “KEY, find a 30-min slot with Sarah next week.”

**Verification**
- 50 emails triaged in a day with ≥90% correct priority.
- Travel booking completed with user confirmation in <3 interactions.

---

### P-2. Bookkeeper

**Deconstructed duties**
- Record transactions
- Categorize expenses/income
- Reconcile bank/credit accounts
- Generate reports
- Manage accounts payable/receivable
- Month-end close tasks

**Core skills KEY can handle**
- OCR receipt capture and categorization
- Bank feed import and matching
- Recurring transaction rules
- Report generation (P&L, balance sheet, cash flow)
- AR/AP tracking

**Human retains**
- Reconciliation exceptions
- Tax strategy
- Audit defense
- Complex adjustments

**Implementation modules**
- Expense capture
- Bank/connector feeds
- Chart of accounts
- Reporting engine
- Reconciliation workflow

**UI strategy**
- “Books” workspace: transactions, receipts, reconciliation, reports.
- Transaction row with AI-suggested category and one-click confirm.
- Reconciliation mismatch cards with source evidence.
- Monthly close checklist driven by KEY.

**Verification**
- 100 receipts categorized with ≥95% accuracy.
- Month-end close checklist completed automatically except flagged items.

---

### P-3. SDR / BDR

**Deconstructed duties**
- Lead research
- List building
- Personalized outreach
- Follow-up sequences
- Meeting booking
- Lead qualification
- CRM hygiene

**Core skills KEY can handle**
- Lead scoring and enrichment
- Email/LinkedIn/WhatsApp sequence execution
- A/B test variants
- Response classification (interested, not now, wrong person)
- Calendar booking link insertion

**Human retains**
- Live objection handling
- Discovery calls
- Relationship building

**Implementation modules**
- CRM
- Marketing/sequence engine
- LinkedIn/email connectors
- Calendar
- Lead scoring model

**UI strategy**
- “Outreach” workspace: sequences, leads, replies, booked meetings.
- Lead card with enrichment, suggested sequence, and personalization fields.
- Reply classification with draft response suggestions.
- Meeting booked notification card.

**Verification**
- 500 leads processed in a week with booked meetings tracked.
- Response classification accuracy ≥85%.

---

### P-4. L1 / L2 Customer Support Agent

**Deconstructed duties**
- Ticket triage
- FAQ responses
- Order/account lookup
- Refund/return processing
- Escalation to L3/human
- Knowledge base maintenance

**Core skills KEY can handle**
- Intent classification
- Knowledge base search
- Order/status lookup
- Refund/return rule execution
- Sentiment detection and escalation

**Human retains**
- Complex/angry customers
- Policy exceptions
- Product bugs requiring engineering

**Implementation modules**
- Key Inbox
- Knowledge base
- CRM/order data
- Returns/refunds
- Command queue escalation

**UI strategy**
- “Support Inbox” with AI-drafted replies and confidence score.
- Customer 360 sidebar: orders, tickets, sentiment.
- “Escalate” button with reason capture.
- Knowledge gap detector: unanswered questions flagged for KB update.

**Verification**
- 70% of L1 tickets resolved without human.
- Escalation rate <15% with correct reason.

---

### P-5. Social Media Manager / Responder

**Deconstructed duties**
- Content calendar
- Post scheduling
- Comment/DM replies
- Trend monitoring
- Reporting
- Crisis escalation

**Core skills KEY can handle**
- Schedule posts across platforms
- Draft replies to comments/DMs
- Route leads/issues to CRM/inbox
- Hashtag and timing suggestions
- Performance reports

**Human retains**
- Creative direction
- Crisis response
- Brand tone final approval

**Implementation modules**
- Meta, X, LinkedIn, TikTok connectors
- Content calendar
- Key Inbox
- Analytics

**UI strategy**
- “Social Hub”: calendar, inbox, analytics, approvals.
- Post composer with AI suggestions and preview.
- DM/comment triage cards with reply drafts.
- Crisis keyword alert banner.

**Verification**
- 30 posts scheduled and published across platforms.
- 80% of routine DMs replied to by KEY with human approval flow.

---

### P-6. Email Marketer / Content Marketer

**Deconstructed duties**
- Campaign creation
- Segmentation
- Copywriting
- A/B testing
- Scheduling
- Performance analysis

**Core skills KEY can handle**
- Audience segmentation from CRM
- Subject line and body generation
- A/B variant creation
- Send-time optimization
- Open/click/revenue reporting

**Human retains**
- Campaign strategy
- Brand voice final approval
- Creative concept

**Implementation modules**
- Marketing controller
- CRM segments
- Email connector (Resend/SendGrid)
- Analytics

**UI strategy**
- “Campaign Builder”: goal, audience, content, schedule.
- AI-generated subject lines and body with variant picker.
- Performance dashboard with recommendations.

**Verification**
- End-to-end campaign created, sent, and reported.
- A/B test winner auto-selected and next campaign optimized.

---

### P-7. Operations Coordinator

**Deconstructed duties**
- Task assignment
- Progress tracking
- Reminder/escalation
- Vendor communication
- Status reporting
- Exception handling

**Core skills KEY can handle**
- Task creation from messages/meetings
- Assignment by workload/rules
- Deadline tracking
- Vendor email follow-ups
- Status dashboards

**Human retains**
- Vendor negotiation
- Complex exceptions
- Strategic process changes

**Implementation modules**
- Command queue
- Projects/tasks
- Key Inbox
- Vendor records

**UI strategy**
- “Operations Center”: tasks, vendors, alerts, reports.
- Exception cards requiring human decision.
- Automated status report builder.

**Verification**
- 100 tasks created and tracked with reminders and escalations.
- Vendor follow-up sequence runs without missing deadlines.

---

### P-8. Project Manager (Administrative)

**Deconstructed duties**
- Plan creation
- Schedule maintenance
- Resource allocation
- Status updates
- Risk identification
- Meeting facilitation

**Core skills KEY can handle**
- Gantt/timeline generation
- Dependency tracking
- Status report generation
- Risk flagging from delays
- Meeting notes → action items

**Human retains**
- Stakeholder negotiation
- Scope decisions
- Conflict resolution

**Implementation modules**
- Projects module
- Command queue
- Calendar
- Documents

**UI strategy**
- Project hub with timeline, risks, resources, status.
- “Generate status report” button.
- Risk alert cards with suggested mitigations.

**Verification**
- Multi-project dashboard updated automatically.
- Status reports generated weekly and emailed to stakeholders.

---

### P-9. Inventory Manager

**Deconstructed duties**
- Stock level monitoring
- Reorder point management
- Purchase order suggestions
- Cycle count coordination
- Dead stock identification
- Supplier reordering

**Core skills KEY can handle**
- Stock alerts
- Reorder suggestions
- PO creation
- Demand signals
- Reports

**Human retains**
- Supplier negotiation
- Physical counts
- Strategic SKU decisions

**Implementation modules**
- Inventory module
- Procurement
- Sales/forecasting
- Reports

**UI strategy**
- “Inventory Command Center”: stock levels, alerts, reorder queue.
- Reorder suggestion card with one-click PO.
- Dead stock report with markdown recommendations.

**Verification**
- Low-stock alert triggers PO suggestion accurately.
- Inventory reports reflect real stock movements.

---

### P-10. Procurement Buyer

**Deconstructed duties**
- Need identification
- Vendor selection
- Quote comparison
- Purchase order creation
- Order tracking
- Invoice matching

**Core skills KEY can handle**
- Reorder triggers
- Vendor quote requests
- Quote comparison tables
- PO creation and approval routing
- Delivery tracking

**Human retains**
- Vendor negotiation
- Strategic sourcing
- Complex contract decisions

**Implementation modules**
- Procurement
- Vendor management
- Inventory/forecasting
- Email connector

**UI strategy**
- “Procurement Hub”: requisitions, quotes, POs, deliveries.
- Quote comparison card.
- Approval workflow with spend thresholds.

**Verification**
- Requisition → quote request → PO → delivery tracked end-to-end.
- Invoice matched to PO and receipt.

---

### P-11. HR Administrator

**Deconstructed duties**
- Onboarding document collection
- Employee record maintenance
- Benefits enrollment coordination
- Leave tracking
- Policy distribution
- Offboarding checklists

**Core skills KEY can handle**
- Onboarding workflows
- Document collection and verification
- Leave balance tracking
- Policy acknowledgment
- Reminder sequences

**Human retains**
- Benefits advice
- Disciplinary actions
- Sensitive employee relations

**Implementation modules**
- Workflows
- Document storage
- Command queue
- Notifications

**UI strategy**
- “People Ops” dashboard: onboarding, offboarding, leave, documents.
- New hire checklist with automated reminders.
- Leave request card with balance and approver.

**Verification**
- New hire completes onboarding 100% via self-service.
- Leave request approved and balance updated.

---

### P-12. Recruiter (Sourcing/Screening)

**Deconstructed duties**
- Sourcing candidates
- Resume screening
- Initial outreach
- Interview scheduling
- Feedback collection
- Pipeline tracking

**Core skills KEY can handle**
- Resume parsing and scoring
- Sourcing from job boards/LinkedIn
- Outreach sequences
- Interview scheduling
- Feedback reminders

**Human retains**
- Interviews
- Final hiring decisions
- Offer negotiation

**Implementation modules**
- CRM/talent pipeline
- Email/LinkedIn connectors
- Calendar
- Document parser

**UI strategy**
- “Talent Pipeline” board with AI-ranked candidates.
- Resume match score and highlights.
- One-click outreach and scheduling.

**Verification**
- 100 resumes screened with accurate scoring.
- Interview scheduled without human coordination.

---

### P-13. IT Support Technician

**Deconstructed duties**
- Ticket triage
- Password resets
- Account provisioning
- Knowledge base search
- Escalation to engineering

**Core skills KEY can handle**
- Intent classification
- Password reset automation
- User provisioning/deprovisioning
- KB article suggestions
- Escalation routing

**Human retains**
- Hardware issues
- Security incidents
- Complex system failures

**Implementation modules**
- Key Inbox
- Identity/admin APIs
- Knowledge base
- Ticketing

**UI strategy**
- “IT Helpdesk” inbox with suggested fixes.
- User provisioning request card.
- Security incident escalation banner.

**Verification**
- 60% of tickets resolved via self-service or KEY automation.
- User provisioning completed in <2 minutes.

---

### P-14. Paralegal / Contract Analyst

**Deconstructed duties**
- Document review
- Contract abstraction
- Research
- Filing and organization
- Deadline tracking
- Compliance checks

**Core skills KEY can handle**
- Contract term extraction
- Clause comparison
- Renewal/deadline tracking
- Document organization
- Checklist generation

**Human retains**
- Legal interpretation
- Strategy
- Client advice

**Implementation modules**
- Document AI
- Contract registry
- Command queue
- Calendar

**UI strategy**
- “Contracts & Compliance” workspace.
- Clause extraction side-by-side view.
- Deadline alert cards.

**Verification**
- Contract uploaded → key terms extracted with ≥90% accuracy.
- Renewal alerts fire correctly.

---

### P-15. Medical Receptionist / Biller / Coder

**Deconstructed duties**
- Appointment scheduling
- Patient intake
- Insurance verification
- Coding
- Claim submission
- Payment posting
- Follow-up on denials

**Core skills KEY can handle**
- Appointment booking and reminders
- Digital intake forms
- Insurance eligibility checks
- Rule-based coding
- Claim submission
- Payment posting

**Human retains**
- Clinical judgment
- Complex coding appeals
- Patient counseling

**Implementation modules**
- Booking
- Forms
- Billing/claims connector
- Payments

**UI strategy**
- “Patient Coordination” dashboard: appointments, intake, claims.
- Claim status tracker with denial reason and suggested action.

**Verification**
- Patient books, completes intake, and claim submitted end-to-end.
- Denial follow-up queued correctly.

---

### P-16. Field Service Dispatcher / Coordinator

**Deconstructed duties**
- Job assignment
- Route optimization
- Parts ordering
- Customer notifications
- Technician schedule updates
- Billing coordination

**Core skills KEY can handle**
- Job-to-technician matching by skill/location/availability
- Route optimization
- Parts lookup and ordering
- ETA notifications
- Billing trigger after job completion

**Human retains**
- Emergency dispatch judgment
- Complex customer issues
- Field safety decisions

**Implementation modules**
- Scheduling
- Inventory/parts
- SMS/WhatsApp notifications
- Invoicing
- Maps/routing

**UI strategy**
- “Dispatch Board”: jobs, technicians, routes, status.
- Job card with suggested technician and ETA.
- Customer notification log.

**Verification**
- Job created → technician assigned → customer notified → invoice generated.

---

### P-17. E-commerce Manager

**Deconstructed duties**
- Product listings
- Inventory sync
- Order management
- Campaigns
- Pricing/promotions
- Reporting

**Core skills KEY can handle**
- Product listing generation
- Inventory sync across channels
- Order routing
- Promotion rules
- Sales reports
- Review response drafting

**Human retains**
- Brand strategy
- Supplier relationships
- Major pricing decisions

**Implementation modules**
- Storefront
- Inventory
- Orders
- Marketing
- Connectors (Shopify, etc.)

**UI strategy**
- “Commerce Command Center”: products, orders, campaigns, reviews.
- Product listing card with AI-generated title/description.
- Order exception queue.

**Verification**
- Product listed, order placed, inventory updated, invoice created end-to-end.

---

### P-18. Front Desk / Concierge

**Deconstructed duties**
- Greeting and check-in
- Appointment handling
- Recommendations
- Requests routing
- Local vendor coordination
- VIP handling

**Core skills KEY can handle**
- Digital check-in
- Appointment reminders
- Templated recommendations
- Request routing to staff
- Vendor booking

**Human retains**
- In-person hospitality
- Complex guest issues
- VIP discretion

**Implementation modules**
- Booking
- Key Inbox
- Vendor/partner directory
- Notifications

**UI strategy**
- “Guest Services” dashboard: arrivals, requests, recommendations.
- Guest request card with suggested action.
- Concierge chat widget.

**Verification**
- Guest requests restaurant reservation → KEY books and confirms.

---

### P-19. Restaurant Manager (Back Office)

**Deconstructed duties**
- Scheduling
- Inventory ordering
- Vendor payments
- Reporting
- Reservation management
- Customer feedback

**Core skills KEY can handle**
- Staff scheduling
- Inventory reorder alerts
- Vendor invoice payment
- Daily P&L reports
- Reservation book
- Feedback analysis

**Human retains**
- Floor leadership
- Menu decisions
- Staff management

**Implementation modules**
- Scheduling
- Inventory/procurement
- Finance
- Bookings
- Feedback

**UI strategy**
- “Restaurant Back Office”: schedule, inventory, reservations, daily report.
- Low-stock alert with suggested order.
- Daily summary card.

**Verification**
- Week schedule auto-generated and published.
- Daily sales and labor report generated automatically.

---

### P-20. UX Designer / Technical Writer / QA Engineer

**Deconstructed duties**
- Wireframes/mockups
- Documentation
- Test cases
- Bug reports
- Design system maintenance
- User feedback synthesis

**Core skills KEY can handle**
- Wireframe generation from requirements
- First-draft documentation
- Test case generation
- Bug report templating
- Design system consistency checks
- Feedback summarization

**Human retains**
- Final UX judgment
- Creative direction
- Exploratory testing

**Implementation modules**
- Design tool integrations (Figma)
- Document generator
- Test runner
- Feedback collector

**UI strategy**
- “Product Ops” workspace: requirements, drafts, tests, feedback.
- “Generate test cases” button on user story.
- Documentation draft editor with AI suggestions.

**Verification**
- User story → wireframe draft + test cases generated.
- Documentation draft exported and reviewed.

---

## Cross-Cutting UI Principles

1. **Role-based workspaces** — Each premium service gets a focused page, not a generic list.
2. **Confidence scoring** — Show KEY’s confidence and make approval one click.
3. **Context sidebars** — Customer 360, vendor 360, employee 360, project 360.
4. **Voice + chat command** — “KEY, invoice Acme for $500” should work everywhere.
5. **Mobile-first capture** — Receipts, business cards, time entries, and approvals must work on phone.
6. **Approval centers** — Centralized queue for items KEY is unsure about or above risk tier.
7. **Audit and undo** — Every automated action is logged and reversible.

---

## Implementation Sequence Recommendation

### Phase 1 — Close R-role trust gaps (4–6 weeks)
- Unified ingestion queue
- Safety shell wired
- Webhook signature enforcement
- Genome enum fix
- Calendar/communications rollback

### Phase 2 — Launch premium R-role services (6–8 weeks)
- Data Inbox premium
- AR autopilot
- Meeting scheduler + notetaker
- Expense report autopilot
- Contract admin + vendor onboarding

### Phase 3 — High-yield P-role automation (8–12 weeks)
- Executive Assistant dashboard
- Bookkeeper workspace
- SDR outreach engine
- L1/L2 support inbox
- Social media hub

### Phase 4 — Scale P-role coverage (12–18 weeks)
- Operations / project / inventory automation
- HR / recruiting workflows
- Field service dispatch
- E-commerce command center
- Medical billing/reception

---

## Conclusion

The R roles represent a near-term product line: **premium automation services** that can be sold as “KEY handles this for you.” The P roles represent a mid-term expansion: **AI-assisted workbenches** that make every knowledge worker significantly more productive. The engineering priority should be to make the R roles bulletproof first, then build the top 10 P-role workbenches into the Command Center experience.
