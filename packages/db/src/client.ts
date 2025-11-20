import { PrismaClient } from "@prisma/client";
import { softDelete } from "./middleware/soft-delete";

// Create the soft delete extension for specific models
const softDeleteExtension = softDelete(["Contact"]); // Add other model names as needed

// create and configure Prisma client
const prisma = new PrismaClient().$extends(softDeleteExtension);

// export the configured client for use across the monorepo
export const db = prisma;

// also export all generated types for convenience
export * from "@prisma/client";