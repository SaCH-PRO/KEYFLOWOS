"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BusinessBlueprintPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/blueprint");
  }, [router]);
  return null;
}
