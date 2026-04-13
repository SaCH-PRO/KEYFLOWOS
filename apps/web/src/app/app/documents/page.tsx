"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DocumentsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/profile?tab=intelligence");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--kf-accent1))]" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Redirecting to Documents...</p>
      </div>
    </div>
  );
}
