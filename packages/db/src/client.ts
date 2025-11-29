import { PrismaClient } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";

// Create the soft delete extension for specific models
const softDeleteExtension = softDelete(["Contact"]); // Add other model names as needed

// Create and configure Prisma client with soft delete extension
export const db = new PrismaClient().$extends(softDeleteExtension);

// Re-export generated Prisma types for convenience
export * from "@prisma/client";
