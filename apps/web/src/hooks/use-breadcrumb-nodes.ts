"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  resolvePathToBreadcrumbNodes,
  getEntityType,
} from "@/lib/semantic-routes";
import { useEntityResolver } from "./use-entity-resolver";

export interface BreadcrumbNode {
  label: string;
  href: string;
  isLink: boolean;
  isUuid?: boolean;
  entityType?: string;
  entityId?: string;
}

export function useBreadcrumbNodes(businessId: string | null | undefined) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const nodes = useMemo(() => {
    return resolvePathToBreadcrumbNodes(pathname, searchParams);
  }, [pathname, searchParams]);

  // Detect UUID segments that might be entity IDs
  const entityNodes = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    const appIndex = segments.indexOf("app");
    if (appIndex === -1) return [];

    const crumbs = segments.slice(appIndex + 1);
    const detected: Array<{ segment: string; entityType: string }> = [];

    for (let i = 0; i < crumbs.length; i++) {
      const segment = crumbs[i];
      if (isUuid(segment) && i > 0) {
        const prevSegment = crumbs[i - 1];
        const et = getEntityType(prevSegment);
        if (et) {
          detected.push({ segment, entityType: et });
        }
      }
    }
    return detected;
  }, [pathname]);

  const { resolveMany, getCached } = useEntityResolver(businessId);

  return {
    nodes,
    entityNodes,
    resolveMany,
    getCached,
  };
}

function isUuid(s: string) {
  return /^[0-9a-f-]{20,}$/i.test(s);
}
