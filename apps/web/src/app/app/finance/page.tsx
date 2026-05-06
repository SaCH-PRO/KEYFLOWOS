import FinanceIntelStripSSR from "./_intel-strip-ssr";
import FinanceOverviewClient from "./_overview-client";

/**
 * FIN5 + FIN8 — Finance overview page. Server component shell that
 * renders the FIN8 insight strip server-side (so the AI headline ships
 * in the initial HTML with deterministic fallback) and delegates the
 * KPI grid + action queue to a client child that needs localStorage.
 */
export default function FinancePage() {
  return (
    <div className="space-y-4">
      <FinanceIntelStripSSR />
      <FinanceOverviewClient />
    </div>
  );
}
