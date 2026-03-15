"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutomationsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/projects?tab=playbooks");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
      Redirecting to Projects & Playbooks...
    </div>
  );
}
