import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";
import { tokenEncryptionExtension } from "./middleware/token-encryption";

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
  'Service', 'Booking', 'StaffMember', 'Project', 'ProjectTask', 'Expense',
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

  // ── Deliberately NOT added: Payment, MarketplaceOrder ──────────────────────
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

/** One shape for all ten hooked operations; strips the marker on every route. */
function scoped(model: string, args: unknown): unknown {
  if (!tenantOperationAllowed(model) || skipRequested(args)) return stripSkipFlag(args);
  return withTenantWhere(args as Record<string, unknown>, activeBusinessId()!);
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
 * These ten are the ONLY intercepted operations. create, createMany, upsert,
 * aggregate and groupBy are not hooked, so this extension cannot scope them —
 * do not reason as though it can.
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
    },
  },
});

// Create and configure Prisma client with soft delete extension
// If adapter is null (no DATABASE_URL), the client still works for type-generation
// but will throw on actual queries — which is the correct fail-fast behavior.
export const db = new PrismaClient({ adapter }).$extends(softDeleteExtension).$extends(defaultTakeExtension).$extends(tenantIsolationExtension).$extends(tokenEncryptionExtension);

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
