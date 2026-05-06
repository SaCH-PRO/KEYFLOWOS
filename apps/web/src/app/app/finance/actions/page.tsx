import FinanceIntelStripSSR from "../_intel-strip-ssr";
import FinanceActionsClient from "./_actions-client";

/**
 * FIN8 — Finance action queue page. Server component shell that
 * renders the SSR insight strip + delegates the action list to a
 * client child.
 */
export default function FinanceActionsPage() {
  return (
    <div className="space-y-4">
      <FinanceIntelStripSSR />
      <FinanceActionsClient />
    </div>
  );
}
