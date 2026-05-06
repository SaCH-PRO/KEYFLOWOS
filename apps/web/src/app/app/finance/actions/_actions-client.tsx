"use client";

import { useEffect, useState } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchFinanceOverview, type FinanceOverview } from "@/lib/client";
import { SkeletonGrid } from "../_overview-client";
import { FinanceIntelPanel } from "../_intel-panel";

/**
 * FIN8 — Client body for the actions page. The SSR insight strip is
 * rendered by the parent server component; this child handles the
 * full action list once businessId is resolved from localStorage.
 */
export default function FinanceActionsClient() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <SkeletonGrid />;
  return <ActionsBody businessId={businessId} />;
}

function ActionsBody({ businessId }: { businessId: string }) {
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  useEffect(() => {
    fetchFinanceOverview(businessId).then((r) => { if (r.data) setOverview(r.data); });
  }, [businessId]);
  const currency = overview?.currency ?? "TTD";
  return <FinanceIntelPanel businessId={businessId} currency={currency} compact={false} />;
}
