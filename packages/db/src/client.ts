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
]);



function activeBusinessId(): string | undefined {
  return getCurrentBusinessId();
}

function withTenantWhere<T extends { where?: Record<string, unknown>; __skipTenantIsolation?: boolean }>(
  args: T | undefined,
  businessId: string,
): T {
  if (!args) return { where: { businessId } } as unknown as T;
  if ((args as any).__skipTenantIsolation) return args;
  return { ...args, where: { ...(args.where ?? {}), businessId } } as unknown as T;
}

function tenantOperationAllowed(model: string): boolean {
  const businessId = activeBusinessId();
  return !!businessId && BUSINESS_ID_MODELS.has(model);
}

/**
 * Tenant isolation extension: auto-injects businessId into WHERE clauses
 * for all read and mutation operations when a tenant context is active.
 * Models without a businessId field (or the tenant root Business model)
 * pass through unchanged. Use `__skipTenantIsolation: true` in args to
 * opt out of scoping for legitimate global queries.
 */
const tenantIsolationExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async findUnique({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async findUniqueOrThrow({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async findFirst({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async findFirstOrThrow({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async findMany({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async count({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async update({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async updateMany({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async delete({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
      },
      async deleteMany({ model, args, query }) {
        if (!tenantOperationAllowed(model)) return query(args);
        return query(withTenantWhere(args as any, activeBusinessId()!) as any);
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
