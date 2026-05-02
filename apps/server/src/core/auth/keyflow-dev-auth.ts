/**
 * Keyflow Dev Auth Bypass — strictly development-only.
 *
 * When KEYFLOW_DEV_AUTH_BYPASS=true and NODE_ENV !== "production", the server
 * accepts requests with a sentinel dev token (or a `?as=<key>` query param) as
 * one of several seeded dev profiles, so developers can flip between role
 * levels (SUPER_ADMIN, OWNER, ADMIN, STAFF, plain USER) without restarting
 * the server. The flag MUST refuse to enable in production builds.
 */

export type DevUserRole = 'USER' | 'SUPER_ADMIN';
export type DevMembershipRole = 'OWNER' | 'ADMIN' | 'STAFF';

export interface KeyflowDevProfile {
  key: string;
  label: string;
  description: string;
  token: string;
  userId: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  userRole: DevUserRole;
  businessId: string;
  businessName: string;
  membershipRole: DevMembershipRole;
}

/**
 * The original sentinel token kept stable for backwards compatibility — it
 * still resolves to the SUPER_ADMIN "super" profile used before this change.
 */
export const KEYFLOW_DEV_BYPASS_TOKEN = 'keyflow-dev-bypass-token';

export const KEYFLOW_DEV_PROFILES: readonly KeyflowDevProfile[] = [
  {
    key: 'super',
    label: 'Super Admin',
    description: 'Global SUPER_ADMIN, owner of the dev business',
    token: KEYFLOW_DEV_BYPASS_TOKEN,
    userId: 'keyflowdev_user',
    email: 'dev@keyflow.os',
    name: 'Keyflow Dev',
    firstName: 'Keyflow',
    lastName: 'Dev',
    userRole: 'SUPER_ADMIN',
    businessId: 'keyflowdev_business',
    businessName: 'Keyflow Dev',
    membershipRole: 'OWNER',
  },
  {
    key: 'owner',
    label: 'Owner',
    description: 'Plain user with OWNER membership in the dev business',
    token: 'keyflow-dev-bypass-token-owner',
    userId: 'keyflowdev_owner',
    email: 'owner@keyflow.os',
    name: 'Dev Owner',
    firstName: 'Dev',
    lastName: 'Owner',
    userRole: 'USER',
    businessId: 'keyflowdev_business',
    businessName: 'Keyflow Dev',
    membershipRole: 'OWNER',
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Plain user with ADMIN membership in the dev business',
    token: 'keyflow-dev-bypass-token-admin',
    userId: 'keyflowdev_admin',
    email: 'admin@keyflow.os',
    name: 'Dev Admin',
    firstName: 'Dev',
    lastName: 'Admin',
    userRole: 'USER',
    businessId: 'keyflowdev_business',
    businessName: 'Keyflow Dev',
    membershipRole: 'ADMIN',
  },
  {
    key: 'staff',
    label: 'Staff',
    description: 'Plain user with STAFF membership in the dev business',
    token: 'keyflow-dev-bypass-token-staff',
    userId: 'keyflowdev_staff',
    email: 'staff@keyflow.os',
    name: 'Dev Staff',
    firstName: 'Dev',
    lastName: 'Staff',
    userRole: 'USER',
    businessId: 'keyflowdev_business',
    businessName: 'Keyflow Dev',
    membershipRole: 'STAFF',
  },
  {
    key: 'user',
    label: 'Plain User',
    description: 'Regular user owning a separate sandbox business',
    token: 'keyflow-dev-bypass-token-user',
    userId: 'keyflowdev_user_only',
    email: 'user@keyflow.os',
    name: 'Dev User',
    firstName: 'Dev',
    lastName: 'User',
    userRole: 'USER',
    businessId: 'keyflowdev_user_business',
    businessName: 'Dev User Sandbox',
    membershipRole: 'OWNER',
  },
] as const;

export const DEFAULT_DEV_PROFILE_KEY = 'super';

const profilesByKey = new Map(KEYFLOW_DEV_PROFILES.map((p) => [p.key, p]));
const profilesByToken = new Map(KEYFLOW_DEV_PROFILES.map((p) => [p.token, p]));

export function getDevProfileByKey(key: string | null | undefined): KeyflowDevProfile | undefined {
  if (!key) return undefined;
  return profilesByKey.get(key.toLowerCase());
}

export function getDevProfileByToken(token: string | null | undefined): KeyflowDevProfile | undefined {
  if (!token) return undefined;
  return profilesByToken.get(token);
}

export function getDefaultDevProfile(): KeyflowDevProfile {
  return profilesByKey.get(DEFAULT_DEV_PROFILE_KEY) ?? KEYFLOW_DEV_PROFILES[0];
}

export function isDevBypassToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return profilesByToken.has(token);
}

export function isDevAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const flag = process.env.KEYFLOW_DEV_AUTH_BYPASS;
  return flag === 'true' || flag === '1';
}

// ─── Backwards-compat exports (the original single-profile constants) ────────
const defaultProfile = getDefaultDevProfile();
export const KEYFLOW_DEV_USER_ID = defaultProfile.userId;
export const KEYFLOW_DEV_USER_EMAIL = defaultProfile.email;
export const KEYFLOW_DEV_USER_NAME = defaultProfile.name;
export const KEYFLOW_DEV_USER_ROLE = defaultProfile.userRole;
export const KEYFLOW_DEV_BUSINESS_ID = defaultProfile.businessId;
export const KEYFLOW_DEV_BUSINESS_NAME = defaultProfile.businessName;

export function getDevUser() {
  return {
    id: defaultProfile.userId,
    email: defaultProfile.email,
    role: defaultProfile.userRole,
  };
}
