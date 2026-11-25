/**
 * SWP-REMOVED-MEMBER-NOTICE (BUG-117, journey J8): the business a member lost access to, kept until they dismiss it,
 * so the shell can tell them by name instead of moving them silently.
 *
 * workspace.ts raises it, from the authoritative membership list only (never from one screen's 403, which can be a
 * scope refusal) and only for the same person who had the business. The app shell's RemovedBusinessNotice shows it,
 * and the Business Genome gate does not send the member to onboarding while it is pending.
 *
 * Its own module (it imports nothing), so screens and tests that mock @/lib/workspace are unaffected by it.
 */
const REMOVED_NOTICE_KEY = "kf_removed_business";
export const BUSINESS_REMOVED_EVENT = "kf:business-removed";
export type RemovedBusinessNotice = { id: string; name: string | null };

export function getRemovedBusinessNotice(): RemovedBusinessNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REMOVED_NOTICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<RemovedBusinessNotice>) : null;
    return parsed && typeof parsed.id === "string"
      ? { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : null }
      : null;
  } catch {
    return null;
  }
}

/** Store the notice and announce it to the shell. */
export function raiseRemovedBusinessNotice(notice: RemovedBusinessNotice) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMOVED_NOTICE_KEY, JSON.stringify(notice));
  window.dispatchEvent(new CustomEvent(BUSINESS_REMOVED_EVENT, { detail: notice }));
}

/** The member dismissed it, signed out, or was given the business back. */
export function dismissRemovedBusinessNotice() {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(REMOVED_NOTICE_KEY) === null) return;
  window.localStorage.removeItem(REMOVED_NOTICE_KEY);
  window.dispatchEvent(new CustomEvent(BUSINESS_REMOVED_EVENT, { detail: null }));
}
