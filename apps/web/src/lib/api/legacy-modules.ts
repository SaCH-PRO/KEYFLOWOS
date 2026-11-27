import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";

/**
 * WEDGE-HIDE-STORE (P225; D-263 'wedge', D-152 'hide'): the web's one reader of the per-business legacy answer,
 * GET /identity/businesses/:businessId/legacy-modules (NAV-B-LEGACY-SERVER). The server answers the sorted keys of the
 * hidden v1 modules (packages/shared/src/v1-modules.ts) this business already has records in; a business on a module's
 * list keeps it, read and write, and any other business is not offered it.
 *
 * Fail closed, on purpose: a hidden module is offered only once the server has answered, for the business on screen, a
 * list naming it. While the read is in flight `known` is false and `has` is false; a refusal, a 5xx, a network failure
 * or a body that is not a list of strings is known and not legacy. With no business selected nothing is read.
 *
 * The answer is kept with its business. A switch of business in this tab (selectBusiness, BUSINESS_CHANGED_EVENT) reads
 * the new business's answer; until it lands the old business's is never used, and a late reply for an older request is
 * dropped. A successful answer is kept for the tab (the list changes only when a business starts using a hidden module);
 * a failed read is not kept, so the next mount reads again.
 */

export function fetchLegacyModules(businessId: string) {
  return apiGet<unknown>(`/identity/businesses/${encodeURIComponent(businessId)}/legacy-modules`);
}

function moduleList(body: unknown): readonly string[] | null {
  if (!Array.isArray(body) || !body.every((k) => typeof k === "string")) return null;
  return body as string[];
}

/** Successful answers in this tab, by business. */
const answers = new Map<string, readonly string[]>();

/** Forgets what this tab read, as a new tab would start. For tests only. */
export function resetLegacyModulesForTests(): void {
  answers.clear();
}

export interface LegacyModuleState {
  /** The server's answer for the business on screen is in (or there is no business). */
  known: boolean;
  /** The business on screen already uses this hidden module: offer it. */
  has: boolean;
}

/** Whether the business on screen is on the legacy list for the hidden module `key` (fail closed). */
export function useLegacyModule(key: string): LegacyModuleState {
  const [businessId, setBusinessId] = useState<string | null>(() => getStoredBusinessId());
  const [read, setRead] = useState<{ businessId: string; modules: readonly string[] } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const onBusinessChanged = (event: Event) => {
      const next = (event as CustomEvent<{ businessId?: string }>).detail?.businessId ?? getStoredBusinessId();
      setBusinessId(next ?? null);
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    return () => window.removeEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
  }, []);

  useEffect(() => {
    if (!businessId || answers.has(businessId)) return;
    const mine = ++request.current;
    let current = true;
    const settle = (modules: readonly string[] | null) => {
      if (!current || mine !== request.current) return;
      if (modules) answers.set(businessId, modules);
      setRead({ businessId, modules: modules ?? [] });
    };
    fetchLegacyModules(businessId)
      .then(({ data, error }) => settle(error ? null : moduleList(data)))
      .catch(() => settle(null));
    return () => {
      current = false;
    };
  }, [businessId]);

  if (!businessId) return { known: true, has: false };
  const cached = answers.get(businessId);
  const modules = cached ?? (read && read.businessId === businessId ? read.modules : null);
  if (!modules) return { known: false, has: false };
  return { known: true, has: modules.includes(key) };
}
