import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";

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
if (connectionString) {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  adapter = new PrismaPg(pool);
}

// Create and configure Prisma client with soft delete extension
export const db = new PrismaClient({ adapter }).$extends(softDeleteExtension);

// Re-export generated Prisma types for convenience
export * from "@prisma/client";
