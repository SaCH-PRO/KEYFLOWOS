"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchOnboardingState } from "@/lib/api/onboarding-concierge";

const ALLOWED_PATHS = [
  "/app/profile",
  "/app/settings",
  "/app/billing",
  "/app/help",
  "/app/key-connect",
  "/app/onboarding",
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
  const [state, setState] = useState<GenomeGateState>(() => ({
    checking: !!getStoredBusinessId(),
    gateActive: true, // fail closed until verified
    threePillarMet: false,
    genomeIntegrity: null,
    genesisCompleted: null,
  }));

  useEffect(() => {
    let cancelled = false;
    const businessId = getStoredBusinessId();

    const pathWithQuery = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname || "";

    if (!businessId) {
      // No business selected -> keep gate closed and send to onboarding.
      if (!isAllowedPath(pathWithQuery)) {
        router.replace("/app/onboarding");
      }
      setState((s) => ({ ...s, checking: false, gateActive: true }));
      return;
    }

    fetchOnboardingState(businessId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          // Fail closed on any API error.
          setState({
            checking: false,
            gateActive: true,
            threePillarMet: false,
            genomeIntegrity: null,
            genesisCompleted: null,
          });
          if (!isAllowedPath(pathWithQuery)) {
            router.replace("/app/onboarding");
          }
          return;
        }

        const threePillarMet = data.threePillarMet;
        const onboardingFinished =
          data.onboardingComplete || data.onboardingCompletedAt != null;
        const gateActive = !threePillarMet || !onboardingFinished;

        setState({
          checking: false,
          gateActive,
          threePillarMet,
          genomeIntegrity: null,
          genesisCompleted: null,
        });

        if (gateActive && pathWithQuery && !isAllowedPath(pathWithQuery)) {
          router.replace("/app/onboarding");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("Genome gate check failed", err);
        setState({
          checking: false,
          gateActive: true,
          threePillarMet: false,
          genomeIntegrity: null,
          genesisCompleted: null,
        });
        if (!isAllowedPath(pathWithQuery)) {
          router.replace("/app/onboarding");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams, router]);

  return state;
}
