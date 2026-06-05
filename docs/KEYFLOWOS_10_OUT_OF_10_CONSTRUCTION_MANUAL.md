# KEYFLOWOS 10/10 Launch Readiness Construction Manual for KimiCode
## Authoritative Product, Architecture, UI, Backend, AI, Automation, Device, Omnichannel, QA, and Launch Plan

**Target repo:** `SaCH-PRO/KEYFLOWOS`  
**Target branch:** `develop` or the active working branch selected by the owner  
**Audience:** KimiCode  
**Purpose:** This is the authoritative construction manual for taking KEYFLOWOS from its current strong but incomplete platform state to a true 10/10 launch-ready Business Operating System.

---

# 0. Executive Instruction to KimiCode

KimiCode: treat this document as the **new source of truth**.

Do not treat this as a small cleanup task. Do not only patch around existing screens. Do not preserve old code patterns if they block the product from becoming excellent.

The goal is a **major product overhaul** into a 10/10 business-running operating system.

You are allowed to:

```text
refactor deeply
replace weak components
delete obsolete duplicated code
consolidate fragmented queues
rewrite poor UI layouts
move routes
rename user-facing labels
create new backend modules
create migrations
replace shallow automation logic
replace placeholder cards
create better abstractions
add tests
add seed templates
change architecture where necessary
```

But you must not leave the app broken at the end of a phase.

Every phase must end with:

```bash
pnpm --filter db run db:generate
pnpm --filter server build
pnpm --filter web build
pnpm lint
pnpm build
```

If full build is temporarily impossible because of existing unrelated breakage, document the exact failure, fix it if reasonable, and do not mark the phase complete until the app can run.

This is not a "maintain the old cooler" task. This is a **business operating system overhaul**. Preserve what is strong. Replace what is weak.

---

# 1. Final Product Vision

KEYFLOWOS must become:

```text
A business owner's command center.
A business owner's secretary.
A business owner's CRM.
A business owner's commerce engine.
A business owner's financial flow.
A business owner's calendar and time system.
A business owner's storefront.
A business owner's automation/bot/flow builder.
A business owner's omnichannel inbox.
A business owner's device-native capture assistant.
A business owner's integration hub.
A business owner's growth network.
A business owner's AI worker.
```

The app should let a business owner plug their business into their real world:

```text
phone/device
camera
microphone
voice
WhatsApp
email
normal phone/calls where technically possible
Google Drive
Google Docs
Google Sheets
Google Forms
Google Calendar
Facebook
Instagram
Messenger
TikTok
Google Business Profile
payments
invoices
bookings
documents
storefront
CRM
social posts
reviews
referrals
automations
reports
admin insights
```

KEY should be able to:

```text
observe
listen
read
classify
understand
connect records
ask clarifying questions
plan
draft
execute safe actions
request approval for risky actions
notify
log
learn
improve
measure outcomes
```

The final product experience:

> "I open KEYFLOWOS and I can see, control, automate, and grow my whole business from one intelligent operating system."

---

# 2. Non-Negotiable User Experience Rule

The user must not see internal architecture tiers.

Do not expose terms like:

```text
Manual OS
Hardwired OS
AI Tier
Omnichannel Tier
Device Tier
Tier 1 / Tier 2 / Tier 3
```

The user-facing app should feel simple:

```text
Cockpit
Contacts
Commerce
Calendar
Storefront
KEY
Settings
Inbox
Connect
Capture
Flows
Approvals
Reports
Finance
```

Use user language:

```text
Today's priorities
Money to collect
Follow-ups due
Needs attention
KEY noticed
Let KEY handle this
Draft reply
Approve action
Business pulse
Capture something
Connect your apps
Build a flow
```

The internal implementation can be complex. The user experience must be clean.

---

# 3. Current App Assessment vs 10/10 Target

This table defines where KEYFLOWOS is now versus where it must be before launch.

| Area | Current state | Current score | 10/10 target | Required work |
|---|---|---:|---|---|
| Core platform breadth | Many modules already exist: CRM, Commerce, Calendar, AI, Finance, Storefront, Social, Connect, Uploads, WhatsApp, Reports, etc. | 8/10 | Modules feel like one connected OS, not scattered features. | Add universal command spine, semantic breadcrumbs, object traceability, shared layout grammar. |
| Navigation | Seven primary modules exist and are correct. | 8/10 | Navigation is simple, contextual, semantic, and traceable. | Add semantic route registry, return-to-origin, object-aware breadcrumbs. |
| Cockpit | Strong operator dashboard but risks widget sprawl. | 7/10 | User can run the day from Cockpit. | Rebuild into Business Pulse, Command Queue, KEY actions, approvals, money/time/people snapshots. |
| Finance OS | FIN8 action queue and tax/accountant export are strong. | 8/10 | Full money command center with safe-to-spend, forecasts, tax, accountant export, receivables, payables, command actions. | Generalize FinanceActionItem into CommandItem, add cashflow forecasting, unify with Cockpit. |
| Storefront / Presence | Strong section system, preview/publish, analytics, public directory. | 7.5/10 | Storefront becomes public revenue machine. | Add conversion checklist, readiness score, visual page map, review/referral loops. |
| Public analytics / attribution | Public event tracking and visitor-contact backstitching exist. | 8/10 | Full growth attribution and customer journey intelligence. | Add dashboards, source ROI, referral attribution, conversion flows. |
| Social publishing | Facebook/Instagram per-page destination support added. | 7/10 | Cross-channel social command center. | Add Meta/IG/Messenger comments/DM ingestion, TikTok planning, post analytics, KEY content agent. |
| KEY backend | Strong AI services, governance, tool registry, memory foundations. | 7/10 | KEY feels like a real AI employee. | Add employee interface, work history, memory editor, approvals, voice UI, agent builder. |
| Voice KEY | Backend TTS/transcription exists. | 5/10 | User can speak with KEY naturally and choose voice. | Add VoiceOrb, voice sessions, selectable voice UI, push-to-talk/live conversation, voice governance. |
| Automation | Playbooks exist but shallow. | 4.5/10 | ManyChat/GoHighLevel/Zapier/Make/n8n-style business-aware Flow Studio. | Add AutomationFlow, FlowVersion, FlowRun, FlowTemplate, BotAgent, AgentBuilder, outcome analytics. |
| Omnichannel inbox | WhatsApp and Connect foundations exist. | 3/10 | Unified inbox for WhatsApp/email/calls/social/forms. | Add ChannelAccount, ConversationThread, CommunicationMessage, ResponseDraft, ConsentRecord. |
| Device capture | Basic uploads exist. | 2/10 | Camera/mic/upload capture-anything system. | Add MediaAsset, VisualIntake, ExtractedEntity, CaptureButton, scanners, KEY visual analysis. |
| Command spine | Multiple action queues exist but fragmented. | 3.5/10 | One universal business command system. | Add CommandItem and migrate/mirror FinanceActionItem, RevenueAction, Presence actions, KEY recommendations. |
| Integrations | Connect is promising. | 6.5/10 | Integration Hub and plugin marketplace. | Add IntegrationProvider, IntegrationConnection, SyncRun, health, recipes, app-triggered flows. |
| Admin intelligence | Early/limited. | 3/10 | Product self-improvement backend. | Add ProductEvent, UserFeedback, AiQualitySignal, RoadmapInsight, admin dashboards. |
| UI/design | Many strong pieces, but inconsistent density. | 6.5/10 | Premium, calm, highly navigable, mobile-first, modern design system. | Create design manual, common layout components, responsive shell, empty/success states. |
| QA/security | Mixed. | 5.5/10 | Launch-grade testing, guards, audit, consent, monitoring. | Add tests, risk gates, permission audit, security checks, logging, error queues. |

Target before launch:

```text
Every area must be at least 9/10.
Core areas must be 10/10:
- Command spine
- Finance
- Omnichannel
- KEY
- Automation
- Capture
- UI/navigation
- Governance
```

---

# 4. Target Architecture Map

## 4.1 Global architecture

```text
External World
├── WhatsApp
├── Email
├── Calls
├── Social DMs/comments
├── Forms
├── Drive/Docs/Sheets
├── Payments
├── Storefront
├── Device camera/mic/uploads
└── Webhooks/APIs

        ↓

Ingestion Layer
├── Connectors
├── Webhooks
├── Sync jobs
├── Upload pipeline
├── Voice pipeline
└── Public event tracker

        ↓

Normalization Layer
├── BusinessEvent
├── CommunicationMessage
├── MediaAsset
├── PublicVisitorEvent
├── ExternalObjectMap
└── Timeline event

        ↓

Context Layer
├── BusinessBlueprint
├── BusinessGraph
├── Contact profile
├── Money records
├── Calendar availability
├── Documents/files
├── Prior conversations
├── KEY memory
└── Governance rules

        ↓

Decision Layer
├── Rules engine
├── Finance intelligence
├── Profit trajectory engine
├── Flow engine
├── KEY agent planner
└── Risk classifier

        ↓

Execution Layer
├── CommandItem
├── ResponseDraft
├── Approval request
├── Task
├── Quote/invoice
├── Booking
├── Message/email/social post
├── Document
└── Notification

        ↓

Outcome Layer
├── Timeline
├── FlowRun
├── AutomationOutcome
├── Reports
├── Admin insights
└── Learning loop
```

## 4.2 User-facing navigation

Primary:

```text
Cockpit
Contacts
Commerce
Calendar
Storefront
KEY
Settings
```

Secondary/contextual:

```text
Finance
Inbox
Connect
Flows
Capture
Reports
Operations
Approvals
Documents
Admin
```

Do not overload the primary nav.

---

# 5. Design System Manual

## 5.1 Visual personality

The UI must feel:

```text
premium
calm
confident
operational
modern
financially aware
relationship-aware
fast
spacious
mobile-first
trustworthy
```

Avoid:

```text
clutter
random widgets
noisy gradients
unclear acronyms
generic dashboard layouts
too many equal nav items
exposing internal architecture terms
```

## 5.2 Layout grammar for every module

Every major page should use:

```text
ModuleHeader
BusinessPulseStrip
CommandZone
MainWorkspace
ContextRail
Timeline/Activity Drawer
KEY Assistance Panel
```

### Standard page layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Module Header: name, purpose, primary action, Capture, KEY    │
├──────────────────────────────────────────────────────────────┤
│ Business Pulse Strip: 4–6 metrics / warnings / trends         │
├───────────────────────────────┬──────────────────────────────┤
│ Main Workspace                 │ Context Rail                 │
│ table/board/calendar/builder   │ KEY, timeline, related data  │
├───────────────────────────────┴──────────────────────────────┤
│ Command Queue / Approvals / Suggested Actions                 │
└──────────────────────────────────────────────────────────────┘
```

## 5.3 Universal components to create

```text
ModuleHeader
BusinessPulseStrip
CommandQueue
CommandItemCard
SemanticBreadcrumbs
ReturnToOriginButton
BusinessObjectDrawer
RelatedRecordsPanel
TimelinePanel
KeySuggestionPanel
HealthScoreCard
RiskOpportunityPanel
EvidenceChip
ImpactBadge
ApprovalPreviewCard
CaptureButton
CaptureSheet
VoiceOrb
IntegrationHealthCard
FlowRunTimeline
```

## 5.4 Color and status rules

Use consistent semantic colors:

```text
green  = healthy/completed/paid
amber  = warning/needs attention
red    = critical/overdue/risk
blue   = information/KEY suggestion
purple = automation/flow
teal   = growth/opportunity
neutral = passive/inactive
```

Do not use color alone. Always include text labels and icons.

## 5.5 Empty state rules

Every empty state must answer:

```text
What is empty?
Why does it matter?
What should the user do next?
Can KEY help?
```

Example:

```text
No contacts yet.
Import contacts, scan a business card, or connect Google Contacts so KEY can help you follow up, sell, and build relationships.
[Import contacts] [Scan card] [Ask KEY]
```

## 5.6 Success state rules

Every completed action should reinforce business value.

Examples:

```text
Invoice sent. TTD 2,400 is now in your collection pipeline.
Contact created. KEY can now help you follow up and convert this relationship.
Storefront published. Customers can now book or buy from your public page.
Receipt saved. Your expense records are cleaner for reporting and tax.
```

## 5.7 Mobile principles

Mobile must prioritize:

```text
Today's actions
Messages needing reply
Money alerts
Bookings
Capture
Voice KEY
Approvals
```

Mobile bottom nav:

```text
Cockpit
Inbox
Capture
KEY
More
```

or preserve current with a central Capture/KEY action if already standardized.

---

# 6. Semantic Breadcrumb and Traceability Manual

## 6.1 Add SemanticRoute registry

```ts
type SemanticRoute = {
  pathPattern: string;
  workspace:
    | 'Cockpit'
    | 'Contacts'
    | 'Commerce'
    | 'Calendar'
    | 'Storefront'
    | 'KEY'
    | 'Finance'
    | 'Inbox'
    | 'Connect'
    | 'Flows'
    | 'Reports'
    | 'Settings'
    | 'Admin';
  objectType?:
    | 'contact'
    | 'invoice'
    | 'quote'
    | 'payment'
    | 'booking'
    | 'message'
    | 'call'
    | 'document'
    | 'media'
    | 'flow'
    | 'command'
    | 'approval'
    | 'storefront';
  labelResolver?: (params: Record<string, string>) => Promise<string>;
  parentResolver?: (params: Record<string, string>) => Promise<BreadcrumbNode[]>;
  relatedActions?: BreadcrumbAction[];
};
```

## 6.2 Examples

```text
Cockpit › Money actions › Invoice INV-1021 › Sarah Ali
Contacts › Sarah Ali › WhatsApp › Booking request
Commerce › Invoices › INV-1021 › Payment reminders
Calendar › This Week › Booking: Consultation
Storefront › Launch Checklist › Payments
KEY › Approvals › Send invoice reminder
Capture › Business Card › Daniel Ramkissoon
Flows › Templates › Missed Call Text-Back
Inbox › Instagram › New lead inquiry
```

## 6.3 Traceability standard

Every record should answer:

```text
What is this?
Who is connected?
What money is attached?
What time/deadline is attached?
What messages/calls/files are attached?
What happened before?
What should happen next?
Can KEY help?
What was automated?
What needs approval?
```

---

# 7. Universal Command Spine

## 7.1 Why this is critical

Current app has multiple queues:

```text
FinanceActionItem
RevenueAction
Presence action cards
Automation playbook actions
KEY recommendations
Notifications
Approvals
```

This must become one universal command system.

## 7.2 Add CommandItem model

```prisma
model CommandItem {
  id                String    @id @default(cuid())
  businessId        String    @map("business_id")
  sourceModule      String    @map("source_module")
  sourceType        String?   @map("source_type")
  sourceId          String?   @map("source_id")

  entityType        String?   @map("entity_type")
  entityId          String?   @map("entity_id")
  contactId         String?   @map("contact_id")

  title             String
  description       String?
  actionType        String    @map("action_type")

  status            String    @default("OPEN")
  priority          String    @default("NORMAL")
  urgencyScore      Int       @default(50) @map("urgency_score")
  impactScore       Int       @default(50) @map("impact_score")
  confidenceScore   Int?      @map("confidence_score")

  expectedValue     Decimal?  @db.Decimal(18, 4) @map("expected_value")
  currency          String?   @default("TTD")
  dueAt             DateTime? @map("due_at")
  snoozedUntil      DateTime? @map("snoozed_until")

  ownerType         String?   @map("owner_type")
  ownerId           String?   @map("owner_id")
  recommendedBy     String?   @map("recommended_by")

  executableByKey   Boolean   @default(false) @map("executable_by_key")
  requiresApproval  Boolean   @default(false) @map("requires_approval")
  riskTier          Int       @default(1) @map("risk_tier")
  toolName          String?   @map("tool_name")
  executionPayload  Json?     @map("execution_payload")

  data              Json      @default("{}")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")
  completedAt       DateTime? @map("completed_at")
  dismissedAt       DateTime? @map("dismissed_at")

  @@index([businessId, status, priority])
  @@index([businessId, sourceModule, status])
  @@index([businessId, dueAt])
  @@index([businessId, entityType, entityId])
  @@index([businessId, contactId])
  @@map("command_items")
}
```

## 7.3 Command module

Create:

```text
apps/server/src/modules/command/
  command.module.ts
  command.controller.ts
  command.service.ts
  command-generator.service.ts
```

## 7.4 Must mirror into CommandItem

```text
FinanceActionItem
RevenueAction
Storefront action cards
KEY recommendations
Automation errors
Inbox messages needing reply
Missed calls
Capture review tasks
Approval requests
Integration failures
```

## 7.5 UI

Create:

```text
apps/web/src/components/command/
  command-queue.tsx
  command-item-card.tsx
  command-filter-bar.tsx
  command-impact-badge.tsx
  command-risk-badge.tsx
  command-execute-button.tsx
```

Command cards show:

```text
title
why it matters
source
linked record
expected impact
due date
risk
KEY can handle
approval state
primary action
snooze/dismiss/complete
```

---

# 8. Cockpit 10/10 Redesign

## 8.1 Goal

Cockpit must let the owner run the day.

## 8.2 Layout

```text
Top:
- greeting
- business status
- Ask KEY
- Capture
- Today / Week / Growth toggle

Row 1:
- Business Health
- Safe-to-Spend
- Money to Collect
- Messages Needing Reply
- Pending Approvals

Main:
- Today's Command Queue
- KEY Can Handle
- Needs Your Approval

Secondary:
- Money Snapshot
- Time Snapshot
- People Snapshot
- Storefront/Growth Snapshot

Bottom:
- Timeline
- Calendar
- Risks & Opportunities
- Module Health
```

## 8.3 Add "Business Weather"

```text
Today: Stable
Cash: Caution
Time: Busy
People: Follow-up needed
Revenue: Opportunity
```

## 8.4 Add "What changed since yesterday?"

```text
2 invoices became overdue
1 lead came in from storefront
3 bookings confirmed
TTD 1,200 collected
KEY prepared 2 drafts
```

---

# 9. Finance 10/10 Plan

Finance is already strong. Finish it.

## 9.1 Add missing features

```text
safe-to-spend
7/30/90-day cash forecast
receivables collection center
payables center
tax reserve center
accountant package center
bank reconciliation command center
cashflow simulator
finance command integration
```

## 9.2 Safe-to-spend formula

```text
cash balance
- tax reserve
- upcoming bills
- payroll/staff obligations
- owner-defined cash buffer
- high-confidence liabilities
= safe-to-spend
```

## 9.3 Finance cockpit

```text
Money Health
Safe-to-Spend
Cash Runway
Receivables
Payables
Tax Reserve
Needs Attention
Forecast
Accountant Export
```

## 9.4 FIN8 integration

Continue using FinanceActionItem, but mirror to CommandItem.

---

# 10. Storefront / Presence 10/10 Plan

## 10.1 Goal

Storefront becomes the public revenue machine.

## 10.2 Add

```text
readiness score
conversion checklist
visual page map
drag reorder sections
mobile/desktop preview
trust signal manager
SEO checklist
review/referral loop
public lead capture
booking/payment links
source attribution dashboard
```

## 10.3 Storefront readiness score

Inputs:

```text
hero clarity
active services/products
pricing completeness
contact options
payment method
booking link
testimonials
FAQ
policies
trust signals
mobile preview
SEO metadata
analytics active
```

---

# 11. Omnichannel Inbox 10/10 Plan

## 11.1 Add models

```prisma
model ChannelAccount {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  providerKey     String   @map("provider_key")
  displayName     String?
  externalAccountId String? @map("external_account_id")
  status          String   @default("CONNECTED")
  capabilities    Json     @default("[]")
  settings        Json     @default("{}")
  lastSyncAt      DateTime? @map("last_sync_at")
  lastError       String?   @map("last_error")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, providerKey, status])
  @@map("channel_accounts")
}

model ConversationThread {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  channelAccountId String? @map("channel_account_id")
  providerKey     String   @map("provider_key")
  externalThreadId String? @map("external_thread_id")
  contactId       String?  @map("contact_id")
  contactName     String?  @map("contact_name")
  contactHandle   String?  @map("contact_handle")
  contactPhone    String?  @map("contact_phone")
  contactEmail    String?  @map("contact_email")
  status          String   @default("OPEN")
  priority        String   @default("NORMAL")
  stage           String?
  lastMessageAt   DateTime? @map("last_message_at")
  lastIntent      String?   @map("last_intent")
  profitPotential Decimal? @db.Decimal(18, 4) @map("profit_potential")
  currency        String?  @default("TTD")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, providerKey, status])
  @@index([businessId, contactId])
  @@index([businessId, lastMessageAt])
  @@map("conversation_threads")
}

model CommunicationMessage {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  threadId        String?  @map("thread_id")
  providerKey     String   @map("provider_key")
  externalMessageId String? @map("external_message_id")
  direction       String
  medium          String
  sender          String?
  recipient       String?
  contactId       String?  @map("contact_id")
  subject         String?
  body            String?
  bodyPreview     String?  @map("body_preview")
  attachments     Json     @default("[]")
  rawRef          String?  @map("raw_ref")
  intent          String?
  sentiment       String?
  urgencyScore    Int?     @map("urgency_score")
  profitScore     Int?     @map("profit_score")
  confidenceScore Int?     @map("confidence_score")
  classification  Json     @default("{}")
  requiresHuman   Boolean  @default(false) @map("requires_human")
  isSensitive     Boolean  @default(false) @map("is_sensitive")
  processedAt     DateTime? @map("processed_at")
  receivedAt      DateTime @default(now()) @map("received_at")
  createdAt       DateTime @default(now())

  @@index([businessId, medium, receivedAt])
  @@index([businessId, contactId, receivedAt])
  @@index([businessId, threadId])
  @@map("communication_messages")
}

model ResponseDraft {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  threadId        String?  @map("thread_id")
  messageId       String?  @map("message_id")
  contactId       String?  @map("contact_id")
  channel         String
  purpose         String
  body            String
  tone            String?
  status          String   @default("DRAFT")
  requiresApproval Boolean @default(true) @map("requires_approval")
  riskTier        Int      @default(2) @map("risk_tier")
  evidence        Json     @default("[]")
  createdBy       String   @default("KEY") @map("created_by")
  approvedById    String?  @map("approved_by_id")
  sentAt          DateTime? @map("sent_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, status, createdAt])
  @@index([businessId, contactId])
  @@map("response_drafts")
}
```

## 11.2 Inbox UI

```text
/app/inbox
```

Views:

```text
All
Needs reply
New leads
Bookings
Payments
Complaints
Reviews
Missed calls
Email
WhatsApp
Instagram
Messenger
Forms
```

Thread card:

```text
channel
contact
intent
urgency
profit potential
last message
linked records
KEY suggestion
approval state
```

---

# 12. Device Capture 10/10 Plan

## 12.1 Add models

```prisma
model MediaAsset {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  userId          String?  @map("user_id")
  objectPath      String   @map("object_path")
  publicUrl       String?  @map("public_url")
  fileName        String?  @map("file_name")
  contentType     String   @map("content_type")
  sizeBytes       Int?     @map("size_bytes")
  mediaType       String   @map("media_type")
  source          String   @default("upload")
  captureMode     String?  @map("capture_mode")
  status          String   @default("UPLOADED")
  linkedEntityType String? @map("linked_entity_type")
  linkedEntityId   String? @map("linked_entity_id")
  contactId        String? @map("contact_id")
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, mediaType, createdAt])
  @@index([businessId, linkedEntityType, linkedEntityId])
  @@index([businessId, contactId])
  @@map("media_assets")
}

model VisualIntake {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  mediaAssetId    String   @map("media_asset_id")
  detectedType    String?  @map("detected_type")
  summary         String?
  extractedText   String?  @map("extracted_text")
  extractedData   Json     @default("{}")
  confidenceScore Int?     @map("confidence_score")
  profitPotential Decimal? @db.Decimal(18, 4) @map("profit_potential")
  recommendedActions Json  @default("[]") @map("recommended_actions")
  status          String   @default("PENDING")
  reviewedById    String?  @map("reviewed_by_id")
  reviewedAt      DateTime? @map("reviewed_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, detectedType, status])
  @@index([businessId, mediaAssetId])
  @@map("visual_intakes")
}
```

## 12.2 Capture UI

Create:

```text
CaptureButton
CaptureSheet
CameraCapture
UploadDropzone
VisualAnalysisSheet
ExtractedFieldsEditor
SuggestedActionsList
CaptureHistory
```

## 12.3 First capture flows

```text
business card → contact → follow-up draft → command
receipt → expense draft → category → finance command
document → summary → deadlines/tasks → attach to record
product → product draft → storefront listing
voice note → transcript → tasks/commands
```

---

# 13. Voice KEY 10/10 Plan

## 13.1 Add frontend

```text
VoiceOrb
VoiceSessionPanel
KeyVoiceSelector
PushToTalkButton
VoiceSettingsPage
VoiceTranscriptDrawer
```

## 13.2 Add models

```prisma
model VoiceSession {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  userId          String?  @map("user_id")
  mode            String   @default("push_to_talk")
  status          String   @default("ACTIVE")
  voiceKey        String?  @map("voice_key")
  transcript      String?
  summary         String?
  toolCalls       Json     @default("[]") @map("tool_calls")
  commandItems    Json     @default("[]") @map("command_items")
  startedAt       DateTime @default(now()) @map("started_at")
  endedAt         DateTime? @map("ended_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([businessId, userId, startedAt])
  @@map("voice_sessions")
}

model KeyVoicePreference {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  userId          String?  @map("user_id")
  voiceKey        String   @map("voice_key")
  displayName     String
  provider        String
  language        String   @default("en")
  accent          String?
  speakingRate    Float    @default(1.0) @map("speaking_rate")
  pitch           Float?   @default(1.0)
  personality     String?
  isDefault       Boolean  @default(false) @map("is_default")
  settings        Json     @default("{}")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, userId])
  @@map("key_voice_preferences")
}
```

## 13.3 User experience

```text
User taps VoiceOrb
KEY listens
KEY transcribes
KEY answers or plans
KEY speaks back
KEY creates drafts/commands
KEY asks approval before risky action
Everything logged
```

---

# 14. Flow Studio and Bot/Automation 10/10 Plan

## 14.1 Add models

```prisma
model AutomationFlow {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  name            String
  description     String?
  category        String
  status          String   @default("DRAFT")
  goal            String?
  triggerSummary  String?  @map("trigger_summary")
  riskTier        Int      @default(1) @map("risk_tier")
  createdBy       String?  @map("created_by")
  blueprintTags   Json     @default("[]") @map("blueprint_tags")
  metrics         Json     @default("{}")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, status, category])
  @@map("automation_flows")
}

model FlowVersion {
  id              String   @id @default(cuid())
  flowId          String   @map("flow_id")
  version         Int
  nodes           Json
  edges           Json
  settings        Json     @default("{}")
  status          String   @default("DRAFT")
  publishedAt     DateTime? @map("published_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([flowId, version])
  @@map("flow_versions")
}

model FlowRun {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  flowId          String   @map("flow_id")
  flowVersionId   String   @map("flow_version_id")
  sourceEventId   String?  @map("source_event_id")
  contactId       String?  @map("contact_id")
  status          String   @default("RUNNING")
  startedAt       DateTime @default(now()) @map("started_at")
  completedAt     DateTime? @map("completed_at")
  currentNodeId   String?  @map("current_node_id")
  input           Json     @default("{}")
  output          Json     @default("{}")
  error           String?
  metrics         Json     @default("{}")

  @@index([businessId, flowId, startedAt])
  @@index([businessId, status])
  @@index([businessId, contactId])
  @@map("flow_runs")
}

model FlowRunStep {
  id              String   @id @default(cuid())
  runId           String   @map("run_id")
  nodeId          String   @map("node_id")
  nodeType        String   @map("node_type")
  status          String   @default("PENDING")
  input           Json     @default("{}")
  output          Json     @default("{}")
  error           String?
  startedAt       DateTime? @map("started_at")
  completedAt     DateTime? @map("completed_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([runId, nodeId])
  @@map("flow_run_steps")
}

model FlowTemplate {
  id              String   @id @default(cuid())
  key             String   @unique
  name            String
  description     String?
  category        String
  businessTypes   Json     @default("[]") @map("business_types")
  nodes           Json
  edges           Json
  requiredConnectors Json  @default("[]") @map("required_connectors")
  estimatedImpact String?  @map("estimated_impact")
  riskTier        Int      @default(1) @map("risk_tier")
  isSystem        Boolean  @default(true) @map("is_system")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([category])
  @@map("flow_templates")
}
```

## 14.2 Create routes

```text
/app/flows
/app/flows/templates
/app/flows/:id
/app/flows/:id/builder
/app/flows/:id/runs
/app/flows/:id/analytics
/app/agents
/app/agents/:id
```

## 14.3 Seed templates

```text
Missed call text-back
WhatsApp price inquiry to booking
Instagram comment to DM
Overdue invoice reminder
Quote follow-up
Business card scan to follow-up
Post-booking review request
Dormant customer reactivation
Receipt scan to expense
New form lead to nurture
Complaint escalation
Payment failed recovery
```

## 14.4 Flow builder modes

```text
Guided mode
Visual canvas mode
Natural language mode
```

---

# 15. Integration Hub 10/10 Plan

## 15.1 Add models

```prisma
model IntegrationProvider {
  id            String   @id @default(cuid())
  key           String   @unique
  name          String
  category      String
  description   String?
  logoUrl       String?
  authType      String
  capabilities  Json     @default("[]")
  scopes        Json     @default("[]")
  status        String   @default("ACTIVE")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("integration_providers")
}

model IntegrationConnection {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  providerKey     String   @map("provider_key")
  status          String   @default("CONNECTED")
  authDataRef     String?  @map("auth_data_ref")
  scopes          Json     @default("[]")
  settings        Json     @default("{}")
  lastSyncAt      DateTime? @map("last_sync_at")
  lastError       String?   @map("last_error")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, providerKey])
  @@map("integration_connections")
}

model IntegrationSyncRun {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  connectionId    String   @map("connection_id")
  providerKey     String   @map("provider_key")
  status          String
  startedAt       DateTime @default(now()) @map("started_at")
  completedAt     DateTime? @map("completed_at")
  recordsRead     Int      @default(0) @map("records_read")
  recordsCreated  Int      @default(0) @map("records_created")
  recordsUpdated  Int      @default(0) @map("records_updated")
  error           String?
  meta            Json     @default("{}")

  @@index([businessId, providerKey, startedAt])
  @@map("integration_sync_runs")
}
```

## 15.2 Integration categories

```text
Messaging
Email
Calendar
Forms
Social
Ads
Payments
Accounting
CRM
Files
Documents
Spreadsheets
Project tools
Automation bridges
Webhooks
Developer API
```

## 15.3 UI

```text
/app/connect
Recommended
Connected
Needs attention
Money
Customers
Calendar
Messaging
Social
Files
Automation
Developer
```

---

# 16. KEY Employee Interface

## 16.1 Create `/app/key`

Sections:

```text
Ask KEY
Today KEY Can Help With
Plans
Drafts
Approvals
Autopilot
Voice
Capture History
Execution Logs
Memory
Tools & Permissions
KEY Performance
```

## 16.2 KEY employee card

```text
KEY status: Active
Today:
- 5 things noticed
- 3 drafts prepared
- 2 actions waiting approval
- 4 safe tasks available
```

## 16.3 KEY memory editor

User can edit:

```text
goals
tone
risk tolerance
cash buffer
pricing rules
customer promise
follow-up style
forbidden actions
preferred voice
business hours
autopilot boundaries
```

---

# 17. Admin Intelligence 10/10 Plan

## 17.1 Add admin models

```prisma
model ProductEvent {
  id          String   @id @default(cuid())
  userId      String?  @map("user_id")
  businessId  String?  @map("business_id")
  sessionId   String?  @map("session_id")
  eventName   String   @map("event_name")
  module      String?
  entityType  String?  @map("entity_type")
  entityId    String?  @map("entity_id")
  properties  Json     @default("{}")
  occurredAt  DateTime @default(now()) @map("occurred_at")

  @@index([businessId, eventName, occurredAt])
  @@index([userId, occurredAt])
  @@index([module, occurredAt])
  @@map("product_events")
}

model UserFeedback {
  id            String   @id @default(cuid())
  userId        String?  @map("user_id")
  businessId    String?  @map("business_id")
  module        String?
  page          String?
  feedbackType  String   @map("feedback_type")
  rating        Int?
  message       String?
  context       Json     @default("{}")
  status        String   @default("NEW")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([businessId, module, createdAt])
  @@index([feedbackType, status])
  @@map("user_feedback")
}

model AiQualitySignal {
  id          String   @id @default(cuid())
  userId      String?  @map("user_id")
  businessId  String?  @map("business_id")
  commandId   String?  @map("command_id")
  module      String?
  signalType  String   @map("signal_type")
  rating      Int?
  comment     String?
  context     Json     @default("{}")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([businessId, module, createdAt])
  @@index([signalType, createdAt])
  @@map("ai_quality_signals")
}
```

## 17.2 Admin route

```text
/app/admin
```

Sections:

```text
Overview
Users & Businesses
Activation
Feature Usage
Command Analytics
KEY Quality
Integration Health
Feedback Inbox
Flow Analytics
Churn Risk
Growth Loops
Roadmap Insights
System Health
```

---

# 18. Governance, Security, and Safety Manual

## 18.1 Approval defaults

```text
Read/summarize → allowed
Draft → allowed
Internal task → allowed
Update tag/stage → allowed with audit
Send customer message → approval unless trusted autopilot enabled
Send quote/invoice → approval
Publish social/storefront → approval
Mark paid/post financial transaction → owner approval
Delete records/change permissions → owner approval or blocked
```

## 18.2 Consent records

Track consent for:

```text
email marketing
WhatsApp
SMS
call recording
voice transcription
review requests
marketing follow-ups
```

## 18.3 Sensitive content handling

Detect and restrict:

```text
IDs
bank cards
legal documents
medical documents
private messages
children/minors
contracts
financial statements
```

## 18.4 Every KEY action logs

```text
input
context used
tool called
risk classification
approval state
output
result
timeline event
```

---

# 19. Testing and QA Manual

## 19.1 Required tests

### Unit tests

```text
CommandItem service
Finance detectors
Flow engine
Flow condition evaluation
Flow action execution
Omnichannel classifier
Identity resolution
Visual intake parser
Voice session service
KEY risk classifier
Integration health
```

### Integration tests

```text
WhatsApp message → ConversationThread → CommandItem → ResponseDraft
Business card capture → MediaAsset → VisualIntake → Contact → CommandItem
Overdue invoice → FinanceActionItem → CommandItem → reminder draft
Storefront visitor → PublicVisitorEvent → Contact → Timeline
Flow run → approval pause → resume → outcome
```

### E2E tests

```text
Onboard business
Add service
Scan business card
Create contact
Draft follow-up
Create quote
Convert to invoice
Collect payment
Request review
See flow outcome
```

## 19.2 Launch gate

Do not launch until:

```text
all builds pass
critical E2E tests pass
auth/business guards reviewed
AI risky actions approval-gated
mobile tested
accessibility checked
error logs monitored
basic analytics working
seed templates installed
```

---

# 20. Implementation Roadmap to 10/10

## Phase 0 — Authority and baseline

```text
1. Add this document as docs/KEYFLOWOS_10_OUT_OF_10_CONSTRUCTION_MANUAL.md.
2. Run baseline build.
3. Document failures.
4. Confirm primary nav remains clean.
5. Stop adding random new widgets without linking to CommandItem/Timeline/KEY.
```

## Phase 1 — Universal Command Spine

```text
Add CommandItem model/module/controller/UI.
Mirror FinanceActionItem, RevenueAction, Presence actions, KEY recommendations.
Replace Cockpit priority widgets with persistent CommandQueue.
```

## Phase 2 — Cockpit redesign

```text
Rebuild Cockpit around Business Pulse, Command Queue, KEY Can Handle, Approvals, Money/Time/People snapshots.
```

## Phase 3 — Omnichannel Inbox MVP

```text
Add ChannelAccount, ConversationThread, CommunicationMessage, ResponseDraft, ConsentRecord.
Extend WhatsApp ingestion.
Create /app/inbox.
Create response draft approval flow.
```

## Phase 4 — Device Capture MVP

```text
Add MediaAsset, VisualIntake.
Create CaptureButton/CaptureSheet.
Implement business card capture to contact/follow-up.
Implement receipt capture to expense.
```

## Phase 5 — Voice KEY frontend

```text
Add VoiceOrb.
Add KeyVoiceSelector.
Add voice settings.
Connect to existing TTS/transcribe endpoints.
Add voice session logging.
```

## Phase 6 — Flow Studio MVP

```text
Add AutomationFlow, FlowVersion, FlowRun, FlowRunStep, FlowTemplate.
Create /app/flows.
Seed templates.
Implement trigger/action MVP.
```

## Phase 7 — KEY Employee Interface

```text
Create /app/key.
Add drafts, approvals, work history, memory editor, tools/permissions, performance.
```

## Phase 8 — Storefront growth finish

```text
Add readiness score, conversion checklist, visual page map, review/referral loops.
```

## Phase 9 — Integration Hub finish

```text
Add IntegrationProvider/Connection/SyncRun.
Turn existing Connect into marketplace/health/recipes.
```

## Phase 10 — Admin intelligence

```text
Add ProductEvent/UserFeedback/AiQualitySignal.
Create admin dashboards.
Add feedback widgets.
```

## Phase 11 — Polish and launch hardening

```text
Mobile pass.
Accessibility pass.
Security audit.
Performance pass.
QA/E2E.
Seed data/templates.
Documentation.
```

---

# 21. First KimiCode Sprint — Exact Instructions

Do this first, in order.

```text
1. Commit this manual into docs/.
2. Run baseline build.
3. Add CommandItem model and migration.
4. Add CommandModule, CommandService, CommandController.
5. Add command client helpers.
6. Add CommandQueue and CommandItemCard components.
7. Mirror FIN8 FinanceActionItem into CommandItem.
8. Add Cockpit CommandQueue section.
9. Add status actions: complete, dismiss, snooze, assign.
10. Write timeline events on command create/update/complete/dismiss.
11. Add ChannelAccount, ConversationThread, CommunicationMessage, ResponseDraft, ConsentRecord models.
12. Extend WhatsApp inbound webhook to create ConversationThread and CommunicationMessage.
13. Add simple deterministic classifier for inbound messages:
    - price inquiry
    - booking request
    - payment question
    - complaint
    - review/referral
    - general inquiry
14. Create CommandItem from messages needing reply.
15. Create ResponseDraft for price/booking inquiries.
16. Add /app/inbox shell with thread list.
17. Add approval-gated response draft panel.
18. Run build/tests.
```

This sprint creates the universal operating spine and first omnichannel business loop.

---

# 22. Second KimiCode Sprint

```text
1. Add MediaAsset and VisualIntake.
2. Add DeviceModule.
3. Add business-scoped media upload endpoint.
4. Add CaptureButton and CaptureSheet.
5. Implement mobile camera capture.
6. Add mock/deterministic business card extraction first.
7. Add extracted field editor.
8. Create contact from card.
9. Create follow-up CommandItem.
10. Create ResponseDraft follow-up.
11. Add timeline events.
12. Add receipt capture to expense draft if expense model supports it.
13. Add VoiceOrb.
14. Connect VoiceOrb to existing TTS/transcription endpoints.
15. Add voice settings page.
```

---

# 23. Third KimiCode Sprint

```text
1. Add AutomationFlow, FlowVersion, FlowRun, FlowRunStep, FlowTemplate.
2. Create FlowModule.
3. Create /app/flows.
4. Add template library.
5. Seed:
   - missed call text-back
   - WhatsApp price inquiry to booking
   - overdue invoice reminder
   - quote follow-up
   - business card scan to follow-up
   - post-booking review request
6. Implement trigger/action runtime MVP.
7. Add FlowRun timeline.
8. Add approval pauses.
9. Add outcomes.
```

---

# 24. "Do Not Ignore" Rules for KimiCode

```text
Do not only generate docs.
Do not leave feature stubs with no wiring.
Do not create UI that is not connected to backend data.
Do not add another fragmented action queue.
Do not expose internal tier language.
Do not bury KEY behind chat only.
Do not create automations without logs.
Do not send customer-facing messages without approval or explicit autopilot settings.
Do not skip business guards.
Do not build desktop-only UI.
Do not leave placeholders on primary launch surfaces.
Do not preserve weak old code just because it exists.
```

---

# 25. Definition of 10/10 Launch Ready

KEYFLOWOS is 10/10 launch-ready when:

```text
The owner can run the day from Cockpit.
All important actions appear in Command Queue.
Finance tells the owner what to chase, reserve, reconcile, and export.
Storefront is publishable, measurable, and conversion-aware.
Public events become contacts/timeline data.
WhatsApp/email/social/calls/forms can feed Inbox.
KEY can draft, plan, explain, execute safe actions, and request approvals.
User can capture business cards/receipts/documents with phone.
User can speak with KEY and choose voice.
Flows can automate lead capture, follow-up, booking, invoicing, payment, review, and reactivation.
Integrations show health and trigger business flows.
Every important action is logged.
Every risky action is governed.
The app is mobile-first and visually premium.
The app has enough tests to confidently launch.
```

Final target feeling:

> "KEYFLOWOS is not another app. It is the operating system for my business."

---

# 26. Final Scorecard Acceptance

Before launch, update the scorecard. Do not launch unless every area is at least 9/10 and the core areas are 10/10.

| Area | Launch target |
|---|---:|
| Core platform coherence | 10 |
| Navigation and breadcrumbs | 10 |
| Cockpit | 10 |
| Finance OS | 10 |
| Storefront / Presence | 10 |
| Public analytics / attribution | 10 |
| Social and growth | 9–10 |
| KEY employee interface | 10 |
| Voice KEY | 9–10 |
| Automation / Flow Studio | 10 |
| Omnichannel inbox | 10 |
| Device capture | 10 |
| Command spine | 10 |
| Integration Hub | 9–10 |
| Admin intelligence | 9 |
| UI/design | 10 |
| QA/security/governance | 10 |

If this table is not true, keep building.
