"use client";

import { RouteErrorFallback } from "@/components/ui/route-error-fallback";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Settings error"
      description="Something went wrong loading your settings. Try again or return to the dashboard."
    />
  );
}
