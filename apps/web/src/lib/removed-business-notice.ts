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
/** As stored: with the person it was raised for, so it is never shown to anyone else (security review MAJOR-1). */
type StoredNotice = RemovedBusinessNotice & { userId: string | null };

function readStored(): StoredNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REMOVED_NOTICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredNotice>) : null;
    return parsed && typeof parsed.id === "string"
      ? {
          id: parsed.id,
          name: typeof parsed.name === "string" ? parsed.name : null,
          userId: typeof parsed.userId === "string" ? parsed.userId : null,
        }
      : null;
  } catch {
    return null;
  }
}

export function getRemovedBusinessNotice(): RemovedBusinessNotice | null {
  const stored = readStored();
  return stored ? { id: stored.id, name: stored.name } : null;
}

/** Whom the pending notice was raised for (null: none pending, or raised without a known user). */
export function getRemovedBusinessNoticeUserId(): string | null {
  return readStored()?.userId ?? null;
}

/** Store the notice for this person and announce it to the shell. */
export function raiseRemovedBusinessNotice(notice: RemovedBusinessNotice, userId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMOVED_NOTICE_KEY, JSON.stringify({ ...notice, userId }));
  window.dispatchEvent(new CustomEvent(BUSINESS_REMOVED_EVENT, { detail: notice }));
}

/**
 * The member dismissed it, or was given the business back: cleared and announced (the shell hides it, the gate
 * re-checks). `silent` is for a session that is ending or starting (sign-out, sign-in): cleared without an
 * announcement, so the gate does not react while the member is being sent to the sign-in page (correctness review
 * R-MINOR-1).
 */
export function dismissRemovedBusinessNotice(options: { silent?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(REMOVED_NOTICE_KEY) === null) return;
  window.localStorage.removeItem(REMOVED_NOTICE_KEY);
  if (!options.silent) window.dispatchEvent(new CustomEvent(BUSINESS_REMOVED_EVENT, { detail: null }));
}
