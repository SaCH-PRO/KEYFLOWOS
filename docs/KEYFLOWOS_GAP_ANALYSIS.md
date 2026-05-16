# Keyflow OS Gap Analysis
## Master Document vs. Current Implementation
**Date:** 2026-05-16
**Auditors:** AI agent fleet (Tenant/RBAC, Content/Drive, Workflow/Tasks, KEY/Communication)

---

## Executive Summary

Keyflow OS is **significantly further along** than a typical early-stage repo. The codebase has:
- ✅ 180+ Prisma models across 15+ modules
- ✅ Mature Google Drive integration (OAuth, CRUD, round-trip sync)
- ✅ Multi-channel communication (WhatsApp, Email, In-app)
- ✅ Sophisticated AI layer (60+ tools, governance, role engine, journeys)
- ✅ Document engine with versioning, approval, and Drive sync
- ✅ Event-driven automations and journey orchestration

**However**, the master document identifies critical architectural gaps that prevent Keyflow OS from being a true "business operating system." The biggest gaps are:
1. **No unified business event log** — audit is fragmented across 5+ tables
2. **No evidence system** — tasks complete with a timestamp, not proof
3. **No general approval engine** — approvals are AI-centric only
4. **No content request fulfillment workflow** — content briefs exist but no work orders
5. **Task assignment is broken** — `assigneeId` is an unvalidated string
6. **No manual call task persistence** — call suggestions don't create tasks
7. **KEY cannot create content requests or Drive upload jobs**

---

## Scored Gap Matrix

| # | Capability | Master Doc Priority | Current State | Gap Severity | Effort |
|---|-----------|---------------------|---------------|--------------|--------|
| 1 | **Unified Business Event Log** | Critical | Partial (5+ fragmented tables) | 🔴 High | Medium |
| 2 | **Evidence System** | Critical | Missing | 🔴 High | Medium |
| 3 | **General Approval Engine** | Critical | AI-only approvals | 🔴 High | Medium |
| 4 | **Content Request Fulfillment** | High | SEO briefs only | 🔴 High | High |
| 5 | **Task Assignment (Polymorphic)** | Critical | Loose string IDs | 🔴 High | Medium |
| 6 | **Manual Call Tasks** | High | Suggestions only | 🟡 Medium | Low |
| 7 | **KEY Creates Content Requests** | High | Cannot | 🟡 Medium | Medium |
| 8 | **KEY Drive Upload Jobs** | High | Cannot | 🟡 Medium | Medium |
| 9 | **Row-Level Ownership** | Medium | Missing | 🟡 Medium | Medium |
| 10 | **Prisma Tenant Middleware** | Medium | Manual businessId | 🟡 Medium | Low |
| 11 | **Workflow Visual Designer** | Low | JSON playbooks | 🟢 Low | High |
| 12 | **Contractor Model** | Medium | Missing | 🟡 Medium | Low |
| 13 | **Call Log Model** | Medium | Missing | 🟡 Medium | Low |
| 14 | **Asset Management / Media Library** | Medium | Missing | 🟡 Medium | Medium |
| 15 | **Multi-step Approval Chains** | Medium | Single approver | 🟡 Medium | Medium |

---

## Detailed Findings by Domain

### 1. Tenant, RBAC & Audit

**What's Strong:**
- Supabase-backed auth with server-side JWT verification
- `BusinessGuard` on 80+ controllers
- `ModuleScopeGuard` with numeric permission levels
- Auth audit with rate limiting and IP buckets
- GDPR-aware contact audit with hash anonymization

**What's Missing:**
- No `Organization` layer above `Business`
- `Business` table is a 470-line god table
- `Membership.role` is a string enum, not a normalized relation
- `JobRole.permissions` is unvalidated JSON, not wired to guards
- No Prisma middleware auto-injecting `businessId`
- No row-level ownership (any business member sees all contacts/deals)
- No unified business event log — `TeamActivityLog` is a loose-text bucket

**Master Doc Alignment:** Section 4 (COSO internal control, ISO quality), Section 18 (security)

---

### 2. Workflow Engine

**What's Strong:**
- `Automation` (playbooks) with trigger → action JSON
- `AgentTrigger` with event patterns and conditions
- `JourneyInstance` + `AiPlan` + `AiPlanStep` for multi-step orchestration
- `DelegationLoop` with 5 autopilot loops
- `FlowOrchestratorService` for AI chat-driven execution
- Blueprint inference for workflow model detection

**What's Missing:**
- No visual workflow designer (JSON-only)
- No conditional branching beyond single condition string
- No workflow versioning or rollback
- No reusable sub-workflow components
- Cross-module workflows are config-only

**Master Doc Alignment:** Section 6.2 (Workflow Engine)

---

### 3. Task & Delegation

**What's Strong:**
- `ContactTask`, `ProjectTask`, `AutopilotTask`, `ReviewTask`, `SupportTicket`
- `DelegationRule` for temporary delegation
- `OrgAssignment` with reporting hierarchy
- `JobRole` with approval tiers

**What's Missing:**
- `ContactTask.assigneeId` and `ProjectTask.assigneeId` are **unvalidated strings** — no referential integrity
- `StaffMember` exists but is **not linked to any task model**
- No contractor model
- No Keyflow OS staff assignment
- No task evidence / completion proof
- No task delegation audit trail
- No task templates

**Master Doc Alignment:** Section 6.3 (Task and Delegation Engine), Golden Rule #1 (No orphan work), #3 (No completion without evidence)

---

### 4. Evidence System

**What's Strong:**
- `ContactMedia` for contact attachments
- `DocumentInstance` + `DocumentVersion` with full lifecycle
- `ObjectStorageService` (S3-compatible)
- `DocumentChangeLog` with before/after values

**What's Missing:**
- No dedicated `Evidence` model
- Cannot attach proof to task completion
- No verification workflow
- No chain-of-custody / audit hashes
- No compliance-grade file access audit

**Master Doc Alignment:** Section 6.3 (evidence requirements), Golden Rule #3

---

### 5. Approval System

**What's Strong:**
- `AiApprovalItem` with 4-tier risk system
- `GovernanceService` with auto-approval rules
- `AutopilotSettings` with autonomy levels
- Stale escalation with timeout handling
- Document approval (`DocumentInstance.approvalStatus`)

**What's Missing:**
- AI-centric only — no general business approvals (expense, PO, time-off)
- No multi-step approval chains
- No approval delegation/proxy
- No approval thresholds ("auto-approve under $500")
- No approval reminders beyond stale escalation

**Master Doc Alignment:** Section 6.3 (approval gates), Golden Rule #4

---

### 6. Communication Hub

**What's Strong:**
- WhatsApp adapter (messages, templates, webhooks)
- Email adapter (transactional, campaigns)
- In-app notifications
- `DeliveryQueueService` with retry logic
- `OutboundContent` / `OutboundVariant` / `OutboundDelivery`
- "Best channel" scoring per contact

**What's Missing:**
- No named "Optimum Connection Engine" abstraction
- No automatic fallback (failed WhatsApp → SMS)
- No native SMS adapter
- No Slack/Teams integration
- No real-time channel health monitoring

**Master Doc Alignment:** Section 6.4 (Communication Hub), Section 6.5 (Optimum Connection Engine)

---

### 7. Content Operations

**What's Strong:**
- `ContentBrief` (SEO-focused) with AI generation
- `OutboundContent` pipeline for social/email
- `DocumentInstance` with 30+ blueprints and AI generation
- `DeliveryQueueService` for scheduled publishing

**What's Missing:**
- No general `ContentRequest` entity ("make me a blog post by Friday")
- No content fulfillment workflow (assignee, deadline, draft → review → approve)
- Content briefs are SEO-only; no video scripts, ad creative, etc.
- No connection between briefs and actual production
- No content staff dashboard or queue

**Master Doc Alignment:** Section 6.14 (Content Operations), Section 11

---

### 8. Google Drive Delivery

**What's Strong:**
- Full OAuth2 lifecycle (auth, refresh, disconnect)
- File CRUD, browsing, sharing
- Document round-trip sync (link, import, pull, conflict detection)
- Save AI-generated docs to Drive as native Google Docs
- Inventory Sheet sync
- Frontend browser component

**What's Missing:**
- No folder provisioning per project/request
- No webhook/polling for Drive-side changes
- No bulk upload from Drive into assets
- AI cannot create/upload documents to Drive
- No Drive file version history integration

**Master Doc Alignment:** Section 6.15 (Google Drive Delivery Engine), Section 12

---

### 9. KEY AI Layer

**What's Strong:**
- 60+ tools across CRM, commerce, bookings, marketing, projects, SEO
- 4-tier governance with role-based permissions
- Flow chat with streaming, tool calling, confirmations
- Inbound WhatsApp/Instagram/Messenger with AI replies
- Pattern detection (revenue drops, support clusters)
- Document/image extraction via vision AI
- Auto-trigger plans from 15 business events
- Semantic memory, business graph, blueprint context
- Role engine with 6 business roles
- Journey orchestrator, morning briefing, unified inbox, goal tracker

**What's Missing:**
- Cannot create `ContentRequest` or `DriveUploadJob`
- No evidence-checking auditor component
- No content brief generation for non-SEO content
- No cross-business intelligence/benchmarking
- No immutable audit ledger for AI actions
- No video/audio content generation

**Master Doc Alignment:** Section 9 (KEY AI Layer), Section 16

---

### 10. Manual Call Tasks

**What's Strong:**
- `NextAction` includes `type: 'call'`
- CRM sequences support call steps
- Call actions generated for hot leads, dormant clients

**What's Missing:**
- No `CallLog` model
- Call suggestions don't create persistent `ContactTask` records
- No click-to-call integration
- No call script/talking points
- No call scheduling integration

**Master Doc Alignment:** Section 10.5 (Phone call handling), Section 13.5

---

## Recommended Implementation Roadmap

### Phase A: Operating Kernel (Foundation) — 2-3 weeks
**Goal:** Fix the foundations that everything else builds on.

1. **Unified Business Event Log**
   - Create `BusinessEvent` table matching master doc schema
   - Build `BusinessEventService` with standardized event types
   - Add NestJS interceptor that auto-logs all mutations
   - Backfill from `TeamActivityLog`, `ContactAuditEntry`, `AuthAuditLog`

2. **Polymorphic Task Assignment**
   - Create `Assignable` union type: `User | StaffMember | Contractor | KeyflowStaff | KEY`
   - Add `TaskAssignment` junction table with `assignableType` / `assignableId`
   - Migrate `ContactTask.assigneeId` → `TaskAssignment`
   - Migrate `ProjectTask.assigneeId` → `TaskAssignment`
   - Validate all assignments at DB level

3. **Evidence Model**
   - Create `Evidence` table: `id`, `businessId`, `evidenceType`, `url`, `checksum`, `submittedBy`, `submittedAt`, `verifiedBy`, `verifiedAt`, `linkedType`, `linkedId`
   - Add evidence submission to task completion flow
   - Create `evidence_required` flag on tasks/workflows

4. **Prisma Tenant Middleware**
   - Add Prisma extension that auto-injects `businessId` into queries
   - Or implement RLS policies with `current_setting('app.current_business_id')`
   - Audit all existing queries for missing `businessId`

### Phase B: General Approval Engine — 1-2 weeks
**Goal:** Extend approvals beyond AI actions to business processes.

1. **ApprovalRequest Model**
   - Create `ApprovalRequest` table: `id`, `businessId`, `requestType`, `requesterId`, `approverIds[]`, `status`, `threshold`, `payload`, `createdAt`, `resolvedAt`
   - Support multi-step chains (`ApprovalStep`)
   - Support thresholds ("auto-approve under $500")
   - Support delegation/proxy rules

2. **Approval UI**
   - Dashboard widget for pending approvals
   - Approval detail page with evidence/context
   - Batch approve/reject
   - Approval history

3. **Integration Points**
   - Quote approval (margin check)
   - Expense approval
   - Discount approval
   - Content delivery approval

### Phase C: Content Operations Pipeline — 2-3 weeks
**Goal:** Make content request → fulfillment → Drive delivery a first-class workflow.

1. **ContentRequest Model**
   - Status workflow: `DRAFT` → `SUBMITTED` → `ASSIGNED` → `IN_PRODUCTION` → `INTERNAL_REVIEW` → `USER_REVIEW` → `APPROVED` → `UPLOADED_TO_DRIVE` → `DELIVERED`
   - Fields: `businessGoal`, `targetAudience`, `deliverables[]`, `dueDate`, `priority`, `assignedTeamMembers[]`

2. **Content Fulfillment Service**
   - Assignment to Keyflow OS staff
   - Draft upload and version tracking
   - QA review checklist
   - User approval/revision loop

3. **Drive Delivery Integration**
   - Folder provisioning per content request
   - Upload job queue (`DriveUploadJob`)
   - Retry logic for failed uploads
   - Delivery notification

4. **KEY Content Capabilities**
   - KEY can detect content needs from business signals
   - KEY can create `ContentRequest` with brief
   - KEY can create `DriveUploadJob` after approval

### Phase D: Call Task System — 1 week
**Goal:** Make phone follow-ups trackable.

1. **CallLog Model**
   - `id`, `businessId`, `contactId`, `taskId`, `callerId`, `outcome`, `duration`, `notes`, `recordingUrl`, `scheduledAt`, `completedAt`

2. **Call Task Integration**
   - Convert `NextAction` call suggestions to persistent `ContactTask` records
   - Attach call script/talking points
   - Log outcome on completion

3. **Future-proofing**
   - Schema supports `recordingUrl` for future telephony integration
   - Supports `scheduledAt` for calendar integration

### Phase E: Asset Management & Media Library — 1-2 weeks
**Goal:** Organize creative files.

1. **Asset Model**
   - `id`, `businessId`, `name`, `type`, `url`, `tags[]`, `folder`, `permissions`, `uploadedBy`, `createdAt`
   - Backed by S3 with tagging and search

2. **Media Library UI**
   - Grid view with filtering
   - Tag management
   - Usage tracking (which assets used in which content)

### Phase F: KEY Enhancement — 2-3 weeks
**Goal:** Make KEY a true operations coordinator per the master doc.

1. **KEY Planner Enhancements**
   - Create `ContentRequest` from detected needs
   - Create `DriveUploadJob` from approved content
   - Create manual `CallTask` from business signals

2. **KEY Auditor**
   - Evidence checker: "Was proof captured?"
   - Approval checker: "Was approval required and obtained?"
   - Channel checker: "Was the correct channel used?"

3. **KEY Monitor**
   - Content request stuck detection
   - Upload failure monitoring
   - Call task overdue detection

4. **Cross-Business Intelligence**
   - Benchmarking (opt-in, anonymized)
   - Industry pattern detection

### Phase G: Workflow Visualizer — 2-3 weeks (Lower Priority)
**Goal:** Make workflows visible and editable.

1. **Node-Edge Representation**
   - Convert `Automation`, `JourneyInstance`, `AiPlan` to visual graphs
   - React Flow or similar for editor
   - Conditional branching UI

---

## Immediate Next Steps (This Week)

1. **Create `BusinessEvent` table + service** — enables everything else
2. **Fix task assignment** — unvalidated strings are a data integrity risk
3. **Add `Evidence` model** — closes a golden rule gap
4. **Create `ContentRequest` model** — unlocks content operations
5. **Add `CallLog` model** — simple, high-value

These five models form the "operating kernel" that the master document demands. Everything else builds on them.

---

## Conclusion

Keyflow OS has **impressive depth** in AI, Google Drive, communication, and document management. The codebase is production-grade in many areas. However, it lacks the **unifying primitives** that make a business operating system: evidence, general approvals, content work orders, and a unified event log. 

The good news: these gaps are **architectural, not fundamental**. The existing models (ContactTask, AiApprovalItem, ContentBrief, DocumentInstance) provide excellent scaffolding. The recommended roadmap closes the gaps by extending existing systems rather than replacing them.

**Priority order:**
1. Business Event Log (enables audit and analytics)
2. Task Assignment Fix (enables proper delegation)
3. Evidence System (enables compliance)
4. General Approval Engine (enables business process control)
5. Content Request Pipeline (enables content operations)
6. Call Tasks (enables phone follow-up tracking)
7. KEY Enhancement (enables AI to use all the above)
