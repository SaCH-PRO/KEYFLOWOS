// @keyflow:dormant
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function SocialDormantLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="contentScheduler" label="Content Scheduler">
      {children}
    </DormantFeatureGate>
  );
}
