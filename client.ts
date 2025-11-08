import { PrismaClient } from './generated/client';
import { softDeleteMiddleware } from './middleware/soft-delete';

// This is the client that will be imported by your NestJS server
const prisma = new PrismaClient();

// Apply the middleware
prisma.$use(softDeleteMiddleware());

export const db = prisma;