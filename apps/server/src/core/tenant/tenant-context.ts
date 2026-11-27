import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  businessId: string;
  userId?: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function runWithTenant<T>(
  businessId: string,
  userId: string | undefined,
  fn: () => T,
): T {
  return tenantStorage.run({ businessId, userId }, fn);
}

/**
 * Run per-tenant background work (cron, interval, queue worker) inside an
 * AsyncLocalStorage tenant context with no user attribution (`userId: undefined`).
 *
 * Activates the Prisma tenant isolation extension for `businessId` while every
 * ambient-context actor reader keeps its SYSTEM / null answer. Fails closed if
 * `businessId` is empty, whitespace-only, or not a string.
 */
export function runForTenant<T>(businessId: string, fn: () => T): T {
  if (typeof businessId !== 'string' || businessId.trim().length === 0) {
    throw new Error('runForTenant requires a non-empty businessId');
  }
  return tenantStorage.run({ businessId, userId: undefined }, fn);
}

export function getCurrentBusinessId(): string | undefined {
  return tenantStorage.getStore()?.businessId;
}

export function getCurrentUserId(): string | undefined {
  return tenantStorage.getStore()?.userId;
}
