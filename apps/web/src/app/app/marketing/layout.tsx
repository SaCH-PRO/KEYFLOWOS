// @keyflow:dormant
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function MarketingDormantLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="contentScheduler" label="Content">
      {children}
    </DormantFeatureGate>
  );
}
