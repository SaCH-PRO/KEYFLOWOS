"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  MapPin,
  Briefcase,
  CheckCircle,
  Clock,
  DollarSign,
  X,
  ChevronDown,
  Store,
  Sparkles,
  ShoppingBag,
  Calendar,
  Send,
  MessageSquare,
  RefreshCw,
  Zap,
  Users,
  Target,
  Handshake,
  Star,
  ShieldCheck,
  Award,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import {
  searchDirectory,
  fetchBusinessRecommendations,
  submitMatchFeedback,
  type DirectoryBusiness,
  type BusinessRecommendation,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { API_BASE } from "@/lib/api";

interface DirectoryProps {
  onViewProfile: (businessId: string) => void;
}

const CAPACITY_OPTIONS = [
  { value: "", label: "Any Availability" },
  { value: "OPEN", label: "Open" },
  { value: "LIMITED", label: "Limited" },
  { value: "FULL", label: "Full" },
];

const STAGE_OPTIONS = [
  { value: "", label: "Any Stage" },
  { value: "IDEA", label: "Idea" },
  { value: "STARTUP", label: "Startup" },
  { value: "GROWTH", label: "Growth" },
  { value: "SCALING", label: "Scaling" },
  { value: "ESTABLISHED", label: "Established" },
  { value: "MATURE", label: "Mature" },
];

const SORT_OPTIONS = [
  { value: "", label: "Best Match" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name A-Z" },
];

const MATCH_TYPE_CONFIG: Record<string, { icon: typeof Zap; label: string; color: string }> = {
  complementary_skills: { icon: Zap, label: "Complementary Skills", color: "text-purple-400 bg-purple-500/15" },
  same_industry: { icon: Briefcase, label: "Same Industry", color: "text-blue-400 bg-blue-500/15" },
  referral_partner: { icon: Handshake, label: "Referral Partner", color: "text-emerald-400 bg-emerald-500/15" },
  collaboration: { icon: Users, label: "Collaboration", color: "text-amber-400 bg-amber-500/15" },
  general: { icon: Star, label: "Good Match", color: "text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/15" },
};

function CapacityBadge({ capacity, accepting }: { capacity?: string; accepting: boolean }) {
  if (!accepting) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400">
        <X className="w-2.5 h-2.5" /> Not Accepting
      </span>
    );
  }
  const config: Record<string, { bg: string; color: string; label: string }> = {
    OPEN: { bg: "bg-emerald-500/15", color: "text-emerald-400", label: "Open" },
    LIMITED: { bg: "bg-amber-500/15", color: "text-amber-400", label: "Limited" },
    FULL: { bg: "bg-red-500/15", color: "text-red-400", label: "Full" },
  };
  const c = config[capacity || "OPEN"] || config.OPEN;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.color}`}>
      <CheckCircle className="w-2.5 h-2.5" /> {c.label}
    </span>
  );
}

function ReputationIndicator({ score }: { score: number }) {
  let color = "text-zinc-400";
  let bg = "bg-zinc-500/15";
  if (score >= 80) { color = "text-emerald-400"; bg = "bg-emerald-500/15"; }
  else if (score >= 60) { color = "text-blue-400"; bg = "bg-blue-500/15"; }
  else if (score >= 40) { color = "text-amber-400"; bg = "bg-amber-500/15"; }

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${bg} ${color}`}>
      <Star className="w-2.5 h-2.5" /> {score}
    </span>
  );
}

function DirectoryBadgeIcon({ icon }: { icon: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    "shield-check": <ShieldCheck className="w-2.5 h-2.5" />,
    "store": <Store className="w-2.5 h-2.5" />,
    "message-square": <MessageSquare className="w-2.5 h-2.5" />,
    "users": <Users className="w-2.5 h-2.5" />,
    "award": <Award className="w-2.5 h-2.5" />,
    "graduation-cap": <Sparkles className="w-2.5 h-2.5" />,
  };
  return <>{iconMap[icon] || <CheckCircle className="w-2.5 h-2.5" />}</>;
}

function MatchScoreBadge({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 60) return "from-emerald-500 to-emerald-600";
    if (score >= 40) return "from-blue-500 to-blue-600";
    return "from-amber-500 to-amber-600";
  };
  return (
    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${getColor()} flex items-center justify-center text-white text-xs font-bold shadow-sm`}>
      {score}
    </div>
  );
}

function RecommendationCard({
  rec,
  onViewProfile,
  onFeedback,
}: {
  rec: BusinessRecommendation;
  onViewProfile: (id: string) => void;
  onFeedback: (targetBusinessId: string, feedback: 'HELPFUL' | 'DISMISSED', score: number, matchType: string) => void;
}) {
  const router = useRouter();
  const [feedbackGiven, setFeedbackGiven] = useState<'HELPFUL' | 'DISMISSED' | null>(null);
  const biz = rec.business;
  const logo = biz.logoUrl
    ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
    : null;
  const initials = biz.name?.[0]?.toUpperCase() || "?";
  const matchConfig = MATCH_TYPE_CONFIG[rec.matchType] || MATCH_TYPE_CONFIG.general;
  const MatchIcon = matchConfig.icon;

  const handleFeedback = (e: React.MouseEvent, type: 'HELPFUL' | 'DISMISSED') => {
    e.stopPropagation();
    setFeedbackGiven(type);
    onFeedback(biz.id, type, rec.score, rec.matchType);
  };

  if (feedbackGiven === 'DISMISSED') {
    return (
      <motion.div
        initial={{ opacity: 1, scale: 1 }}
        animate={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0, padding: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="kf-card border border-border/20 rounded-xl p-4 overflow-hidden"
      >
        <p className="text-xs text-muted-foreground text-center">Dismissed</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card border border-[hsl(var(--kf-accent1))]/20 rounded-xl p-4 space-y-3 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/40 transition-all group relative overflow-hidden"
      onClick={() => onViewProfile(biz.id)}
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[hsl(var(--kf-accent1))]/5 to-transparent rounded-bl-full pointer-events-none" />

      <div className="flex items-start gap-3">
        <MatchScoreBadge score={rec.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
              {logo ? (
                <img src={logo} alt={biz.name} className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate group-hover:text-[hsl(var(--kf-accent1))] transition-colors">{biz.name}</h3>
              {biz.headline && <p className="text-[10px] text-muted-foreground truncate">{biz.headline}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${matchConfig.color}`}>
          <MatchIcon className="w-2.5 h-2.5" /> {matchConfig.label}
        </span>
        <CapacityBadge capacity={biz.currentCapacity} accepting={biz.acceptingWork} />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{rec.explanation}</p>

      {biz.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {biz.skills.slice(0, 3).map((skill) => (
            <span key={skill} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground border border-white/5">
              {skill}
            </span>
          ))}
          {biz.skills.length > 3 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground">+{biz.skills.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {(biz.city || biz.country) && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {[biz.city, biz.country].filter(Boolean).join(", ")}
          </span>
        )}
        {biz.industry && (
          <span className="flex items-center gap-1">
            <Briefcase className="w-3 h-3" /> {biz.industry}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-2 border-t border-border/20">
        <button
          onClick={(e) => handleFeedback(e, 'HELPFUL')}
          disabled={feedbackGiven === 'HELPFUL'}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            feedbackGiven === 'HELPFUL'
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-white/5 hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-400"
          }`}
          title="Helpful match"
        >
          <ThumbsUp className="w-3 h-3" />
          {feedbackGiven === 'HELPFUL' ? "Marked Helpful" : "Helpful"}
        </button>
        <button
          onClick={(e) => handleFeedback(e, 'DISMISSED')}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors ml-auto"
          title="Not relevant"
        >
          <XCircle className="w-3 h-3" />
          Not Relevant
        </button>
      </div>
    </motion.div>
  );
}

function DirectoryCard({ biz, onViewProfile }: { biz: DirectoryBusiness; onViewProfile: (id: string) => void }) {
  const router = useRouter();
  const logo = biz.logoUrl
    ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
    : null;
  const initials = biz.name?.[0]?.toUpperCase() || "?";
  const topOffering = biz.services?.[0] || biz.products?.[0];
  const hasVerified = biz.badges?.some(b => b.id === 'complete_profile') ?? false;
  const topBadges = (biz.badges || []).filter(b => b.id !== 'complete_profile').slice(0, 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card border border-border/30 rounded-xl p-4 space-y-3 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/30 transition-all group"
      onClick={() => onViewProfile(biz.id)}
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-lg font-bold overflow-hidden flex-shrink-0">
          {logo ? (
            <img src={logo} alt={biz.name} className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold truncate group-hover:text-[hsl(var(--kf-accent1))] transition-colors">{biz.name}</h3>
            {hasVerified && (
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            )}
            {biz.reputationScore != null && biz.reputationScore > 0 && (
              <ReputationIndicator score={biz.reputationScore} />
            )}
          </div>
          {biz.headline && <p className="text-xs text-muted-foreground truncate">{biz.headline}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <CapacityBadge capacity={biz.currentCapacity} accepting={biz.acceptingWork} />
            {biz.industry && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                <Briefcase className="w-2.5 h-2.5" /> {biz.industry}
              </span>
            )}
          </div>
        </div>
      </div>

      {topBadges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topBadges.map((badge) => (
            <span
              key={badge.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
              title={badge.label}
            >
              <DirectoryBadgeIcon icon={badge.icon} />
              {badge.label}
            </span>
          ))}
        </div>
      )}

      {biz.positioningStatement && (
        <p className="text-xs text-muted-foreground line-clamp-2">{biz.positioningStatement}</p>
      )}

      {biz.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {biz.skills.slice(0, 4).map((skill) => (
            <span key={skill} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground border border-white/5">
              {skill}
            </span>
          ))}
          {biz.skills.length > 4 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground">+{biz.skills.length - 4}</span>
          )}
        </div>
      )}

      {topOffering && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/20">
          <Store className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
          <span className="truncate">{topOffering.name}</span>
          <span className="ml-auto font-medium text-foreground">
            {topOffering.currency} {topOffering.price.toLocaleString()}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {(biz.city || biz.country) && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {[biz.city, biz.country].filter(Boolean).join(", ")}
          </span>
        )}
        {biz.leadTime && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {biz.leadTime}
          </span>
        )}
        {biz._count?.networkConnectionsTo ? (
          <span className="ml-auto">{biz._count.networkConnectionsTo} followers</span>
        ) : null}
      </div>

      {biz.slug && (
        <div className="flex items-center gap-1.5 pt-2 border-t border-border/20">
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] text-[10px] font-medium transition-colors"
          >
            <ShoppingBag className="w-3 h-3" /> Store
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}?action=book`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] text-[10px] font-medium transition-colors"
          >
            <Calendar className="w-3 h-3" /> Book
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}?action=quote`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground text-[10px] font-medium transition-colors"
          >
            <Send className="w-3 h-3" /> Quote
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/app/community?message=${biz.id}`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground text-[10px] font-medium transition-colors ml-auto"
          >
            <MessageSquare className="w-3 h-3" /> Message
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function Directory({ onViewProfile }: DirectoryProps) {
  const [businesses, setBusinesses] = useState<DirectoryBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    industry: "",
    city: "",
    businessStage: "",
    currentCapacity: "",
    acceptingWork: "",
    serviceType: "",
    priceMin: "",
    priceMax: "",
    sort: "",
  });

  const [recommendations, setRecommendations] = useState<BusinessRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState(false);
  const [showRecs, setShowRecs] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadRecommendations = useCallback(async (refresh = false) => {
    if (!businessId) return;
    setRecsLoading(true);
    setRecsError(false);
    try {
      const res = await fetchBusinessRecommendations(businessId, refresh);
      if (res.data) {
        setRecommendations(Array.isArray(res.data) ? res.data : []);
      } else {
        setRecsError(true);
      }
    } catch {
      setRecsError(true);
    }
    setRecsLoading(false);
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      void loadRecommendations();
    }
  }, [businessId, loadRecommendations]);

  const handleMatchFeedback = useCallback(async (targetBusinessId: string, feedback: 'HELPFUL' | 'DISMISSED', matchScore: number, matchType: string) => {
    if (!businessId) return;
    try {
      await submitMatchFeedback(businessId, { targetBusinessId, feedback, matchScore, matchType });
      if (feedback === 'DISMISSED') {
        setTimeout(() => {
          setRecommendations((prev) => prev.filter((r) => r.businessId !== targetBusinessId));
        }, 600);
      }
    } catch {
    }
  }, [businessId]);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filters.industry) params.industry = filters.industry;
    if (filters.city) params.city = filters.city;
    if (filters.businessStage) params.businessStage = filters.businessStage;
    if (filters.currentCapacity) params.currentCapacity = filters.currentCapacity;
    if (filters.acceptingWork) params.acceptingWork = filters.acceptingWork;
    if (filters.serviceType) params.serviceType = filters.serviceType;
    if (filters.priceMin) params.priceMin = filters.priceMin;
    if (filters.priceMax) params.priceMax = filters.priceMax;
    if (filters.sort) params.sort = filters.sort;
    params.page = String(page);
    params.limit = "20";

    try {
      const res = await searchDirectory(params);
      if (res.data) {
        setBusinesses(res.data.data);
        setTotal(res.data.total);
      }
    } catch {}
    setLoading(false);
  }, [search, filters, page]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasActiveSearch = search || activeFilterCount > 0;

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {showRecs && !hasActiveSearch && recommendations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
                  <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Recommended for You</h3>
                  <p className="text-[10px] text-muted-foreground">AI-matched businesses based on your profile</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void loadRecommendations(true)}
                  disabled={recsLoading}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
                  title="Refresh recommendations"
                >
                  <RefreshCw className={`w-3 h-3 ${recsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowRecs(false)}
                  className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  title="Hide recommendations"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {recommendations.map((rec) => (
                <RecommendationCard key={rec.businessId} rec={rec} onViewProfile={onViewProfile} onFeedback={handleMatchFeedback} />
              ))}
            </div>

            <div className="border-b border-border/20" />
          </motion.div>
        )}
      </AnimatePresence>

      {!hasActiveSearch && recsLoading && recommendations.length === 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Recommended for You</h3>
              <p className="text-[10px] text-muted-foreground">Finding your best matches...</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="kf-card rounded-xl p-4 space-y-3 animate-pulse border border-[hsl(var(--kf-accent1))]/10">
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted/30" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-28 bg-muted/30 rounded" />
                    <div className="h-3 w-40 bg-muted/20 rounded" />
                  </div>
                </div>
                <div className="h-6 bg-muted/15 rounded" />
                <div className="h-8 bg-muted/10 rounded" />
              </div>
            ))}
          </div>
          <div className="border-b border-border/20" />
        </div>
      )}

      {!showRecs && recommendations.length > 0 && !hasActiveSearch && (
        <button
          onClick={() => setShowRecs(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          Show AI Recommendations ({recommendations.length})
        </button>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search businesses, skills, services..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
            showFilters || activeFilterCount > 0
              ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
              : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-[hsl(var(--kf-accent1))] text-white text-[10px] flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        <select
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
          className="px-3 py-2.5 rounded-xl text-xs bg-white/5 border border-white/10 text-muted-foreground focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
        >
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Industry</label>
            <input
              placeholder="e.g. Technology"
              value={filters.industry}
              onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Location</label>
            <input
              placeholder="e.g. Port of Spain"
              value={filters.city}
              onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Business Stage</label>
            <select
              value={filters.businessStage}
              onChange={(e) => setFilters((f) => ({ ...f, businessStage: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            >
              {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Availability</label>
            <select
              value={filters.currentCapacity}
              onChange={(e) => setFilters((f) => ({ ...f, currentCapacity: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            >
              {CAPACITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Service Type</label>
            <input
              placeholder="e.g. Branding, Web Dev"
              value={filters.serviceType}
              onChange={(e) => setFilters((f) => ({ ...f, serviceType: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Min Price</label>
            <input
              type="number"
              placeholder="0"
              value={filters.priceMin}
              onChange={(e) => setFilters((f) => ({ ...f, priceMin: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Max Price</label>
            <input
              type="number"
              placeholder="No limit"
              value={filters.priceMax}
              onChange={(e) => setFilters((f) => ({ ...f, priceMax: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div className="col-span-2 md:col-span-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={filters.acceptingWork === "true"}
                onChange={(e) => setFilters((f) => ({ ...f, acceptingWork: e.target.checked ? "true" : "" }))}
                className="rounded"
              />
              Only show businesses accepting work
            </label>
            <button
              onClick={() => setFilters({ industry: "", city: "", businessStage: "", currentCapacity: "", acceptingWork: "", serviceType: "", priceMin: "", priceMax: "", sort: "" })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="kf-card rounded-xl p-4 space-y-3 animate-pulse border border-border/30">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted/30" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-muted/30 rounded" />
                  <div className="h-3 w-48 bg-muted/20 rounded" />
                </div>
              </div>
              <div className="h-8 bg-muted/15 rounded" />
            </div>
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No businesses found"
          description="Try adjusting your search or filters to find businesses in the network."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{total} business{total !== 1 ? "es" : ""} found</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {businesses.map((biz) => (
              <DirectoryCard key={biz.id} biz={biz} onViewProfile={onViewProfile} />
            ))}
          </div>
          {total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / 20)}</span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
