"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  BarChart3,
  Eye,
  TrendingUp,
  TrendingDown,
  Users,
  Star,
  Briefcase,
  Package,
  Send,
  Inbox,
  Link2,
  Award,
  Activity,
} from "lucide-react";
import {
  getNetworkAnalyticsDashboard,
  listRecentProfileViewers,
  type AnalyticsDashboard,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

export default function NetworkAnalyticsPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [recentViewers, setRecentViewers] = useState<Array<{ id: string; createdAt: string; source?: string | null; viewer: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null } }>>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [d, rv] = await Promise.all([
      getNetworkAnalyticsDashboard(businessId, days),
      listRecentProfileViewers(businessId, 10),
    ]);
    setData(d.data ?? null);
    setRecentViewers(rv.data ?? []);
    setLoading(false);
  }, [businessId, days]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void load(); }, [load]);

  const maxTrend = Math.max(1, ...(data?.profileViews.trend.map((t) => t.views) ?? [0]));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <button onClick={() => router.push("/app/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />Back to Community
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10"><BarChart3 className="w-5 h-5 text-[hsl(var(--kf-accent1))]" /></div>
          <div>
            <h1 className="text-xl font-bold">Network Analytics</h1>
            <p className="text-xs text-muted-foreground">How your business is performing in the community</p>
          </div>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {loading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <div key={i} className="h-24 bg-muted/20 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={Eye} label="Profile Views" value={data.profileViews.window} sub={`${data.profileViews.uniqueViewers} unique`} delta={data.profileViews.deltaPct} />
            <Stat icon={Users} label="Followers" value={data.network.followers} sub={`${data.network.following} following`} />
            <Stat icon={Star} label="Reputation" value={data.reputation?.score ?? 0} sub={data.reputation?.percentile != null ? `Top ${(100 - data.reputation.percentile).toFixed(0)}%` : "—"} />
            <Stat icon={Award} label="Reviews" value={data.reviews.receivedInWindow} sub={`avg ${data.reputation?.averageRating ?? 0}/5`} />
            <Stat icon={Send} label="Quotes Sent" value={data.quoteRequests.sent} sub={`${data.quoteRequests.received} received`} />
            <Stat icon={Inbox} label="Referrals" value={data.referrals.received} sub={`${data.referrals.sent} sent`} />
            <Stat icon={Link2} label="Active Partners" value={data.partnerships.active} />
            <Stat icon={Briefcase} label="Opportunities" value={data.opportunities.posted} sub={`${data.opportunities.applicationsSent} applied`} />
          </div>

          <div className="kf-card rounded-xl p-5 border border-border/30">
            <h3 className="text-sm font-semibold mb-3">Profile Views Trend</h3>
            <div className="flex items-end gap-1 h-32">
              {data.profileViews.trend.map((t) => (
                <div key={t.date} className="flex-1 flex flex-col items-center gap-1" title={`${t.date}: ${t.views} views`}>
                  <div className="w-full bg-[hsl(var(--kf-accent1))]/30 rounded-t" style={{ height: `${(t.views / maxTrend) * 100}%`, minHeight: t.views > 0 ? "4px" : "1px" }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
              <span>{data.profileViews.trend[0]?.date}</span>
              <span>{data.profileViews.trend[data.profileViews.trend.length - 1]?.date}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="kf-card rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-semibold mb-3">Top Viewers</h3>
              {data.profileViews.topViewers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No identified viewers yet</p>
              ) : (
                <div className="space-y-2">
                  {data.profileViews.topViewers.map((tv) => tv.business && (
                    <div key={tv.business.id} className="flex items-center justify-between cursor-pointer hover:bg-white/[0.03] rounded-lg p-2" onClick={() => router.push(`/app/community/profile/${tv.business!.id}`)}>
                      <div>
                        <p className="text-sm font-medium">{tv.business.name}</p>
                        <p className="text-[11px] text-muted-foreground">{tv.business.headline}</p>
                      </div>
                      <span className="text-xs font-semibold">{tv.viewCount} views</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="kf-card rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-semibold mb-3">Recent Viewers</h3>
              {recentViewers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent viewers</p>
              ) : (
                <div className="space-y-2">
                  {recentViewers.map((v) => (
                    <div key={v.id} className="flex items-center justify-between cursor-pointer hover:bg-white/[0.03] rounded-lg p-2" onClick={() => v.viewer && router.push(`/app/community/profile/${v.viewer.id}`)}>
                      <div>
                        <p className="text-sm font-medium">{v.viewer?.name}</p>
                        <p className="text-[11px] text-muted-foreground">{v.viewer?.headline}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={Package} label="Resources Sold" value={data.resources.downloadsReceived} sub={`${data.resources.downloadsMade} purchased`} />
            <Stat icon={Activity} label="Activity Events" value={data.activity.eventsInWindow} />
            <Stat icon={Star} label="Total Completed" value={data.reputation?.totalCompleted ?? 0} />
            <Stat icon={Award} label="Network Rank" value={data.reputation?.rank ?? "—"} sub={data.reputation?.totalRanked ? `of ${data.reputation.totalRanked}` : ""} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, delta }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string; value: number | string; sub?: string; delta?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kf-card rounded-xl p-4 border border-border/30">
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        {typeof delta === "number" && delta !== 0 && (
          <span className={`text-[10px] flex items-center gap-0.5 ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/60 mt-1">{sub}</p>}
    </motion.div>
  );
}

