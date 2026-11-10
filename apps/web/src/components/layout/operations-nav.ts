"use client";

import { useEffect, useState } from "react";
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
 * way lib/module-access.ts already decides it (GET procurement stats: 403 is
 * none, success is read or more, anything else is unknown and keeps the entry).
 * The cockpit is not gated: it stays every member's home, each tile filtered by
 * the member's own permissions (D-96).
 *
 * The desktop sidebar, the mobile drawer and the bottom nav's module launcher
 * each call the hook; their probes go out together on mount and apiGet shares
 * one in-flight request between them.
 */

/** The signed-in member's operations access in the selected business, as the server last answered it; re-read when the business changes. */
export function useOperationsAccess(): OperationsAccess {
  const [access, setAccess] = useState<OperationsAccess>("unknown");

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const probe = () => {
      const mine = ++generation;
      const businessId = getStoredBusinessId();
      if (!businessId) return;
      void probeOperationsAccess(businessId).then((answer) => {
        // A later business (or an unmounted nav) owns the answer now.
        if (disposed || mine !== generation || getStoredBusinessId() !== businessId) return;
        setAccess(answer);
      });
    };
    // Another business: the previous one's answer says nothing about it, so the entry shows until the new answer lands.
    const onBusinessChanged = () => {
      setAccess("unknown");
      probe();
    };
    probe();
    window.addEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    return () => {
      disposed = true;
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    };
  }, []);

  return access;
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
