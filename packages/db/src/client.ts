import { PrismaClient } from "@prisma/client";
import { softDeleteExtension } from "./middleware/soft-delete";

// create and configure Prisma client
const prisma = new PrismaClient().$extends(softDeleteExtension);

// register the soft-delete middleware globally

// export the configured client for use across the monorepo
export const db = prisma;

// also export all generated types for convenience
export * from "@prisma/client";