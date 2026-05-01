"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ControlTowerRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/keyflow-command");
  }, [router]);
  return null;
}
