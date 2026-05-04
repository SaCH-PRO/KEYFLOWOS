"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ComplianceSettingsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/profile");
  }, [router]);

  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-muted-foreground">Redirecting to Profile...</p>
    </div>
  );
}
