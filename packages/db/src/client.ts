import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { softDelete } from "./middleware/soft-delete";

// Use WASM-based client for environments without native binaries
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("./generated/client/wasm.js");

// Enable soft delete for all models that include a deletedAt column
const softDeleteExtension = softDelete([
  "Business",
  "Membership",
  "Session",
  "Contact",
  "Product",
  "Quote",
  "QuoteItem",
  "Invoice",
  "InvoiceItem",
  "Payment",
  "StaffMember",
  "Service",
  "Availability",
  "Booking",
  "SocialConnection",
  "SocialPost",
  "Automation",
  "Project",
  "ProjectTask",
  "ProjectTemplate",
  "Site",
]);

// Create a connection pool using the DATABASE_URL
const connectionString = process.env.DATABASE_URL;

// Create pool and adapter - adapter must be null (not undefined) if no connection string
let adapter: PrismaPg | null = null;
if (connectionString) {
  const pool = new Pool({ connectionString });
  adapter = new PrismaPg(pool);
}

// Create and configure Prisma client with soft delete extension
export const db = new PrismaClient({ adapter }).$extends(softDeleteExtension);

// Re-export generated Prisma types for convenience
export * from "@prisma/client";
