"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { BUSINESS_REMOVED_EVENT, getRemovedBusinessNotice } from "@/lib/removed-business-notice";
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
  // SWP-REMOVED-MEMBER-NOTICE (security review MINOR-3): re-check when the removed-business notice is raised or
  // dismissed, so the gate applies again as soon as the member dismisses it.
  const [noticeVersion, setNoticeVersion] = useState(0);
  useEffect(() => {
    const bump = () => setNoticeVersion((v) => v + 1);
    window.addEventListener(BUSINESS_REMOVED_EVENT, bump);
    return () => window.removeEventListener(BUSINESS_REMOVED_EVENT, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const businessId = getStoredBusinessId();

    const pathWithQuery = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname || "";

    // SWP-REMOVED-MEMBER-NOTICE (BUG-117): a member who just lost access to a business is told so by the shell's
    // notice; they are never sent to onboarding for that reason (their remaining business, or none, is not a choice
    // they made). Once they dismiss the notice, the gate applies as usual.
    const removedPending = getRemovedBusinessNotice() !== null;

    if (!businessId) {
      // No business selected -> keep gate closed and send to onboarding.
      // The pending-notice guard wraps the allowed-path guard, never merges into it: the redirect keeps the exact form
      // e2e/onboarding-loop-regression.spec.ts (Release 0 evidence, R0-06) pins.
      if (!removedPending) {
        if (!isAllowedPath(pathWithQuery)) {
          router.replace("/app/onboarding");
        }
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

        if (!removedPending) {
          if (gateActive && pathWithQuery && !isAllowedPath(pathWithQuery)) {
            router.replace("/app/onboarding");
          }
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
  }, [pathname, searchParams, router, noticeVersion]);

  return state;
}
