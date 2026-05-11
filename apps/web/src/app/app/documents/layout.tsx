// @keyflow:dormant — gated by featureFlags.documents (KEY-9 cleanup target).
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="documents" label="Documents">
      {children}
    </DormantFeatureGate>
  );
}
