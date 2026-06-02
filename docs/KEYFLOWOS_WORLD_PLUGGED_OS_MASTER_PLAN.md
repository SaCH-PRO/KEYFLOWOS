# KEYFLOWOS — World Plugged OS Master Plan

**Version:** 1.0  
**Branch:** `develop`  
**Purpose:** Single merged implementation plan for evolving KEYFLOWOS into a seamless, modern, device-native, omnichannel, AI-assisted business operating system.

---

## 0. Absolute Product Vision

KEYFLOWOS must become the system that lets a person **plug their business into their real world**.

The app connects:

- the business owner
- their phone/device, camera, voice
- WhatsApp, normal phone/calls, email
- Google Workspace, Drive/Docs/Sheets/Forms, Calendar
- files/documents, storefront, invoices/payments
- customers, social platforms, public presence
- team, operations, accounting/finance
- reviews/referrals, business community/network

KEY acts as the intelligent worker across all of that:

> observe → listen → read → classify → understand → link → ask → plan → draft → execute safely → request approval → notify → log → learn → improve

The product should feel like: *"My business is connected to my world. KEYFLOWOS sees what matters, understands it, and helps me act."*

---

## 1. Non-Negotiable User Experience Rule

Internally the system has capability layers (manual, deterministic, AI, omnichannel, device-native, growth, admin), but the user must **never** be overtly exposed to those as product tiers.

**Do not show:** Manual OS, Hardwired OS, AI Tier, Omnichannel Tier, Device Tier, Tier 1/2/3.

**The user sees one seamless product:**

- Cockpit
- Contacts
- Commerce
- Calendar
- Storefront
- KEY
- Settings
- Capture
- Inbox
- Connect
- Approvals
- Today’s priorities
- Money actions
- Follow-ups
- Risks
- Opportunities
- Let KEY handle this

---

## 2. Refreshed Repo Assessment

### 2.1 Current branch
- Default: `develop`
- Recent: AI-native OS overhaul, feature flags, Drive sync, Stripe flows, Google Maps removal, Commerce consolidation

### 2.2 Backend breadth
`AppModule` already loads 40+ modules including Identity, CRM, Catalog, Commerce, Bookings, Social, Automation, Site, AI, Flow, Timeline, Gamification, Webhooks, API Keys, Actions, Uploads, Autopilot, Notifications, Payments, Subscriptions, Projects, Expenses, Finance, Reports, Email Marketing, Lead Forms, Templates, Education, Community, Marketplace, Procurement, Supplier, Momentum, Onboarding Concierge, Documents, Google Drive, Diagnostics, Communications, WhatsApp, Connector, Keyflow Command, Connect, SEO, Growth Intelligence, Feature Flags, Blueprint, Calendar, Public Events.

### 2.3 Primary navigation
Keep the approved seven:
- Cockpit
- Contacts
- Commerce
- Calendar
- Storefront
- KEY
- Settings

Secondary modules live under **More**, contextual links, command surfaces, or settings.

### 2.4 Connect foundation
`ConnectModule` already includes Google Forms, Google Contacts Sync, Google Business Profile, Connector Form Mapping, Outlook Contacts Sync, Contact Sync, Signature Parser, Microsoft OAuth.

### 2.5 Uploads foundation
`UploadsController` supports presigned uploads (images, PDFs, CSV, Excel, vCard) with 10MB limit. Needs business-scoping, media-record backing, vision-analysis, audio/video, KEY-connection, timeline-logging, command-generation.

### 2.6 WhatsApp foundation
WhatsApp controller supports connection status, conversations, templates, send/schedule messages, inbound webhook with HMAC verification, phone-to-business resolution. Seed of KEY as omnichannel secretary.

---

## 3. Final Product Structure

### 3.1 Conceptual dimensions

| Dimension | Modules |
|---|---|
| Money | Commerce, Finance, Payments, Reports |
| Time | Calendar, Bookings, Tasks, Deadlines |
| People | Contacts, Inbox, WhatsApp, Email, CRM |
| Work | Projects, Operations, Automations, Procurement |
| Presence | Storefront, Site, Google Business Profile, Social |
| Knowledge | Documents, Drive, Docs, Sheets, Forms, Notes |
| Network | Reviews, Referrals, Community, Vendors, Partners |
| Governance | Approvals, Permissions, Audit, KEY Safety |

KEY sits across all of them.

---

## 4. Global Interface System

Every main page follows:

```
Page Header
├── module name + business-outcome subtitle
├── primary action + Capture button + Ask KEY

Business Pulse Strip
├── 4–6 critical metrics, warnings, trends, setup state

Command / Action Zone
├── today’s actions, approvals, KEY suggestions, risks/opportunities

Main Workspace
├── records / board / builder / calendar / inbox / report

Context Rail
├── timeline, related records, notes, KEY insight, automation coverage
```

Premium, calm, uncluttered, business-outcome oriented. Avoid generic dashboard sprawl.

---

## 5. Semantic Navigation and Breadcrumbs

Upgrade origin-aware breadcrumbs into **semantic business breadcrumbs**.

Breadcrumbs answer:
- Where am I?
- How did I get here?
- What business object am I viewing?
- What is connected to it?
- How do I return to the workflow?
- What is the next related surface?

**Examples:**
- Cockpit › Money actions › Invoice INV-1021 › Sarah Ali
- Contacts › Sarah Ali › Quotes › Quote Q-884
- Calendar › This Week › Booking: Consultation with Raj
- Inbox › WhatsApp › Sarah Ali › Booking request
- Capture › Business Card › Daniel Ramkissoon

---

## 6. Universal Business Object Traceability

Every important object has a traceable business map connecting to:

Contact, Conversation, Messages, Calls, Emails, Files, Timeline, Command items, Quotes, Invoices, Payments, Bookings, Tasks, Projects, KEY recommendations, Approvals, Audit log.

**BusinessObjectDrawer tabs:**
- Overview
- Timeline
- People
- Money
- Time
- Work
- Files
- Messages
- KEY
- Audit

---

## 7. Persistent Command Spine

Command items are generated from:
- overdue invoices, stale leads, new messages, missed calls, new emails
- new form responses, receipt captures, business card captures
- quote follow-up, booking reminders, storefront readiness gaps
- tax due dates, uncategorized expenses, integration failures
- KEY recommendations, admin product insights

**Command card shows:** title, why it matters, linked record, expected impact, urgency, risk, due date, KEY can handle?, approval required?, primary action, ask KEY, snooze/dismiss.

---

## 8. Business Blueprint as Runtime Brain

Blueprint drives: onboarding, recommended modules, rule thresholds, KEY tone, KEY autonomy, financial buffers, business type templates, default workflows, capture interpretation, service suggestions, storefront defaults, outreach style, business hours, escalation rules, voice style.

**Templates:** clinic, service_business, consultant, agency, contractor, retail_service_hybrid, education_tutor, wellness_beauty, professional_services.

---

## 9. KEY as AI Business Worker

**Modes:** Ask, Plan, Draft, Do, Auto, Capture, Voice

**Responsibilities:** answer questions, summarize, identify risks/opportunities, draft messages, create tasks, prepare quotes/invoices, summarize calls, interpret photos, analyze documents, suggest packages, follow up leads, request reviews, create commands, ask for approval, execute low-risk actions, monitor outcomes.

**Governance:** Every tool declares `ToolRisk` (tier, category, requiresApproval, reversible). User-facing labels: Safe, Needs review, Approval required, Owner approval required, Blocked.

---

## 10. Device-Native Capture Layer

**Capture menu:**
- Take photo
- Upload image/file
- Scan business card
- Scan receipt
- Scan document
- Scan product/inventory
- Record voice note
- Talk to KEY
- Choose from library

**Flows:**
- Business card → extract fields → match/create contact → draft follow-up → create command/timeline
- Receipt → extract merchant/date/tax/total → create expense draft → suggest category → timeline
- Document → classify → summarize → extract obligations → create deadlines → attach to contact/project
- Product → identify label/barcode → create product draft → update inventory → suggest storefront listing

---

## 11. Voice KEY

**Voice modes:** Push-to-talk, Voice note, Live conversation, Read-aloud, Hands-free review

**User can say:**
- "KEY, what should I do today?"
- "KEY, take this receipt and add it as an expense."
- "KEY, follow up with the person from this card tomorrow."
- "KEY, draft a package for this lead."
- "KEY, summarize the WhatsApp conversation with Sarah."

**Voice presets:** Professional, Warm, Concise, Energetic, Calm, Front-desk assistant, Sales assistant.

---

## 12. Omnichannel Business Nervous System

**Channels:** WhatsApp, SMS, calls, voicemail, email, Google Forms, Typeform/Jotform, Drive, Docs, Sheets, Calendar, Facebook, Messenger, Instagram, TikTok, Google Business Profile, Storefront, Payment links, Booking links.

**Ingestion pipeline:**
```
Channel webhook/sync → Normalize → Identity resolution → Link/create contact
→ Classify intent → Build business context → Score profit/risk
→ Create command item → KEY draft/action → approval if needed
→ timeline → notification
```

**Unified Inbox at `/app/inbox`:**
Views: All, Needs reply, New leads, Bookings, Payments, Complaints, Reviews, Missed calls, Email, WhatsApp, Instagram, Messenger, Forms.

---

## 13. Profit-Trajectory Engine

KEY routes interactions toward the best business outcome:
- collect payment, book appointment, send quote, send invoice
- retain customer, solve complaint, request review, generate referral
- upsell/cross-sell, reduce admin time, escalate to human, archive/spam

**Score components:** revenue potential + conversion probability + lifetime value + urgency + margin quality + retention value + referral potential - risk - time cost - compliance sensitivity.

---

## 14. Integration Hub and Plug-In Ecosystem

**Integration Hub at `/app/connect`:**
- Recommended for your business
- Connected apps / Needs attention
- Customer sources, Payment sources, Calendar sources, Marketing sources
- Files and documents, Automation bridges, Developer/API

**First-class providers:** Google Contacts, Outlook Contacts, Gmail, Outlook Mail, Google Calendar, Google Drive, Google Docs, Google Sheets, Google Forms, WhatsApp, Facebook, Instagram, Messenger, Google Business Profile, Stripe, WiPay, Zapier/Make, Typeform/Jotform, TikTok, Twilio.

---

## 15. Passive Network and Community Growth

**Growth loops:**
- Storefront → visitor → lead/order/booking → review → referral
- Invoice → payment → book again/referral prompt
- Booking completed → review request → public trust
- Happy customer → referral command
- Vendor relationship → partner opportunity
- Google review → reply/post → local trust

---

## 16. Marketing-Genius UI Layer

**Success feedback:**
- "Invoice sent. This added TTD 2,400 to your collection pipeline."
- "Follow-up created. This lead is now protected from going cold."
- "Storefront published. Customers can now book or buy from your public page."

**Outcome-based empty states:**
- Bad: "No contacts."
- Better: "Your customer list is empty. Import contacts or scan a business card so KEY can help you follow up, sell, and build relationships."

---

## 17. Admin Intelligence and Product Self-Improvement

**Admin route:** `/app/admin` (role-gated)

**Sections:** Overview, Users & Businesses, Activation, Feature Usage, Command Analytics, KEY Quality, Integration Health, Feedback Inbox, Support Signals, Experiments, Release Impact, Churn Risk, Growth Loops, Product Roadmap Insights, System Health.

**Feedback widgets on:** KEY responses, command cards, capture review, inbox responses, onboarding steps, failed integrations, reports, storefront builder, invoice/quote builder.

---

## 18. Security, Privacy, Consent, and Governance

**Critical rules:**
- Never send customer-facing messages without permission unless autopilot is explicitly enabled.
- Never auto-post financial/legal/medical/high-stakes responses.
- Never secretly record calls.
- Always track consent for calls, messages, marketing, recording, transcription.
- Always log KEY actions.
- Always allow users to inspect/revoke KEY permissions.
- Always business-scope private data.
- Always require approval for risky/financial/destructive actions.

**Sensitive capture handling:** Detect IDs, bank cards, legal/medical documents, private messages, children, financial statements, contracts. Require explicit review, restricted retention, no auto-send, audit log, privacy warning.

---

## 19. Backend Modules

**Add:** CommandModule, IntelligenceModule, DeviceModule, OmnichannelModule, IntegrationHubModule, NetworkModule, AdminIntelligenceModule.

**Refactor/extend:** UploadsModule, ConnectModule, WhatsAppModule, AI/KeyCommand, TimelineModule, BlueprintModule, NotificationsModule, GrowthIntelligenceModule.

---

## 20. Frontend Components

**Key components to add:**
- CaptureButton, CaptureSheet, CameraCapture, UploadDropzone
- VisualAnalysisSheet, ExtractedFieldsEditor, SuggestedActionsList
- VoiceOrb, VoiceSessionPanel, KeyVoiceSelector
- CommandQueue, BusinessObjectDrawer, SemanticBreadcrumbs
- OmnichannelInbox, ThreadDetail, ResponseDraftPanel
- IntegrationHub, IntegrationCard, IntegrationHealthPanel
- AdminInsightDashboard, FeedbackWidget

---

## 21. Implementation Phases

| Phase | Focus | Status |
|---|---|---|
| 0 | Baseline, docs, confirm no tier language | ✅ Done |
| 1 | Command Spine (model/service/controller/UI) | ✅ Done |
| 2 | Device Capture MVP (MediaAsset, VisualIntake, ExtractedEntity, Voice) | 🔄 In Progress |
| 3 | Omnichannel MVP (ChannelAccount, Thread, Message, Draft, Consent, Inbox) | ✅ Backend Done |
| 4 | Email and Google Workspace ingestion | ⏳ Pending |
| 5 | Phone/Voice Secretary (CallLog, transcripts, summaries) | ⏳ Pending |
| 6 | Social and Presence (FB/IG/GBP/TikTok) | ⏳ Pending |
| 7 | Integration Hub marketplace + health | ✅ Backend Done |
| 8 | Network/Growth Loops | ⏳ Pending |
| 9 | Admin Intelligence (events, feedback, quality, roadmap) | ✅ Backend Done |
| 10 | Polish: mobile-first, breadcrumbs, drawer, accessibility, tests | ⏳ Pending |

---

## 22. First Kimi Sprint — Exact Tasks

1. Refresh repo and run baseline build.
2. Create this master plan doc.
3. Add MediaAsset, VisualIntake, ExtractedEntity, VoiceSession, KeyVoicePreference.
4. Create DeviceModule.
5. Add business-scoped media upload endpoint.
6. Add CaptureButton and CaptureSheet to Cockpit and KEY.
7. Implement mobile camera capture using `capture="environment"`.
8. Add VisualIntake creation after upload.
9. Implement deterministic/mock business-card classifier.
10. Add extracted fields editor.
11. Create contact from extracted business card.
12. Create follow-up command item and timeline event.
13. Add VoiceOrb and browser speech synthesis fallback.
14. Extend WhatsApp inbound webhook to create ConversationThread and CommunicationMessage.
15. Add IdentityResolutionService for phone/email/contact matching.
16. Add InteractionClassifierService with deterministic rules.
17. Add ProfitTrajectoryService.
18. Create command item from inbound WhatsApp message.
19. Add unified Inbox shell.
20. Add response draft panel with approval gate.
21. Run tests/build.

---

## 23. Acceptance Criteria

The full implementation succeeds when:

- A user can manually run their business.
- A user can capture real-world objects with their phone.
- KEY can analyze a business card and create a contact/follow-up.
- KEY can analyze receipts/documents/products.
- A user can speak to KEY.
- KEY can speak back with selectable voice.
- WhatsApp messages become business events.
- Emails become business events.
- Calls/missed calls become business events where connected.
- Google Drive/Forms/Docs/Sheets become business inputs.
- Social messages/comments/leads can become contacts/commands.
- Every interaction links to contacts/money/time/work where possible.
- Every KEY action is logged.
- Risky actions require approval.
- The unified Inbox shows all business communications.
- Cockpit shows money/time/people/inbox/capture priorities.
- Connect shows app health and integrations.
- Admin can see user feedback, usage, KEY quality, and growth loops.
- The app learns from user behavior and improves.
- The user feels their business is plugged into their world.

---

## 24. Final Experience Examples

### Business card
User takes photo of call card. KEY extracts name, phone, email, company. Asks to create contact. User says yes. KEY asks to send follow-up. User says: "Offer clinic maintenance package." KEY drafts email/WhatsApp. User approves. Contact, command, draft, and timeline are created.

### WhatsApp inquiry
New WhatsApp: "How much for consultation Friday?" KEY links/creates contact. Checks service price and calendar. Drafts reply with availability. Asks approval or sends if safe autopilot enabled. Booking command created. Timeline updated.

### Missed call
Missed call from unknown number. KEY creates contact candidate. Drafts callback message. Creates follow-up command. User taps approve.

### Receipt
User scans receipt. KEY extracts merchant/date/total/tax. Creates expense draft and suggests category. User confirms. Finance and timeline update.

### Admin intelligence
Many users reject KEY invoice reminders as too formal. Admin insight generated: "Invoice reminder tone is too formal for service businesses." Product team receives roadmap insight. KEY tone settings improved.

---

## 25. Final Product Standard

KEYFLOWOS should become:

- The business owner’s command center.
- The business owner’s secretary.
- The business owner’s capture tool.
- The business owner’s inbox.
- The business owner’s financial flow.
- The business owner’s calendar.
- The business owner’s CRM.
- The business owner’s storefront.
- The business owner’s integration hub.
- The business owner’s growth network.
- The product team’s self-improving intelligence platform.

Every channel, device, customer, file, message, call, invoice, booking, and task should feed the operating system. KEY should convert that context into clarity, action, profit-positive next steps, repeatable workflows, and traceable outcomes.
