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
const BUSINESS_ID_MODELS = new Set([
  'BusinessEvent', 'Evidence', 'TaskAssignment', 'ContentRequest',
  'ContentDeliveryPackage', 'CallLog', 'ApprovalRequest', 'ApprovalStep',
  'Asset', 'Contact', 'Account', 'Deal', 'Invoice', 'Quote', 'Product',
  'Service', 'Booking', 'StaffMember', 'Project', 'ProjectTask', 'Expense',
  'SocialPost', 'EmailCampaign', 'DocumentInstance', 'Site', 'CalendarEvent',
  'ConnectorStatus', 'Automation', 'CommunicationEvent', 'MessageThread',
  'OutboundDelivery', 'DeliveryEvent', 'NotificationEvent',
]);

/**
 * Tenant isolation extension: auto-injects businessId into WHERE clauses
 * for findMany and count queries when a tenant context is active.
 * Models without a businessId field silently pass through unchanged.
 */
const tenantIsolationExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        const businessId = getCurrentBusinessId();
        if (!businessId || !BUSINESS_ID_MODELS.has(model)) return query(args);
        const where = (args as any).where ?? {};
        return query({ ...args, where: { ...where, businessId } } as any);
      },
      async count({ model, args, query }) {
        const businessId = getCurrentBusinessId();
        if (!businessId || !BUSINESS_ID_MODELS.has(model)) return query(args);
        const where = (args as any).where ?? {};
        return query({ ...args, where: { ...where, businessId } } as any);
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
