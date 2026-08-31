"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NotificationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/settings/notifications");
  }, [router]);

  return null;
}
