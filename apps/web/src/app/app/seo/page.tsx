"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  FileText,
  DollarSign,
  Plug,
  RefreshCw,
  Plus,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getStoredBusinessId, getCachedUser } from "@/lib/workspace";

const COMING_SOON_ADMIN_EMAIL = "keyflowos.tt@gmail.com";

type TabKey = "overview" | "pages" | "keywords" | "issues" | "briefs" | "revenue" | "connectors";

interface SeoDashboard {
  score: number;
  overview: {
    totalPages: number;
    indexedPages: number;
    indexRate: number;
    totalKeywords: number;
    trackedKeywords: number;
    openIssues: number;
    criticalIssues: number;
    pendingBriefs: number;
    rankingDrops: number;
    rankingGains: number;
  };
  traffic: {
    totalClicks: number;
    totalImpressions: number;
    totalConversions: number;
    totalRevenue: number;
  };
  topPages: Array<{
    id: string; url: string; path: string; pageType: string; title?: string;
    impressions: number; clicks: number; ctr: number; avgPosition: number;
    organicSessions: number; conversions: number; revenue: number;
    indexingStatus: string;
  }>;
  topKeywords: Array<{
    id: string; keyword: string; currentPosition?: number | null;
    previousPosition?: number | null; impressions: number; clicks: number;
    ctr: number; trend: string; positionChange: number; pageId?: string | null;
  }>;
  recentIssues: Array<{
    id: string;
    severity: string;
    title: string;
    recommendation?: string;
    type?: string;
    pageUrl?: string;
    detectedAt?: string;
  }>;
}

interface SeoPage {
  id: string; url: string; path: string; pageType: string; title?: string;
  metaTitle?: string; metaDescription?: string; wordCount?: number;
  indexingStatus: string; impressions: number; clicks: number; ctr: number;
  avgPosition: number; organicSessions: number; conversions: number; revenue: number;
  keywords?: Array<{ id: string; keyword: string; currentPosition?: number | null; isPrimary: boolean }>;
}

interface SeoKeyword {
  id: string; keyword: string; currentPosition?: number | null; previousPosition?: number | null;
  positionChange: number; trend: string; impressions: number; clicks: number; ctr: number;
  isTracked: boolean; isPrimary: boolean; pageId?: string | null;
  page?: { id: string; url: string; path: string; title?: string } | null;
}

interface SeoIssue {
  id: string; issueType: string; severity: string; category: string;
  title: string; description?: string; pageUrl?: string; recommendation?: string;
  status: string; detectedAt: string;
}

interface ContentBrief {
  id: string; title: string; targetKeyword: string; secondaryKeywords: string[];
  contentType: string; status: string; priority: string; approvalStatus: string;
  searchIntent?: string; recommendedWordCount?: number;
  outline?: Array<{ heading: string; talkingPoints?: string[] }>; suggestedMetaTitle?: string; suggestedMetaDescription?: string;
  callToAction?: string; competitorAngle?: string; createdAt: string;
}

interface RevenueAttribution {
  totalOrganicSessions: number;
  totalConversions: number;
  totalRevenue: number;
  conversionRate: number;
  topRevenuePages: Array<{
    id: string; url: string; path: string; title?: string;
    organicSessions: number; conversions: number; revenue: number;
    keywords?: Array<{ keyword: string; currentPosition?: number | null }>;
  }>;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  low: "text-blue-400 bg-blue-500/10 border-blue-500/30",
};

const TREND_ICONS: Record<string, React.ElementType> = {
  improving: TrendingUp,
  declining: TrendingDown,
  stable: Minus,
};

const TREND_COLORS: Record<string, string> = {
  improving: "text-emerald-400",
  declining: "text-red-400",
  stable: "text-slate-400",
};

export default function SeoPage() {
  const router = useRouter();
  const [accessChecked, setAccessChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const user = getCachedUser();
    const email = (user?.email ?? "").trim().toLowerCase();
    if (email !== COMING_SOON_ADMIN_EMAIL) {
      toast.info("SEO is coming soon");
      router.replace("/app");
      return;
    }
    setAccessChecked(true);
  }, [router]);
  const [dashboard, setDashboard] = useState<SeoDashboard | null>(null);
  const [pages, setPages] = useState<SeoPage[]>([]);
  const [keywords, setKeywords] = useState<SeoKeyword[]>([]);
  const [issues, setIssues] = useState<SeoIssue[]>([]);
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [revenue, setRevenue] = useState<RevenueAttribution | null>(null);
  const [gscStatus, setGscStatus] = useState<{ connected: boolean; siteUrl: string | null; lastSync: string | null } | null>(null);
  const [ga4Status, setGa4Status] = useState<{ connected: boolean; propertyId: string | null; lastSync: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [showGenerateBrief, setShowGenerateBrief] = useState(false);
  const [briefKeyword, setBriefKeyword] = useState("");
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [showGscConnect, setShowGscConnect] = useState(false);
  const [showGa4Connect, setShowGa4Connect] = useState(false);
  const [gscSiteUrl, setGscSiteUrl] = useState("");
  const [gscToken, setGscToken] = useState("");
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [ga4Token, setGa4Token] = useState("");

  useEffect(() => {
    if (!accessChecked) return;
    setBusinessId(getStoredBusinessId());
  }, [accessChecked]);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [d, p, k, i, b, r, gsc, ga4] = await Promise.all([
        apiGet<SeoDashboard>(`/seo/businesses/${businessId}/dashboard`),
        apiGet<SeoPage[]>(`/seo/businesses/${businessId}/pages`),
        apiGet<SeoKeyword[]>(`/seo/businesses/${businessId}/keywords`),
        apiGet<SeoIssue[]>(`/seo/businesses/${businessId}/issues?status=open`),
        apiGet<ContentBrief[]>(`/seo/businesses/${businessId}/briefs`),
        apiGet<RevenueAttribution>(`/seo/businesses/${businessId}/revenue-attribution`),
        apiGet<{ connected: boolean; siteUrl: string | null; lastSync: string | null }>(`/seo/businesses/${businessId}/connectors/gsc`),
        apiGet<{ connected: boolean; propertyId: string | null; lastSync: string | null }>(`/seo/businesses/${businessId}/connectors/ga4`),
      ]);
      if (d.data) setDashboard(d.data);
      if (p.data) setPages(p.data);
      if (k.data) setKeywords(k.data);
      if (i.data) setIssues(i.data);
      if (b.data) setBriefs(b.data);
      if (r.data) setRevenue(r.data);
      if (gsc.data) setGscStatus(gsc.data);
      if (ga4.data) setGa4Status(ga4.data);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onSyncPages = async () => {
    if (!businessId) return;
    setSyncing(true);
    const res = await apiPost<{ synced: number }>({ path: `/seo/businesses/${businessId}/pages/sync`, body: {} });
    setSyncing(false);
    if (res.error) {
      toast.error(`Sync failed: ${res.error}`);
    } else {
      toast.success(`Synced ${res.data?.synced ?? 0} pages`);
      void refresh();
    }
  };

  const onAddKeyword = async () => {
    if (!businessId || !newKeyword.trim()) return;
    const res = await apiPost({ path: `/seo/businesses/${businessId}/keywords`, body: { keyword: newKeyword.trim(), isPrimary: false } });
    if (res.error) {
      toast.error(`Failed: ${res.error}`);
    } else {
      toast.success(`Added keyword "${newKeyword.trim()}"`);
      setNewKeyword("");
      setShowAddKeyword(false);
      void refresh();
    }
  };

  const onRemoveKeyword = async (id: string) => {
    if (!businessId) return;
    const res = await apiDelete(`/seo/businesses/${businessId}/keywords/${id}`);
    if (res.error) toast.error(`Failed: ${res.error}`);
    else { toast.success("Keyword removed"); void refresh(); }
  };

  const onResolveIssue = async (id: string) => {
    if (!businessId) return;
    const res = await apiPatch(`/seo/businesses/${businessId}/issues/${id}/resolve`, {});
    if (res.error) toast.error(`Failed: ${res.error}`);
    else { toast.success("Issue resolved"); void refresh(); }
  };

  const onDetectIssues = async () => {
    if (!businessId) return;
    const res = await apiPost<{ detected: number }>({ path: `/seo/businesses/${businessId}/issues/detect`, body: {} });
    if (res.error) toast.error(`Failed: ${res.error}`);
    else { toast.success(`Detected ${res.data?.detected ?? 0} new issues`); void refresh(); }
  };

  const onGenerateBrief = async () => {
    if (!businessId || !briefKeyword.trim()) return;
    setGeneratingBrief(true);
    const res = await apiPost({
      path: `/seo/businesses/${businessId}/briefs/generate`,
      body: { targetKeyword: briefKeyword.trim() },
    });
    setGeneratingBrief(false);
    if (res.error) toast.error(`Failed: ${res.error}`);
    else {
      toast.success(`Brief generated for "${briefKeyword.trim()}"`);
      setBriefKeyword("");
      setShowGenerateBrief(false);
      void refresh();
    }
  };

  const onConnectGsc = async () => {
    if (!businessId || !gscSiteUrl.trim()) return;
    const res = await apiPost({
      path: `/seo/businesses/${businessId}/connectors/gsc`,
      body: { siteUrl: gscSiteUrl.trim(), accessToken: gscToken.trim() || undefined },
    });
    if (res.error) toast.error(`Failed: ${res.error}`);
    else { toast.success("Search Console connected"); setShowGscConnect(false); setGscSiteUrl(""); setGscToken(""); void refresh(); }
  };

  const onConnectGa4 = async () => {
    if (!businessId || !ga4PropertyId.trim()) return;
    const res = await apiPost({
      path: `/seo/businesses/${businessId}/connectors/ga4`,
      body: { propertyId: ga4PropertyId.trim(), accessToken: ga4Token.trim() || undefined },
    });
    if (res.error) toast.error(`Failed: ${res.error}`);
    else { toast.success("Analytics connected"); setShowGa4Connect(false); setGa4PropertyId(""); setGa4Token(""); void refresh(); }
  };

  const onSyncGsc = async () => {
    if (!businessId) return;
    setSyncing(true);
    const res = await apiPost<{ synced: boolean; reason?: string }>({ path: `/seo/businesses/${businessId}/connectors/gsc/sync`, body: {} });
    setSyncing(false);
    if (res.error || !res.data?.synced) toast.error(res.data?.reason ?? res.error ?? "Sync failed");
    else { toast.success("Search Console data synced"); void refresh(); }
  };

  const onSyncGa4 = async () => {
    if (!businessId) return;
    setSyncing(true);
    const res = await apiPost<{ synced: boolean; reason?: string }>({ path: `/seo/businesses/${businessId}/connectors/ga4/sync`, body: {} });
    setSyncing(false);
    if (res.error || !res.data?.synced) toast.error(res.data?.reason ?? res.error ?? "Sync failed");
    else { toast.success("Analytics data synced"); void refresh(); }
  };

  const tabs = [
    { key: "overview", label: "Overview", icon: Search },
    { key: "pages", label: "Pages", icon: FileText, count: pages.length },
    { key: "keywords", label: "Keywords", icon: TrendingUp, count: keywords.length },
    { key: "issues", label: "Issues", icon: AlertTriangle, count: issues.length },
    { key: "briefs", label: "Briefs", icon: Sparkles, count: briefs.length },
    { key: "revenue", label: "Revenue", icon: DollarSign },
    { key: "connectors", label: "Connectors", icon: Plug },
  ];

  const subtitle = dashboard ? (
    <span className="text-sm text-slate-400">
      SEO score <span className={dashboard.score >= 70 ? "text-emerald-400" : dashboard.score >= 40 ? "text-yellow-400" : "text-red-400"}>{dashboard.score}/100</span>
      {dashboard.overview.criticalIssues > 0 && <> · <span className="text-red-400">{dashboard.overview.criticalIssues} critical</span></>}
    </span>
  ) : "Search performance, content gaps, and organic revenue";

  if (!accessChecked) {
    return null;
  }

  return (
    <WorkspaceShell
      icon={Search}
      title="SEO Operations"
      subtitle={subtitle}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(k) => setActiveTab(k as TabKey)}
      actionLabel={syncing ? "Syncing..." : "Sync Pages"}
      actionIcon={RefreshCw}
      onAction={onSyncPages}
      iconColor="text-purple-400"
    >
      {loading && !dashboard ? (
        <div className="flex items-center justify-center py-24 text-slate-400">Loading SEO data…</div>
      ) : (
        <>
          {activeTab === "overview" && <OverviewTab dashboard={dashboard} />}
          {activeTab === "pages" && <PagesTab pages={pages} />}
          {activeTab === "keywords" && (
            <KeywordsTab
              keywords={keywords}
              showAdd={showAddKeyword}
              setShowAdd={setShowAddKeyword}
              newKeyword={newKeyword}
              setNewKeyword={setNewKeyword}
              onAdd={onAddKeyword}
              onRemove={onRemoveKeyword}
            />
          )}
          {activeTab === "issues" && <IssuesTab issues={issues} onResolve={onResolveIssue} onDetect={onDetectIssues} />}
          {activeTab === "briefs" && (
            <BriefsTab
              briefs={briefs}
              show={showGenerateBrief}
              setShow={setShowGenerateBrief}
              keyword={briefKeyword}
              setKeyword={setBriefKeyword}
              onGenerate={onGenerateBrief}
              generating={generatingBrief}
            />
          )}
          {activeTab === "revenue" && <RevenueTab revenue={revenue} />}
          {activeTab === "connectors" && (
            <ConnectorsTab
              gscStatus={gscStatus}
              ga4Status={ga4Status}
              showGsc={showGscConnect}
              setShowGsc={setShowGscConnect}
              showGa4={showGa4Connect}
              setShowGa4={setShowGa4Connect}
              gscSiteUrl={gscSiteUrl}
              setGscSiteUrl={setGscSiteUrl}
              gscToken={gscToken}
              setGscToken={setGscToken}
              ga4PropertyId={ga4PropertyId}
              setGa4PropertyId={setGa4PropertyId}
              ga4Token={ga4Token}
              setGa4Token={setGa4Token}
              onConnectGsc={onConnectGsc}
              onConnectGa4={onConnectGa4}
              onSyncGsc={onSyncGsc}
              onSyncGa4={onSyncGa4}
              syncing={syncing}
            />
          )}
        </>
      )}
    </WorkspaceShell>
  );
}

function MetricCard({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color ?? "text-white"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function OverviewTab({ dashboard }: { dashboard: SeoDashboard | null }) {
  if (!dashboard) return <div className="text-slate-400">No data yet. Sync your pages to get started.</div>;
  const { overview, traffic, topPages, topKeywords, recentIssues } = dashboard;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Pages" value={overview.totalPages} hint={`${overview.indexedPages} indexed (${overview.indexRate}%)`} />
        <MetricCard label="Tracked Keywords" value={overview.trackedKeywords} hint={`${overview.totalKeywords} total`} />
        <MetricCard label="Open Issues" value={overview.openIssues} hint={`${overview.criticalIssues} critical`} color={overview.criticalIssues > 0 ? "text-red-400" : "text-white"} />
        <MetricCard label="Pending Briefs" value={overview.pendingBriefs} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Organic Clicks" value={traffic.totalClicks.toLocaleString()} />
        <MetricCard label="Impressions" value={traffic.totalImpressions.toLocaleString()} />
        <MetricCard label="Conversions" value={traffic.totalConversions.toLocaleString()} />
        <MetricCard label="Organic Revenue" value={`TT$${(traffic.totalRevenue ?? 0).toLocaleString()}`} color="text-emerald-400" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileText className="h-4 w-4" /> Top Pages</h3>
          {topPages.length === 0 ? <div className="text-sm text-slate-500">No page data yet.</div> : (
            <div className="space-y-2">
              {topPages.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="truncate flex-1">
                    <div className="truncate text-slate-200">{p.title || p.path}</div>
                    <div className="truncate text-xs text-slate-500">{p.path}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-emerald-400 font-medium">{p.clicks}</div>
                    <div className="text-xs text-slate-500">clicks</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Top Keywords</h3>
          {topKeywords.length === 0 ? <div className="text-sm text-slate-500">No keywords tracked yet.</div> : (
            <div className="space-y-2">
              {topKeywords.slice(0, 8).map(k => {
                const TrendIcon = TREND_ICONS[k.trend] ?? Minus;
                return (
                  <div key={k.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="truncate flex-1 text-slate-200">{k.keyword}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-400">#{k.currentPosition?.toFixed(0) ?? "—"}</span>
                      <TrendIcon className={`h-4 w-4 ${TREND_COLORS[k.trend]}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {recentIssues.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Recent Issues</h3>
          <div className="space-y-2">
            {recentIssues.slice(0, 5).map(issue => (
              <div key={issue.id} className="flex items-start gap-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs uppercase shrink-0 ${SEVERITY_COLORS[issue.severity ?? "low"] ?? SEVERITY_COLORS.low}`}>
                  {issue.severity}
                </span>
                <div className="flex-1 truncate">
                  <div className="text-slate-200 truncate">{issue.title}</div>
                  {issue.recommendation && <div className="text-xs text-slate-500 truncate">{issue.recommendation}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PagesTab({ pages }: { pages: SeoPage[] }) {
  if (pages.length === 0) return <div className="text-slate-400 py-12 text-center">No pages yet. Sync your pages to get started.</div>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/80 text-slate-400 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-3">Page</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-right px-4 py-3">Clicks</th>
            <th className="text-right px-4 py-3">Impr.</th>
            <th className="text-right px-4 py-3">CTR</th>
            <th className="text-right px-4 py-3">Pos.</th>
            <th className="text-right px-4 py-3">Conv.</th>
            <th className="text-right px-4 py-3">Revenue</th>
            <th className="text-left px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {pages.map(p => (
            <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-900/30">
              <td className="px-4 py-3">
                <div className="text-slate-200 truncate max-w-md">{p.title || p.path}</div>
                <div className="text-xs text-slate-500 truncate max-w-md">{p.path}</div>
              </td>
              <td className="px-4 py-3 text-slate-400 text-xs">{p.pageType}</td>
              <td className="px-4 py-3 text-right text-emerald-400">{p.clicks}</td>
              <td className="px-4 py-3 text-right text-slate-300">{p.impressions}</td>
              <td className="px-4 py-3 text-right text-slate-300">{(p.ctr * 100).toFixed(1)}%</td>
              <td className="px-4 py-3 text-right text-slate-300">{p.avgPosition?.toFixed(1) || "—"}</td>
              <td className="px-4 py-3 text-right text-slate-300">{p.conversions}</td>
              <td className="px-4 py-3 text-right text-emerald-400">TT${(p.revenue ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-1 rounded ${p.indexingStatus === "indexed" ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>
                  {p.indexingStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeywordsTab({
  keywords, showAdd, setShowAdd, newKeyword, setNewKeyword, onAdd, onRemove,
}: {
  keywords: SeoKeyword[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newKeyword: string;
  setNewKeyword: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-sm"
        >
          <Plus className="h-4 w-4" /> Track Keyword
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 flex items-center gap-2">
          <input
            type="text"
            placeholder="e.g., trinidad wedding photographer"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
          />
          <button onClick={onAdd} className="px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-sm hover:bg-purple-500/30">
            Add
          </button>
        </div>
      )}

      {keywords.length === 0 ? (
        <div className="text-slate-400 py-12 text-center">No keywords tracked yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Keyword</th>
                <th className="text-right px-4 py-3">Position</th>
                <th className="text-right px-4 py-3">Change</th>
                <th className="text-center px-4 py-3">Trend</th>
                <th className="text-right px-4 py-3">Clicks</th>
                <th className="text-right px-4 py-3">CTR</th>
                <th className="text-left px-4 py-3">Page</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {keywords.map(k => {
                const TrendIcon = TREND_ICONS[k.trend] ?? Minus;
                return (
                  <tr key={k.id} className="border-t border-slate-800 hover:bg-slate-900/30">
                    <td className="px-4 py-3 text-slate-200">{k.keyword}{k.isPrimary && <span className="ml-2 text-xs text-purple-400">primary</span>}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{k.currentPosition?.toFixed(1) || "—"}</td>
                    <td className={`px-4 py-3 text-right ${k.positionChange > 0 ? "text-emerald-400" : k.positionChange < 0 ? "text-red-400" : "text-slate-400"}`}>
                      {k.positionChange > 0 ? "+" : ""}{k.positionChange.toFixed(1) || "0"}
                    </td>
                    <td className="px-4 py-3 text-center"><TrendIcon className={`h-4 w-4 mx-auto ${TREND_COLORS[k.trend]}`} /></td>
                    <td className="px-4 py-3 text-right text-emerald-400">{k.clicks}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{(k.ctr * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-xs">{k.page?.path ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => onRemove(k.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IssuesTab({
  issues, onResolve, onDetect,
}: { issues: SeoIssue[]; onResolve: (id: string) => void; onDetect: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={onDetect}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-sm"
        >
          <RefreshCw className="h-4 w-4" /> Re-scan for Issues
        </button>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
          <div className="text-slate-200 font-medium">No open issues</div>
          <div className="text-sm text-slate-500 mt-1">Your SEO health looks clean.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map(issue => (
            <div key={issue.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs uppercase ${SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.low}`}>{issue.severity}</span>
                    <span className="text-xs text-slate-500">{issue.category}</span>
                  </div>
                  <div className="text-slate-200 font-medium">{issue.title}</div>
                  {issue.description && <div className="text-sm text-slate-400 mt-1">{issue.description}</div>}
                  {issue.recommendation && (
                    <div className="text-sm text-purple-300 mt-2 flex items-start gap-2">
                      <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{issue.recommendation}</span>
                    </div>
                  )}
                  {issue.pageUrl && <div className="text-xs text-slate-500 mt-2 truncate">{issue.pageUrl}</div>}
                </div>
                <button onClick={() => onResolve(issue.id)} className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1 rounded border border-emerald-500/30 hover:bg-emerald-500/10">
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefsTab({
  briefs, show, setShow, keyword, setKeyword, onGenerate, generating,
}: {
  briefs: ContentBrief[];
  show: boolean;
  setShow: (v: boolean) => void;
  keyword: string;
  setKeyword: (v: string) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShow(!show)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-sm"
        >
          <Sparkles className="h-4 w-4" /> Generate Brief
        </button>
      </div>

      {show && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 flex items-center gap-2">
          <input
            type="text"
            placeholder="Target keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !generating && onGenerate()}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
            disabled={generating}
          />
          <button
            onClick={onGenerate}
            disabled={generating || !keyword.trim()}
            className="px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-sm hover:bg-purple-500/30 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      )}

      {briefs.length === 0 ? (
        <div className="text-slate-400 py-12 text-center">No content briefs yet. Generate one from a target keyword.</div>
      ) : (
        <div className="space-y-3">
          {briefs.map(b => (
            <div key={b.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 font-medium">{b.title}</div>
                  <div className="text-sm text-purple-300 mt-1">Target: {b.targetKeyword}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded text-xs uppercase ${b.priority === "high" ? "bg-red-500/10 text-red-400" : b.priority === "medium" ? "bg-yellow-500/10 text-yellow-400" : "bg-slate-700/30 text-slate-400"}`}>
                    {b.priority}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs uppercase ${b.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/30 text-slate-400"}`}>
                    {b.status}
                  </span>
                </div>
              </div>
              {b.suggestedMetaTitle && (
                <div className="text-xs text-slate-500 mt-1"><span className="text-slate-400">Meta title:</span> {b.suggestedMetaTitle}</div>
              )}
              {b.suggestedMetaDescription && (
                <div className="text-xs text-slate-500 mt-1"><span className="text-slate-400">Meta desc:</span> {b.suggestedMetaDescription}</div>
              )}
              {b.recommendedWordCount && (
                <div className="text-xs text-slate-500 mt-1">Recommended: {b.recommendedWordCount} words · {b.searchIntent} intent</div>
              )}
              {Array.isArray(b.outline) && b.outline.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-slate-300 hover:text-white">View outline ({b.outline.length} sections)</summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {b.outline.map((s, i) => (
                      <li key={i} className="text-slate-400">
                        <span className="text-slate-300">{s.heading}</span>
                        {Array.isArray(s.talkingPoints) && s.talkingPoints.length > 0 && (
                          <ul className="ml-4 mt-1 list-disc text-xs text-slate-500">
                            {s.talkingPoints.map((p: string, j: number) => <li key={j}>{p}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RevenueTab({ revenue }: { revenue: RevenueAttribution | null }) {
  if (!revenue) return <div className="text-slate-400">No revenue data yet.</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Organic Sessions" value={revenue.totalOrganicSessions.toLocaleString()} />
        <MetricCard label="Conversions" value={revenue.totalConversions.toLocaleString()} />
        <MetricCard label="Conversion Rate" value={`${revenue.conversionRate}%`} />
        <MetricCard label="Total Revenue" value={`TT$${revenue.totalRevenue.toLocaleString()}`} color="text-emerald-400" />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-400" /> Top Revenue Pages</h3>
        {revenue.topRevenuePages.length === 0 ? (
          <div className="text-slate-500 text-sm">No converting pages yet. Connect GA4 and import data.</div>
        ) : (
          <div className="space-y-2">
            {revenue.topRevenuePages.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{p.title || p.path}</div>
                  <div className="text-xs text-slate-500 truncate">{p.path}</div>
                  {p.keywords && p.keywords.length > 0 && (
                    <div className="text-xs text-purple-400 mt-1 truncate">{p.keywords.map(k => k.keyword).join(" · ")}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm text-emerald-400 font-medium">TT${p.revenue.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">{p.conversions} conv · {p.organicSessions} sessions</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConnectorsTabProps {
  gscStatus: { connected?: boolean; siteUrl?: string | null; lastSync?: string | null } | null;
  ga4Status: { connected?: boolean; propertyId?: string | null; lastSync?: string | null } | null;
  showGsc: boolean;
  setShowGsc: (v: boolean) => void;
  showGa4: boolean;
  setShowGa4: (v: boolean) => void;
  gscSiteUrl: string;
  setGscSiteUrl: (v: string) => void;
  gscToken: string;
  setGscToken: (v: string) => void;
  ga4PropertyId: string;
  setGa4PropertyId: (v: string) => void;
  ga4Token: string;
  setGa4Token: (v: string) => void;
  onConnectGsc: () => void;
  onConnectGa4: () => void;
  onSyncGsc: () => void;
  onSyncGa4: () => void;
  syncing: boolean;
}

function ConnectorsTab({
  gscStatus, ga4Status, showGsc, setShowGsc, showGa4, setShowGa4,
  gscSiteUrl, setGscSiteUrl, gscToken, setGscToken,
  ga4PropertyId, setGa4PropertyId, ga4Token, setGa4Token,
  onConnectGsc, onConnectGa4, onSyncGsc, onSyncGa4, syncing,
}: ConnectorsTabProps) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-blue-400" />
            <h3 className="text-base font-semibold text-slate-100">Google Search Console</h3>
          </div>
          {gscStatus?.connected && <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Connected</span>}
        </div>
        <p className="text-sm text-slate-400 mb-4">Pull search queries, impressions, clicks, and ranking positions from Google Search Console.</p>

        {gscStatus?.connected ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Site: <span className="text-slate-300">{gscStatus.siteUrl}</span></div>
            {gscStatus.lastSync && <div className="text-xs text-slate-500">Last sync: {new Date(gscStatus.lastSync).toLocaleString()}</div>}
            <button
              onClick={onSyncGsc}
              disabled={syncing}
              className="w-full mt-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" /> {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {!showGsc ? (
              <button onClick={() => setShowGsc(true)} className="w-full px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 text-sm">
                Connect Search Console
              </button>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Site URL (e.g. https://example.com)"
                  value={gscSiteUrl}
                  onChange={(e) => setGscSiteUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
                />
                <input
                  type="password"
                  placeholder="OAuth access token (optional)"
                  value={gscToken}
                  onChange={(e) => setGscToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
                />
                <div className="flex gap-2">
                  <button onClick={onConnectGsc} className="flex-1 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 text-sm">Save</button>
                  <button onClick={() => setShowGsc(false)} className="px-3 py-2 rounded-lg border border-slate-700 text-slate-400 text-sm">Cancel</button>
                </div>
                <div className="text-xs text-slate-500">Manual token connection for now. OAuth flow comes in Phase 10.</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChartIcon /> <h3 className="text-base font-semibold text-slate-100">Google Analytics 4</h3>
          </div>
          {ga4Status?.connected && <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Connected</span>}
        </div>
        <p className="text-sm text-slate-400 mb-4">Pull organic traffic, sessions, conversions, and revenue per page from GA4.</p>

        {ga4Status?.connected ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Property ID: <span className="text-slate-300">{ga4Status.propertyId}</span></div>
            {ga4Status.lastSync && <div className="text-xs text-slate-500">Last sync: {new Date(ga4Status.lastSync).toLocaleString()}</div>}
            <button
              onClick={onSyncGa4}
              disabled={syncing}
              className="w-full mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" /> {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {!showGa4 ? (
              <button onClick={() => setShowGa4(true)} className="w-full px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-sm">
                Connect Analytics
              </button>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="GA4 Property ID (numeric)"
                  value={ga4PropertyId}
                  onChange={(e) => setGa4PropertyId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
                />
                <input
                  type="password"
                  placeholder="OAuth access token (optional)"
                  value={ga4Token}
                  onChange={(e) => setGa4Token(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200"
                />
                <div className="flex gap-2">
                  <button onClick={onConnectGa4} className="flex-1 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm">Save</button>
                  <button onClick={() => setShowGa4(false)} className="px-3 py-2 rounded-lg border border-slate-700 text-slate-400 text-sm">Cancel</button>
                </div>
                <div className="text-xs text-slate-500">Manual token connection for now. OAuth flow comes in Phase 10.</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BarChartIcon() {
  return <DollarSign className="h-5 w-5 text-amber-400" />;
}
