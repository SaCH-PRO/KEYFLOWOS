/**
 * Tests for the frontend mirror in apps/web/src/lib/keyflow-dev-auth.ts —
 * specifically the cache-invalidation contract used when developers switch
 * profiles via a `?as=<key>` URL parameter. We import the source directly
 * across the package boundary so we don't have to spin up a separate test
 * harness in apps/web for this single piece of pure logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyDevBypassToLocalStorage,
  DEV_PROFILE_STORAGE_KEY,
  getActiveDevProfile,
  switchDevProfile,
} from '../../../../web/src/lib/keyflow-dev-auth';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null; }
  get length() { return this.data.size; }
}

const originalEnv = { ...process.env };

function setSearch(qs: string) {
  const url = `https://app.local/${qs}`;
  (window as any).location = new URL(url) as unknown as Location;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS = 'true';
  const storage = new MemoryStorage();
  vi.stubGlobal('window', {
    localStorage: storage,
    location: new URL('https://app.local/'),
    history: { replaceState: vi.fn() },
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('applyDevBypassToLocalStorage cache invalidation', () => {
  it('seeds the default super profile on first call from an empty localStorage', () => {
    const ls = (window as any).localStorage as MemoryStorage;
    // First call from empty storage: all three keys move from null → seeded
    // values, which is reported as a change so any leftover cache (none here)
    // would be evicted.
    expect(applyDevBypassToLocalStorage()).toBe(true);
    expect(ls.getItem('kf_token')).toBe('keyflow-dev-bypass-token');
    expect(ls.getItem('kf_business_id')).toBe('keyflowdev_business');
    expect(ls.getItem(DEV_PROFILE_STORAGE_KEY)).toBe('super');
  });

  it('returns false on a subsequent call when nothing changes (idempotent)', () => {
    applyDevBypassToLocalStorage();
    expect(applyDevBypassToLocalStorage()).toBe(false);
  });

  it('clears stale user/business cache and returns true when the active profile changes via ?as=', () => {
    const ls = (window as any).localStorage as MemoryStorage;
    // First boot: super profile is active.
    applyDevBypassToLocalStorage();
    // Simulate the cache populated by a previous bootstrap as super.
    ls.setItem('kf_user_cache', JSON.stringify({ id: 'keyflowdev_user', email: 'dev@keyflow.os' }));
    ls.setItem('kf_business_cache', JSON.stringify({ id: 'keyflowdev_business', name: 'Keyflow Dev' }));

    // Now developer arrives with ?as=staff
    setSearch('?as=staff');
    const changed = applyDevBypassToLocalStorage();

    expect(changed).toBe(true);
    expect(ls.getItem('kf_token')).toBe('keyflow-dev-bypass-token-staff');
    expect(ls.getItem(DEV_PROFILE_STORAGE_KEY)).toBe('staff');
    // Stale cache must be evicted so the UI re-fetches identity as staff.
    expect(ls.getItem('kf_user_cache')).toBeNull();
    expect(ls.getItem('kf_business_cache')).toBeNull();
  });

  it('clears stale cache when ?as= switches to the plain user profile in a different business', () => {
    const ls = (window as any).localStorage as MemoryStorage;
    applyDevBypassToLocalStorage();
    ls.setItem('kf_user_cache', 'whatever');
    ls.setItem('kf_business_cache', 'whatever');

    setSearch('?as=user');
    const changed = applyDevBypassToLocalStorage();

    expect(changed).toBe(true);
    expect(ls.getItem('kf_business_id')).toBe('keyflowdev_user_business');
    expect(ls.getItem('kf_user_cache')).toBeNull();
    expect(ls.getItem('kf_business_cache')).toBeNull();
  });

  it('does no-op (false) when bypass is disabled', () => {
    process.env.NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS = 'false';
    const ls = (window as any).localStorage as MemoryStorage;
    expect(applyDevBypassToLocalStorage()).toBe(false);
    expect(ls.getItem('kf_token')).toBeNull();
  });
});

describe('getActiveDevProfile resolution order', () => {
  it('prefers ?as= over stored profile and over default', () => {
    const ls = (window as any).localStorage as MemoryStorage;
    ls.setItem(DEV_PROFILE_STORAGE_KEY, 'staff');
    setSearch('?as=admin');
    expect(getActiveDevProfile().key).toBe('admin');
  });

  it('falls back to stored profile when no ?as=', () => {
    const ls = (window as any).localStorage as MemoryStorage;
    ls.setItem(DEV_PROFILE_STORAGE_KEY, 'staff');
    expect(getActiveDevProfile().key).toBe('staff');
  });

  it('falls back to the default super profile when nothing is set', () => {
    expect(getActiveDevProfile().key).toBe('super');
  });
});

describe('switchDevProfile', () => {
  it('writes new token/business/profile and clears caches', () => {
    const reload = vi.fn();
    (window as any).location = Object.assign(new URL('https://app.local/'), { reload });

    const ls = (window as any).localStorage as MemoryStorage;
    ls.setItem('kf_user_cache', 'old');
    ls.setItem('kf_business_cache', 'old');

    switchDevProfile('admin');

    expect(ls.getItem('kf_token')).toBe('keyflow-dev-bypass-token-admin');
    expect(ls.getItem('kf_business_id')).toBe('keyflowdev_business');
    expect(ls.getItem(DEV_PROFILE_STORAGE_KEY)).toBe('admin');
    expect(ls.getItem('kf_user_cache')).toBeNull();
    expect(ls.getItem('kf_business_cache')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('ignores unknown keys silently', () => {
    const reload = vi.fn();
    (window as any).location = Object.assign(new URL('https://app.local/'), { reload });
    switchDevProfile('not-a-profile');
    expect(reload).not.toHaveBeenCalled();
  });
});
