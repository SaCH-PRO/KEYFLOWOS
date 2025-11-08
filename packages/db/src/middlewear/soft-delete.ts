import { Prisma } from '../generated/client';

// Define the models that have the 'deletedAt' field
const modelsWithSoftDelete: Prisma.ModelName[] = [
  'Business', 'Contact', 'Product', 'Quote', 'Invoice', 'StaffMember',
  'Service', 'Booking', 'SocialPost', 'Automation', 'Project', 'ProjectTask', 'Site'
];

export function softDeleteMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    if (modelsWithSoftDelete.includes(params.model as Prisma.ModelName)) {
      // --- Intercept 'delete' actions ---
      if (params.action === 'delete') {
        // Change the action to an 'update'
        return next({
          ...params,
          action: 'update',
          args: {
            ...params.args,
            data: { deletedAt: new Date() },
          },
        });
      }

      // --- Intercept 'deleteMany' actions ---
      if (params.action === 'deleteMany') {
        // Change the action to an 'updateMany'
        return next({
          ...params,
          action: 'updateMany',
          args: {
            ...params.args,
            data: { deletedAt: new Date() },
          },
        });
      }

      // --- Intercept 'find' queries to exclude deleted items ---
      // This applies to: findUnique, findFirst, findMany
      if (params.action.startsWith('find')) {
        // Add a 'where' clause to filter out deleted items
        return next({
          ...params,
          args: {
            ...params.args,
            where: {
              ...params.args.where,
              deletedAt: null,
            },
          },
        });
      }
    }
    return next(params);
  };
}