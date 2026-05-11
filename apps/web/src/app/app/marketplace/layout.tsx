// @keyflow:dormant — gated by featureFlags.marketplaceBrowsing (KEY-9 cleanup target).
import { DormantFeatureGate } from "@/components/dormant-feature-gate";

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <DormantFeatureGate flag="marketplaceBrowsing" label="Marketplace">
      {children}
    </DormantFeatureGate>
  );
}
