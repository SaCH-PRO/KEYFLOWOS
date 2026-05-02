/**
 * Keyflow Dev Auth Bypass — strictly development-only.
 *
 * When KEYFLOW_DEV_AUTH_BYPASS=true and NODE_ENV !== "production", the server
 * accepts requests with no token (or with the sentinel dev token) as the
 * "keyflowdev" SUPER_ADMIN profile, and the matching default business is
 * seeded on startup. The flag MUST refuse to enable in production builds.
 */

export const KEYFLOW_DEV_USER_ID = 'keyflowdev_user';
export const KEYFLOW_DEV_USER_EMAIL = 'dev@keyflow.os';
export const KEYFLOW_DEV_USER_NAME = 'Keyflow Dev';
export const KEYFLOW_DEV_USER_ROLE = 'SUPER_ADMIN';

export const KEYFLOW_DEV_BUSINESS_ID = 'keyflowdev_business';
export const KEYFLOW_DEV_BUSINESS_NAME = 'Keyflow Dev';

export const KEYFLOW_DEV_BYPASS_TOKEN = 'keyflow-dev-bypass-token';

export function isDevAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const flag = process.env.KEYFLOW_DEV_AUTH_BYPASS;
  return flag === 'true' || flag === '1';
}

export function getDevUser() {
  return {
    id: KEYFLOW_DEV_USER_ID,
    email: KEYFLOW_DEV_USER_EMAIL,
    role: KEYFLOW_DEV_USER_ROLE,
  };
}
