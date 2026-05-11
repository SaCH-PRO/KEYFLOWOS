// @keyflow:dormant — gated by featureFlags.learning (KEY-9 cleanup target).
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="learning" label="Learn">
      {children}
    </DormantFeatureGate>
  );
}
