"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SocialPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/marketing?tab=social");
  }, [router]);

  return null;
}
