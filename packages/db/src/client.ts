<<<<<<< HEAD
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
=======
import { PrismaClient } from './generated/client';
import { softDeleteMiddleware } from './middleware/soft-delete';

// This is the client that will be imported by your NestJS server
const prisma = new PrismaClient();

// Apply the middleware
prisma.$use(softDeleteMiddleware());

export const db = prisma;
>>>>>>> dfe993612f4ee85a6ee5223d660e4ace57c758e5
