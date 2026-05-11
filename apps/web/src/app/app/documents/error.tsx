// @keyflow:dormant
"use client";

import { ModuleErrorBoundary } from "@/components/ui/module-error-boundary";

export default function DocumentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ModuleErrorBoundary error={error} reset={reset} moduleName="Documents" />;
}