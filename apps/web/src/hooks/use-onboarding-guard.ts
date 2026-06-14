"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

const ONBOARDING_PATHS = [
  "/app/onboarding",
  "/app/blueprint",
  "/app/profile",
  "/app/build/business/blueprint",
];

const PUBLIC_APP_PATHS = [
  "/app/settings",
  "/app/billing",
  "/app/help",
];

function isOnboardingOrPublic(path: string): boolean {
  if (ONBOARDING_PATHS.some((p) => path === p || path.startsWith(`${p}?`))) return true;
  if (PUBLIC_APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  return false;
}

export function useOnboardingGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [complete, setComplete] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const businessId = getStoredBusinessId();
    if (!businessId) {
      setChecking(false);
      return;
    }

    apiGet<{ completeness: number }>(`/blueprint/businesses/${businessId}`)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setChecking(false);
          return;
        }
        const completeness = data.completeness || 0;
        setComplete(completeness >= 60);
        if (completeness < 60 && pathname && !isOnboardingOrPublic(pathname)) {
          router.replace("/app/onboarding");
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return { checking, complete };
}
