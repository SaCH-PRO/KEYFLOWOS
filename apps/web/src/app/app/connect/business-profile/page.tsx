"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Loader2,
  RefreshCw,
  Star,
  MessageCircle,
  Send,
  ExternalLink,
  Megaphone,
  CheckCircle2,
  Sparkles,
  Clock,
  BarChart3,
  CalendarClock,
  XCircle,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface BpAccount {
  name: string;
  accountName?: string;
  type?: string;
}

interface BpLocation {
  name: string;
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
  };
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string };
}

interface BpReview {
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  name?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

interface BpPost {
  name?: string;
  summary?: string;
  state?: string;
  createTime?: string;
  searchUrl?: string;
}

interface ScheduledPost {
  id: string;
  location: string;
  summary: string;
  callToAction?: { actionType: string; url: string };
  scheduledFor: string;
  status: "scheduled" | "published" | "failed" | "cancelled";
  createdAt: string;
  publishedAt?: string;
  error?: string;
}

interface InsightsResponse {
  locationName: string;
  rangeDays: number;
  metrics: Array<{
    metric: string;
    total: number;
    daily: Array<{ date: string; value: number }>;
  }>;
  generatedAt: string;
}

const METRIC_LABELS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Desktop · Maps views",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Desktop · Search views",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Mobile · Maps views",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Mobile · Search views",
  BUSINESS_DIRECTION_REQUESTS: "Direction requests",
  CALL_CLICKS: "Call clicks",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_CONVERSATIONS: "Messages",
};

const STAR_TO_NUM: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function formatAddress(loc: BpLocation): string {
  const a = loc.storefrontAddress;
  if (!a) return "";
  return [
    ...(a.addressLines ?? []),
    [a.locality, a.administrativeArea].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatDate(s?: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-TT", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

export default function ConnectBusinessProfilePage() {
  const businessId = getStoredBusinessId();
  const [accounts, setAccounts] = useState<BpAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [locations, setLocations] = useState<BpLocation[]>([]);
  const [activeLocation, setActiveLocation] = useState<string>("");
  const [reviews, setReviews] = useState<BpReview[]>([]);
  const [posts, setPosts] = useState<BpPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  const [postSummary, setPostSummary] = useState("");
  const [postCtaUrl, setPostCtaUrl] = useState("");
  const [postCtaType, setPostCtaType] = useState("LEARN_MORE");
  const [postScheduleAt, setPostScheduleAt] = useState("");
  const [posting, setPosting] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  const [aiBusyFor, setAiBusyFor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"reviews" | "posts" | "insights">("reviews");
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const loadAccountsAndLocations = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      setError("No active business — pick a workspace first.");
      return;
    }
    setError(null);
    setLoading(true);
    const accRes = await apiGet<{ accounts?: BpAccount[] }>(
      `/connect/businesses/${businessId}/business-profile/accounts`,
    );
    if (accRes.error) {
      setError(accRes.error);
      setLoading(false);
      return;
    }
    const accs = accRes.data?.accounts ?? [];
    setAccounts(accs);
    const accountForLoad =
      selectedAccountId ||
      accs[0]?.name?.replace(/^accounts\//, "") ||
      "";
    if (!selectedAccountId && accountForLoad) {
      setSelectedAccountId(accountForLoad);
    }

    const locUrl = accountForLoad
      ? `/connect/businesses/${businessId}/business-profile/locations?accountId=${encodeURIComponent(accountForLoad)}`
      : `/connect/businesses/${businessId}/business-profile/locations`;
    const locRes = await apiGet<{ locations?: BpLocation[] }>(locUrl);
    if (locRes.error) {
      setError(locRes.error);
    } else {
      const list = locRes.data?.locations ?? [];
      setLocations(list);
      if (list.length > 0 && !activeLocation) {
        setActiveLocation(list[0].name);
      }
    }
    setLoading(false);
  }, [businessId, activeLocation, selectedAccountId]);

  useEffect(() => {
    loadAccountsAndLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, selectedAccountId]);

  const loadDetails = useCallback(async () => {
    if (!businessId || !activeLocation) return;
    setRefreshing(true);
    const [revRes, postsRes] = await Promise.all([
      apiGet<{ reviews?: BpReview[] }>(
        `/connect/businesses/${businessId}/business-profile/reviews?location=${encodeURIComponent(activeLocation)}`,
      ),
      apiGet<{ localPosts?: BpPost[] }>(
        `/connect/businesses/${businessId}/business-profile/posts?location=${encodeURIComponent(activeLocation)}`,
      ),
    ]);
    if (!revRes.error && revRes.data) setReviews(revRes.data.reviews ?? []);
    if (!postsRes.error && postsRes.data) setPosts(postsRes.data.localPosts ?? []);
    setRefreshing(false);
  }, [businessId, activeLocation]);

  useEffect(() => {
    if (activeLocation) loadDetails();
  }, [activeLocation, loadDetails]);

  const activeLocationObject = useMemo(
    () => locations.find((l) => l.name === activeLocation),
    [locations, activeLocation],
  );

  const handleSetActive = async (loc: BpLocation) => {
    if (!businessId) return;
    const accountId =
      selectedAccountId ||
      accounts[0]?.name?.replace(/^accounts\//, "") ||
      "";
    if (!accountId) {
      toast.error("No Business Profile account found");
      return;
    }
    setActiveLocation(loc.name);
    const locationId = loc.name.replace(/^locations\//, "");
    await apiPostSimple(
      `/connect/businesses/${businessId}/business-profile/active-location`,
      { accountId, locationId },
    );
    toast.success(`Active location set: ${loc.title ?? loc.name}`);
  };

  const handleSubmitReply = async (review: BpReview) => {
    if (!businessId) return;
    const reviewName = review.name ?? review.reviewId;
    if (!reviewName || !replyText.trim()) return;
    setReplyBusy(true);
    const res = await apiPostSimple(
      `/connect/businesses/${businessId}/business-profile/reviews/reply`,
      { reviewName, comment: replyText.trim() },
    );
    setReplyBusy(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Reply published");
      setReplyOpen(null);
      setReplyText("");
      await loadDetails();
    }
  };

  const handlePublishPost = async () => {
    if (!businessId || !activeLocation || !postSummary.trim()) return;
    const cta = postCtaUrl.trim()
      ? { actionType: postCtaType, url: postCtaUrl.trim() }
      : undefined;

    setPosting(true);
    const willSchedule = !!postScheduleAt.trim();
    const path = willSchedule
      ? `/connect/businesses/${businessId}/business-profile/scheduled-posts`
      : `/connect/businesses/${businessId}/business-profile/posts`;
    const body: Record<string, unknown> = {
      location: activeLocation,
      summary: postSummary.trim(),
      ...(cta ? { callToAction: cta } : {}),
    };
    if (willSchedule) body.scheduledFor = new Date(postScheduleAt).toISOString();

    const res = await apiPostSimple(path, body);
    setPosting(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(willSchedule ? "Post scheduled" : "Post published");
      setPostSummary("");
      setPostCtaUrl("");
      setPostScheduleAt("");
      setShowComposer(false);
      await loadDetails();
      await loadScheduled();
    }
  };

  const loadScheduled = useCallback(async () => {
    if (!businessId) return;
    setScheduledLoading(true);
    const res = await apiGet<ScheduledPost[]>(
      `/connect/businesses/${businessId}/business-profile/scheduled-posts`,
    );
    setScheduledLoading(false);
    if (!res.error && res.data) setScheduled(res.data);
  }, [businessId]);

  useEffect(() => {
    if (activeTab === "posts") loadScheduled();
  }, [activeTab, loadScheduled]);

  const handleCancelScheduled = async (id: string) => {
    if (!businessId) return;
    const res = await apiDelete(
      `/connect/businesses/${businessId}/business-profile/scheduled-posts/${id}`,
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Scheduled post cancelled");
      await loadScheduled();
    }
  };

  const loadInsights = useCallback(
    async (days = 30) => {
      if (!businessId || !activeLocation) return;
      setInsightsLoading(true);
      setInsightsError(null);
      const res = await apiGet<InsightsResponse>(
        `/connect/businesses/${businessId}/business-profile/insights?location=${encodeURIComponent(activeLocation)}&days=${days}`,
      );
      setInsightsLoading(false);
      if (res.error) setInsightsError(res.error);
      else if (res.data) setInsights(res.data);
    },
    [businessId, activeLocation],
  );

  useEffect(() => {
    if (activeTab === "insights") loadInsights(30);
  }, [activeTab, loadInsights]);

  const handleAiSuggestReply = async (review: BpReview) => {
    if (!businessId) return;
    const reviewName = review.name ?? review.reviewId;
    if (!reviewName) return;
    setAiBusyFor(reviewName);
    const stars = STAR_TO_NUM[review.starRating ?? ""] ?? 0;
    const prompt = `Draft a warm, professional public reply (max 2 short paragraphs) to this Google Business review.
Reviewer: ${review.reviewer?.displayName ?? "a customer"}
Rating: ${stars}/5
Review: """${review.comment ?? "(no text)"}"""

Address them by first name if known. Thank them for their feedback. If the rating is 4 or higher, reinforce what they liked. If it is 3 or lower, acknowledge the concern, apologize, and invite them to reach out privately. Do not include placeholders. Reply only with the message body.`;
    try {
      const res = await apiPostSimple<{ reply?: string; message?: string; text?: string }>(
        `/ai/businesses/${businessId}/ai/chat`,
        { message: prompt },
      );
      const text =
        res.data?.reply ?? res.data?.message ?? res.data?.text ?? "";
      if (text) {
        setReplyOpen(reviewName);
        setReplyText(text.trim());
        toast.success("AI reply drafted — review and edit before publishing");
      } else {
        toast.error(res.error ?? "AI did not return a reply");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusyFor(null);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <Link
        href="/app/connect"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to KeyFlow Connect
      </Link>
      <PageHeader
        icon={Building2}
        title="Google Business Profile"
        subtitle="Manage your locations, respond to reviews, and publish posts to your storefront."
        rightSlot={
          <div className="flex items-center gap-2">
            <a
              href="https://business.google.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 px-2 py-1 rounded-lg"
            >
              <ExternalLink className="h-3 w-3" />
              Open Business Profile
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                loadAccountsAndLocations();
                if (activeLocation) loadDetails();
              }}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-72 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
      ) : locations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No locations yet"
          description="Connect Google Business Profile and verify a location to manage it here."
          actionLabel="Open KeyFlow Connect"
          onAction={() => (window.location.href = "/app/connect")}
        />
      ) : (
        <>
          {/* Locations */}
          <section>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Locations
              </h3>
              {accounts.length > 1 && (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Account</span>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => {
                      setSelectedAccountId(e.target.value);
                      setActiveLocation("");
                    }}
                    className="kf-input text-[11px] py-1 px-2"
                  >
                    {accounts.map((a) => {
                      const id = a.name.replace(/^accounts\//, "");
                      return (
                        <option key={a.name} value={id}>
                          {a.accountName ?? a.name}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {locations.map((loc) => {
                const isActive = activeLocation === loc.name;
                return (
                  <button
                    key={loc.name}
                    onClick={() => handleSetActive(loc)}
                    className={`text-left rounded-2xl border p-4 transition-all ${
                      isActive
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-border/40 bg-card/40 hover:border-border/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-semibold truncate">
                            {loc.title ?? "Untitled"}
                          </h4>
                          {isActive && (
                            <Badge tone="success" className="text-[9px]">
                              Active
                            </Badge>
                          )}
                        </div>
                        {formatAddress(loc) && (
                          <p className="text-[11px] text-muted-foreground">
                            {formatAddress(loc)}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                          {loc.phoneNumbers?.primaryPhone && (
                            <span>{loc.phoneNumbers.primaryPhone}</span>
                          )}
                          {loc.websiteUri && (
                            <a
                              href={loc.websiteUri}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Website
                            </a>
                          )}
                        </div>
                      </div>
                      {isActive && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {activeLocationObject && (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-border/40">
                {([
                  { id: "reviews", label: "Reviews", icon: MessageCircle },
                  { id: "posts", label: "Posts", icon: Megaphone },
                  { id: "insights", label: "Insights", icon: BarChart3 },
                ] as const).map((t) => {
                  const Icon = t.icon;
                  const active = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors ${
                        active
                          ? "border-emerald-400 text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === "posts" && (
              <>
              {/* Posts composer */}
              <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-semibold">Local posts</h3>
                  </div>
                  <Button
                    size="sm"
                    variant={showComposer ? "ghost" : "default"}
                    onClick={() => setShowComposer((v) => !v)}
                  >
                    {showComposer ? "Cancel" : "New post"}
                  </Button>
                </div>
                {showComposer && (
                  <div className="space-y-3 mb-4">
                    <textarea
                      value={postSummary}
                      onChange={(e) => setPostSummary(e.target.value)}
                      placeholder="What's new for your customers?"
                      rows={3}
                      maxLength={1500}
                      className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        value={postCtaType}
                        onChange={(e) => setPostCtaType(e.target.value)}
                        className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
                      >
                        <option value="LEARN_MORE">Learn more</option>
                        <option value="BOOK">Book</option>
                        <option value="ORDER">Order online</option>
                        <option value="SHOP">Shop</option>
                        <option value="SIGN_UP">Sign up</option>
                        <option value="CALL">Call</option>
                      </select>
                      <input
                        value={postCtaUrl}
                        onChange={(e) => setPostCtaUrl(e.target.value)}
                        placeholder="https://… (optional CTA URL)"
                        className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-3 justify-between">
                      <label className="flex flex-col text-[11px] uppercase tracking-wider text-muted-foreground">
                        <span className="inline-flex items-center gap-1 mb-1">
                          <CalendarClock className="h-3 w-3" />
                          Schedule for later (optional)
                        </span>
                        <input
                          type="datetime-local"
                          value={postScheduleAt}
                          onChange={(e) => setPostScheduleAt(e.target.value)}
                          className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm normal-case tracking-normal text-foreground"
                        />
                      </label>
                      <Button
                        size="sm"
                        onClick={handlePublishPost}
                        disabled={!postSummary.trim() || posting}
                      >
                        {posting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : postScheduleAt ? (
                          <Clock className="h-3 w-3 mr-1" />
                        ) : (
                          <Send className="h-3 w-3 mr-1" />
                        )}
                        {postScheduleAt ? "Schedule" : "Publish"}
                      </Button>
                    </div>
                  </div>
                )}
                {posts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No posts yet.</p>
                ) : (
                  <div className="space-y-2">
                    {posts.slice(0, 5).map((p, i) => (
                      <div
                        key={p.name ?? `${i}`}
                        className="rounded-xl border border-border/30 bg-muted/10 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground">
                            {formatDate(p.createTime)}
                          </span>
                          {p.state && (
                            <span className="text-[10px] text-muted-foreground/80 px-1.5 py-0.5 rounded-full border border-border/40">
                              {p.state}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-3">{p.summary}</p>
                        {p.searchUrl && (
                          <a
                            href={p.searchUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View on Search
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Scheduled posts queue */}
              <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-blue-400" />
                    <h3 className="text-sm font-semibold">Scheduled & history</h3>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={loadScheduled}
                    disabled={scheduledLoading}
                  >
                    {scheduledLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                </div>
                {scheduled.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No scheduled posts yet.</p>
                ) : (
                  <div className="space-y-2">
                    {scheduled.map((sp) => {
                      const tone =
                        sp.status === "published"
                          ? "success"
                          : sp.status === "failed"
                            ? "danger"
                            : sp.status === "cancelled"
                              ? "default"
                              : "info";
                      return (
                        <div
                          key={sp.id}
                          className="rounded-xl border border-border/30 bg-muted/10 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="inline-flex items-center gap-2 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {new Date(sp.scheduledFor).toLocaleString()}
                              <Badge tone={tone} className="text-[9px] uppercase">
                                {sp.status}
                              </Badge>
                            </div>
                            {sp.status === "scheduled" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCancelScheduled(sp.id)}
                                className="h-6 px-2 text-[11px] text-red-400 hover:text-red-300"
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                Cancel
                              </Button>
                            )}
                          </div>
                          <p className="line-clamp-2">{sp.summary}</p>
                          {sp.error && (
                            <p className="text-red-400 mt-1">{sp.error}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              </>
              )}

              {activeTab === "reviews" && (
              <>
              {/* Reviews */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Recent reviews
                </h3>
                {reviews.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border/40 rounded-xl">
                    No reviews to show.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((r) => {
                      const stars = STAR_TO_NUM[r.starRating ?? ""] ?? 0;
                      const reviewName = r.name ?? r.reviewId;
                      const isReplying = replyOpen === reviewName;
                      return (
                        <div
                          key={reviewName}
                          className="rounded-2xl border border-border/40 bg-card/40 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-sm font-medium">
                                  {r.reviewer?.displayName ?? "Anonymous"}
                                </span>
                                <span className="inline-flex">
                                  {[1, 2, 3, 4, 5].map((i) => (
                                    <Star
                                      key={i}
                                      className={`h-3 w-3 ${
                                        i <= stars
                                          ? "text-amber-400 fill-amber-400"
                                          : "text-muted-foreground/30"
                                      }`}
                                    />
                                  ))}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDate(r.updateTime ?? r.createTime)}
                                </span>
                              </div>
                              {r.comment && (
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                  {r.comment}
                                </p>
                              )}
                              {r.reviewReply?.comment && (
                                <div className="mt-3 ml-3 pl-3 border-l-2 border-emerald-500/40">
                                  <div className="text-[11px] text-emerald-400 font-medium mb-0.5">
                                    Owner reply ·{" "}
                                    {formatDate(r.reviewReply.updateTime)}
                                  </div>
                                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                    {r.reviewReply.comment}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setReplyOpen(isReplying ? null : reviewName ?? null);
                                  setReplyText(r.reviewReply?.comment ?? "");
                                }}
                                className="h-7 px-2 text-xs"
                              >
                                <MessageCircle className="h-3 w-3 mr-1" />
                                {r.reviewReply ? "Edit reply" : "Reply"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAiSuggestReply(r)}
                                disabled={aiBusyFor === reviewName}
                                className="h-7 px-2 text-xs text-fuchsia-300 hover:text-fuchsia-200"
                                title="Draft a reply with AI"
                              >
                                {aiBusyFor === reviewName ? (
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                ) : (
                                  <Sparkles className="h-3 w-3 mr-1" />
                                )}
                                Suggest
                              </Button>
                            </div>
                          </div>
                          {isReplying && (
                            <div className="mt-3 space-y-2">
                              <textarea
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Write a thoughtful reply…"
                                rows={3}
                                className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
                              />
                              <div className="flex justify-between gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleAiSuggestReply(r)}
                                  disabled={aiBusyFor === reviewName}
                                  className="text-fuchsia-300 hover:text-fuchsia-200"
                                >
                                  {aiBusyFor === reviewName ? (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  ) : (
                                    <Sparkles className="h-3 w-3 mr-1" />
                                  )}
                                  AI rewrite
                                </Button>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setReplyOpen(null);
                                      setReplyText("");
                                    }}
                                    disabled={replyBusy}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleSubmitReply(r)}
                                    disabled={!replyText.trim() || replyBusy}
                                  >
                                    {replyBusy ? (
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    ) : (
                                      <Send className="h-3 w-3 mr-1" />
                                    )}
                                    Publish reply
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              </>
              )}

              {activeTab === "insights" && (
              <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold">Performance — last 30 days</h3>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => loadInsights(30)}
                    disabled={insightsLoading}
                  >
                    {insightsLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                </div>
                {insightsError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 mb-3">
                    {insightsError}
                  </div>
                )}
                {insightsLoading && !insights ? (
                  <div className="h-40 rounded-xl bg-muted/10 border border-border/20 animate-pulse" />
                ) : !insights || insights.metrics.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No performance data available for this location yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {insights.metrics.map((m) => {
                      const max = Math.max(1, ...m.daily.map((d) => d.value));
                      return (
                        <div
                          key={m.metric}
                          className="rounded-xl border border-border/40 bg-card/40 p-3"
                        >
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {METRIC_LABELS[m.metric] ?? m.metric}
                          </div>
                          <div className="text-lg font-semibold mt-1 inline-flex items-center gap-1">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                            {m.total.toLocaleString()}
                          </div>
                          <div className="flex items-end gap-0.5 mt-2 h-12">
                            {m.daily.slice(-30).map((d) => (
                              <div
                                key={d.date}
                                title={`${d.date}: ${d.value}`}
                                className="flex-1 rounded-sm bg-emerald-500/40"
                                style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
