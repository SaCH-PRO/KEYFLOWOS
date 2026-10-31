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

/**
 * The state when the onboarding check could not be made (API error, empty
 * body, network failure). Owner ruling D-03: the gate fails open — onboarding
 * completes without AI on the manual path, and a failed read must never send
 * an onboarded owner back to /app/onboarding.
 */
const FAIL_OPEN_STATE: GenomeGateState = {
  checking: false,
  gateActive: false,
  threePillarMet: false,
  genomeIntegrity: null,
  genesisCompleted: null,
};

export function useGenomeGate(): GenomeGateState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<GenomeGateState>(() => ({
    checking: !!getStoredBusinessId(),
    gateActive: true, // until checked; the layout shows a spinner meanwhile
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag lifecycle: closes the gate once the no-business path resolves
      setState((s) => ({ ...s, checking: false, gateActive: true }));
      return;
    }

    fetchOnboardingState(businessId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          // Owner ruling D-03: the gate fails open. An unreadable onboarding
          // state is not evidence that onboarding is unfinished, so the user
          // stays where they are instead of being bounced to /app/onboarding.
          setState(FAIL_OPEN_STATE);
          return;
        }

        const threePillarMet = data.threePillarMet;
        const onboardingFinished =
          data.onboardingComplete || data.onboardingCompletedAt != null;
        // Gate on ONBOARDING completion only. An incomplete Business Genome
        // (three pillars not yet met) is encouraged, not required: a returning
        // user who has finished onboarding lands in their workspace and is
        // nudged by GenomeIntegrityBanner, never bounced back into onboarding.
        // Including !threePillarMet here trapped every genome-incomplete
        // account on the onboarding screen at every login.
        const gateActive = !onboardingFinished;

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
         
        console.error("Genome gate check failed", err);
        // Fails open, as above (D-03).
        setState(FAIL_OPEN_STATE);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams, router]);

  return state;
}
