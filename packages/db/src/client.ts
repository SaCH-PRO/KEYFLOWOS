import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";
import { tokenEncryptionExtension } from "./middleware/token-encryption";
export { tokenEncryptionKeySource } from "./middleware/token-encryption";
export type { TokenEncryptionKeyVar } from "./middleware/token-encryption";

// Tenant isolation support via AsyncLocalStorage (injected at runtime by apps/server)
let _tenantContextProvider: { getCurrentBusinessId: () => string | undefined } | undefined;

export function setTenantContextProvider(provider: { getCurrentBusinessId: () => string | undefined }) {
  _tenantContextProvider = provider;
}

function getCurrentBusinessId(): string | undefined {
  return _tenantContextProvider?.getCurrentBusinessId();
}

// Enable soft delete for all models that include a deletedAt column
const softDeleteExtension = softDelete([
  "Business",
  "Contact",
  "Product",
  "Quote",
  "Invoice",
  "StaffMember",
  "Service",
  "Booking",
  "SocialPost",
  "Automation",
  "Project",
  "ProjectTask",
  "Site",
  "CalendarEvent",
]);

// Create a connection pool using the DATABASE_URL
const connectionString = process.env.DATABASE_URL;

// Create pool and adapter - adapter must be null (not undefined) if no connection string
let adapter: PrismaPg | null = null;
let pool: InstanceType<typeof Pool> | null = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Handle pool errors gracefully — don't crash the process on transient DB hiccups
  pool.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error("[PrismaPool] Unexpected pool error:", err.message);
  });

  adapter = new PrismaPg(pool as any);
}

// Default pagination guard: prevents unbounded findMany queries
const defaultTakeExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async findMany({ args, query }) {
        const take = args.take ? Math.min(args.take as number, 1000) : 1000;
        return query({ ...args, take });
      },
      async findFirst({ args, query }) {
        // findFirst is already implicitly limited to 1, but guard depth
        return query(args);
      },
    },
  },
});

// Models known to have a businessId column (auto-filtered when tenant context is active)
// NOTE: TaskAssignment intentionally excluded — it has no businessId column
// (polymorphic taskType+taskId). Injecting businessId here throws
// PrismaClientValidationError. Its tenancy is enforced at the service layer via
// TaskAssignmentService's task/assignable ownership checks.
const BUSINESS_ID_MODELS = new Set([
  'BusinessEvent', 'Evidence', 'ContentRequest',
  'ContentDeliveryPackage', 'CallLog', 'ApprovalRequest', 
  'Asset', 'Contact', 'Account', 'Deal', 'Invoice', 'Quote', 'Product',
  'Service', 'Booking', 'BookingWaitlistEntry', 'StaffMember', 'Project', 'ProjectTask', 'Expense',
  'SocialPost', 'EmailCampaign', 'DocumentInstance', 'Site', 'CalendarEvent',
  'ConnectorStatus', 'Automation', 
  'OutboundDelivery', 'CommandItem',
  'BusinessEntityLink', 'BusinessRisk', 'CashReserveBucket',
  'WorkflowTemplate', 'WorkflowRun', 'SopDocument',
  'MarketingCampaignPlan', 'BusinessInitiative',
  // Phase 3 Skeleton: KEY Cortex identity & audit tables
  'CortexSession', 'CortexActionLog', 'KeyCommand', 'AiExecutionLog',
  'KeyCortexMemory', 'AiApprovalItem', 'AiApprovalRequest',
  // Restored after a rename left the list naming models that no longer
  // exist. MessageThread/CommunicationEvent/NotificationEvent were removed
  // from this set because there are no such models; these four are what
  // they became, and every one has a businessId.
  'KeyInboxThread', 'Notification', 'CustomerNotificationLog',
  // ConversationThread was removed 2026-08-07: the model was dropped when the
  // two omnichannel inboxes were merged, so this set named a model that no
  // longer exists — the exact drift the note above describes, committed by the
  // same person who wrote the note.
  //
  // AiGoal/AiPlan added the same day. POST /cortex/goals/:goalId/plans resolved
  // a goal id from the URL with no tenant scoping at any layer, because these
  // were absent here AND the service used findUnique on the bare id. The
  // service is scoped now; this is the second layer, for the paths that do not
  // go through a controller.
  'AiGoal', 'AiPlan',

  // ── Finance / accounting / contracts cluster, added 2026-08-07 ──────────────
  // 30 models audited at every one of their 98 unscoped call sites (two rounds,
  // 40 agents, adversarially verified). Verdicts: every site is either
  // check-then-act on an HTTP path — where injection closes the window between
  // the ownership read and the bare-id write — or unreachable with a tenant
  // context at all, where it is inert. Three sites needed a fix first and got
  // one; see __skipTenantIsolation in posting.service.ts and the note below.
  //
  // What this does NOT protect, stated so nobody reads more into it:
  //   • cron / setInterval / BullMQ / WebSocket / provider-webhook paths. The
  //     interceptor is HTTP-only, so activeBusinessId() is undefined there and
  //     these entries do nothing. Several of those sweeps iterate every tenant
  //     BY DESIGN; the explicit `where: { businessId }` remains their only scope.
  //   • create / createMany / upsert / aggregate / groupBy — not hooked.
  //     A cross-tenant CREATE cannot be stopped here. It is stopped by binding
  //     businessId from the route param, never from the request body.
  'AccountingPeriod', 'BankConnection', 'BankRule', 'BankTransaction',
  'ChartOfAccount', 'Contract', 'ContractAlert', 'ContractParty',
  'ContractTerm', 'ContractVersion', 'CreditNote', 'DealStage',
  'ExpenseBudget', 'ExpenseCategory', 'FinancialAccount', 'FinancialTransaction',
  'FixedAsset', 'LedgerEntry', 'PaymentLink', 'PreOrder', 'PurchaseOrder',
  'RecurringExpense', 'RecurringInvoice', 'RecurringJournalEntry',
  'RevenueAction', 'RevenueAttribution', 'Subscription', 'TaxLiability',
  'TaxRate',

  // ── Batch 1 of the unscoped-ledger reduction, 2026-08-09 ─────────────────
  // Each verified individually, not by the scanner: seven have ZERO findUnique
  // call sites, and BusinessSetting's single one already keys on businessId, so
  // scoping injects the value it already had. None is reachable by a global
  // external key — the lookup that would otherwise become a silent null.
  'BusinessSetting', 'BusinessSnapshot', 'BusinessHealthSnapshot', 'AiUsageLog',
  'ActivityLog', 'AutonomyVerdict', 'AiQualitySignal', 'BusinessSignal',

  // ── Batch 2 of the unscoped-ledger reduction, 2026-08-09 ─────────────────
  // Criterion: ZERO findUnique call sites anywhere in apps/server/src, so no
  // unique lookup exists that an injected businessId could turn into a silent
  // null. Deferred from this batch, for individual review: anything resolved
  // BEFORE a tenant is known or by an external key — ApiKey, AuthorityGrant,
  // Channel*/Connection*/Account*, tokens, credentials, webhooks, sync state.
  // What remains is findFirst/findMany gaining the tenant filter, which is the
  // point, and update/delete failing across tenants, which is also the point.
  'Activity', 'AgentMessage', 'AiMemoryEmbedding', 'AiPlanResult',
  'AiSuggestionEvent', 'AiUsageAlert', 'AttributionResult', 'AutomationOutcome',
  'AutonomyRule', 'BusinessAsset', 'BusinessGoal', 'BusinessMatch',
  'BusinessPlan', 'BusinessProfileVersion', 'BusinessRule', 'BusinessTemplateUsage',
  'Campaign', 'CognitionMemory', 'CognitiveEvent', 'CohortMember',
  'CommercialDocumentTemplate', 'CommunityComment', 'CommunityNotification', 'CommunityPost',
  'Competitor', 'ConnectorActivityLog', 'ConnectorAuditLog', 'ConnectorHealthLog',
  'ConsentRecord', 'ContactAuditEntry', 'ContactDataIssue', 'ContactEvent',
  'ContactMedia', 'ContactMomentumSnapshot', 'ContactPlaybook', 'ContactRelationship',
  'ContactSavedView', 'ContactShare', 'ContentBrief', 'ContractTag',
  'CrmActivity', 'CrmSequence', 'CrmTask', 'CustomFieldDefinition',
  'CustomsDeclaration', 'DelegationLoop', 'DelegationLoopRun', 'DelegationRule',
  'DeliveryNote', 'Document', 'DocumentChangeLog', 'EmailCampaignContact',
  'Event', 'ExchangeRate', 'ExtractedEntity', 'FlowExecution',
  'FlowRoleSubscription', 'FlowSignal', 'FulfillmentRoute', 'GeneratedDocument',
  'GenomeChatMessage', 'GenomeContentStrategy', 'GenomeCrossDomainSnapshot', 'GenomeCustomerSalesSnapshot',
  'GenomeCustomerSegment', 'GenomeDeliveryCapability', 'GenomeEvidence', 'GenomeEvolutionProposal',
  'GenomeFinanceSnapshot', 'GenomeFinancialMetric', 'GenomeMarketingSnapshot', 'GenomeOperationalProcess',
  'GenomeOperationsSnapshot', 'GenomeOutcomeLearningWindow', 'GenomeSalesMotion', 'GoodsReceipt',
  'GrowthInsight', 'GuidanceAssessment', 'HelpdeskTicket', 'IntakeSubmission',
  'JobRole', 'JourneyInstance', 'JourneyTouchpoint', 'KeyAgentConfig',
  'KeyCortexTriggerRule', 'KeyDocument', 'KeyInboxInsight', 'KeyInteractionFeedback',
  'KeyTuningLog', 'KeyUserPreferences', 'KeyVoicePreference', 'KeyflowNote',
  'KeystoreServiceCategory', 'KeystoreServiceListing', 'KeystoreServiceOrder', 'KnowledgeSource',
  'LandingPage', 'Lead', 'LeadForm', 'LeadFormSubmission',
  'MarketplaceListing', 'MatchFeedback', 'MaturityScore', 'MediaAsset',
  'MergeOperation', 'MomentumRecommendation', 'NetworkEdge', 'NetworkNode',
  'OrgAssignment', 'OrgStandard', 'OrgUnit', 'OutboundCampaign',
  'OutputTemplate', 'PayRate', 'PayrollItem', 'PayrollRun',
  'PresenceDailyStat', 'ProcurementRequest', 'ProductEvent', 'ProductReview',
  'ProjectPlan', 'ProjectTemplate', 'Projection', 'PublicEvent',
  'PublicVisitorEvent', 'Receipt', 'Reconciliation', 'RelationshipInsightDismissal',
  'Reminder', 'Report', 'RetainerAgreement', 'ReviewTask',
  'SagaExecution', 'SandboxExecutionLog', 'ScheduledAgentJob', 'SeoIssue',
  'SequenceAttribution', 'Shipment', 'ShippingZone', 'SocialEngagement',
  'StaffPerformanceSnapshot', 'StockCount', 'StockMovement', 'StorefrontConversionDaily',
  'SubscriptionPayment', 'SupportTicket', 'SupportTicketMessage', 'Tag',
  'Task', 'TeamActivityLog', 'TemporalFlowEvent', 'TimeCostEntry',
  'TimeEntry', 'TriggerDefinition', 'UserFeedback', 'VisualIntake',
  'Warehouse', 'WhatsAppContact', 'WonLostReason', 'Workflow',

  // ── Batch 3 of the unscoped-ledger reduction, 2026-08-09 ─────────────────
  // Every findUnique on these keys on `id`, on `businessId`, or on a compound
  // unique whose name already carries the tenant (businessId_date_actionType,
  // courseId_businessId). Injecting businessId there is a no-op, so none can
  // become the silent null that Prisma 6.19 produces for an extra scalar in a
  // WhereUniqueInput.
  //
  // Still held back, and these are the real ones: lookups by an EXTERNAL key —
  // ContactExportJob(token), DriveIntakeFile(driveFileId), IngestionItem and
  // MessageIntake(externalId), PromoCode(code), PushSubscription(endpoint),
  // SitePageDraft(previewToken), WhatsAppMessage(wamid), Membership(userId).
  // Some of the remaining 21 will prove safe on reading — AiMemory's category
  // and key are nested inside businessId_category_key — but that needs eyes.
  'AgentTrigger', 'AutomationFlow', 'AutopilotTask', 'BusinessConstitutionVersion',
  'Cohort', 'ContactImport', 'ContactList', 'ContactMomentum',
  'ContactNote', 'ContactReadState', 'ContactTask', 'CourseEnrollment',
  'CrossModuleWorkflow', 'CustomerJourney', 'EventAttendee', 'FlowDefinition',
  'GenomeExperiment', 'GenomeFact', 'GenomeMemoryEvent', 'GenomeModuleReadiness',
  'GenomeRecommendation', 'GenomeRecommendationOutcome', 'GenomeSignal', 'GoogleFormMapping',
  'InteractionIntent', 'KeyActionProposal', 'KeyEvolutionLog', 'KeyInboxMessage',
  'Message', 'OutboundContent', 'PromptVariant', 'PublicVisitor',
  'QualificationJourney', 'ResponseDraft', 'SavedBusiness', 'SitePagePublished',
  'TemporalFlowMemory',

  // ── Batch 4, 2026-08-09 ───────────────────────────────────────────────────
  // Twenty models on a stronger test than batch 3 used.
  //
  // Batch 3 asked "does any findUnique key on a global unique". That question
  // is necessary and it is not sufficient, and Membership is the proof: every
  // one of its unique lookups keys on `id`, so a key-shape test clears it —
  // while `membership.findMany({ where: { userId } })` in
  // cross-business-intelligence.service.ts:62 means "every business this user
  // belongs to", and the extension injects businessId into findMany just as
  // readily as into findUnique. Scoped, that query returns exactly one row and
  // the multi-business feature quietly stops working.
  // identity.service.ts:769 is worse: `updateMany({ where: { userId: oldId } })`
  // re-points a merged account's memberships across EVERY business, and scoped
  // it silently merges one.
  //
  // So the test applied here is the whole intercepted surface — all fifteen
  // operations, not the five unique ones — and the bar is that EVERY call site
  // in apps/server already names businessId in its own `where`. Where that
  // holds, injection is provably a no-op: it re-states a predicate the caller
  // already wrote. Nothing can become a silent null because nothing changes.
  //
  // Six of the twenty have zero call sites today (BotAgent,
  // BotConversationState, ConnectorAccount, ExternalObjectMap,
  // WebhookDeliveryLog, and ChannelAccount's single one). Those are listed
  // precisely BECAUSE they have no callers: an unlisted model is unscoped by
  // default, so the first query anyone writes against them inherits no
  // protection at all. Listing them now costs nothing and closes that door.
  'AutonomyDailyActionCount', 'AutonomyDailySpend', 'AutopilotSettings',
  'BotAgent', 'BotConversationState', 'BusinessAutonomyProfile',
  'BusinessBlueprint', 'BusinessGenome', 'BusinessGuidanceProfile',
  'ChannelAccount', 'ConnectorAccount', 'ContactSyncAudit',
  'DriveSyncCursor', 'ExternalObjectMap', 'IdempotencyKey',
  'LLMProviderCost', 'MarketStrategy', 'ToolOutcomeScore',
  'Webhook', 'WebhookDeliveryLog',

  // ── Deliberately NOT added: Payment, MarketplaceOrder, WebhookEvent ────────
  // Their lookups live in handleStripeWebhook / handlePaypalWebhook /
  // handleWipayCallback and resolve rows by a GLOBAL provider key
  // (`payment.findUnique({ where: { providerPaymentId } })`), deriving the
  // business FROM the row because a webhook cannot know it beforehand.
  //
  // Adding them buys nothing — a webhook has no tenant context, so the
  // extension never fires. And it is not merely useless: Prisma 6.19 ACCEPTS an
  // extra scalar in a WhereUniqueInput rather than rejecting it (measured, with
  // a negative control), so if a context ever did appear on that path the
  // lookup would return null SILENTLY. No error, no log, no provider retry — a
  // payment taken and never recorded.
  //
  // If you are here to "finish the list", this is the reason it is not
  // finished. Scoping the money path needs the webhook to resolve its business
  // explicitly, not an entry in this set.
  //
  // WebhookEvent joined them 2026-08-09, for the same reason one layer out. Its
  // unique is `@@unique([provider, providerEventId])` — no businessId in it —
  // and that key exists to make a provider's redelivery idempotent. It has zero
  // call sites in apps/server today, which is exactly why it is easy to get
  // wrong: it looks like the six harmless empty ones added above, and it is the
  // opposite. The first handler written against it will be a webhook resolving
  // a row it cannot yet attribute to a business.
  // ── Batch of seven, 2026-08-30 ─────────────────────────────────────────────
  // Cleared by the protocol this file's gate spells out: does EVERY call site
  // already name businessId in its own `where`? Where it does, injection
  // re-states a predicate the caller already wrote and can change nothing.
  //
  // 133 production call sites across the seven, one by one. All but eight
  // already name businessId; those eight were read individually:
  //
  //   FlowSession            0 unscoped sites. Every one names businessId as of
  //                          the session-key fix — which is the same defect this
  //                          set exists to prevent, arriving because the model
  //                          was sitting in the debt ledger. A client-chosen
  //                          `sessionId` addressed one global row and every
  //                          user's onboarding chat wrote into a stranger's.
  //   AuthorityGrant         revokeAuthorityGrant: findFirst({id, businessId})
  //                          proves ownership, then update({where:{id}}).
  //   CognitionSession       updateSession: getSession(businessId, id) first.
  //   ValueConstraint        observeFeedback: the preceding findUnique keys on
  //                          businessId_valueKey_source, businessId included.
  //   ContactInsightSnapshot the contact is read scoped and throws when absent,
  //                          so contactId is already proven to be this tenant's.
  //
  // Check-then-act, all four: injection closes the window between the ownership
  // read and the bare-id write, and changes nothing else.
  //
  //   CampaignBriefing       NOT a no-op, and the reason it is here.
  //                          generateBriefing(businessId, campaignId) does
  //                          findUnique({ where: { campaignId } }) and RETURNS
  //                          the row — so passing another business's campaignId
  //                          returned their briefing. Scoping turns that into a
  //                          miss, which is the point.
  //   PresenceInsightSnapshot its one unscoped site is markAllStale(), which has
  //                          no callers at all. It means "every snapshot" on
  //                          purpose, so it now says so with
  //                          skipTenantIsolation rather than depending on
  //                          happening to run without a tenant context.
  //
  // SitePageDraft was reviewed in the same pass and deliberately NOT moved:
  // `getByPreviewToken` keys on previewToken, a GLOBAL @unique with no
  // businessId, which is the exact shape that returns a silent null. It stays
  // in the ledger.
  'AuthorityGrant', 'CampaignBriefing', 'CognitionSession',
  'ContactInsightSnapshot', 'FlowSession', 'PresenceInsightSnapshot',
  'ValueConstraint',
  // ── Batch of five, 2026-08-30 (second pass) ───────────────────────────────
  // Same protocol: every call site read, not sampled. 61 production sites
  // across the five; the eleven that did not already name businessId were:
  //
  //   AiMemory              resolveConflicts reads findMany({ businessId })
  //                         and deletes from that set; loadStructuredMemory's
  //                         `whereBase` IS `{ businessId }` — a variable the
  //                         scanner cannot see into, not a missing filter.
  //   CalendarSyncConflict  resolveConflict does findFirst({ id, businessId })
  //                         and throws before the bare-id update. The
  //                         createMany takes businessId by injection.
  //   PromoCode             update and delete are both preceded by
  //                         findFirst({ id: promoId, businessId }) that throws.
  //   ConversationAIInsight the upsert keys on the compound unique
  //                         businessId_contactId_kind_messageRef. The one real
  //                         gap is contact-insight.service.ts:382, a findFirst
  //                         on `{ contactId }` alone while every sibling query
  //                         in the same Promise.all names businessId — so this
  //                         entry FIXES an inconsistency rather than restating
  //                         a predicate.
  //   IntegrationSyncRun    one site, in admin analytics, with no businessId
  //                         anywhere in its route. The interceptor needs one in
  //                         params/body/query, so no context exists there and
  //                         injection never fires — but it now says so with
  //                         skipTenantIsolation instead of relying on that.
  'AiMemory', 'CalendarSyncConflict', 'ConversationAIInsight',
  'IntegrationSyncRun', 'PromoCode',
]);



function activeBusinessId(): string | undefined {
  return getCurrentBusinessId();
}

/**
 * `__skipTenantIsolation` is OUR marker, not Prisma's, and it must never reach
 * the query engine — Prisma rejects unknown top-level arguments with
 * `PrismaClientValidationError: Unknown argument __skipTenantIsolation`.
 *
 * It did reach it, on every path, from the day it was documented. Measured
 * 2026-08-07 against the real client: `withTenantWhere` returned `args`
 * untouched when it saw the flag, and the `!tenantOperationAllowed` branch
 * passed `args` straight through too, so the opt-out threw whether the model
 * was scoped or not. Nothing in the repo used it, which is the only reason
 * nobody found out; the first caller to try would have taken the exception.
 *
 * Stripping happens here, once, on every route through `scoped()`.
 */
function stripSkipFlag<T>(args: T): T {
  if (!args || typeof args !== 'object' || !(args as { __skipTenantIsolation?: boolean }).__skipTenantIsolation) {
    return args;
  }
  const { __skipTenantIsolation: _omit, ...rest } = args as Record<string, unknown>;
  return rest as T;
}

function skipRequested(args: unknown): boolean {
  return !!args && typeof args === 'object' && !!(args as { __skipTenantIsolation?: boolean }).__skipTenantIsolation;
}

function withTenantWhere<T extends { where?: Record<string, unknown>; __skipTenantIsolation?: boolean }>(
  args: T | undefined,
  businessId: string,
): T {
  if (!args) return { where: { businessId } } as unknown as T;
  if (skipRequested(args)) return stripSkipFlag(args);
  return { ...args, where: { ...(args.where ?? {}), businessId } } as unknown as T;
}

function tenantOperationAllowed(model: string): boolean {
  const businessId = activeBusinessId();
  return !!businessId && BUSINESS_ID_MODELS.has(model);
}

/** Shape of a `$allModels` query hook, for the three Prisma does not type. */
type HookParams = {
  model: string;
  args: unknown;
  query: (a: never) => Promise<unknown>;
};

/** One shape for the where-injecting operations; strips the marker on every route. */
function scoped(model: string, args: unknown): unknown {
  if (!tenantOperationAllowed(model) || skipRequested(args)) return stripSkipFlag(args);
  return withTenantWhere(args as Record<string, unknown>, activeBusinessId()!);
}

/**
 * Force a row being written into the caller's tenant, overriding whatever
 * businessId the caller supplied.
 *
 * MEASURED, NOT ASSUMED. Against a real database, with business A's context
 * active, `taxRate.create({ data: { businessId: BIZ_B, ... } })` created the row
 * inside B. The caller named the tenant and the extension had no opinion.
 *
 * A nested `business: { connect: { id } }` and a scalar `businessId` are
 * mutually exclusive in Prisma — supplying both is a validation error. Three
 * call sites in apps/server use the relation form, so those are left alone
 * rather than broken. They are not thereby scoped; the relation form can still
 * name a foreign business, and that is a service-layer concern.
 */
function withBusinessId(data: unknown, businessId: string): unknown {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((row) => withBusinessId(row, businessId));
  if ('business' in (data as Record<string, unknown>)) return data;
  return { ...(data as Record<string, unknown>), businessId };
}

/** create / createMany: the row lands in the caller's tenant, whatever it asked for. */
function scopedCreate(model: string, args: unknown): unknown {
  if (!tenantOperationAllowed(model) || skipRequested(args)) return stripSkipFlag(args);
  const a = (args ?? {}) as Record<string, unknown>;
  return { ...a, data: withBusinessId(a.data, activeBusinessId()!) };
}

/**
 * upsert: scope the lookup AND force the created row into the caller's tenant.
 *
 * Both halves are required, and for different reasons.
 *
 * The `where` injection is what closes the hole: measured against a real
 * database, `taxRate.upsert({ where: { id: <B's id> }, update: {...} })` under
 * business A's context REWROTE B's row. 154 call sites had that shape.
 *
 * The `create` injection is what keeps the fix from being worse than the bug.
 * A `where` that no longer matches does not make Prisma throw — it makes Prisma
 * take the create branch. Without forcing the tenant there, a refused
 * cross-tenant update would quietly become a cross-tenant INSERT, which is the
 * same breach wearing a different verb.
 */
function scopedUpsert(model: string, args: unknown): unknown {
  if (!tenantOperationAllowed(model) || skipRequested(args)) return stripSkipFlag(args);
  const businessId = activeBusinessId()!;
  const a = (args ?? {}) as Record<string, unknown>;
  return {
    ...a,
    where: { ...((a.where as Record<string, unknown>) ?? {}), businessId },
    create: withBusinessId(a.create, businessId),
  };
}

/**
 * Exempt ONE query from tenant scoping.
 *
 * The only legitimate use is a query that must read ACROSS businesses in order
 * to reject what it finds — a cross-tenant validation check. Scoping such a
 * query does not harden it; it deletes the control and leaves a misleading
 * "not found" in its place. If you are reaching for this to make a query
 * "work", you want a correct `where`, not this.
 *
 * Generic in T so the caller's `include`/`select` inference survives — writing
 * the marker into the object literal directly forces a cast, and the cast is
 * what erases the result type.
 *
 *   const row = await tx.financialTransaction.findUnique(
 *     skipTenantIsolation({ where: { id }, include: { entries: true } }),
 *   );
 */
export function skipTenantIsolation<T extends object>(args: T): T {
  return { ...args, __skipTenantIsolation: true } as T;
}

/**
 * Tenant isolation extension: auto-injects businessId into WHERE clauses
 * for all read and mutation operations when a tenant context is active.
 * Models without a businessId field (or the tenant root Business model)
 * pass through unchanged.
 *
 * `__skipTenantIsolation: true` opts one call out, for a query that must
 * legitimately read across businesses — a cross-tenant validation check needs
 * to SEE the foreign row in order to reject it. Scoping such a query does not
 * harden it, it deletes the control and leaves a misleading error in its place.
 *
 * FIFTEEN operations are intercepted. The previous ten were the five finds,
 * count, update, updateMany, delete and deleteMany; create, createMany, upsert,
 * aggregate and groupBy were not, and the comment here said so — which is why
 * "add the model to BUSINESS_ID_MODELS" was never the whole fix. The models
 * were already in the set. The operations were not in the extension.
 *
 * All five were measured leaking against a real database on 2026-08-09, under
 * business A's context, at 441 call sites in apps/server:
 *
 *   upsert    (154)  rewrote B's row by its bare id          — cross-tenant WRITE
 *   create     (22)  planted a row inside B                  — cross-tenant WRITE
 *   aggregate (165)  counted both tenants                    — disclosure
 *   groupBy   (100)  returned B's group                      — disclosure
 *
 * What this still does NOT cover, stated so nobody reads more into it:
 * createManyAndReturn, and any write whose tenant is named through a nested
 * `business: { connect: ... }` relation rather than the scalar column.
 */
const tenantIsolationExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async findUnique({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async findUniqueOrThrow({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async findFirst({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async findFirstOrThrow({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async findMany({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async count({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async update({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async updateMany({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async delete({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async deleteMany({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async aggregate({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
      async groupBy({ model, args, query }) {
        return query(scoped(model, args) as never);
      },
    },
  },
});

/**
 * The three write operations, hooked PER MODEL.
 *
 * WHY NOT $allModels
 *
 * Prisma 6.19 types `query.$allModels` with exactly THIRTEEN operation keys —
 * the five finds, update, updateMany, updateManyAndReturn, delete, deleteMany,
 * aggregate, groupBy and count. Every one carries a `where`. A `create` key is
 * rejected outright:
 *
 *   TS2353: Object literal may only specify known properties,
 *           and 'create' does not exist in type '{ $allOperations?: ... }'
 *
 * (The first error was TS7031, implicit-any on the destructured parameters,
 * which reads like Prisma merely failing to infer. Annotating them revealed the
 * real one. The parameters were untyped because the KEY was invalid.)
 *
 * WHY NOT $allOperations EITHER — THE PART THAT COST A BOOT
 *
 * `$allModels.$allOperations` accepts them at runtime; all four leaking tests
 * went green with it. It also STOPPED THE SERVER FROM BOOTING. Measured, with a
 * negative control: chained, `node dist/main.js` produced no output for 45s and
 * the boot gate failed; unchained and rebuilt, the same binary reached listening
 * in 34.5s. It wraps every operation on all 428 models, and the cost of building
 * that lands at startup.
 *
 * Nothing else in the suite could see it. tsc was clean and 3,355 tests passed
 * against a build that never serves a request — which is the sentence
 * app-module-boots.integration.test.ts exists to be able to print.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Names each model explicitly, exactly as middleware/token-encryption.ts does
 * (`query: { business: { create } }`) — per-model extensions accept the full
 * operation set. Built from BUSINESS_ID_MODELS, so it covers the 77 models that
 * have a businessId and no others, and adding a model to that set widens the
 * write scoping automatically rather than silently leaving it behind.
 */
function delegateName(model: string): string {
  return model[0].toLowerCase() + model.slice(1);
}

const tenantWriteIsolationExtension = Prisma.defineExtension({
  query: Object.fromEntries(
    [...BUSINESS_ID_MODELS].map((model) => [
      delegateName(model),
      {
        create: ({ args, query }: HookParams) => query(scopedCreate(model, args) as never),
        createMany: ({ args, query }: HookParams) => query(scopedCreate(model, args) as never),
        upsert: ({ args, query }: HookParams) => query(scopedUpsert(model, args) as never),
      },
    ]),
  ),
} as never);

// Create and configure Prisma client with soft delete extension
// If adapter is null (no DATABASE_URL), the client still works for type-generation
// but will throw on actual queries — which is the correct fail-fast behavior.
export const db = new PrismaClient({ adapter }).$extends(softDeleteExtension).$extends(defaultTakeExtension).$extends(tenantIsolationExtension).$extends(tenantWriteIsolationExtension).$extends(tokenEncryptionExtension);

/**
 * Health-check the database connection.
 * Returns { ok, latencyMs } without throwing.
 */
export async function dbHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  if (!pool) {
    return { ok: false, latencyMs: 0 };
  }
  const start = Date.now();
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PrismaPool] Health check failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// Re-export generated Prisma types for convenience
export * from "@prisma/client";
