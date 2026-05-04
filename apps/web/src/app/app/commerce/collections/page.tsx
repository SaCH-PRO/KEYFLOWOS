"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CollectionsPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const sub = params.get("tab") || "payments";
    router.replace(`/app/commerce?tab=${encodeURIComponent(sub)}&surface=collections`);
  }, [router, params]);

  return (
    <div className="p-6 text-sm text-muted-foreground">
      Opening Collections (customer payments)…
    </div>
  );
}
