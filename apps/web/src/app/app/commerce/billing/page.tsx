"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LegacyBillingRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const tab = params.get("tab") || "payments";
    router.replace(`/app/commerce/collections?tab=${encodeURIComponent(tab)}`);
  }, [router, params]);

  return (
    <div className="p-6 text-sm text-muted-foreground">
      Redirecting to Collections (Customer Payments)…
    </div>
  );
}
