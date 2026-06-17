"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

const ALLOWED_PATHS = [
  "/app/profile",
  "/app/settings",
  "/app/billing",
  "/app/help",
  "/app/key-connect",
  "/logout",
];

const PUBLIC_PATH_PREFIXES = ["/app/auth", "/public", "/"];

function isAllowedPath(path: string): boolean {
  if (ALLOWED_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) {
    return true;
  }
  if (PUBLIC_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) {
    return true;
  }
  return false;
}

interface GenomeGateState {
  checking: boolean;
  gateActive: boolean;
  threePillarMet: boolean;
  genomeIntegrity: number | null;
  genesisCompleted: boolean | null;
}

export function useGenomeGate(): GenomeGateState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<GenomeGateState>({
    checking: true,
    gateActive: false,
    threePillarMet: false,
    genomeIntegrity: null,
    genesisCompleted: null,
  });

  useEffect(() => {
    let cancelled = false;
    const businessId = getStoredBusinessId();
    if (!businessId) {
      setState((s) => ({ ...s, checking: false }));
      return;
    }

    const pathWithQuery = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname || "";

    apiGet<{
      met: boolean;
      founder: number;
      business: number;
      market: number;
    }>(`/blueprint/businesses/${businessId}/genome/three-pillar-status`)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setState((s) => ({ ...s, checking: false }));
          return;
        }

        const threePillarMet = data.met;
        const gateActive = !threePillarMet;
        const minScore = Math.min(data.founder, data.business, data.market);

        setState({
          checking: false,
          gateActive,
          threePillarMet,
          genomeIntegrity: minScore,
          genesisCompleted: null,
        });

        if (gateActive && pathWithQuery && !isAllowedPath(pathWithQuery)) {
          router.replace("/app/profile?tab=business-genome&intro=1");
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, checking: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams, router]);

  return state;
}
