"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LaunchpadRoute() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/store?tab=launch");
  }, [router]);

  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Opening Launchpad...</p>
    </div>
  );
}
