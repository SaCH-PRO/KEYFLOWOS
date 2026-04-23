"use client";

import { ModuleErrorBoundary } from "@/components/ui/module-error-boundary";

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ModuleErrorBoundary error={error} reset={reset} moduleName="CRM" />;
}
