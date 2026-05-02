"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
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
  Pencil,
  FileText,
  Handshake,
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
  updateEndorsement,
  removeEndorsement,
  createCommunityQuoteRequest,
  createCommunityReferral,
  createCommunityCollaboration,
  saveBusinessToShortlist,
  unsaveBusinessFromShortlist,
  checkBusinessSaved,
  fetchBusinessReviews,
  recordProfileView,
  type CommunityProfile,
  type CommunityPost,
  type NetworkConnectionStatus,
  type TrustSignals,
  type EndorsementData,
  type CommunityReview,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { QuoteRequestModal } from "../../components/quote-request-modal";
import { ReferralModal } from "../../components/referral-modal";
import { CollaborationModal } from "../../components/collaboration-modal";
import { MessageModal } from "../../components/message-modal";
import { InteractionHistorySection } from "../../components/interaction-history";

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
  const [myBusinessId, setMyBusinessId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<NetworkConnectionStatus>({ following: false, saved: false });
  const [togglingConnection, setTogglingConnection] = useState(false);
  const [trustSignals, setTrustSignals] = useState<TrustSignals | null>(null);
  const [endorsements, setEndorsements] = useState<EndorsementData[]>([]);
  const [topSkills, setTopSkills] = useState<{ skill: string; count: number }[]>([]);
  const [myEndorsedSkills, setMyEndorsedSkills] = useState<string[]>([]);
  const [myEndorsementMessages, setMyEndorsementMessages] = useState<Record<string, string>>({});
  const [endorsingSkill, setEndorsingSkill] = useState<string | null>(null);
  const [endorseModalSkill, setEndorseModalSkill] = useState<string | null>(null);
  const [endorseMessage, setEndorseMessage] = useState("");
  const [endorseError, setEndorseError] = useState<string | null>(null);
  const [editingEndorsement, setEditingEndorsement] = useState<{ skill: string; toBusinessId: string } | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [endorsementsVisible, setEndorsementsVisible] = useState(6);
  const [saved, setSaved] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setMyBusinessId(bid);
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const viewerBusinessId = getStoredBusinessId();
    if (viewerBusinessId === businessId) return;
    void recordProfileView(businessId, { viewerBusinessId, source: "profile_page" }).catch(() => {});
  }, [businessId]);

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
      checkBusinessSaved(myBusinessId, businessId),
    ])
      .then(([connRes, endorseRes, savedRes]) => {
        if (connRes.data) setConnectionStatus(connRes.data);
        if (endorseRes.data) {
          setMyEndorsedSkills(endorseRes.data.map(e => e.skill));
          const msgMap: Record<string, string> = {};
          endorseRes.data.forEach(e => { if (e.message) msgMap[e.skill] = e.message; });
          setMyEndorsementMessages(msgMap);
        }
        if (savedRes.data) setSaved(savedRes.data.saved);
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
    if (!myBusinessId || savingBookmark) return;
    setSavingBookmark(true);
    try {
      if (saved) {
        await unsaveBusinessFromShortlist(myBusinessId, businessId);
        setSaved(false);
      } else {
        await saveBusinessToShortlist(myBusinessId, businessId);
        setSaved(true);
      }
    } catch {}
    setSavingBookmark(false);
  }, [myBusinessId, businessId, saved, savingBookmark]);

  const handleEndorse = useCallback(async (skill: string) => {
    if (!myBusinessId || endorsingSkill) return;
    if (myEndorsedSkills.includes(skill)) {
      setEndorsingSkill(skill);
      try {
        await removeEndorsement(myBusinessId, businessId, skill);
        setMyEndorsedSkills(prev => prev.filter(s => s !== skill));
        setTopSkills(prev => prev.map(s => s.skill === skill ? { ...s, count: Math.max(0, s.count - 1) } : s).filter(s => s.count > 0));
        setEndorsements(prev => prev.filter(e => !(e.skill === skill && e.fromBusiness.id === myBusinessId)));
      } catch {}
      setEndorsingSkill(null);
    } else {
      setEndorseMessage("");
      setEndorseModalSkill(skill);
    }
  }, [myBusinessId, businessId, myEndorsedSkills, endorsingSkill]);

  const closeEndorseModal = useCallback(() => {
    setEndorseModalSkill(null);
    setEndorseMessage("");
    setEndorseError(null);
  }, []);

  const submitEndorsement = useCallback(async () => {
    if (!myBusinessId || !endorseModalSkill || endorsingSkill) return;
    const skill = endorseModalSkill;
    setEndorsingSkill(skill);
    setEndorseError(null);
    try {
      const msg = endorseMessage.trim() || undefined;
      const result = await createEndorsement(myBusinessId, businessId, skill, msg);
      if (result.error) {
        setEndorseError(typeof result.error === "string" ? result.error : "Failed to endorse. Please try again.");
        setEndorsingSkill(null);
        return;
      }
      setMyEndorsedSkills(prev => [...prev, skill]);
      setTopSkills(prev => {
        const existing = prev.find(s => s.skill === skill);
        if (existing) return prev.map(s => s.skill === skill ? { ...s, count: s.count + 1 } : s);
        return [...prev, { skill, count: 1 }];
      });
      if (result.data) {
        setEndorsements(prev => [result.data!, ...prev]);
      }
      closeEndorseModal();
    } catch {
      setEndorseError("Failed to endorse. Please try again.");
    }
    setEndorsingSkill(null);
  }, [myBusinessId, businessId, endorseModalSkill, endorseMessage, endorsingSkill, closeEndorseModal]);

  const handleEditEndorsement = useCallback(async () => {
    if (!myBusinessId || !editingEndorsement || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await updateEndorsement(myBusinessId, editingEndorsement.toBusinessId, editingEndorsement.skill, editMessage);
      if (res.data) {
        setMyEndorsementMessages(prev => ({ ...prev, [editingEndorsement.skill]: editMessage }));
        setEndorsements(prev => prev.map(e =>
          e.skill === editingEndorsement.skill && e.fromBusiness.id === myBusinessId
            ? { ...e, message: editMessage || undefined }
            : e
        ));
        setEditingEndorsement(null);
      }
    } catch {}
    setSavingEdit(false);
  }, [myBusinessId, editingEndorsement, editMessage, savingEdit]);

  const handleQuoteSubmit = useCallback(async (data: any) => {
    if (!myBusinessId) return;
    await createCommunityQuoteRequest(myBusinessId, {
      toBusinessId: businessId,
      ...data,
      aiSuggestionSource: 'quote_request_modal',
    });
  }, [myBusinessId, businessId]);

  const handleReferralSubmit = useCallback(async (data: any) => {
    if (!myBusinessId) return;
    await createCommunityReferral(myBusinessId, { toBusinessId: businessId, ...data });
  }, [myBusinessId, businessId]);

  const handleCollabSubmit = useCallback(async (data: any) => {
    if (!myBusinessId) return;
    await createCommunityCollaboration(myBusinessId, { toBusinessId: businessId, ...data });
  }, [myBusinessId, businessId]);

  const isOwnProfile = myBusinessId === businessId;

  const resolvedLogo = profile?.logoUrl
    ? profile.logoUrl.startsWith("http") ? profile.logoUrl : `${API_BASE}${profile.logoUrl}`
    : null;
  const initials = profile?.name?.[0]?.toUpperCase() || "?";
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

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
                <Image src={resolvedLogo} alt={profile.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 pb-1 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{profile.name}</h1>
                {trustSignals?.isVerified ? (
                  <span title="Verified Provider" className="flex-shrink-0">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  </span>
                ) : trustSignals && trustSignals.badges.some(b => b.id === 'complete_profile') ? (
                  <ShieldCheck className="w-5 h-5 text-blue-400 flex-shrink-0" />
                ) : null}
              </div>
              {profile.headline && (
                <p className="text-sm text-muted-foreground mt-0.5">{profile.headline}</p>
              )}
              {trustSignals && (trustSignals.totalReviews ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const filled = Math.round(trustSignals.averageRating ?? 0) >= n;
                      return (
                        <svg
                          key={n}
                          viewBox="0 0 20 20"
                          fill={filled ? "rgb(251 191 36)" : "none"}
                          stroke="rgb(251 191 36)"
                          strokeWidth={1.5}
                          className="w-3.5 h-3.5"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.783.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      );
                    })}
                  </div>
                  <span className="text-sm font-semibold">{(trustSignals.averageRating ?? 0).toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">
                    ({trustSignals.totalReviews} review{trustSignals.totalReviews === 1 ? "" : "s"})
                  </span>
                </div>
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
                  disabled={savingBookmark}
                  className={`p-2 rounded-xl transition-colors ${
                    saved
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  }`}
                  title={saved ? "Remove from shortlist" : "Save to shortlist"}
                >
                  {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
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

          {profile.bio && (
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
              <button
                onClick={() => router.push(`/app/community?collab=${profile.id}`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-sm font-medium transition-colors border border-purple-500/20"
              >
                <Sparkles className="w-4 h-4" />
                Collaborate
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {!isOwnProfile && myBusinessId && (
        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => setShowMessageModal(true)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] text-xs font-medium transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Message
          </button>
          <button
            onClick={() => setShowQuoteModal(true)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Request Quote
          </button>
          <button
            onClick={() => setShowReferralModal(true)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Refer
          </button>
          <button
            onClick={() => setShowCollabModal(true)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-colors"
          >
            <Handshake className="w-3.5 h-3.5" />
            Collaborate
          </button>
        </motion.div>
      )}

      {trustSignals && (
        <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              Trust & Reputation
            </h3>
            {trustSignals.isVerified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Verified Provider
              </span>
            )}
          </div>
          <ReputationMeter score={trustSignals.reputationScore} />
          {((trustSignals.totalCompleted ?? 0) > 0 ||
            (trustSignals.onTimeRate ?? 0) > 0 ||
            (trustSignals.responseTimeHours ?? 0) > 0 ||
            (trustSignals.referralsConverted ?? 0) > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-border/20">
              <div className="text-center p-2 rounded-lg bg-white/5">
                <div className="text-base font-bold">{trustSignals.totalCompleted ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">Projects done</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/5">
                <div className="text-base font-bold">{Math.round((trustSignals.onTimeRate ?? 0) * 100)}%</div>
                <div className="text-[10px] text-muted-foreground">On-time</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/5">
                <div className="text-base font-bold">{Math.round((trustSignals.repeatClientRate ?? 0) * 100)}%</div>
                <div className="text-[10px] text-muted-foreground">Repeat clients</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/5">
                <div className="text-base font-bold">{trustSignals.referralsConverted ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">Referrals won</div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      <ProfileReviewsSection businessId={businessId} />


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
                    <Image src={product.imageUrl.startsWith("http") ? product.imageUrl : `${API_BASE}${product.imageUrl}`} alt={product.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
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
            {endorsements.slice(0, endorsementsVisible).map((endorsement) => {
              const eLogo = endorsement.fromBusiness.logoUrl
                ? endorsement.fromBusiness.logoUrl.startsWith("http")
                  ? endorsement.fromBusiness.logoUrl
                  : `${API_BASE}${endorsement.fromBusiness.logoUrl}`
                : null;
              return (
                <div key={endorsement.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                    {eLogo ? (
                      <Image src={eLogo} alt={endorsement.fromBusiness.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
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
                      <p className="text-xs text-muted-foreground mt-1 italic border-l-2 border-[hsl(var(--kf-accent1))]/30 pl-2 line-clamp-3">&ldquo;{endorsement.message}&rdquo;</p>
                    )}
                    <span className="text-[9px] text-muted-foreground">{timeAgo(endorsement.createdAt)}</span>
                  </div>
                  {myBusinessId && endorsement.fromBusiness.id === myBusinessId && (
                    <button
                      onClick={() => {
                        setEditingEndorsement({ skill: endorsement.skill, toBusinessId: businessId });
                        setEditMessage(endorsement.message || myEndorsementMessages[endorsement.skill] || "");
                      }}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      title="Edit testimonial"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {endorsements.length > 6 && (
            <div className="flex items-center justify-center pt-1">
              {endorsementsVisible < endorsements.length ? (
                <button
                  onClick={() => setEndorsementsVisible((v) => Math.min(v + 6, endorsements.length))}
                  className="text-xs font-medium text-[hsl(var(--kf-accent1))] hover:underline transition-colors"
                >
                  Show more ({endorsements.length - endorsementsVisible} remaining)
                </button>
              ) : (
                <button
                  onClick={() => setEndorsementsVisible(6)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}

      {editingEndorsement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditingEndorsement(null)}>
          <div className="w-full max-w-md mx-4 kf-card rounded-2xl border border-border/50 p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Pencil className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Edit Testimonial
              </h3>
              <button onClick={() => setEditingEndorsement(null)} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Update your testimonial for the <span className="font-medium text-amber-400">{editingEndorsement.skill}</span> endorsement.
            </p>
            <textarea
              value={editMessage}
              onChange={e => setEditMessage(e.target.value)}
              placeholder="Write your testimonial..."
              rows={4}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 resize-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingEndorsement(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditEndorsement}
                disabled={savingEdit}
                className="px-4 py-2 rounded-xl text-xs font-medium kf-btn-primary disabled:opacity-50"
              >
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
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

      {endorseModalSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeEndorseModal}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="kf-card rounded-2xl border border-border/50 p-6 w-full max-w-md mx-4 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ThumbsUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Endorse Skill
              </h3>
              <button
                onClick={closeEndorseModal}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                You are endorsing <span className="font-medium text-foreground">{profile.name}</span> for:
              </p>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                {endorseModalSkill}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Add a testimonial <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <textarea
                value={endorseMessage}
                onChange={(e) => setEndorseMessage(e.target.value)}
                placeholder="Share your experience working with them on this skill..."
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50 resize-none"
              />
              <p className="text-[10px] text-muted-foreground text-right">{endorseMessage.length}/500</p>
            </div>

            {endorseError && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{endorseError}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={closeEndorseModal}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={submitEndorsement}
                disabled={!!endorsingSkill}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium kf-btn-primary transition-colors"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                {endorsingSkill ? "Endorsing..." : "Endorse"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {!isOwnProfile && myBusinessId && (
        <InteractionHistorySection businessId={myBusinessId} otherBusinessId={businessId} otherBusinessName={profile.name} />
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

      <QuoteRequestModal
        isOpen={showQuoteModal}
        onClose={() => setShowQuoteModal(false)}
        toBusinessName={profile.name}
        onSubmit={handleQuoteSubmit}
        myBusinessId={myBusinessId ?? undefined}
        toBusinessId={businessId}
        onViewProvider={(providerId) => {
          setShowQuoteModal(false);
          router.push(`/app/community/profile/${providerId}`);
        }}
      />
      <ReferralModal
        isOpen={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        toBusinessName={profile.name}
        onSubmit={handleReferralSubmit}
      />
      <CollaborationModal
        isOpen={showCollabModal}
        onClose={() => setShowCollabModal(false)}
        toBusinessName={profile.name}
        onSubmit={handleCollabSubmit}
      />
      {myBusinessId && (
        <MessageModal
          isOpen={showMessageModal}
          onClose={() => setShowMessageModal(false)}
          businessId={myBusinessId}
          otherBusinessId={businessId}
          otherBusinessName={profile.name}
          otherBusinessLogo={profile.logoUrl}
        />
      )}
    </motion.div>
  );
}

function ReviewStars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          style={{ width: size, height: size }}
          className={n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}

function ProfileReviewsSection({ businessId }: { businessId: string }) {
  const [reviews, setReviews] = useState<CommunityReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchBusinessReviews(businessId, 50)
      .then((res) => {
        if (cancelled) return;
        setReviews(res.data?.reviews ?? []);
        setTotal(res.data?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (loading) {
    return (
      <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 animate-pulse space-y-3">
        <div className="h-4 w-24 bg-muted/40 rounded" />
        <div className="h-16 bg-muted/20 rounded" />
      </motion.div>
    );
  }

  if (reviews.length === 0) return null;

  const visible = showAll ? reviews : reviews.slice(0, 3);

  return (
    <motion.div variants={fadeUp} className="kf-card rounded-xl p-5 border border-border/30 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
          Reviews
          <span className="text-xs text-muted-foreground font-normal">({total})</span>
        </h3>
      </div>
      <div className="space-y-3">
        {visible.map((r) => {
          const reviewerLogo = r.reviewerBusiness?.logoUrl
            ? r.reviewerBusiness.logoUrl.startsWith("http")
              ? r.reviewerBusiness.logoUrl
              : `${API_BASE}${r.reviewerBusiness.logoUrl}`
            : null;
          const reviewerInitials = r.reviewerBusiness?.name?.[0]?.toUpperCase() ?? "?";
          return (
            <div key={r.id} className="flex gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-sm font-bold overflow-hidden flex-shrink-0">
                {reviewerLogo ? (
                  <Image src={reviewerLogo} alt={r.reviewerBusiness?.name ?? "reviewer"} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                ) : (
                  reviewerInitials
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate">{r.reviewerBusiness?.name ?? "A business"}</span>
                    <ReviewStars value={r.rating} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </span>
                </div>
                {r.title && <p className="text-xs font-medium mt-1">{r.title}</p>}
                {r.body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.body}</p>}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="capitalize">{r.transactionType.replace("_", " ").toLowerCase()}</span>
                  {r.qualityRating ? <span>· Quality {r.qualityRating}/5</span> : null}
                  {r.communicationRating ? <span>· Comm {r.communicationRating}/5</span> : null}
                  {r.timelinessRating ? <span>· On-time {r.timelinessRating}/5</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {reviews.length > 3 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-[hsl(var(--kf-accent1))] hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${reviews.length} reviews`}
        </button>
      )}
    </motion.div>
  );
}
