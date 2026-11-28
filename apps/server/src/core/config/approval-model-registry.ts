/**
 * RR-APPROVAL-MODEL-CENSUS (D-261, D-262, D-17, D-226, D-238, D-103)
 *
 * REC-ONE-APPROVAL-MODEL, first slice only (read-only static census).
 *
 * Canonical inventory of every writer in `apps/server/src` across the five
 * approval-shaped Prisma models plus Flow inline confirmations stored as
 * `IdempotencyKey` rows:
 *   1. `KeyActionProposal` (`key_action_proposals`)  — kind: 'KEY action proposal'
 *   2. `AiApprovalItem`    (`ai_approval_items`)     — kind: 'KEY approval queue'
 *   3. `ApprovalRequest`   (`approval_requests`)     — kind: 'human workflow approval'
 *   4. `ApprovalStep`      (`approval_steps`)        — kind: 'human workflow approval'
 *   5. `AiApprovalRequest` (`ai_approval_requests`)  — kind: 'dormant' (zero live code refs)
 *   6. `IdempotencyKey`    (`idempotency_keys`, `flow-confirm:*`) — kind: 'Flow confirmation'
 *
 * Enforced by `approval-model-census.spec.ts`:
 *  - Any unregistered writer fails CI.
 *  - Any stale row whose writer was removed/renamed fails CI.
 *  - `AiApprovalRequest` must remain dormant (zero code references, singular or plural).
 *  - Writers where an effect can run without the approval created/managed are
 *    explicitly flagged (`effectRunsWithoutApproval: true` + `bypassNote`) to
 *    become REDs in their own follow-up packets.
 *
 * Read-only: changes no writer, changes no schema, and preserves D-226/D-238
 * proposal visibility rules untouched.
 */

export type ApprovalModelName =
  | 'KeyActionProposal'
  | 'AiApprovalItem'
  | 'ApprovalRequest'
  | 'ApprovalStep'
  | 'AiApprovalRequest'
  | 'IdempotencyKey';

export type ApprovalWriterKind =
  | 'KEY action proposal'
  | 'KEY approval queue'
  | 'human workflow approval'
  | 'Flow confirmation'
  | 'dormant';

export interface ApprovalModelWriterEntry {
  readonly model: ApprovalModelName;
  readonly file: string;
  readonly method: string;
  readonly kind: ApprovalWriterKind;
  readonly gatedEffect: string;
  readonly executionSite: string;
  readonly clearerScope: string;
  readonly manualPath: string;
  /**
   * True when an effect can run without the approval row this writer creates or
   * when this writer clears/commits without enforcing prior approval.
   */
  readonly effectRunsWithoutApproval: boolean;
  readonly bypassNote?: string;
}

export const APPROVAL_MODEL_WRITERS: readonly ApprovalModelWriterEntry[] = [
  // ── 1. Dormant model (AiApprovalRequest) ──────────────────────────────────
  {
    model: 'AiApprovalRequest',
    file: 'packages/db/prisma/schema.prisma',
    method: '<dormant>',
    kind: 'dormant',
    gatedEffect: 'None — schema table `ai_approval_requests` has zero live writers or readers in server code.',
    executionSite: 'none (dormant)',
    clearerScope: 'none (dormant — candidate for future retirement migration)',
    manualPath: 'none (dormant)',
    effectRunsWithoutApproval: false,
  },

  // ── 2. KEY Approval Queue (AiApprovalItem) ────────────────────────────────
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai-oversight.service.ts',
    method: 'createApprovalItem',
    kind: 'KEY approval queue',
    gatedEffect:
      'Queues high-risk Flow chat, graph action, plan step, drive/message/ingestion intake, or delegation-loop tool invocations requiring formal/admin approval.',
    executionSite:
      'apps/server/src/modules/ai/graph-actions.controller.ts#executeAction and apps/server/src/modules/ai/plan-executor.service.ts (plan steps); apps/server/src/modules/commerce/drive-intake-orchestrator.service.ts#executePlan, apps/server/src/modules/communications/message-intake-orchestrator.service.ts#executePlan, and apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts#execute (intake executors — bypass AiApprovalItem gate); chat/delegation callers queue items without an automatic executor unless migrated to KeyActionProposal.',
    clearerScope:
      'Authenticated member with operations:write + membershipApprovalTier >= item.riskTier (or SUPER_ADMIN) via AiApprovalsController; ai:write + membershipApprovalTier >= item.riskTier (or SUPER_ADMIN) via AiController; resolved OrgAssignment holder with autoApprovalViaReply=true & capped position tier >= item.riskTier via StaffChatBridgeService; or post-hoc resolution by DriveIntakeOrchestrator/MessageIntakeOrchestrator.',
    manualPath:
      'POST /ai-approvals/businesses/:businessId/items/:itemId/resolve, POST /ai-approvals/businesses/:businessId/items/bulk-resolve, POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, POST /ai/businesses/:businessId/ai/approvals/batch-resolve, or reply approval via StaffChatBridgeService.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'Three intake executors queue an AiApprovalItem via createApprovalItem but execute all side effects without checking AiApprovalItem.status==="approved": DriveIntakeOrchestrator.executePlan (commits invoices/payments/credit notes/notifications/tasks before resolvePendingApproval), MessageIntakeOrchestrator.executePlan (creates threads, sends email/SMS/WhatsApp replies, tasks/notes via a route without ModuleScopeGuard before resolvePendingApproval), and IngestionOrchestratorService.execute (runs without checking or, for message sources, resolving the AiApprovalItem).',
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai-oversight.service.ts',
    method: 'routeAndNotify',
    kind: 'KEY approval queue',
    gatedEffect:
      'Records resolved approverAssignmentId, approverMethod, and notifiedAt metadata on a queued AiApprovalItem (routing/notification bookkeeping only).',
    executionSite: 'none (routing metadata update; does not execute gated tool)',
    clearerScope: 'Internal fire-and-forget from AiOversightService.createApprovalItem; does not clear the item.',
    manualPath:
      'Shared AiApprovalItem queue visible via GET /ai-approvals/businesses/:businessId/items and GET /actions/businesses/:businessId/queue.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai-oversight.service.ts',
    method: 'finalizeResolution',
    kind: 'KEY approval queue',
    gatedEffect:
      'Marks AiApprovalItem approved/rejected/deferred; when approved with a planStepId, resets AiPlanStep.status to pending so the gated plan step can run.',
    executionSite:
      'apps/server/src/modules/ai/graph-actions.controller.ts#executeAction and apps/server/src/modules/ai/plan-executor.service.ts (executes unlocked AiPlanStep); also invoked post-hoc AFTER side effects have already committed by DriveIntakeOrchestrator.resolvePendingApproval and MessageIntakeOrchestrator.resolvePendingApproval.',
    clearerScope:
      'Called by resolveApproval (AiApprovalsController with AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + membershipApprovalTier >= riskTier or SUPER_ADMIN; or post-hoc from DriveIntakeOrchestrator/MessageIntakeOrchestrator) and resolveApprovalByAssignment (resolved OrgAssignment with autoApprovalViaReply=true & approvalTierForPosition >= riskTier).',
    manualPath:
      'POST /ai-approvals/businesses/:businessId/items/:itemId/resolve, POST /ai-approvals/businesses/:businessId/items/bulk-resolve, reply-based approval via StaffChatBridgeService (WhatsApp/SMS), or post-hoc via intake approve endpoints.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'DriveIntakeOrchestrator.executePlan (POST /commerce/businesses/:businessId/drive/intake/:intakeFileId/approve) and MessageIntakeOrchestrator.executePlan (POST /communications/businesses/:businessId/message-intake/:intakeId/approve, lacking ModuleScopeGuard) run all mutations first and only invoke resolveApproval -> finalizeResolution afterward.',
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai-oversight.service.ts',
    method: 'escalateStaleApprovals',
    kind: 'KEY approval queue',
    gatedEffect:
      'Marks overdue pending AiApprovalItems escalated — or auto-approves tier 1–2 items when autonomyLevel >= 3 and resets linked AiPlanStep.status to pending.',
    executionSite:
      'apps/server/src/modules/ai/graph-actions.controller.ts#executeAction and apps/server/src/modules/ai/plan-executor.service.ts (can execute auto-approved plan step).',
    clearerScope:
      'Automated timeout sweep (no human clearer recorded for tier <= 2 auto-approvals when autonomyLevel >= 3; tier 3–4 marked escalated only).',
    manualPath:
      'Human resolution before timeout via POST /ai-approvals/businesses/:businessId/items/:itemId/resolve or POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, or lowering autonomyLevel < 3.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'When settings.autonomyLevel >= 3 and item.riskTier <= 2, escalateStaleApprovals auto-marks the AiApprovalItem approved with no human clearer and re-opens linked AiPlanStep to pending after approvalTimeoutHours.',
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai.controller.ts',
    method: 'resolveLegacyApproval',
    kind: 'KEY approval queue',
    gatedEffect:
      'Defers a legacy AiApprovalItem directly, or migrates it to a KeyActionProposal, approves/rejects the proposal (autoExecute=false), and mirrors resolution onto the legacy AiApprovalItem.',
    executionSite:
      'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts#execute (explicit post-approval execution of the migrated KeyActionProposal) and apps/server/src/modules/ai/plan-executor.service.ts#onProposalApproved (listens to key.action.approved, resets linked AiPlanStep to pending, and re-enqueues execution).',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(ai:write) + assertCanResolveApproval (membershipApprovalTier >= riskTier or SUPER_ADMIN).',
    manualPath:
      'POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve and POST /ai/businesses/:businessId/ai/approvals/batch-resolve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/ai.controller.ts',
    method: 'migrateAiApprovalItemToProposal',
    kind: 'KEY approval queue',
    gatedEffect:
      'Links a legacy AiApprovalItem (`migratedToProposalId`) to its newly created canonical KeyActionProposal during legacy resolution.',
    executionSite: 'none (migration link bookkeeping prior to KeyActionProposal approval/execution)',
    clearerScope:
      'Invoked only from AiController.resolveLegacyApproval after AuthGuard + BusinessGuard + ModuleScopeGuard(ai:write) + assertCanResolveApproval.',
    manualPath:
      'POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve and POST /ai/businesses/:businessId/ai/approvals/batch-resolve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'attributeApprovalItem',
    kind: 'KEY approval queue',
    gatedEffect:
      'Stamps the confirming member userId onto an already-queued AiApprovalItem created during a confirmed Flow chat turn (requester attribution only).',
    executionSite: 'none (requester attribution update; item remains pending)',
    clearerScope: 'Internal post-create attribution after claimFlowConfirmation verifies requestedBy === userId.',
    manualPath:
      'POST /ai-approvals/businesses/:businessId/items/:itemId/resolve or POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/ai/graph-actions.controller.ts',
    method: 'executeAction',
    kind: 'KEY approval queue',
    gatedEffect:
      'Stamps requester userId onto an AiApprovalItem just queued when an AI plan step requires formal/admin approval before executeToolDirect runs.',
    executionSite:
      'apps/server/src/modules/ai/graph-actions.controller.ts#executeAction (executes FlowOrchestratorService.executeToolDirect only once an approved AiApprovalItem exists for planStepId).',
    clearerScope:
      'Queues on behalf of authenticated graph-action caller; cleared by member with operations:write (AiApprovalsController) or ai:write (AiController) + membershipApprovalTier >= riskTier.',
    manualPath:
      'POST /ai-approvals/businesses/:businessId/items/:itemId/resolve or POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/commerce/quote-stale.listener.ts',
    method: 'handleQuoteStale',
    kind: 'KEY approval queue',
    gatedEffect:
      'Creates a tier-1 Action Queue card (`commerce_send_quote_reminder`) prompting follow-up on a stale sent quote.',
    executionSite:
      'apps/server/src/modules/commerce/commerce.controller.ts#sendQuoteFollowUp -> CommerceService.markQuoteFollowedUp.',
    clearerScope:
      'Either resolved directly via CommerceController.sendQuoteFollowUp (revenue:write), AiApprovalsController (operations:write + tier >= 1), or AiController (ai:write + tier >= 1).',
    manualPath:
      'POST /commerce/businesses/:businessId/quotes/:quoteId/follow-up (one-click Action Queue button), POST /ai-approvals/businesses/:businessId/items/:itemId/resolve, or POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'Stale-quote follow-up executes directly in CommerceController.sendQuoteFollowUp without checking whether an AiApprovalItem was previously approved; the card is advisory only.',
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/commerce/commerce.controller.ts',
    method: 'sendQuoteFollowUp',
    kind: 'KEY approval queue',
    gatedEffect:
      'Marks pending `commerce_send_quote_reminder` AiApprovalItems for the quote as approved AFTER executing markQuoteFollowedUp.',
    executionSite:
      'apps/server/src/modules/commerce/commerce.controller.ts#sendQuoteFollowUp (calls this.commerce.markQuoteFollowedUp before updating AiApprovalItem).',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(revenue:write) + assertSuperAdminMayWriteRevenue (does not check membershipApprovalTier).',
    manualPath: 'POST /commerce/businesses/:businessId/quotes/:quoteId/follow-up.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'Executes markQuoteFollowedUp first and then marks matching pending AiApprovalItems approved under revenue:write without prior approval or membershipApprovalTier enforcement.',
  },
  {
    model: 'AiApprovalItem',
    file: 'apps/server/src/modules/identity/identity.service.ts',
    method: 'reconcileUserId',
    kind: 'KEY approval queue',
    gatedEffect:
      'Re-points AiApprovalItem.userId and AiApprovalItem.resolvedByUserId FK references from an old User.id to a reconciled Supabase User.id during auth identity merge.',
    executionSite: 'none (identity FK reconciliation; does not alter approval status or trigger effects)',
    clearerScope: 'Internal auth identity reconciliation transaction (IdentityService.reconcileUserId).',
    manualPath: 'Automatic during login/identity reconciliation; no manual approval action.',
    effectRunsWithoutApproval: false,
  },

  // ── 3. Flow Inline Confirmations (IdempotencyKey `flow-confirm:*`) ────────
  {
    model: 'IdempotencyKey',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'bindFlowConfirmation',
    kind: 'Flow confirmation',
    gatedEffect:
      'Binds a Flow tool call (toolName, canonical args, requestedBy, crew, surface, 24h TTL, SHA-256 requestHash) to a server-issued `flowc_*` confirmation id for non-boundary tools.',
    executionSite:
      'apps/server/src/modules/ai/flow-orchestrator.service.ts#chat -> this.executeTool (which calls executeToolAction) or escalates to AiApprovalItem after claimFlowConfirmation succeeds.',
    clearerScope:
      'Strictly the same authenticated member (`bound.requestedBy === userId`) in the same businessId before expiresAt; memberless turns cannot bind or confirm.',
    manualPath:
      'POST /ai/businesses/:businessId/flow/confirm or POST /ai/businesses/:businessId/flow/chat (with body.pendingConfirmation).',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'IdempotencyKey',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'claimFlowConfirmation',
    kind: 'Flow confirmation',
    gatedEffect:
      'Single-use compare-and-set transition of `flow-confirm:<id>` (`pending` -> `claimed`/`cancelled`/`expired`, then `settle` -> `completed`/`failed`/`refused`) gating execution of the server-bound Flow tool call.',
    executionSite:
      'apps/server/src/modules/ai/flow-orchestrator.service.ts#chat -> this.executeTool (runs bound tool only on `claim.kind === "claimed"` and re-evaluates governance).',
    clearerScope:
      'Authenticated business member matching `bound.requestedBy === userId` with intact `requestHash` and unexpired TTL; refuses boundary-adopted tools.',
    manualPath:
      'POST /ai/businesses/:businessId/flow/confirm or POST /ai/businesses/:businessId/flow/chat (with body.pendingConfirmation).',
    effectRunsWithoutApproval: false,
  },

  // ── 4. Human Workflow Approvals (ApprovalRequest & ApprovalStep) ──────────
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'createRequest',
    kind: 'human workflow approval',
    gatedEffect:
      'Creates a multi-step human workflow ApprovalRequest (auto-approved if allowAutoApprove && amount <= threshold, else pending + shadow-migrated to KeyActionProposal) and emits approval.created / approval.auto_approved.',
    executionSite:
      'none (event-only: emits approval.created / approval.auto_approved; no server listener executes a gated effect on approval, and ContentRequestService.transitionStatus commits status="approved" before calling createRequest).',
    clearerScope:
      'Created via ApprovalController (operations:write or requestType module write; auto-approve only if operations:write), ContentRequestService, or Flow tool; cleared by assigned step approverId/delegatedTo with operations:write.',
    manualPath:
      'POST /businesses/:businessId/approvals to create; POST /businesses/:businessId/approvals/:approvalId/approve|reject|delegate to decide.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'ContentRequestService.transitionStatus updates contentRequest.status to "approved" BEFORE calling ApprovalRequestService.createRequest (and swallows errors), and no downstream listener gates execution on approval.step_approved.',
  },
  {
    model: 'ApprovalStep',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'createRequest',
    kind: 'human workflow approval',
    gatedEffect:
      'Creates ordered ApprovalStep rows nested inside ApprovalRequestService.createRequest (auto-approved when under threshold with allowAutoApprove, else pending).',
    executionSite:
      'none (event-only step chain; no server listener executes a downstream effect upon step completion).',
    clearerScope:
      'Each step cleared only by its assigned approverId or delegatedTo via ApprovalController (AuthGuard, BusinessGuard, ModuleScopeGuard operations:write).',
    manualPath:
      'POST /businesses/:businessId/approvals/:approvalId/approve, /reject, or /delegate.',
    effectRunsWithoutApproval: true,
    bypassNote:
      'Steps belong to ApprovalRequest whose callers (e.g. ContentRequestService.transitionStatus) commit state changes without waiting for step approval.',
  },
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'decideStep',
    kind: 'human workflow approval',
    gatedEffect:
      'Advances ApprovalRequest.currentStep or resolves the request as approved/rejected in the same transaction as deciding the current ApprovalStep, emitting approval.step_approved / approval.step_rejected.',
    executionSite: 'none (emits EventEmitter2 event only; no downstream executor subscribes to approval.step_approved)',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + tenant match (requestInBusiness) + currentStep.approverId or delegatedTo === principal.',
    manualPath:
      'POST /businesses/:businessId/approvals/:approvalId/approve or /reject (also exposed via Flow tool approval_decide_step, which passes hardcoded approverId="key_ai").',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalStep',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'decideStep',
    kind: 'human workflow approval',
    gatedEffect:
      'Records approve/reject decision, decidedAt, and comment on the active ApprovalStep inside the decideStep transaction.',
    executionSite: 'none (updates ApprovalStep and parent ApprovalRequest state only)',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + tenant match + currentStep.approverId or delegatedTo === principal.',
    manualPath:
      'POST /businesses/:businessId/approvals/:approvalId/approve or /reject (also Flow tool approval_decide_step).',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalStep',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'delegateStep',
    kind: 'human workflow approval',
    gatedEffect:
      'Marks the active pending ApprovalStep as delegated and records delegatedTo so another user may decide the step (note: sets status="delegated", which currently excludes the step from decideStep status==="pending" lookup).',
    executionSite: 'none (step delegation state update only)',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + tenant match + currentStep.approverId === principal.',
    manualPath: 'POST /businesses/:businessId/approvals/:approvalId/delegate.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'cancelRequest',
    kind: 'human workflow approval',
    gatedEffect: 'Marks a pending ApprovalRequest as cancelled and emits approval.cancelled.',
    executionSite: 'none (terminal cancellation state only)',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + tenant match + request.requesterId === principal.',
    manualPath: 'DELETE /businesses/:businessId/approvals/:approvalId.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'escalateRequest',
    kind: 'human workflow approval',
    gatedEffect: 'Moves a pending ApprovalRequest to terminal escalated status and emits approval.escalated.',
    executionSite: 'none (terminal escalation state only)',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) + authenticated principal + tenant match (requestInBusiness).',
    manualPath: 'POST /businesses/:businessId/approvals/:approvalId/escalate.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/approvals/approval-request.service.ts',
    method: 'shadowMigrateToProposal',
    kind: 'human workflow approval',
    gatedEffect:
      'Records `migratedToProposalId` linking a newly created pending ApprovalRequest to its shadow KeyActionProposal.',
    executionSite: 'none (shadow-migration link bookkeeping only)',
    clearerScope: 'Internal helper invoked from ApprovalRequestService.createRequest.',
    manualPath: 'Visible in KeyActionProposal queue via GET /key-autonomy/businesses/:businessId/actions/proposals.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'ApprovalRequest',
    file: 'apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts',
    method: 'cleanExpiredApprovals',
    kind: 'human workflow approval',
    gatedEffect: 'Hard-deletes pending ApprovalRequest rows older than 7 days during Cortex reflection maintenance.',
    executionSite: 'none (maintenance cleanup; executes no gated effect)',
    clearerScope: 'Internal Cortex reflection maintenance job (no human actor).',
    manualPath: 'Decide pending requests within 7 days via POST /businesses/:businessId/approvals/:approvalId/approve|reject.',
    effectRunsWithoutApproval: false,
  },

  // ── 5. KEY Action Proposals — Action Boundary (KeyActionProposal) ─────────
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'prepare',
    kind: 'KEY action proposal',
    gatedEffect:
      'Creates (or refreshes controlRequirement on) a fingerprinted KeyActionProposal for boundary-adopted capabilities (currently helpdesk_create_ticket) before any side effect may admit.',
    executionSite:
      'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts#admit (writes supportTicket inside the single claim transaction).',
    clearerScope:
      'Evaluated by policy: NONE (clearable on trusted surface), PRINCIPAL_CONFIRMATION (same requester), or HUMAN_APPROVAL (member with approval tier >= capability.riskTier or SUPER_ADMIN).',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/approve, POST /api/v1/cortex/actions/approve, or Flow confirm -> confirmAndExecute.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'recordEvidence',
    kind: 'KEY action proposal',
    gatedEffect:
      'Locks the proposal row FOR UPDATE, verifies live principal authority and recomputed fingerprint, and records signed ControlEvidence (`status: APPROVED`, `evidenceExpiresAt`).',
    executionSite:
      'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts#admit (re-checks ControlEvidence, expiry, fingerprint, and principal authority before committing effect).',
    clearerScope:
      'Authenticated user (`principalUserId`) verified on locked rows via readFresh + evidenceKindFor (requester for CONFIRMATION, or member with approvalTier >= capability.riskTier / SUPER_ADMIN for APPROVAL), via KeyActionProposalController (operations:write), AiController (ai:write + tier check), KeyCortexController (ai:write + CortexMemberAuthorityGuard), or Flow confirm.',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/approve, POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, POST /api/v1/cortex/actions/approve, or Flow confirm.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'sealIfUnsealed',
    kind: 'KEY action proposal',
    gatedEffect:
      'Seals an older or externally created boundary-governed KeyActionProposal with actionEnvelope, actionFingerprint, capabilityName, and monotonic carriesMoney before evidence can bind.',
    executionSite: 'none (pre-evidence sealing inside KeyActionBoundaryService.recordEvidence transaction)',
    clearerScope: 'Internal transaction helper called inside KeyActionBoundaryService.recordEvidence.',
    manualPath: 'Triggered automatically when approving an unsealed proposal for an adopted capability.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'admit',
    kind: 'KEY action proposal',
    gatedEffect:
      'Atomically claims idempotencyKey, re-verifies clearance on locked rows, executes the boundary-adopted side effect (supportTicket creation), and writes status=EXECUTED + outcomeEvidence.',
    executionSite:
      'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts#admit (effect commits in the same Prisma transaction).',
    clearerScope:
      'Requires valid ControlEvidence or policy clearance=NONE verified on locked rows inside the admission transaction.',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/execute or Flow confirmAndExecute.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'voidAction',
    kind: 'KEY action proposal',
    gatedEffect:
      'Claims the execution idempotencyKey as voided and marks a boundary-governed KeyActionProposal REJECTED or CANCELLED so it can never execute.',
    executionSite: 'none (terminal void; blocks future admission)',
    clearerScope:
      'Authenticated member via KeyActionProposalController (operations:write), AiController (ai:write + tier check), or KeyCortexController (ai:write + CortexMemberAuthorityGuard); Flow cancel enforces `onlyIfRequestedBy`.',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/reject or /cancel, POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, or POST /api/v1/cortex/actions/approve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'recordRefusal',
    kind: 'KEY action proposal',
    gatedEffect:
      'Records an admission refusal on a boundary-governed proposal (returns to PENDING if reevaluate=true, else BLOCKED) without executing the effect.',
    executionSite: 'none (refusal bookkeeping after rolled-back admission transaction)',
    clearerScope: 'Internal error handler in KeyActionBoundaryService.admit.',
    manualPath: 'Re-approve via POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/approve if PENDING.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
    method: 'recordFailure',
    kind: 'KEY action proposal',
    gatedEffect:
      'Marks a boundary-governed proposal FAILED with outcomeEvidence when the effect fails inside admission.',
    executionSite: 'none (failure bookkeeping after rolled-back admission transaction)',
    clearerScope: 'Internal error handler in KeyActionBoundaryService.admit.',
    manualPath: 'Inspect failure via GET /key-autonomy/businesses/:businessId/actions/proposals/:proposalId.',
    effectRunsWithoutApproval: false,
  },

  // ── 6. KEY Action Proposals — Core Proposal Service (KeyActionProposal) ───
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts',
    method: 'create',
    kind: 'KEY action proposal',
    gatedEffect:
      'Creates a PENDING KeyActionProposal (sealing boundary columns if adopted, computing authoritative carriesMoney per D-238/D-227) awaiting approval before execution.',
    executionSite:
      'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts#execute -> KeyActionExecutorService.execute or KeyActionBoundaryService.admit.',
    clearerScope:
      'Created via KeyActionProposalController (operations:write), Cortex orchestrator, genome bridge, or shadow migration; cleared via approve (operations:write / ai:write + authority check).',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals to create; .../approve + .../execute (or POST /api/v1/cortex/actions/approve) to clear and run.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts',
    method: 'approve',
    kind: 'KEY action proposal',
    gatedEffect:
      'Transitions a non-boundary PENDING KeyActionProposal to APPROVED via conditional updateMany while snapping the approver PrincipalAuthority into resolution JSON (for boundary proposals, delegates to recordEvidence).',
    executionSite:
      'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts#execute (executes only after claimForExecution re-verifies approver authority on locked rows) and apps/server/src/modules/ai/plan-executor.service.ts#onProposalApproved.',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) via KeyActionProposalController, ai:write + assertCanResolveApproval via AiController, or ai:write + CortexMemberAuthorityGuard via KeyCortexController; authority re-checked at execution.',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/approve, POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, or POST /api/v1/cortex/actions/approve.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts',
    method: 'claimForExecution',
    kind: 'KEY action proposal',
    gatedEffect:
      'Atomically re-checks approver authority on FOR SHARE locked user/membership/business rows; reverts lapsed approvals to PENDING (APPROVAL_LAPSED) or claims APPROVED -> EXECUTING once.',
    executionSite:
      'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts#execute -> KeyActionExecutorService.execute (runs only after EXECUTING claim wins).',
    clearerScope:
      'Requires intact approver PrincipalAuthority (SUPER_ADMIN or active Membership with approvalTier >= recorded tier; never owner_without_membership per D-104/D-125).',
    manualPath: 'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/execute.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts',
    method: 'recordBlocked',
    kind: 'KEY action proposal',
    gatedEffect:
      'Conditionally transitions an APPROVED proposal to BLOCKED when genome policy or execution guard refuses to run it.',
    executionSite: 'none (blocks execution)',
    clearerScope: 'Internal refusal write inside KeyActionProposalService.execute.',
    manualPath: 'Inspect refusal via GET /key-autonomy/businesses/:businessId/actions/proposals/:proposalId.',
    effectRunsWithoutApproval: false,
  },
  {
    model: 'KeyActionProposal',
    file: 'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts',
    method: 'writeIfStatus',
    kind: 'KEY action proposal',
    gatedEffect:
      'Conditional status-guarded updateMany backing reject (PENDING -> REJECTED), cancel (PENDING/APPROVED -> CANCELLED), and recordOutcome (EXECUTING -> EXECUTED/FAILED).',
    executionSite:
      'apps/server/src/modules/key-autonomy/key-action-proposal.service.ts#reject, #cancel, and #recordOutcome (post-execution outcome recording only).',
    clearerScope:
      'AuthGuard + BusinessGuard + ModuleScopeGuard(operations:write) via KeyActionProposalController (reject/cancel/execute), ai:write + assertCanResolveApproval via AiController, or ai:write + CortexMemberAuthorityGuard via KeyCortexController.',
    manualPath:
      'POST /key-autonomy/businesses/:businessId/actions/proposals/:proposalId/reject, /cancel, /execute, POST /ai/businesses/:businessId/ai/approvals/:approvalId/resolve, or POST /api/v1/cortex/actions/approve.',
    effectRunsWithoutApproval: false,
  },
];
