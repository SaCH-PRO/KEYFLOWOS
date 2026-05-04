"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { dispatchOpenNotes } from "@/components/keyflow/notes-context";

/**
 * Onboarding has been folded into the unified Notes drawer as the
 * "Get started" entry. We redirect to /app and open the Notes drawer on the
 * Get Started page so users land in the same place no matter which entry
 * point they used.
 */
export default function OnboardingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app");
    // Defer dispatch so the Notes provider has mounted on /app.
    const t = setTimeout(() => {
      dispatchOpenNotes({
        scope: { kind: "page", pageKey: "get-started" },
        tab: "page",
      });
    }, 250);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] text-sm text-muted-foreground">
      Opening Get Started…
    </div>
  );
}
