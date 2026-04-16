"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  MapPin,
  Briefcase,
  Calendar,
  MessageSquare,
  Users,
  Sparkles,
  Tag,
  Heart,
  CheckCircle,
  Clock,
  ShoppingBag,
  Send,
  Store,
  Bookmark,
  BookmarkCheck,
  UserPlus,
  UserCheck,
  X,
  DollarSign,
  ShieldCheck,
  Award,
  Star,
  ThumbsUp,
} from "lucide-react";
import {
  fetchCommunityProfile,
  fetchCommunityPosts,
  createNetworkConnection,
  removeNetworkConnection,
  getConnectionStatus,
  fetchTrustSignals,
  fetchEndorsements,
  fetchMyEndorsementsGiven,
  createEndorsement,
  removeEndorsement,
  type CommunityProfile,
  type CommunityPost,
  type NetworkConnectionStatus,
  type TrustSignals,
  type EndorsementData,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function CapacityBadge({ capacity, accepting }: { capacity?: string; accepting: boolean }) {
  if (!accepting) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 text-red-400 text-xs font-medium">
        <X className="w-3.5 h-3.5" /> Not Accepting Work
      </span>
    );
  }
  const config: Record<string, { bg: string; color: string; label: string }> = {
    OPEN: { bg: "bg-emerald-500/15", color: "text-emerald-400", label: "Open for Work" },
    LIMITED: { bg: "bg-amber-500/15", color: "text-amber-400", label: "Limited Availability" },
    FULL: { bg: "bg-red-500/15", color: "text-red-400", label: "At Capacity" },
  };
  const c = config[capacity || "OPEN"] || config.OPEN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl ${c.bg} ${c.color} text-xs font-medium`}>
      <CheckCircle className="w-3.5 h-3.5" /> {c.label}
    </span>
  );
}

function ReputationMeter({ score }: { score: number }) {
  let color = "from-zinc-500 to-zinc-400";
  let label = "Building";
  if (score >= 80) { color = "from-emerald-500 to-emerald-400"; label = "Excellent"; }
  else if (score >= 60) { color = "from-blue-500 to-blue-400"; label = "Strong"; }
  else if (score >= 40) { color = "from-amber-500 to-amber-400"; label = "Growing"; }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5" /> Reputation
        </span>
        <span className="text-xs font-medium">{score}/100 - {label}</span>
      </div>
      <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function BadgeIcon({ icon, className = "w-4 h-4" }: { icon: string; className?: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    "shield-check": <ShieldCheck className={className} />,
    "store": <Store className={className} />,
    "message-square": <MessageSquare className={className} />,
    "users": <Users className={className} />,
    "award": <Award className={className} />,
    "graduation-cap": <Sparkles className={className} />,
  };
  return <>{iconMap[icon] || <CheckCircle className={className} />}</>;
}

export default function PublicProfilePage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [myBusinessId, setMyBusinessId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<NetworkConnectionStatus>({ following: false, saved: false });
  const [togglingConnection, setTogglingConnection] = useState(false);
  const [trustSignals, setTrustSignals] = useState<TrustSignals | null>(null);
  const [endorsements, setEndorsements] = useState<EndorsementData[]>([]);
  const [topSkills, setTopSkills] = useState<{ skill: string; count: number }[]>([]);
  const [myEndorsedSkills, setMyEndorsedSkills] = useState<string[]>([]);
  const [endorsingSkill, setEndorsingSkill] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setMyBusinessId(bid);
  }, []);

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      fetchCommunityProfile(businessId),
      fetchCommunityPosts(),
      fetchTrustSignals(businessId),
      fetchEndorsements(businessId),
    ])
      .then(([profileRes, postsRes, trustRes, endorseRes]) => {
        if (profileRes.data) setProfile(profileRes.data);
        if (postsRes.data) {
          const arr = Array.isArray(postsRes.data) ? postsRes.data : (postsRes.data as any)?.data || [];
          setPosts(arr.filter((p: CommunityPost) => p.businessId === businessId));
        }
        if (trustRes.data) setTrustSignals(trustRes.data);
        if (endorseRes.data) {
          setEndorsements(endorseRes.data.endorsements);
          setTopSkills(endorseRes.data.topSkills);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  useEffect(() => {
    if (!myBusinessId || !businessId || myBusinessId === businessId) return;
    Promise.all([
      getConnectionStatus(myBusinessId, businessId),
      fetchMyEndorsementsGiven(myBusinessId, businessId),
    ])
      .then(([connRes, endorseRes]) => {
        if (connRes.data) setConnectionStatus(connRes.data);
        if (endorseRes.data) setMyEndorsedSkills(endorseRes.data.map(e => e.skill));
      })
      .catch(() => {});
  }, [myBusinessId, businessId]);

  const toggleFollow = useCallback(async () => {
    if (!myBusinessId || togglingConnection) return;
    setTogglingConnection(true);
    try {
      if (connectionStatus.following) {
        await removeNetworkConnection(myBusinessId, businessId, "FOLLOW");
        setConnectionStatus((s) => ({ ...s, following: false }));
      } else {
        await createNetworkConnection(myBusinessId, businessId, "FOLLOW");
        setConnectionStatus((s) => ({ ...s, following: true }));
      }
    } catch {}
    setTogglingConnection(false);
  }, [myBusinessId, businessId, connectionStatus.following, togglingConnection]);

  const toggleSave = useCallback(async () => {
    if (!myBusinessId || togglingConnection) return;
    setTogglingConnection(true);
    try {
      if (connectionStatus.saved) {
        await removeNetworkConnection(myBusinessId, businessId, "SAVE");
        setConnectionStatus((s) => ({ ...s, saved: false }));
      } else {
        await createNetworkConnection(myBusinessId, businessId, "SAVE");
        setConnectionStatus((s) => ({ ...s, saved: true }));
      }
    } catch {}
    setTogglingConnection(false);
  }, [myBusinessId, businessId, connectionStatus.saved, togglingConnection]);

  const handleEndorse = useCallback(async (skill: string) => {
    if (!myBusinessId || endorsingSkill) return;
    setEndorsingSkill(skill);
    try {
      if (myEndorsedSkills.includes(skill)) {
        await removeEndorsement(myBusinessId, businessId, skill);
        setMyEndorsedSkills(prev => prev.filter(s => s !== skill));
        setTopSkills(prev => prev.map(s => s.skill === skill ? { ...s, count: Math.max(0, s.count - 1) } : s).filter(s => s.count > 0));
      } else {
        await createEndorsement(myBusinessId, businessId, skill);
        setMyEndorsedSkills(prev => [...prev, skill]);
        setTopSkills(prev => {
          const existing = prev.find(s => s.skill === skill);
          if (existing) return prev.map(s => s.skill === skill ? { ...s, count: s.count + 1 } : s);
          return [...prev, { skill, count: 1 }];
        });
      }
    } catch {}
    setEndorsingSkill(null);
  }, [myBusinessId, businessId, myEndorsedSkills, endorsingSkill]);

  const resolvedLogo = profile?.logoUrl
    ? profile.logoUrl.startsWith("http") ? profile.logoUrl : `${API_BASE}${profile.logoUrl}`
    : null;
  const initials = profile?.name?.[0]?.toUpperCase() || "?";
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";
  const isOwnProfile = myBusinessId === businessId;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-40 rounded-2xl bg-muted/30" />
        <div className="flex gap-4 -mt-10 px-6">
          <div className="w-24 h-24 rounded-2xl bg-muted/40 border-4 border-background" />
          <div className="space-y-2 pt-8">
            <div className="h-6 w-48 bg-muted/40 rounded" />
            <div className="h-4 w-72 bg-muted/30 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Profile not found</p>
        <button
          onClick={() => router.push("/app/community")}
          className="mt-4 text-sm text-[hsl(var(--kf-accent1))] hover:underline"
        >
          Back to Community
        </button>
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="max-w-3xl mx-auto space-y-6">
      <motion.div variants={fadeUp}>
        <button
          onClick={() => router.push("/app/community")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Community
        </button>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card rounded-2xl overflow-hidden border border-border/50">
        <div className="relative h-36 bg-gradient-to-br from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent1))]/50 to-[hsl(var(--kf-accent2))]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(255,255,255,0.08),transparent_40%)]" />
        </div>

        <div className="px-6 pb-6 -mt-12 space-y-4">
          <div className="flex items-end gap-5">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-3xl font-bold overflow-hidden border-4 border-background shadow-xl flex-shrink-0">
              {resolvedLogo ? (
                <img src={resolvedLogo} alt={profile.name} className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 pb-1 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{profile.name}</h1>
                {trustSignals && trustSignals.badges.some(b => b.id === 'complete_profile') && (
                  <ShieldCheck className="w-5 h-5 text-blue-400 flex-shrink-0" />
                )}
              </div>
              {profile.headline && (
                <p className="text-sm text-muted-foreground mt-0.5">{profile.headline}</p>
              )}
            </div>
            {!isOwnProfile && myBusinessId && (
              <div className="flex items-center gap-2 pb-1">
                <button
                  onClick={toggleFollow}
                  disabled={togglingConnection}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                    connectionStatus.following
                      ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]"
                      : "kf-btn-primary"
                  }`}
                >
                  {connectionStatus.following ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {connectionStatus.following ? "Following" : "Follow"}
                </button>
                <button
                  onClick={toggleSave}
                  disabled={togglingConnection}
                  className={`p-2 rounded-xl transition-colors ${
                    connectionStatus.saved
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  }`}
                >
                  {connectionStatus.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <CapacityBadge capacity={profile.currentCapacity} accepting={profile.acceptingWork} />
            {profile.leadTime && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-muted-foreground text-xs">
                <Clock className="w-3.5 h-3.5" /> {profile.leadTime}
              </span>
            )}
            {profile.budgetFit && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-muted-foreground text-xs">
                <DollarSign className="w-3.5 h-3.5" /> {profile.budgetFit}
              </span>
            )}
          </div>

          {trustSignals && trustSignals.badges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {trustSignals.badges.map((badge) => (
                <span
                  key={badge.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium"
                >
                  <BadgeIcon icon={badge.icon} className="w-3.5 h-3.5" />
                  {badge.label}
                </span>
              ))}
            </div>
          )}

          {profile.positioningStatement && (
            <div className="border-l-2 border-[hsl(var(--kf-accent1))]/40 pl-4">
              <p className="text-sm text-muted-foreground leading-relaxed italic">{profile.positioningStatement}</p>
            </div>
          )}

          {profile.bio && !profile.positioningStatement && (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">{profile.bio}</p>
          )}

          {profile.bio && profile.positioningStatement && (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">{profile.bio}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {profile.industry && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium">
                <Briefcase className="w-3.5 h-3.5" />
                {profile.industry}
              </span>
            )}
            {(profile.city || profile.country) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/30 text-muted-foreground text-xs">
                <MapPin className="w-3.5 h-3.5" />
                {[profile.city, profile.country].filter(Boolean).join(", ")}
              </span>
            )}
            {profile.businessStage && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                {profile.businessStage}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/30 text-muted-foreground text-xs">
              <Calendar className="w-3.5 h-3.5" />
              Member since {memberSince}
            </span>
          </div>

          {profile.slug && (
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              <button
                onClick={() => router.push(`/book/${profile.slug}`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl kf-btn-primary text-sm font-medium"
              >
                <ShoppingBag className="w-4 h-4" />
                View Store
              </button>
              <button
                onClick={() => router.push(`/book/${profile.slug}?action=book`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[hsl(var(--kf-accent2))]/15 hover:bg-[hsl(var(--kf-accent2))]/25 text-[hsl(var(--kf-accent2))] text-sm font-medium transition-colors border border-[hsl(var(--kf-accent2))]/20"
              >
                <Calendar className="w-4 h-4" />
                Book Service
              </button>
              <button
                onClick={() => router.push(`/book/${profile.slug}?action=quote`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-sm font-medium transition-colors border border-white/10"
              >
                <Send className="w-4 h-4" />
                Request Quote
              </button>
              <button
                onClick={() => router.push(`/app/community?message=${profile.id}`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-sm font-medium transition-colors border border-white/10"
              >
                <MessageSquare className="w-4 h-4" />
                Send Message
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {trustSignals && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Trust & Reputation
          </h3>
          <ReputationMeter score={trustSignals.reputationScore} />
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-4 text-center border border-border/30">
          <div className="text-2xl font-bold">{profile._count?.communityPosts || 0}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <MessageSquare className="w-3.5 h-3.5" /> Posts
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-4 text-center border border-border/30">
          <div className="text-2xl font-bold">{profile._count?.cohortMembers || 0}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <Users className="w-3.5 h-3.5" /> Cohorts
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-4 text-center border border-border/30">
          <div className="text-2xl font-bold">{profile._count?.networkConnectionsTo || 0}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <Users className="w-3.5 h-3.5" /> Followers
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-4 text-center border border-border/30">
          <div className="text-2xl font-bold">{trustSignals?.endorsementCount || 0}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <Award className="w-3.5 h-3.5" /> Endorsements
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-4 text-center border border-border/30">
          <div className="text-2xl font-bold">{profile.profileCompleteness}%</div>
          <div className="text-xs text-muted-foreground mt-1">Profile Complete</div>
          <div className="h-1.5 bg-muted/30 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] transition-all duration-500"
              style={{ width: `${profile.profileCompleteness}%` }}
            />
          </div>
        </motion.div>
      </div>

      {((profile.services && profile.services.length > 0) || (profile.products && profile.products.length > 0)) && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Store className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Offerings
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profile.services?.map((service) => (
              <div key={service.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{service.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {service.currency} {service.price.toLocaleString()}
                    {service.durationMins && ` · ${service.durationMins}min`}
                  </p>
                </div>
              </div>
            ))}
            {profile.products?.map((product) => (
              <div key={product.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent2))]/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {product.imageUrl ? (
                    <img src={product.imageUrl.startsWith("http") ? product.imageUrl : `${API_BASE}${product.imageUrl}`} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <ShoppingBag className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{product.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {product.currency} {product.price.toLocaleString()}
                    <span className="ml-1 text-[9px] opacity-60">{product.category}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {profile.preferredProjectTypes.length > 0 && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Tag className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Preferred Project Types
          </h3>
          <div className="flex flex-wrap gap-2">
            {profile.preferredProjectTypes.map((pt) => (
              <span key={pt} className="px-3 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                {pt}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {profile.skills.length > 0 && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Skills & Expertise
          </h3>
          <div className="flex flex-wrap gap-2">
            {profile.skills.map((skill) => {
              const endorseCount = topSkills.find(s => s.skill === skill)?.count || 0;
              const isEndorsed = myEndorsedSkills.includes(skill);
              const canEndorse = !isOwnProfile && myBusinessId && connectionStatus.following;

              return (
                <div key={skill} className="group relative">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    endorseCount > 0
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                      : "bg-white/10 text-muted-foreground border-white/5"
                  }`}>
                    {skill}
                    {endorseCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px]">
                        <ThumbsUp className="w-2.5 h-2.5" /> {endorseCount}
                      </span>
                    )}
                  </span>
                  {canEndorse && (
                    <button
                      onClick={() => handleEndorse(skill)}
                      disabled={endorsingSkill === skill}
                      className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all opacity-0 group-hover:opacity-100 ${
                        isEndorsed
                          ? "bg-amber-500 text-white"
                          : "bg-white/20 text-muted-foreground hover:bg-white/30"
                      }`}
                      title={isEndorsed ? "Remove endorsement" : "Endorse this skill"}
                    >
                      <ThumbsUp className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!isOwnProfile && myBusinessId && connectionStatus.following && (
            <p className="text-[10px] text-muted-foreground italic">Hover over a skill to endorse it</p>
          )}
        </motion.div>
      )}

      {endorsements.length > 0 && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Award className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Recent Endorsements
          </h3>
          <div className="space-y-3">
            {endorsements.slice(0, 6).map((endorsement) => {
              const eLogo = endorsement.fromBusiness.logoUrl
                ? endorsement.fromBusiness.logoUrl.startsWith("http")
                  ? endorsement.fromBusiness.logoUrl
                  : `${API_BASE}${endorsement.fromBusiness.logoUrl}`
                : null;
              return (
                <div key={endorsement.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                    {eLogo ? (
                      <img src={eLogo} alt={endorsement.fromBusiness.name} className="w-full h-full object-cover" />
                    ) : (
                      endorsement.fromBusiness.name[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-medium hover:underline cursor-pointer"
                        onClick={() => router.push(`/app/community/profile/${endorsement.fromBusiness.id}`)}
                      >
                        {endorsement.fromBusiness.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400 font-medium">
                        {endorsement.skill}
                      </span>
                    </div>
                    {endorsement.message && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{endorsement.message}</p>
                    )}
                    <span className="text-[9px] text-muted-foreground">{timeAgo(endorsement.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {profile.interests.length > 0 && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Heart className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Interests
          </h3>
          <div className="flex flex-wrap gap-2">
            {profile.interests.map((interest) => (
              <span key={interest} className="px-3 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                {interest}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {posts.length > 0 && (
        <motion.div variants={fadeUp} className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Recent Posts
          </h3>
          {posts.slice(0, 5).map((post) => (
            <div
              key={post.id}
              onClick={() => router.push(`/app/community`)}
              className="kf-card rounded-xl p-4 border border-border/30 space-y-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center justify-between">
                {post.title && <h4 className="text-sm font-medium">{post.title}</h4>}
                <span className="text-[10px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{post.content}</p>
              {post.tags?.length > 0 && (
                <div className="flex gap-1">
                  {post.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] bg-white/10 text-muted-foreground flex items-center gap-0.5">
                      <Tag className="w-2 h-2" />{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{post.likes || 0}</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{post._count?.comments || 0}</span>
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
