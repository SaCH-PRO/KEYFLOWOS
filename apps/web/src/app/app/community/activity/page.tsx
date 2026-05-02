"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Activity,
  Briefcase,
  Link2,
  Package,
  Users,
  Star,
  Award,
  Trophy,
  CheckCircle2,
} from "lucide-react";
import {
  listNetworkActivity,
  listFollowingActivity,
  type NetworkActivityItem,
  type NetworkActivityType,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const TYPE_ICONS: Record<NetworkActivityType, React.ElementType> = {
  OPPORTUNITY_POSTED: Briefcase,
  OPPORTUNITY_AWARDED: CheckCircle2,
  PARTNERSHIP_FORMED: Link2,
  PARTNERSHIP_TERMINATED: Link2,
  RESOURCE_PUBLISHED: Package,
  COHORT_JOINED: Users,
  REVIEW_RECEIVED: Star,
  COLLAB_COMPLETED: CheckCircle2,
  CERTIFICATION_EARNED: Award,
  MILESTONE_REACHED: Trophy,
};

export default function ActivityFeedPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<"network" | "following">("network");
  const [items, setItems] = useState<NetworkActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    if (tab === "network") {
      const r = await listNetworkActivity({ limit: 50 });
      setItems(r.data?.data ?? []);
    } else if (tab === "following" && businessId) {
      const r = await listFollowingActivity(businessId, { limit: 50 });
      setItems(r.data?.data ?? []);
    }
    setLoading(false);
  }, [tab, businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => router.push("/app/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />Back to Community
      </button>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10"><Activity className="w-5 h-5 text-[hsl(var(--kf-accent1))]" /></div>
        <div>
          <h1 className="text-xl font-bold">Network Activity</h1>
          <p className="text-xs text-muted-foreground">Real-time updates from across the community</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border/30">
        <button onClick={() => setTab("network")} className={`px-4 py-2 text-xs font-medium ${tab === "network" ? "border-b-2 border-[hsl(var(--kf-accent1))] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          All Network
        </button>
        <button onClick={() => setTab("following")} className={`px-4 py-2 text-xs font-medium ${tab === "following" ? "border-b-2 border-[hsl(var(--kf-accent1))] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Following
        </button>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-muted/20 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {tab === "following" ? "Follow businesses to see their activity here" : "No recent activity"}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const Icon = TYPE_ICONS[it.type] ?? Activity;
            return (
              <motion.div
                key={it.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => it.actor?.id && router.push(`/app/community/profile/${it.actor.id}`)}
                className="kf-card rounded-xl p-3 border border-border/30 flex items-start gap-3 cursor-pointer hover:bg-white/[0.03]"
              >
                <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex-shrink-0">
                  <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{it.actor?.name ?? "A business"}</span>{" "}
                    <span className="text-muted-foreground">{it.title}</span>
                  </p>
                  {it.body && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{it.body}</p>}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{new Date(it.createdAt).toLocaleString()}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
