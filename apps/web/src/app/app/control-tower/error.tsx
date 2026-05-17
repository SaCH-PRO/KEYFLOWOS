"use client";

import { RouteErrorFallback } from "@/components/ui/route-error-fallback";

export default function ControlTowerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Control Tower error"
      description="Something went wrong loading the control tower. Try again or return to the dashboard."
    />
  );
}
