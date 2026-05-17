import { AsyncLocalStorage } from 'async_hooks';

interface TenantContext {
  businessId: string;
  userId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function runWithTenant<T>(
  businessId: string,
  userId: string,
  fn: () => T,
): T {
  return tenantStorage.run({ businessId, userId }, fn);
}

export function getCurrentBusinessId(): string | undefined {
  return tenantStorage.getStore()?.businessId;
}

export function getCurrentUserId(): string | undefined {
  return tenantStorage.getStore()?.userId;
}
