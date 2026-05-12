import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Creates a Prisma extension for soft-deleting records.
 * @param models - An array of model names that should have soft-delete enabled.
 */
export function softDelete(models: Prisma.ModelName[]) {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: "soft-delete",
      query: {
        $allModels: {
          async delete({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            // Convert delete to update with deletedAt
            const ctx = Prisma.getExtensionContext(client) as any;
            const modelClient = ctx[model.charAt(0).toLowerCase() + model.slice(1)];
            return modelClient.update({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          },
          async deleteMany({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            // Convert deleteMany to updateMany with deletedAt
            const ctx = Prisma.getExtensionContext(client) as any;
            const modelClient = ctx[model.charAt(0).toLowerCase() + model.slice(1)];
            return modelClient.updateMany({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          },
          async findUnique({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
          async findUniqueOrThrow({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
          async findFirst({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
          async findFirstOrThrow({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
          async findMany({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
          async count({ model, args, query }) {
            if (!model || !models.includes(model as Prisma.ModelName)) {
              return query(args);
            }
            const newArgs = { ...args } as any;
            if (newArgs.where) {
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs);
          },
        },
      },
    });
  });
}
