import { Prisma } from "@prisma/client";

/**
 * Creates a Prisma extension for soft-deleting records.
 * @param models - An array of model names that should have soft-delete enabled.
 */
export function softDelete(models: Prisma.ModelName[]) {
  return Prisma.defineExtension({
    name: "soft-delete",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !models.includes(model)) {
            return query(args);
          }

          if (operation === "delete") {
            // Change delete to update and set deletedAt
            const newArgs = { ...args, data: { deletedAt: new Date() } };
            return (query as any).update(newArgs);
          }

          if (operation === "deleteMany") {
            // Change deleteMany to updateMany and set deletedAt
            const newArgs = { ...args, data: { deletedAt: new Date() } };
            return (query as any).updateMany(newArgs);
          }

          // For find operations, add a condition to exclude soft-deleted records
          const findOps = ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"];
          if (findOps.includes(operation)) {
            const newArgs = { ...args } as any; // Use type assertion
            if (newArgs.where) { // This is now safe
              newArgs.where.deletedAt = null;
            } else {
              newArgs.where = { deletedAt: null };
            }
            return query(newArgs as any);
          }

          return query(args);
        },
      },
    },
  });
}
