import { useEffect, useState, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api";
import { actingMemberNow } from "@/lib/business-settings";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";

/**
 * WEDGE-HIDE-STORE (P225; D-263 'wedge', D-152 'hide'): the web's one reader of the per-business legacy answer,
 * GET /identity/businesses/:businessId/legacy-modules (NAV-B-LEGACY-SERVER). The server answers the sorted keys of the
 * hidden v1 modules (packages/shared/src/v1-modules.ts) this business already has records in; a business on a module's
 * list keeps it, read and write, and any other business is not offered it.
 *
 * Fail closed, on purpose: a hidden module is offered only once the server has answered, for the member and the
 * business on screen, a list naming it. While the read is in flight `known` is false and `has` is false; a refusal, a
 * 5xx, a network failure or a body that is not a list of strings is known and not legacy. With no business selected
 * nothing is read and nothing is legacy.
 *
 * An answer belongs to the member and the business it was asked for (repair round 1, the pattern of
 * useMemberModuleLevels in hooks/use-app-layout.ts and useStoredBusinessId in lib/business-settings.ts). The selection
 * is read again on every render and followed across BUSINESS_CHANGED_EVENT (selectBusiness in this tab) and `storage`
 * (another tab's switch, sign-in or sign-out). So a business stored without an announcement (refreshWorkspace's
 * correction, a first business bootstrapped, the sign-in pages), a sign-out (clearStoredBusinessId) and a different
 * user signing in on the same tab each get their own answer: the previous selection's is never used, and a late
 * reply for it is dropped. A successful answer is kept for the tab under its member and business; a failed read is not
 * kept, so the next mount reads again.
 */

export function fetchLegacyModules(businessId: string) {
  return apiGet<unknown>(`/identity/businesses/${encodeURIComponent(businessId)}/legacy-modules`);
}

function moduleList(body: unknown): readonly string[] | null {
  if (!Array.isArray(body) || !body.every((k) => typeof k === "string")) return null;
  return body as string[];
}

/** Successful answers in this tab, by member and business (the selection key below). */
const answers = new Map<string, readonly string[]>();

/** Forgets what this tab read, as a new tab would start. For tests only. */
export function resetLegacyModulesForTests(): void {
  answers.clear();
}

function subscribeToSelection(onChange: () => void): () => void {
  window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The member acting and the business selected, as one key; null with no business. Either changing is another answer. */
const selectionKey = (): string | null => {
  const businessId = getStoredBusinessId();
  return businessId ? `${actingMemberNow()}\n${businessId}` : null;
};

/**
 * On the server and while hydrating, the selection is not known yet (repair round 2): the hook answers
 * `known: false` there, so a consumer acting on `known && !has` never acts on a hard load before the client has read
 * who is signed in and which business is selected. Not a value selectionKey() can return (it holds no newline).
 */
const HYDRATING = "hydrating";
const selectionWhileHydrating = () => HYDRATING;

export interface LegacyModuleState {
  /** The server's answer for the member and business on screen is in (or there is no business). */
  known: boolean;
  /** The business on screen already uses this hidden module: offer it. */
  has: boolean;
}

/** Whether the business on screen is on the legacy list for the hidden module `key` (fail closed). */
export function useLegacyModule(key: string): LegacyModuleState {
  const selection = useSyncExternalStore(subscribeToSelection, selectionKey, selectionWhileHydrating);
  const [read, setRead] = useState<{ selection: string; modules: readonly string[] } | null>(null);

  useEffect(() => {
    if (!selection || selection === HYDRATING || answers.has(selection)) return;
    const businessId = selection.slice(selection.indexOf("\n") + 1);
    // A later selection (another business or member) disposes this read: its reply is then dropped.
    let disposed = false;
    const settle = (modules: readonly string[] | null) => {
      if (disposed) return;
      if (modules) answers.set(selection, modules);
      setRead({ selection, modules: modules ?? [] });
    };
    fetchLegacyModules(businessId)
      .then(({ data, error }) => settle(error ? null : moduleList(data)))
      .catch(() => settle(null));
    return () => {
      disposed = true;
    };
  }, [selection]);

  if (selection === HYDRATING) return { known: false, has: false };
  if (!selection) return { known: true, has: false };
  const modules = answers.get(selection) ?? (read && read.selection === selection ? read.modules : null);
  if (!modules) return { known: false, has: false };
  return { known: true, has: modules.includes(key) };
}
