# Keyflow OS Implementation Plan
## Aligned with Master AI Coder Direction Document
**Date:** 2026-05-16

---

## How to Use This Document

This plan maps the master document's vision against the current codebase and provides concrete, phased implementation steps. Each phase is designed to be deliverable independently. Do not skip Phase A — it provides the foundations everything else requires.

---

## Phase 0: Schema Foundation (Week 1)

### 0.1 BusinessEvent Table
```prisma
model BusinessEvent {
  id          String   @id @default(cuid())
  businessId  String
  branchId    String?
  eventType   String   // e.g., "task.created", "invoice.paid", "approval.resolved"
  subjectType String   // e.g., "Task", "Invoice", "Contact"
  subjectId   String
  actorType   String   // "human" | "ai" | "system" | "integration"
  actorId     String
  action      String   // "create", "update", "delete", "approve", "execute"
  before      Json?
  after       Json?
  evidenceIds String[] // references to Evidence records
  messageIds  String[] // references to CommunicationEvent records
  approvalId  String?
  riskScore   Int?
  source      String   // "web" | "mobile" | "email" | "whatsapp" | "api" | "worker" | "ai"
  createdAt   DateTime @default(now())

  @@index([businessId, createdAt])
  @@index([businessId, eventType])
  @@index([subjectType, subjectId])
  @@index([actorType, actorId])
}
```

**Service:** `BusinessEventService` with methods:
- `emit(event)` — fire-and-forget event creation
- `emitAsync(event)` — queued for high-volume
- `getTimeline(subjectType, subjectId)` — full history of an object
- `getAuditTrail(businessId, options)` — filtered query

**Integration:** NestJS interceptor on all `@Post`, `@Patch`, `@Delete` endpoints that auto-logs mutations by diffing request/response.

### 0.2 Evidence Table
```prisma
model Evidence {
  id          String   @id @default(cuid())
  businessId  String
  evidenceType String  // "photo", "file", "signature", "checklist", "message", "note", "document"
  url         String
  storageKey  String   // S3 key or Drive file ID
  checksum    String?  // SHA-256 for integrity
  mimeType    String?
  sizeBytes   Int?
  submittedBy String   // userId or "key_ai"
  submittedAt DateTime @default(now())
  verifiedBy  String?
  verifiedAt  DateTime?
  linkedType  String   // "Task", "ApprovalRequest", "Contact", "WorkOrder"
  linkedId    String
  metadata    Json?    // e.g., GPS coords for photo, timestamp for signature

  @@index([businessId, linkedType, linkedId])
  @@index([businessId, evidenceType])
}
```

### 0.3 TaskAssignment Junction Table
```prisma
model TaskAssignment {
  id            String   @id @default(cuid())
  taskType      String   // "ContactTask" | "ProjectTask" | "AutopilotTask"
  taskId        String
  assignableType String  // "User" | "StaffMember" | "Contractor" | "KeyflowStaff" | "KEY"
  assignableId  String
  assignedBy    String
  assignedAt    DateTime @default(now())
  unassignedAt  DateTime?
  reason        String?

  @@unique([taskType, taskId, assignableType, assignableId])
  @@index([taskType, taskId])
  @@index([assignableType, assignableId])
}
```

**Migration:** Backfill from `ContactTask.assigneeId` and `ProjectTask.assigneeId`.

### 0.4 ContentRequest Table
```prisma
model ContentRequest {
  id                String   @id @default(cuid())
  businessId        String
  requestedBy       String   // userId or "key_ai"
  source            String   // "user_request" | "key_recommendation" | "campaign_calendar" | "sales_signal" | "inventory_signal"
  status            String   @default("draft")
  contentTypes      String[] // "blog_post", "social_post", "email", "video_script", "flyer", "whitepaper"
  businessGoal      String
  targetAudience    String?
  offer             String?
  productOrService  String?
  branch            String?
  tone              String?
  dueDate           DateTime?
  priority          String   @default("normal")
  requiredInputs    String[]
  attachedAssetIds  String[]
  assignedTeamMemberIds String[]
  googleDriveFolderId String?
  deliveryFileIds   String[]
  approvalRequired  Boolean  @default(true)
  approvedBy        String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  briefs    ContentBrief[]
  deliveries ContentDeliveryPackage[]

  @@index([businessId, status])
  @@index([businessId, dueDate])
}
```

### 0.5 CallLog Table
```prisma
model CallLog {
  id          String   @id @default(cuid())
  businessId  String
  contactId   String?
  taskId      String?  // linked ContactTask
  callerId    String   // userId or staffMemberId
  scheduledAt DateTime?
  completedAt DateTime?
  duration    Int?     // seconds
  outcome     String?  // "reached", "no_answer", "voicemail", "wrong_number", "callback_requested"
  notes       String?
  script      String?  // talking points used
  recordingUrl String?
  evidenceIds String[]
  followUpTaskId String?
  createdAt   DateTime @default(now())

  @@index([businessId, contactId])
  @@index([businessId, callerId])
  @@index([businessId, scheduledAt])
}
```

### 0.6 ApprovalRequest Table
```prisma
model ApprovalRequest {
  id          String   @id @default(cuid())
  businessId  String
  requestType String   // "quote_discount", "expense", "content_delivery", "refund", "po"
  requesterId String
  title       String
  description String?
  payload     Json     // the actual data being approved
  status      String   @default("pending")
  threshold   Float?   // auto-approve under this amount
  currentStep Int      @default(0)
  createdAt   DateTime @default(now())
  resolvedAt  DateTime?
  resolution  String?  // "approved" | "rejected" | "escalated"

  steps ApprovalStep[]
  audit BusinessEvent[]

  @@index([businessId, status])
  @@index([businessId, requestType])
}

model ApprovalStep {
  id              String  @id @default(cuid())
  approvalRequestId String
  stepOrder       Int
  approverId      String
  status          String  @default("pending")
  delegatedTo     String?
  decidedAt       DateTime?
  decision        String? // "approved" | "rejected"
  comment         String?

  @@index([approvalRequestId, stepOrder])
}
```

### 0.7 Asset / Media Library Table
```prisma
model Asset {
  id          String   @id @default(cuid())
  businessId  String
  name        String
  type        String   // "image", "video", "document", "audio", "other"
  url         String
  storageKey  String
  mimeType    String?
  sizeBytes   Int?
  tags        String[]
  folder      String   @default("uncategorized")
  permissions String   @default("team") // "private" | "team" | "public"
  uploadedBy  String
  usageCount  Int      @default(0)
  metadata    Json?    // dimensions, duration, etc.
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([businessId, type])
  @@index([businessId, tags])
  @@index([businessId, folder])
}
```

---

## Phase 1: Business Event Service + Interceptor (Week 1-2)

### 1.1 BusinessEventService
```typescript
@Injectable()
export class BusinessEventService {
  async emit(event: CreateBusinessEventInput): Promise<BusinessEvent>;
  async emitBatch(events: CreateBusinessEventInput[]): Promise<void>;
  async getTimeline(subjectType: string, subjectId: string, limit?: number): Promise<BusinessEvent[]>;
  async getAuditTrail(businessId: string, filters: AuditFilter): Promise<BusinessEvent[]>;
  async getKpiStats(businessId: string, windowDays: number): Promise<KpiStats>;
}
```

### 1.2 Auto-Log Interceptor
```typescript
@Injectable()
export class BusinessEventInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    // After handler completes, diff request body vs response
    // Create BusinessEvent with before/after
    // Skip if @SkipBusinessEvent() decorator present
  }
}
```

Apply globally or per-controller:
```typescript
@UseInterceptors(BusinessEventInterceptor)
```

### 1.3 Backfill Strategy
- Run migration script that reads `TeamActivityLog`, `ContactAuditEntry`, `DocumentChangeLog`
- Converts each to `BusinessEvent` format
- Marks as `migrated: true` in metadata
- Estimated volume: assess before running

---

## Phase 2: Evidence System (Week 2)

### 2.1 EvidenceService
```typescript
@Injectable()
export class EvidenceService {
  async submit(data: SubmitEvidenceInput): Promise<Evidence>;
  async verify(evidenceId: string, verifierId: string): Promise<Evidence>;
  async getForObject(linkedType: string, linkedId: string): Promise<Evidence[]>;
  async validateChecksum(evidenceId: string): Promise<boolean>;
}
```

### 2.2 Task Completion Flow
Modify task completion to require evidence when `evidenceRequired = true`:
```typescript
async completeTask(taskId: string, input: CompleteTaskInput) {
  if (task.evidenceRequired && !input.evidenceIds?.length) {
    throw new Error('Evidence required before task can be completed');
  }
  // ... mark complete, create BusinessEvent
}
```

### 2.3 UI Components
- `EvidenceUploader` — drag-and-drop with type selection
- `EvidenceGallery` — grid view for an object
- `EvidenceBadge` — shows verification status

---

## Phase 3: Polymorphic Task Assignment (Week 2-3)

### 3.1 AssignmentService
```typescript
@Injectable()
export class AssignmentService {
  async assign(taskType: string, taskId: string, assignee: AssignableRef, assignedBy: string): Promise<TaskAssignment>;
  async unassign(taskType: string, taskId: string, assignee: AssignableRef): Promise<void>;
  async getAssignees(taskType: string, taskId: string): Promise<AssignableRef[]>;
  async getTasksForAssignee(assignee: AssignableRef, filters?: TaskFilter): Promise<Task[]>;
  async reassign(taskType: string, taskId: string, from: AssignableRef, to: AssignableRef, reason: string): Promise<void>;
}
```

### 3.2 Migration
```typescript
// Backfill ContactTask.assigneeId
for (const task of contactTasks) {
  if (task.assigneeId) {
    await assignmentService.assign('ContactTask', task.id, {
      type: 'User',
      id: task.assigneeId,
    }, 'migration');
  }
}
```

### 3.3 UI Updates
- Task creation form: assignee picker with tabs (Users, Staff, Contractors, KEY)
- Task detail: show assignment history
- Dashboard: "My Tasks" works for all assignable types

---

## Phase 4: General Approval Engine (Week 3-4)

### 4.1 ApprovalRequestService
```typescript
@Injectable()
export class ApprovalRequestService {
  async create(data: CreateApprovalRequestInput): Promise<ApprovalRequest>;
  async submitForApproval(requestId: string): Promise<void>;
  async decide(stepId: string, decision: 'approved' | 'rejected', comment?: string): Promise<void>;
  async delegate(stepId: string, delegateeId: string): Promise<void>;
  async checkThreshold(request: ApprovalRequest): Promise<boolean>; // auto-approve
  async escalateIfStale(): Promise<void>;
}
```

### 4.2 Integration Points
- **Quote approval:** When discount > threshold, create ApprovalRequest
- **Expense approval:** Any expense above $X requires approval
- **Content delivery:** If `approvalRequired = true`, block Drive upload
- **AI action:** Route through existing `AiApprovalItem` or new `ApprovalRequest`

### 4.3 UI
- Approval inbox (manager view)
- Approval detail with context and evidence
- Batch actions
- Approval history

---

## Phase 5: Content Operations Pipeline (Week 4-6)

### 5.1 ContentRequestService
```typescript
@Injectable()
export class ContentRequestService {
  async create(data: CreateContentRequestInput): Promise<ContentRequest>;
  async generateBrief(requestId: string): Promise<ContentBrief>;
  async assign(requestId: string, teamMemberIds: string[]): Promise<void>;
  async submitDraft(requestId: string, files: FileInput[]): Promise<void>;
  async requestReview(requestId: string): Promise<void>;
  async approve(requestId: string, userId: string): Promise<void>;
  async requestRevision(requestId: string, feedback: string): Promise<void>;
  async createDeliveryPackage(requestId: string): Promise<ContentDeliveryPackage>;
}
```

### 5.2 Content Staff Dashboard
- Queue: New requests → Assigned → In Production → Review → Ready for Delivery
- Brief viewer with asset requirements
- Draft upload with version history
- QA checklist per content type
- User approval/rejection with feedback

### 5.3 Drive Delivery
```typescript
@Injectable()
export class ContentDeliveryService {
  async provisionFolder(request: ContentRequest): Promise<string>; // Drive folder ID
  async queueUpload(requestId: string): Promise<DriveUploadJob>;
  async processUploadJob(jobId: string): Promise<void>;
  async notifyDelivery(requestId: string): Promise<void>;
}
```

### 5.4 KEY Integration
Add to `FlowOrchestratorService` tools:
- `content_create_request` — KEY creates ContentRequest from business signals
- `content_generate_brief` — KEY generates brief from request
- `content_create_delivery_job` — KEY queues Drive upload after approval

---

## Phase 6: Call Task System (Week 5)

### 6.1 CallTaskService
```typescript
@Injectable()
export class CallTaskService {
  async createFromNextAction(action: NextAction): Promise<ContactTask>;
  async logCall(data: LogCallInput): Promise<CallLog>;
  async getScheduledCalls(callerId: string, date: Date): Promise<CallLog[]>;
  async createFollowUp(callLogId: string): Promise<ContactTask>;
}
```

### 6.2 CRM Integration
- When `NextAction.type === 'call'`, create `ContactTask` + `CallLog` (scheduled)
- Attach call script from sequence step or AI-generated talking points
- On completion, log outcome and create follow-up if needed

### 6.3 UI
- Call queue (today's scheduled calls)
- Call detail: contact info, script, outcome form
- Call history per contact

---

## Phase 7: KEY Enhancement (Week 6-8)

### 7.1 KEY Planner: Content Request Creation
```typescript
// In MorningBriefingService or PatternDetector
async detectContentNeeds(businessId: string): Promise<ContentNeed[]> {
  // High inventory + low sales → promotion content
  // New product → launch content
  // Seasonal opportunity → seasonal content
  // No posts in N days → engagement content
}
```

### 7.2 KEY Auditor
```typescript
@Injectable()
export class KeyAuditorService {
  async checkEvidence(taskId: string): Promise<AuditResult>;
  async checkApproval(requestId: string): Promise<AuditResult>;
  async checkChannelUsage(communicationEventId: string): Promise<AuditResult>;
  async checkDriveDelivery(requestId: string): Promise<AuditResult>;
}
```

### 7.3 KEY Monitor
```typescript
@Injectable()
export class KeyMonitorService {
  async checkOverdueTasks(): Promise<Alert[]>;
  async checkStuckContentRequests(): Promise<Alert[]>;
  async checkFailedUploads(): Promise<Alert[]>;
  async checkUnconfirmedBookings(): Promise<Alert[]>;
  async generateDailyDigest(businessId: string): Promise<Digest>;
}
```

### 7.4 Tool Registry Additions
Add to `flow-tool-registry.ts`:
- `content_create_request`
- `content_generate_brief`
- `content_approve_for_delivery`
- `drive_queue_upload`
- `call_create_task`
- `call_log_outcome`
- `evidence_submit`
- `approval_create_request`

---

## Phase 8: Asset Management (Week 7-8)

### 8.1 AssetService
```typescript
@Injectable()
export class AssetService {
  async upload(file: Buffer, metadata: AssetMetadata): Promise<Asset>;
  async getById(id: string): Promise<Asset>;
  async search(businessId: string, query: AssetSearch): Promise<Asset[]>;
  async tag(assetId: string, tags: string[]): Promise<Asset>;
  async trackUsage(assetId: string, usedIn: { type: string; id: string }): Promise<void>;
}
```

### 8.2 UI
- Media library grid with folders
- Upload dropzone
- Tag editor
- Usage tracking
- Asset picker in content request forms

---

## Database Migration Order

1. **Migration 1:** `BusinessEvent` table
2. **Migration 2:** `Evidence` table
3. **Migration 3:** `TaskAssignment` table + backfill
4. **Migration 4:** `ContentRequest`, `ContentDeliveryPackage` tables
5. **Migration 5:** `CallLog` table
6. **Migration 6:** `ApprovalRequest`, `ApprovalStep` tables
7. **Migration 7:** `Asset` table
8. **Migration 8:** Add `evidenceRequired` to `ContactTask`, `ProjectTask`
9. **Migration 9:** Add `contentRequestId` to `ContentBrief`
10. **Migration 10:** Add `callLogId` to `ContactTask`

---

## API Endpoint Plan

### Business Events
```
GET    /businesses/:id/events
GET    /businesses/:id/events/timeline/:subjectType/:subjectId
POST   /businesses/:id/events/query
```

### Evidence
```
POST   /businesses/:id/evidence
GET    /businesses/:id/evidence
GET    /evidence/:id
POST   /evidence/:id/verify
GET    /businesses/:id/evidence/for/:linkedType/:linkedId
```

### Task Assignments
```
POST   /tasks/:taskType/:taskId/assign
DELETE /tasks/:taskType/:taskId/assign/:assignmentId
GET    /tasks/:taskType/:taskId/assignees
GET    /assignees/:type/:id/tasks
```

### Content Requests
```
POST   /businesses/:id/content-requests
GET    /businesses/:id/content-requests
GET    /content-requests/:id
PATCH  /content-requests/:id
POST   /content-requests/:id/generate-brief
POST   /content-requests/:id/assign
POST   /content-requests/:id/submit-draft
POST   /content-requests/:id/request-review
POST   /content-requests/:id/approve
POST   /content-requests/:id/request-revision
POST   /content-requests/:id/create-delivery
```

### Approvals
```
POST   /businesses/:id/approvals
GET    /businesses/:id/approvals
GET    /approvals/:id
POST   /approvals/:id/decide
POST   /approvals/:id/delegate
```

### Call Logs
```
POST   /businesses/:id/calls
GET    /businesses/:id/calls
GET    /calls/:id
PATCH  /calls/:id
POST   /calls/:id/follow-up
```

### Assets
```
POST   /businesses/:id/assets
GET    /businesses/:id/assets
GET    /assets/:id
PATCH  /assets/:id
DELETE /assets/:id
```

---

## Testing Strategy

### Unit Tests
- BusinessEventService: emit, batch, timeline, audit trail
- EvidenceService: submit, verify, checksum validation
- AssignmentService: assign, unassign, reassign
- ApprovalRequestService: create, decide, delegate, threshold
- ContentRequestService: full lifecycle

### Integration Tests
- Content request → brief → assignment → draft → approval → Drive delivery
- Task creation → assignment → evidence submission → completion → audit
- Approval request → multi-step chain → decision → business event
- Failed Drive upload → retry → success → delivery event

### E2E Tests
- Manager creates content request → KEY detects need → staff assigned → draft uploaded → manager approves → files in Drive
- Sales user submits quote with discount → approval required → manager approves → quote sent → business event logged
- Technician completes job → submits photo evidence → task complete → invoice created

---

## Success Criteria

After all phases:
- [ ] Every mutation creates a `BusinessEvent`
- [ ] Tasks can be assigned to Users, Staff, Contractors, or KEY
- [ ] Task completion requires evidence when configured
- [ ] Content requests flow from need → brief → production → approval → Drive delivery
- [ ] General approvals support multi-step chains and thresholds
- [ ] Call tasks are persistent with outcomes and follow-ups
- [ ] KEY can create content requests, Drive upload jobs, and call tasks
- [ ] All business events are auditable in a unified timeline
- [ ] Dashboard shows: priorities, overdue, blocked, pending approvals, content status
- [ ] No unvalidated string IDs for assignments

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Migration breaks existing tasks | Backfill in transaction, keep old columns until verified |
| BusinessEvent table grows too fast | Partition by month, archive after 90 days, compress JSON |
| Approval engine conflicts with AiApprovalItem | Gradually migrate AiApprovalItem → ApprovalRequest, keep both during transition |
| Content request schema too rigid | Use `metadata` JSON for extensibility, iterate based on usage |
| Drive upload failures | Retry queue with exponential backoff, alert on persistent failures |
| Task assignment migration loses data | Dry-run migration, validate counts before commit |

---

## Conclusion

This plan transforms Keyflow OS from a feature-rich but fragmented system into a unified business operating system. The phases are ordered by dependency:

1. **Schema first** — all new tables in Phase 0
2. **Event log** — enables audit and analytics for everything after
3. **Core primitives** — evidence, assignment, approval
4. **Vertical workflows** — content, calls
5. **AI integration** — KEY uses all the above

Each phase is designed to be shippable independently. Start with Phase 0 and Phase 1 — they unblock everything else.
