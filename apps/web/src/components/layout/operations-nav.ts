"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";
import { isHrefAvailable, probeOperationsAccess, type OperationsAccess } from "@/lib/module-access";
import type { NavItem, NavSection } from "@/lib/nav-config";

/**
 * W7-WEB-OPS-SCOPE (owner rulings D-40 and D-96; OPS-T02): what the nav shows a
 * member, given their operations access in the selected business.
 *
 * Every procurement route needs the 'operations' module scope (D-40), so a
 * member whose scope map grants none is refused on every call /app/procurement
 * makes; the nav must not offer them the door. The web cannot read a STAFF
 * member's own scope map, so the level comes from the server's answer, read the
 * way lib/module-access.ts decides it (GET procurement stats: ModuleScopeGuard's
 * refusal naming no operations access is none; success is read or more; any
 * other answer, every other 403 included, is unknown and keeps the entry; review
 * WOS-R1). The cockpit is not gated: it stays every member's home, each tile
 * filtered by the member's own permissions (D-96).
 *
 * The desktop sidebar, the mobile drawer and the bottom nav's module launcher
 * each call the hook; their probes go out together on mount and apiGet shares
 * one in-flight request between them.
 *
 * An answer belongs to the business it was probed for (review SEC-WOS-1 and
 * WOS-R2): the hook keeps {businessId, access} and applies it only while that
 * business is still the selected one, so one tenant's answer never stands for
 * another's. The selected business is followed the way contact-custom-fields'
 * useSelectedBusinessId follows it: read again at every render (so
 * refreshWorkspace's unannounced correction of a stale id, which use-app-layout
 * runs on every mount, is picked up when the shell renders again once it has
 * landed), on BUSINESS_CHANGED_EVENT (selectBusiness) and on `storage` (a
 * switch made in another tab). A probe whose business was replaced while it was
 * in flight is followed by a probe of the new one.
 */

function subscribeToSelectedBusiness(onChange: () => void) {
  window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The server renders no selection; the client reads it once hydrated. */
const NO_SELECTION_ON_SERVER = () => null;

/** The signed-in member's operations access in the selected business, as the server answered it for that business; "unknown" until it has. */
export function useOperationsAccess(): OperationsAccess {
  const businessId = useSyncExternalStore(subscribeToSelectedBusiness, getStoredBusinessId, NO_SELECTION_ON_SERVER);
  const [answered, setAnswered] = useState<{ businessId: string; access: OperationsAccess } | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let disposed = false;
    void probeOperationsAccess(businessId).then((access) => {
      // The nav unmounted, or it has moved to another business and probes that one.
      if (disposed) return;
      // Recorded for the business it answers for. When the stored business moved while this was in
      // flight without announcing it (refreshWorkspace), the render this causes reads the new one,
      // which this answer does not match, and probes it.
      setAnswered({ businessId, access });
    });
    return () => {
      disposed = true;
    };
  }, [businessId]);

  // Another business's answer says nothing about this one: the entry shows until this one's answer lands.
  return answered !== null && answered.businessId === businessId ? answered.access : "unknown";
}

// Both return their input unchanged (the same array) unless an entry is hidden, so the
// launcher's memoised sections are not rebuilt on every render.

/** The nav entries a member with `access` is shown. */
export function navItemsForOperationsAccess(items: NavItem[], access: OperationsAccess): NavItem[] {
  const shown = items.filter((item) => isHrefAvailable(item.href, access));
  return shown.length === items.length ? items : shown;
}

/** The nav sections a member with `access` is shown: hidden entries removed, and a section they emptied dropped. */
export function sectionsForOperationsAccess(sections: NavSection[], access: OperationsAccess): NavSection[] {
  let changed = false;
  const shown = sections.flatMap((section) => {
    const items = navItemsForOperationsAccess(section.items, access);
    if (items === section.items) return [section];
    changed = true;
    return items.length > 0 ? [{ ...section, items }] : [];
  });
  return changed ? shown : sections;
}
