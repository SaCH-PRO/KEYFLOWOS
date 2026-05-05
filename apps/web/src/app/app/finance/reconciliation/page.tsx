"use client";

import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function FinanceReconciliationPage() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Bank reconciliation"
      description="Import a bank statement to start matching transactions. Coming with the next finance release."
      variant="compact"
    />
  );
}
