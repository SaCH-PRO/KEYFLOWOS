"use client";

import { RouteErrorFallback } from "@/components/ui/route-error-fallback";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Admin error"
      description="Something went wrong in the admin panel. Try again or return to the dashboard."
    />
  );
}
