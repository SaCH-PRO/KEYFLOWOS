"use client";

import { RouteErrorFallback } from "@/components/ui/route-error-fallback";

export default function AutomationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Automations error"
      description="Something went wrong loading your automations. Try again or return to the dashboard."
    />
  );
}
