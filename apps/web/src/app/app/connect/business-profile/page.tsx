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
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet, apiPostSimple } from "@/lib/api";
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
  const [posting, setPosting] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

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
    setPosting(true);
    const body: {
      location: string;
      summary: string;
      callToAction?: { actionType: string; url: string };
    } = {
      location: activeLocation,
      summary: postSummary.trim(),
    };
    if (postCtaUrl.trim()) {
      body.callToAction = {
        actionType: postCtaType,
        url: postCtaUrl.trim(),
      };
    }
    const res = await apiPostSimple(
      `/connect/businesses/${businessId}/business-profile/posts`,
      body,
    );
    setPosting(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Post published");
      setPostSummary("");
      setPostCtaUrl("");
      setShowComposer(false);
      await loadDetails();
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
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handlePublishPost}
                        disabled={!postSummary.trim() || posting}
                      >
                        {posting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Send className="h-3 w-3 mr-1" />
                        )}
                        Publish
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReplyOpen(isReplying ? null : reviewName ?? null);
                                setReplyText(r.reviewReply?.comment ?? "");
                              }}
                              className="h-7 px-2 text-xs shrink-0"
                            >
                              <MessageCircle className="h-3 w-3 mr-1" />
                              {r.reviewReply ? "Edit reply" : "Reply"}
                            </Button>
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
                              <div className="flex justify-end gap-2">
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
