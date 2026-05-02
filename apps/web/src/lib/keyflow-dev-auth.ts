/**
 * Frontend mirror of the server's dev auth bypass.
 *
 * When NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS is "true", the web app skips the
 * login screen and pre-populates a sentinel token + business id in
 * localStorage so the rest of the app code paths (which rely on `kf_token` /
 * `kf_business_id`) see a valid session without ever hitting the login flow.
 *
 * Multiple dev profiles are mirrored from the server so developers can flip
 * between role levels (SUPER_ADMIN, OWNER, ADMIN, STAFF, plain USER) using
 * either the dev banner dropdown or a `?as=<key>` URL query param. Switching
 * always resets the cached business + user so the next request is attributed
 * to the right profile.
 */

export type DevUserRole = "USER" | "SUPER_ADMIN";
export type DevMembershipRole = "OWNER" | "ADMIN" | "STAFF";

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

export const KEYFLOW_DEV_BYPASS_TOKEN = "keyflow-dev-bypass-token";
export const DEFAULT_DEV_PROFILE_KEY = "super";
export const DEV_PROFILE_STORAGE_KEY = "kf_dev_profile";

export const KEYFLOW_DEV_PROFILES: readonly KeyflowDevProfile[] = [
  {
    key: "super",
    label: "Super Admin",
    description: "Global SUPER_ADMIN, owner of the dev business",
    token: KEYFLOW_DEV_BYPASS_TOKEN,
    userId: "keyflowdev_user",
    email: "dev@keyflow.os",
    name: "Keyflow Dev",
    firstName: "Keyflow",
    lastName: "Dev",
    userRole: "SUPER_ADMIN",
    businessId: "keyflowdev_business",
    businessName: "Keyflow Dev",
    membershipRole: "OWNER",
  },
  {
    key: "owner",
    label: "Owner",
    description: "Plain user with OWNER membership in the dev business",
    token: "keyflow-dev-bypass-token-owner",
    userId: "keyflowdev_owner",
    email: "owner@keyflow.os",
    name: "Dev Owner",
    firstName: "Dev",
    lastName: "Owner",
    userRole: "USER",
    businessId: "keyflowdev_business",
    businessName: "Keyflow Dev",
    membershipRole: "OWNER",
  },
  {
    key: "admin",
    label: "Admin",
    description: "Plain user with ADMIN membership in the dev business",
    token: "keyflow-dev-bypass-token-admin",
    userId: "keyflowdev_admin",
    email: "admin@keyflow.os",
    name: "Dev Admin",
    firstName: "Dev",
    lastName: "Admin",
    userRole: "USER",
    businessId: "keyflowdev_business",
    businessName: "Keyflow Dev",
    membershipRole: "ADMIN",
  },
  {
    key: "staff",
    label: "Staff",
    description: "Plain user with STAFF membership in the dev business",
    token: "keyflow-dev-bypass-token-staff",
    userId: "keyflowdev_staff",
    email: "staff@keyflow.os",
    name: "Dev Staff",
    firstName: "Dev",
    lastName: "Staff",
    userRole: "USER",
    businessId: "keyflowdev_business",
    businessName: "Keyflow Dev",
    membershipRole: "STAFF",
  },
  {
    key: "user",
    label: "Plain User",
    description: "Regular user owning a separate sandbox business",
    token: "keyflow-dev-bypass-token-user",
    userId: "keyflowdev_user_only",
    email: "user@keyflow.os",
    name: "Dev User",
    firstName: "Dev",
    lastName: "User",
    userRole: "USER",
    businessId: "keyflowdev_user_business",
    businessName: "Dev User Sandbox",
    membershipRole: "OWNER",
  },
] as const;

const profilesByKey = new Map(KEYFLOW_DEV_PROFILES.map((p) => [p.key, p]));

export function getDevProfileByKey(
  key: string | null | undefined,
): KeyflowDevProfile | undefined {
  if (!key) return undefined;
  return profilesByKey.get(key.toLowerCase());
}

export function getDefaultDevProfile(): KeyflowDevProfile {
  return profilesByKey.get(DEFAULT_DEV_PROFILE_KEY) ?? KEYFLOW_DEV_PROFILES[0];
}

export function isDevAuthBypassEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_KEYFLOW_DEV_AUTH_BYPASS;
  return flag === "true" || flag === "1";
}

/**
 * Returns the active dev profile based on (in order):
 *   1. `?as=<key>` query parameter on the current URL
 *   2. The `kf_dev_profile` localStorage value
 *   3. The default profile
 *
 * Always returns a profile when called on the client; on the server it falls
 * back to the default profile (no localStorage / window).
 */
export function getActiveDevProfile(): KeyflowDevProfile {
  if (typeof window === "undefined") return getDefaultDevProfile();
  try {
    const params = new URLSearchParams(window.location.search);
    const queryKey = params.get("as");
    const fromQuery = getDevProfileByKey(queryKey);
    if (fromQuery) return fromQuery;
  } catch {
    // ignore
  }
  try {
    const stored = window.localStorage.getItem(DEV_PROFILE_STORAGE_KEY);
    const fromStorage = getDevProfileByKey(stored);
    if (fromStorage) return fromStorage;
  } catch {
    // ignore
  }
  return getDefaultDevProfile();
}

/**
 * Idempotently sync the current active dev profile into localStorage so the
 * rest of the app code paths see the dev session without ever hitting the
 * login flow. Called at app boot and on every workspace bootstrap.
 *
 * If the active profile has *changed* since the last call (e.g. the developer
 * arrived with a `?as=staff` query param after previously browsing as super),
 * we also evict the cached user + business so the next bootstrap re-fetches
 * identity against the new profile instead of rendering the previous one.
 *
 * Returns `true` when the active profile changed (caller should treat any
 * cached workspace as invalidated and re-bootstrap).
 */
export function applyDevBypassToLocalStorage(): boolean {
  if (typeof window === "undefined") return false;
  if (!isDevAuthBypassEnabled()) return false;
  const profile = getActiveDevProfile();
  try {
    const previousKey = window.localStorage.getItem(DEV_PROFILE_STORAGE_KEY);
    const previousToken = window.localStorage.getItem("kf_token");
    const previousBusinessId = window.localStorage.getItem("kf_business_id");

    const profileChanged =
      previousKey !== profile.key ||
      previousToken !== profile.token ||
      previousBusinessId !== profile.businessId;

    if (profileChanged) {
      // Drop any cached identity so the next bootstrap call re-attributes
      // against the new profile rather than rendering the previous one.
      window.localStorage.removeItem("kf_user_cache");
      window.localStorage.removeItem("kf_business_cache");
    }

    if (previousToken !== profile.token) {
      window.localStorage.setItem("kf_token", profile.token);
    }
    if (previousBusinessId !== profile.businessId) {
      window.localStorage.setItem("kf_business_id", profile.businessId);
    }
    if (previousKey !== profile.key) {
      window.localStorage.setItem(DEV_PROFILE_STORAGE_KEY, profile.key);
    }

    return profileChanged;
  } catch {
    // localStorage may be unavailable (private mode, SSR); best-effort only.
    return false;
  }
}

/**
 * Switch the active dev profile, clear cached identity data and reload so the
 * server reattributes every subsequent request to the new profile.
 */
export function switchDevProfile(key: string) {
  if (typeof window === "undefined") return;
  if (!isDevAuthBypassEnabled()) return;
  const profile = getDevProfileByKey(key);
  if (!profile) return;
  try {
    window.localStorage.setItem(DEV_PROFILE_STORAGE_KEY, profile.key);
    window.localStorage.setItem("kf_token", profile.token);
    window.localStorage.setItem("kf_business_id", profile.businessId);
    // Drop cached identity so the next bootstrap call re-fetches the new
    // attribution rather than rendering the previous profile's name/role.
    window.localStorage.removeItem("kf_user_cache");
    window.localStorage.removeItem("kf_business_cache");
  } catch {
    // best-effort
  }
  // Strip the `?as=` query param so the localStorage value wins on reload.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("as")) {
      url.searchParams.delete("as");
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    // ignore
  }
  window.location.reload();
}

// ─── Backwards-compat exports (the original single-profile constants) ────────
const defaultProfile = getDefaultDevProfile();
export const KEYFLOW_DEV_BUSINESS_ID = defaultProfile.businessId;
export const KEYFLOW_DEV_USER_ID = defaultProfile.userId;
export const KEYFLOW_DEV_USER_EMAIL = defaultProfile.email;
export const KEYFLOW_DEV_USER_NAME = defaultProfile.name;
