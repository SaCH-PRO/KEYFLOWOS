// @keyflow:dormant — gated by featureFlags.community (KEY-9 cleanup target).
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="community" label="Community">
      {children}
    </DormantFeatureGate>
  );
}
