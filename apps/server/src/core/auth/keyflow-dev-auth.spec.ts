import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEV_PROFILE_KEY,
  KEYFLOW_DEV_BYPASS_TOKEN,
  KEYFLOW_DEV_PROFILES,
  getDefaultDevProfile,
  getDevProfileByKey,
  getDevProfileByToken,
  isDevBypassToken,
} from './keyflow-dev-auth';

describe('keyflow-dev-auth profiles', () => {
  it('exposes the canonical set of role profiles', () => {
    const keys = KEYFLOW_DEV_PROFILES.map((p) => p.key).sort();
    expect(keys).toEqual(['admin', 'owner', 'staff', 'super', 'user']);
  });

  it('keeps the default sentinel token mapped to the SUPER_ADMIN profile for backwards compatibility', () => {
    const def = getDefaultDevProfile();
    expect(def.key).toBe(DEFAULT_DEV_PROFILE_KEY);
    expect(def.userRole).toBe('SUPER_ADMIN');
    expect(def.token).toBe(KEYFLOW_DEV_BYPASS_TOKEN);
    expect(getDevProfileByToken(KEYFLOW_DEV_BYPASS_TOKEN)?.key).toBe('super');
  });

  it('uses unique tokens, ids, emails and labels per profile', () => {
    const fields = ['token', 'userId', 'email', 'label'] as const;
    for (const field of fields) {
      const seen = new Set<string>();
      for (const profile of KEYFLOW_DEV_PROFILES) {
        const value = profile[field];
        expect(seen.has(value), `duplicate ${field}: ${value}`).toBe(false);
        seen.add(value);
      }
    }
  });

  it('covers SUPER_ADMIN, OWNER, ADMIN and STAFF role combinations', () => {
    const roles = KEYFLOW_DEV_PROFILES.map(
      (p) => `${p.userRole}/${p.membershipRole}`,
    );
    expect(roles).toContain('SUPER_ADMIN/OWNER');
    expect(roles).toContain('USER/OWNER');
    expect(roles).toContain('USER/ADMIN');
    expect(roles).toContain('USER/STAFF');
  });

  it('resolves profiles by key (case-insensitive) and rejects unknown keys', () => {
    expect(getDevProfileByKey('staff')?.membershipRole).toBe('STAFF');
    expect(getDevProfileByKey('STAFF')?.membershipRole).toBe('STAFF');
    expect(getDevProfileByKey('Owner')?.membershipRole).toBe('OWNER');
    expect(getDevProfileByKey('not-a-profile')).toBeUndefined();
    expect(getDevProfileByKey(undefined)).toBeUndefined();
    expect(getDevProfileByKey(null)).toBeUndefined();
    expect(getDevProfileByKey('')).toBeUndefined();
  });

  it('treats every seeded profile token as a dev bypass token', () => {
    for (const profile of KEYFLOW_DEV_PROFILES) {
      expect(isDevBypassToken(profile.token)).toBe(true);
    }
    expect(isDevBypassToken('not-a-dev-token')).toBe(false);
    expect(isDevBypassToken(undefined)).toBe(false);
  });

  it('isolates the plain user profile in its own sandbox business', () => {
    const user = getDevProfileByKey('user');
    expect(user).toBeDefined();
    const sharingDevBusiness = KEYFLOW_DEV_PROFILES.filter(
      (p) => p.businessId === user!.businessId,
    );
    expect(sharingDevBusiness).toHaveLength(1);
    expect(sharingDevBusiness[0].key).toBe('user');
  });
});
