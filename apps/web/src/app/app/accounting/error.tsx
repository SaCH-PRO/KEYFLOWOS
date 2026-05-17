"use client";

import { RouteErrorFallback } from "@/components/ui/route-error-fallback";

export default function AccountingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Accounting error"
      description="Something went wrong loading your accounting data. Try again or return to the dashboard."
    />
  );
}
