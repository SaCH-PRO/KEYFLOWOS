"use client";

import { useServiceWorker } from "@/hooks/use-service-worker";

export function RegisterSW() {
  useServiceWorker();

  return null;
}
