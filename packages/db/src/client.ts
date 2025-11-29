import { PrismaClient } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";

// Enable soft delete for all models that include a deletedAt column
const softDeleteExtension = softDelete([
  "User",
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

// Create and configure Prisma client with soft delete extension
export const db = new PrismaClient().$extends(softDeleteExtension);

// Re-export generated Prisma types for convenience
export * from "@prisma/client";
