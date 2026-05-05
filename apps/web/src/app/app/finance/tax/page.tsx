"use client";

import { Calculator } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function FinanceTaxPage() {
  return (
    <EmptyState
      icon={Calculator}
      title="Tax centre"
      description="Per-period VAT and business levy rollups land here. For now, manage the default tax rate and tax accounts in Settings."
      variant="compact"
    />
  );
}
