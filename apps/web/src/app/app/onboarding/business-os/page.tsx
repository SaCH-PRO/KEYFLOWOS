"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingBusinessOsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/onboarding");
  }, [router]);
  return null;
}
