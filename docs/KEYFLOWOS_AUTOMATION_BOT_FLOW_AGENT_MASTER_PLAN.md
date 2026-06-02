# KEYFLOWOS — Automation, Bot, Flow, and Agentic Execution Master Plan

**Version:** 1.0  
**Branch:** `develop`  
**Purpose:** Give Kimi Code a comprehensive implementation plan so KEYFLOWOS can capture the value businesses currently pay for in chatbot platforms, automation builders, AI agents, CRMs, marketing automations, missed-call systems, lead funnels, review/referral tools, and omnichannel follow-up systems — but execute them more intelligently because KEYFLOWOS has business-wide context.

---

## 0. Executive Directive

Businesses currently pay for fragmented products: chatbots, social DM automations, missed-call text back, workflow automations, lead capture funnels, CRM automations, email/SMS campaigns, review requests, reputation management, booking automations, invoice reminders, AI support agents, AI prospecting agents, visual workflow builders, integration platforms, voice agents, sales pipelines, customer journeys.

KEYFLOWOS should absorb their core capabilities into one **business-aware execution system** where every automated flow is grounded in:

- Business Blueprint
- CRM/contact data
- Conversation history
- Calendar/availability
- Services/products/pricing
- Commerce/quotes/invoices/payments
- Finance/cashflow
- Documents/files
- Storefront/public links
- Past outcomes
- KEY memory
- User preferences
- Approval/governance rules

---

## 1. User-Facing Product Language

Do not expose this as "bot engine" or "automation tier" only.

**User-facing names:**
- Flow Studio
- KEY Automations
- Business Flows
- Smart Replies
- Do It For Me
- Triggers
- Approvals
- Playbooks
- Templates
- Autopilot Rules
- Customer Journeys
- Follow-Up Systems

**Primary UI locations:**
- KEY → Automations / Do It For Me / Autopilot
- Cockpit → Today's automated opportunities
- Contacts → follow-up flows
- Commerce → revenue flows
- Calendar → time flows
- Storefront → conversion flows
- Connect → app-triggered flows
- Settings → rules, approvals, channel permissions

---

## 2. Competitor Capability Targets

### 2.1 ManyChat-style
Instagram/Facebook/WhatsApp/TikTok/SMS conversations, keyword triggers, comment-to-DM flows, DM automation, conversation sequences, lead capture, tags/segments, broadcasts, AI replies, human handoff, ecommerce/sales flows.

**KEYFLOWOS improvement:** Responses are not just scripted. KEY knows the contact, invoice, booking, service, price, calendar, payment status, and profit potential.

### 2.2 HighLevel-style
Capture leads, nurture leads, close deals, reviews/referrals, reactivation, conversation inbox, voice AI, forms/surveys/quizzes, funnels/landing pages, call tracking, missed-call text-back, social DMs, calendars, appointment reminders, pipelines, workflows, proposals, invoicing, payments, review requests, loyalty/referrals, mobile app, AI business card scanner.

**KEYFLOWOS improvement:** One business object graph, not separate marketing objects. Every lead/message/call/card/invoice/booking becomes a traceable business event and command item.

### 2.3 Zapier-style
Trigger-action automation, many app connectors, templates, multi-step workflows, AI automation, tables/forms/interfaces/canvas/agents/chatbots, governed app integrations, developer platform.

**KEYFLOWOS improvement:** Flow actions are business-aware by default. A trigger like "new WhatsApp message" can know whether the sender owes money, has a booking, is high value, or should receive a quote.

### 2.4 Make-style
Visual canvas, routers/branches, scenario builder, AI agents, real-time visual map, custom apps/API integration, error handling, operations at scale.

**KEYFLOWOS improvement:** Flow Studio offers a visual canvas but also explains every flow in business language: goal, impact, revenue potential, risk, owner, and expected outcome.

### 2.5 n8n-style
Node-based workflows, self-hostable logic patterns, technical depth, custom code, traceable AI agent reasoning, connect to anything, workflow execution logs.

**KEYFLOWOS improvement:** Every KEY action and automation run is traceable from source event → reasoning → tool call → approval → outcome.

### 2.6 HubSpot Breeze-style
CRM-grounded AI assistant, customer agent, prospecting agent, data agent, AI email, deal summaries, reply recommendations, lead scoring, conversation context, autonomous customer-facing workflows.

**KEYFLOWOS improvement:** KEY knows finances, calendar, storefront, documents, devices, and business profit trajectory — not just CRM.

### 2.7 Salesforce Agentforce-style
Agent builder, voice agents, agent marketplace, low-code/pro-code tools, data/platform integration, flow automation, service/sales/marketing/commerce agents, controlled deployment.

**KEYFLOWOS improvement:** Small-business-ready agent deployment without enterprise complexity, while retaining governance, evidence, and traceability.

### 2.8 Intercom Fin-style
AI customer service agent, helpdesk integration, automatic answers, complex query handling, handoff, outcome-based pricing/measurement.

**KEYFLOWOS improvement:** KEY supports customers but also converts support into sales, retention, reviews, and repeat business when appropriate.

### 2.9 Klaviyo-style
Unified customer profiles, email/SMS/WhatsApp/mobile push, segmentation, flows, reviews, marketing agent, customer agent, real-time signals, predictive/personalized campaigns.

**KEYFLOWOS improvement:** Combines campaigns with actual operational/business data: appointments, invoices, payments, service history, captured business cards, calls, documents, and cashflow.

---

## 3. Strategic Product Position

**Business Flow OS**

- Flow Studio → build automations
- KEY Agents → AI workers that can reason and act
- Business Playbooks → reusable successful flows
- Omnichannel Inbox → messages/calls/emails/social in one place
- Command Queue → action spine
- Integration Hub → connect apps
- Blueprint → business context
- Timeline → audit/event memory
- Approvals → control and safety
- Outcome Tracking → prove whether flows work

---

## 4. Core Architecture

### 4.1 Event → Context → Decision → Action → Outcome

```
Event occurs
→ Normalize event
→ Link to business object
→ Build business context
→ Decide next best action
→ Draft/execute action
→ Request approval if needed
→ Log execution
→ Measure outcome
→ Improve future flow
```

### 4.2 Five system engines

1. Event Ingestion Engine
2. Flow Orchestration Engine
3. KEY Agent Execution Engine
4. Governance & Approval Engine
5. Outcome Intelligence Engine

---

## 5. Event Ingestion Engine

### 5.1 Sources

Events from: new WhatsApp message, new SMS, new email, new phone call, missed call, voicemail, new Instagram DM, new Messenger message, new TikTok lead/comment, new Facebook/Instagram comment, new Google Form response, new Typeform/Jotform response, new Drive file, new Doc/Sheet change, new calendar booking, new invoice overdue, new invoice paid, new quote viewed, new quote accepted, new payment failed, new storefront visitor/order, new review, new contact created, new device capture, new business card scan, new receipt scan, manual user action, scheduled time trigger, webhook/API event.

### 5.2 BusinessEvent model

```prisma
model BusinessEvent {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  source          String
  eventType       String   @map("event_type")
  entityType      String?  @map("entity_type")
  entityId        String?  @map("entity_id")
  contactId       String?  @map("contact_id")
  externalId      String?  @map("external_id")
  occurredAt      DateTime @default(now()) @map("occurred_at")
  payload         Json     @default("{}")
  normalized      Json     @default("{}")
  processed       Boolean  @default(false)
  processedAt     DateTime? @map("processed_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([businessId, source, eventType, occurredAt])
  @@index([businessId, contactId])
  @@index([businessId, entityType, entityId])
  @@map("business_events")
}
```

---

## 6. Flow Studio

### 6.1 Goal

Built-in automation builder equivalent to ManyChat flows, Zapier Zaps, Make scenarios, n8n workflows, HighLevel workflows, and CRM automation builders.

### 6.2 User-facing sections

```
Flow Studio
├── My Flows
├── Recommended Flows
├── Templates
├── Customer Journeys
├── Revenue Flows
├── Communication Flows
├── Operations Flows
├── KEY Agents
├── Flow Runs
├── Error Queue
├── Approvals
└── Analytics
```

### 6.3 Flow builder modes

- **Guided mode:** User chooses goal, system creates suggested flow
- **Visual canvas mode:** Trigger → Condition → Delay → Action → KEY step → Approval → Branch → Loop → End
- **Natural language mode:** User describes flow in plain English, KEY generates draft nodes

---

## 7. Flow Data Models

### 7.1 AutomationFlow

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
```

### 7.2 FlowVersion

```prisma
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
```

### 7.3 FlowRun

```prisma
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
```

### 7.4 FlowRunStep

```prisma
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
```

### 7.5 FlowTemplate

```prisma
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

---

## 8. Flow Node Types

### 8.1 Triggers

new_message, new_email, new_call, missed_call, new_form_submission, new_review, invoice_overdue, quote_viewed, booking_created, booking_completed, payment_received, payment_failed, new_contact, contact_stage_changed, time_scheduled, device_capture_created, storefront_order, webhook_received.

### 8.2 Conditions

if_contact_new, if_contact_stage, if_invoice_status, if_amount_over, if_channel, if_service_interest, if_sentiment_negative, if_business_hours, if_consent_exists, if_key_confidence_above, if_profit_score_above, if_calendar_available, if_customer_high_value, if_message_contains, if_tagged.

### 8.3 Actions

create_contact, update_contact, add_tag, create_task, create_command_item, send_message, draft_message, send_email, draft_email, create_quote, send_quote, create_invoice, send_invoice, create_booking, send_booking_link, request_review, create_referral_prompt, create_payment_link, schedule_follow_up, notify_user, escalate_to_human, create_document, update_sheet, post_social, reply_review, webhook_call.

### 8.4 KEY steps

classify_intent, summarize_thread, draft_reply, draft_quote, draft_invoice, recommend_package, analyze_profit_potential, choose_next_best_action, extract_fields, qualify_lead, generate_follow_up_sequence, generate_campaign, detect_risk.

### 8.5 Governance steps

approval_required, owner_only_approval, human_review, sensitive_content_check, consent_check, rate_limit_check, business_hours_check, compliance_check.

---

## 9. Bot / Conversation Engine

### 9.1 BotAgent model

```prisma
model BotAgent {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  name            String
  purpose         String
  channels        Json     @default("[]")
  status          String   @default("DRAFT")
  persona         Json     @default("{}")
  knowledgeSources Json    @default("[]") @map("knowledge_sources")
  allowedTools    Json     @default("[]") @map("allowed_tools")
  blockedTopics   Json     @default("[]") @map("blocked_topics")
  escalationRules Json     @default("{}") @map("escalation_rules")
  riskTier        Int      @default(2) @map("risk_tier")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, status])
  @@map("bot_agents")
}
```

### 9.2 ConversationState model

```prisma
model BotConversationState {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  botAgentId      String?  @map("bot_agent_id")
  threadId        String   @map("thread_id")
  contactId       String?  @map("contact_id")
  state           String   @default("ACTIVE")
  currentGoal     String?  @map("current_goal")
  slots           Json     @default("{}")
  historySummary  String?  @map("history_summary")
  lastAction      String?  @map("last_action")
  nextExpectedInput String? @map("next_expected_input")
  updatedAt       DateTime @updatedAt @map("updated_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([businessId, threadId])
  @@map("bot_conversation_states")
}
```

---

## 10. Business Playbook Library

### 10.1 Lead playbooks
New lead follow-up, Form submission to booked call, Instagram comment to DM lead, WhatsApp price inquiry to booking, Missed call text-back, Business card capture to follow-up, Website visitor to offer, Google Business Profile inquiry to booking.

### 10.2 Sales playbooks
Quote follow-up sequence, Quote accepted to invoice, Abandoned quote recovery, High-ticket consultation close, Proposal reminder, Payment link follow-up, Upsell after purchase, Cross-sell after booking.

### 10.3 Finance playbooks
Overdue invoice reminder, Payment promise follow-up, Receipt capture to expense, Tax reserve reminder, Unpaid invoice escalation, Cashflow risk response.

### 10.4 Customer success playbooks
Booking confirmation, Appointment reminder, Post-service follow-up, Review request, Referral request, Complaint recovery, Dormant customer win-back, Birthday/seasonal message.

### 10.5 Marketing playbooks
Reactivation campaign, Newsletter, Promo launch, New service announcement, Review-to-social post, Google Business Profile weekly post, Social content calendar, Lead magnet follow-up.

### 10.6 Operations playbooks
New client onboarding, Project task creation, Document request, Procurement request, Vendor follow-up, Maintenance checklist, Recurring service workflow.

---

## 11. Agent Builder

### 11.1 KEY Agent types

Receptionist Agent, Sales Follow-Up Agent, Booking Agent, Collections Agent, Review/Referral Agent, Customer Support Agent, Marketing Agent, Document Intake Agent, Finance Assistant Agent, Operations Coordinator Agent, Admin Secretary Agent.

### 11.2 Agent config model

```prisma
model KeyAgentConfig {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  name            String
  agentType       String   @map("agent_type")
  status          String   @default("DRAFT")
  channels        Json     @default("[]")
  goals           Json     @default("[]")
  allowedTools    Json     @default("[]") @map("allowed_tools")
  approvalPolicy  Json     @default("{}") @map("approval_policy")
  memoryScope     String   @default("business") @map("memory_scope")
  knowledgeSources Json    @default("[]") @map("knowledge_sources")
  kpis            Json     @default("[]")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, agentType, status])
  @@map("key_agent_configs")
}
```

---

## 12. Flow Execution Runtime

### 12.1 Required services

FlowEngineService, FlowSchedulerService, FlowRunnerService, FlowNodeExecutorService, FlowConditionService, FlowActionRegistry, FlowErrorService, FlowTemplateService, FlowAnalyticsService, AgentOrchestrationService, ApprovalBridgeService, OutcomeTrackingService.

### 12.2 Runtime requirements

Idempotency keys, retry policies, dead-letter queue, rate limiting, per-channel throttling, execution timeouts, step logs, structured errors, human handoff, approval pauses, resume after approval, resume after customer reply, branching/conditions, delays, scheduled triggers, webhook triggers, test mode, dry-run mode, versioned publishing, rollback flow version.

### 12.3 Error handling

Flow errors produce: error queue item, notification, command item, KEY explanation, retry button, skip step, manual resolve.

---

## 13. Outcome Intelligence

### 13.1 AutomationOutcome model

```prisma
model AutomationOutcome {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  flowId          String?  @map("flow_id")
  agentId         String?  @map("agent_id")
  runId           String?  @map("run_id")
  outcomeType     String   @map("outcome_type")
  value           Decimal? @db.Decimal(18, 4)
  currency        String?
  contactId       String?  @map("contact_id")
  entityType      String?  @map("entity_type")
  entityId        String?  @map("entity_id")
  attribution     Json     @default("{}")
  occurredAt      DateTime @default(now()) @map("occurred_at")

  @@index([businessId, flowId, occurredAt])
  @@index([businessId, outcomeType, occurredAt])
  @@map("automation_outcomes")
}
```

### 13.2 Measures

Leads captured, reply rate, bookings created, quotes sent, quotes accepted, payments collected, reviews requested, reviews received, referrals generated, customers reactivated, time saved, manual tasks avoided, revenue influenced, profit protected, errors prevented.

### 13.3 Dashboard

Runs, success rate, failure rate, approval rate, revenue influenced, time saved, conversion rate, best-performing variants, worst-performing steps, drop-off point, next improvement.

---

## 14. Integrations and Pluggability

### 14.1 Categories

Messaging, Email, Calendar, Forms, Social, Ads, Payments, Accounting, CRM, Files, Documents, Spreadsheets, Project tools, Automation bridges, Webhooks, Developer API, MCP/tools.

### 14.2 Must support

WhatsApp Business, Gmail, Outlook Mail, Google Calendar, Outlook Calendar, Google Drive, Google Docs, Google Sheets, Google Forms, Typeform/Jotform, Facebook Pages, Instagram DMs/comments, Messenger, TikTok, Google Business Profile, Stripe, WiPay, QuickBooks/Xero, Twilio Voice/SMS, Zapier webhook, Make webhook, n8n webhook, generic webhook/API.

---

## 15. Device-Native Automation

### 15.1 Capture triggers

business_card_scanned, receipt_scanned, document_scanned, product_scanned, voice_note_recorded, photo_uploaded, QR_scanned, barcode_scanned.

### 15.2 Example flows

**Business card scan flow:** Extract contact fields → Check duplicate → Create/update contact → Ask relationship type → Draft follow-up → Create reminder → Suggest package → Add to lead nurture flow.

**Receipt scan flow:** Extract merchant/amount/tax → Create expense draft → Categorize → Attach receipt → Create approval command.

**Voice command flow:** Transcribe → Classify intent → Generate plan → Execute safe steps → Ask approval for risky steps → Speak confirmation.

---

## 16. UI Implementation

### 16.1 Pages

```
/app/flows
/app/flows/templates
/app/flows/:id
/app/flows/:id/builder
/app/flows/:id/runs
/app/flows/:id/analytics
/app/agents
/app/agents/:id
```

### 16.2 Components

FlowCanvas, FlowNode, FlowEdge, FlowNodePalette, TriggerSelector, ConditionBuilder, ActionSelector, KeyStepConfigurator, ApprovalNodeConfig, DelayNodeConfig, FlowTestPanel, FlowRunTimeline, FlowErrorQueue, FlowAnalyticsPanel, PlaybookLibrary, AgentBuilder, AgentCapabilityPicker, ChannelPermissionPanel, OutcomeDashboard.

### 16.3 UX requirements

Every flow has a business goal. Every action explains expected outcome. Every risky action shows approval policy. Every connector requirement is visible. Every run is traceable. Every failure can be fixed. KEY can explain any node/run/error.

---

## 17. Governance

### 17.1 Risk categories

read, draft, internal write, customer-facing message, external post, financial write, payment/collection, legal/sensitive, destructive, permission/security.

### 17.2 Default approval rules

- Drafting → allowed
- Internal task creation → allowed
- Tagging/contact update → allowed with undo
- Sending customer message → approval required unless trusted channel autopilot enabled
- Publishing social/storefront → approval required
- Sending invoice/quote → approval required
- Marking paid/payment posting → owner approval
- Deleting records → owner approval or blocked

### 17.3 Compliance

opt-out tracking, consent records, business hours, quiet hours, rate limits, template compliance for WhatsApp, sensitive content detection, human handoff, audit logs.

---

## 18. Flow Templates to Seed

### 18.1 Revenue
New lead to booked appointment, Price inquiry to quote, Quote viewed follow-up, Quote accepted to invoice, Overdue invoice collection, Payment failed recovery, High-value lead fast-track.

### 18.2 Communication
Missed call text-back, WhatsApp inquiry response, Instagram comment to DM, Email inquiry triage, Complaint escalation, After-hours auto-response.

### 18.3 Customer success
Booking reminder, Post-service follow-up, Review request, Referral request, Dormant customer reactivation, Birthday/seasonal message.

### 18.4 Operations
New client onboarding, Document request and follow-up, Procurement request, Vendor quote chase, Recurring maintenance workflow, Project kickoff.

### 18.5 Marketing
New service launch, Weekly Google Business post, Review-to-social-content, Storefront traffic recovery, Newsletter campaign, Social content calendar.

### 18.6 Device
Business card to contact and offer, Receipt to expense, Contract to deadline reminders, Product photo to storefront listing, Voice note to task plan.

---

## 19. Admin and Self-Improvement

### 19.1 Metrics

flow adoption, flow completion, flow failure, flow revenue, flow approvals, flow rejections, bot response helpfulness, customer replies, opt-outs, complaints, time saved, manual overrides.

### 19.2 Product insights

If many users reject a bot reply: create ProductRoadmapInsight, cluster problem, recommend template improvement, update default tone.

---

## 20. Kimi Implementation Phases

| Phase | Focus |
|---|---|
| 1 | Flow Runtime Foundation (models, engine, runner, registry, API) |
| 2 | Flow Studio UI (list, templates, builder shell, runs, analytics) |
| 3 | Trigger/Action MVP (triggers + actions) |
| 4 | Bot/Conversation Engine (BotAgent, ConversationState, slot filling) |
| 5 | KEY Agent Builder (KeyAgentConfig, templates, permissions, dashboard) |
| 6 | Omnichannel Integration (WhatsApp, Gmail, Instagram, Forms, Drive, GBP, Twilio) |
| 7 | Outcome Intelligence (AutomationOutcome, analytics, attribution, A/B) |
| 8 | Marketplace / Playbooks (library, setup wizard, health checks) |
| 9 | Governance Hardening (approval gates, consent, opt-out, audit, rollback) |

---

## 21. First Kimi Sprint Exact Tasks

1. Create this master plan doc.
2. Add AutomationFlow, FlowVersion, FlowRun, FlowRunStep, FlowTemplate, AutomationOutcome models.
3. Create FlowModule with FlowController, FlowEngineService, FlowRunnerService, FlowTemplateService, FlowActionRegistry.
4. Add endpoints: GET/POST flows, GET templates, POST publish, POST test, GET runs.
5. Build /app/flows list page.
6. Build Flow Template Library UI.
7. Build basic Flow Builder shell with trigger/action nodes.
8. Seed templates: missed call text-back, WhatsApp price inquiry to booking, overdue invoice reminder, quote follow-up, business card scan to follow-up, post-booking review request.
9. Implement basic event trigger for invoice_overdue.
10. Implement basic event trigger for new WhatsApp message.
11. Implement action nodes: create command item, draft message, notify user, create task.
12. Add FlowRun logging and timeline event writes.
13. Add approval requirement for send_message.
14. Run build and tests.

---

## 22. Acceptance Criteria

- A business can create a flow from a template.
- A business can build a custom flow.
- A WhatsApp message can trigger a flow.
- A missed call can trigger a callback command.
- An overdue invoice can trigger a collection flow.
- A scanned business card can trigger a contact/follow-up flow.
- KEY can generate a flow draft from natural language.
- KEY can explain every step.
- Risky actions require approval.
- Every flow run is logged.
- Failures are visible and fixable.
- Outcomes are tracked.
- The system matches or exceeds the business value of bot/automation platforms because it knows the entire business context.

---

## 23. Final Standard

KEYFLOWOS should become:

> ManyChat + HighLevel + Zapier + Make + n8n + HubSpot Breeze + Salesforce Agentforce + Intercom Fin + Klaviyo-style growth automation

But not as a bundle of copied features. It should be:

> A business-aware operating system where every automation is grounded in real contacts, money, calendar, conversations, documents, devices, and profit trajectory.

The product should let the user say:

> "KEY, build me a system that captures leads from WhatsApp, qualifies them, books them, sends a quote, follows up, collects payment, requests a review, and reactivates them later."

And KEYFLOWOS should generate: flow, bot script, approval rules, integrations needed, timeline tracking, command items, analytics, outcome measurement.
