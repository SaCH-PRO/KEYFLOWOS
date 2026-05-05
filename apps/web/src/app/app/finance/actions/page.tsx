"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchFinanceOverview, type FinanceOverview } from "@/lib/client";
import { ActionList, SkeletonGrid } from "../page";

export default function FinanceActionsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <SkeletonGrid />;
  return <ActionsBody businessId={businessId} />;
}

function ActionsBody({ businessId }: { businessId: string }) {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const o = await fetchFinanceOverview(businessId);
    if (o.data) setData(o.data);
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonGrid />;
  if (!data || data.actions.length === 0) {
    return <EmptyState icon={Zap} title="Inbox zero" description="No pending finance actions. Check back later." variant="compact" />;
  }
  return <ActionList items={data.actions} currency={data.currency} />;
}
