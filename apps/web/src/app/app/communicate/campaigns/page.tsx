// @keyflow:dormant — gated by featureFlags.contentScheduler, like app/app/marketing.
//
// next.config.ts sends /app/marketing here with a permanent 308, so this route
// renders the marketing screen outside app/app/marketing/layout.tsx. It wears
// that layout's gate itself (same flag, same label): in production the
// marketing module stays hidden behind the redirect too (ruling D-152 `hide`,
// MARKETING-REDIRECT-GATE). The redirect itself stays: a 308 is never reversed.
import { DormantFeatureGate } from "@/components/dormant-feature-gate";
import MarketingPage from "@/app/app/marketing/page";

export default function CommunicateCampaignsPage() {
  return (
    <DormantFeatureGate flag="contentScheduler" label="Content">
      <MarketingPage />
    </DormantFeatureGate>
  );
}
