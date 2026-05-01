"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ListPageSkeleton } from "@/components/ui/skeleton";

export default function CommandPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/keyflow-command");
  }, [router]);

  return <ListPageSkeleton />;
}
