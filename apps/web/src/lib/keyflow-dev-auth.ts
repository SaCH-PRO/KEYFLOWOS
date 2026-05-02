/**
 * Frontend mirror of the server's dev auth bypass.
 *
 * When NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS is "true", the web app skips the
 * login screen, pre-populates the dev sentinel token + business id in
 * localStorage, and treats the session as the seeded "keyflowdev" profile.
 * The flag is intended for development only; the server independently
 * refuses to honor the bypass when NODE_ENV=production.
 */

export const KEYFLOW_DEV_BYPASS_TOKEN = "keyflow-dev-bypass-token";
export const KEYFLOW_DEV_BUSINESS_ID = "keyflowdev_business";
export const KEYFLOW_DEV_USER_ID = "keyflowdev_user";
export const KEYFLOW_DEV_USER_EMAIL = "dev@keyflow.os";
export const KEYFLOW_DEV_USER_NAME = "Keyflow Dev";

export function isDevAuthBypassEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS;
  return flag === "true" || flag === "1";
}

/**
 * Idempotently set the dev sentinel token + business id in localStorage so
 * the rest of the app code paths (which rely on `kf_token`/`kf_business_id`)
 * see the dev session without ever hitting the login flow.
 */
export function applyDevBypassToLocalStorage() {
  if (typeof window === "undefined") return;
  if (!isDevAuthBypassEnabled()) return;
  try {
    if (window.localStorage.getItem("kf_token") !== KEYFLOW_DEV_BYPASS_TOKEN) {
      window.localStorage.setItem("kf_token", KEYFLOW_DEV_BYPASS_TOKEN);
    }
    if (window.localStorage.getItem("kf_business_id") !== KEYFLOW_DEV_BUSINESS_ID) {
      window.localStorage.setItem("kf_business_id", KEYFLOW_DEV_BUSINESS_ID);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR); best-effort only.
  }
}
