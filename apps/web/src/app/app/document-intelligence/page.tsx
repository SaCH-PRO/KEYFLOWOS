"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DocumentIntelligencePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/profile?tab=documents");
  }, [router]);

  return null;
}
