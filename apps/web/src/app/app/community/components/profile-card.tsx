"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Briefcase,
  Calendar,
  MessageSquare,
  Users,
  ExternalLink,
  Sparkles,
  CheckCircle,
  Clock,
  Store,
  ShoppingBag,
  Send,
  Bookmark,
  ShieldCheck,
  Award,
  Star,
} from "lucide-react";
import { fetchCommunityProfile, fetchTrustSignals, type CommunityProfile, type TrustSignals } from "@/lib/client";
import { API_BASE } from "@/lib/api";
import { useRouter } from "next/navigation";

interface ProfileCardProps {
  businessId: string;
  isOpen: boolean;
  onClose: () => void;
}

function CapacityBadge({ capacity, accepting }: { capacity?: string; accepting: boolean }) {
  if (!accepting) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400">
        <X className="w-2.5 h-2.5" /> Not Accepting Work
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
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.color}`}>
      <CheckCircle className="w-2.5 h-2.5" /> {c.label}
    </span>
  );
}

function ReputationBadge({ score }: { score: number }) {
  let color = "text-zinc-400";
  let bg = "bg-zinc-500/15";
  if (score >= 80) { color = "text-emerald-400"; bg = "bg-emerald-500/15"; }
  else if (score >= 60) { color = "text-blue-400"; bg = "bg-blue-500/15"; }
  else if (score >= 40) { color = "text-amber-400"; bg = "bg-amber-500/15"; }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${bg} ${color}`}>
      <Star className="w-2.5 h-2.5" /> {score} Rep
    </span>
  );
}

function BadgeIcon({ icon }: { icon: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    "shield-check": <ShieldCheck className="w-3 h-3" />,
    "store": <Store className="w-3 h-3" />,
    "message-square": <MessageSquare className="w-3 h-3" />,
    "users": <Users className="w-3 h-3" />,
    "award": <Award className="w-3 h-3" />,
    "graduation-cap": <Sparkles className="w-3 h-3" />,
  };
  return <>{iconMap[icon] || <CheckCircle className="w-3 h-3" />}</>;
}

export function ProfileCard({ businessId, isOpen, onClose }: ProfileCardProps) {
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [trustSignals, setTrustSignals] = useState<TrustSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!isOpen || !businessId) return;
    setProfile(null);
    setTrustSignals(null);
    setLoading(true);
    Promise.all([
      fetchCommunityProfile(businessId),
      fetchTrustSignals(businessId),
    ])
      .then(([profileRes, trustRes]) => {
        if (profileRes.data) setProfile(profileRes.data);
        if (trustRes.data) setTrustSignals(trustRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, businessId]);

  const resolvedLogo = profile?.logoUrl
    ? profile.logoUrl.startsWith("http") ? profile.logoUrl : `${API_BASE}${profile.logoUrl}`
    : null;

  const initials = profile?.name?.[0]?.toUpperCase() || "?";

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  const topOffering = profile?.services?.[0] || profile?.products?.[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-[10%] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-auto sm:w-full sm:max-w-md"
          >
            <div className="kf-card border border-border/50 rounded-2xl overflow-hidden shadow-2xl max-h-[80vh] overflow-y-auto">
              <div className="relative h-24 bg-gradient-to-br from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent1))]/60 to-[hsl(var(--kf-accent2))]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15),transparent_50%)]" />
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loading ? (
                <div className="px-6 pb-6 -mt-10 space-y-4 animate-pulse">
                  <div className="w-20 h-20 rounded-2xl bg-muted/40 border-4 border-background" />
                  <div className="h-5 w-40 bg-muted/40 rounded" />
                  <div className="h-3 w-60 bg-muted/30 rounded" />
                  <div className="h-16 bg-muted/20 rounded-xl" />
                </div>
              ) : profile ? (
                <div className="px-6 pb-6 -mt-10 space-y-4">
                  <div className="flex items-end gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-2xl font-bold overflow-hidden border-4 border-background shadow-lg flex-shrink-0">
                      {resolvedLogo ? (
                        <img src={resolvedLogo} alt={profile.name} className="w-full h-full object-cover" />
                      ) : (
                        initials
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-lg font-bold truncate">{profile.name}</h3>
                        {trustSignals?.isVerified ? (
                          <span title="Verified Provider" className="flex-shrink-0">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          </span>
                        ) : trustSignals && trustSignals.badges.some(b => b.id === 'complete_profile') ? (
                          <ShieldCheck className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        ) : null}
                      </div>
                      {profile.headline && (
                        <p className="text-sm text-muted-foreground truncate">{profile.headline}</p>
                      )}
                      {trustSignals && (trustSignals.totalReviews ?? 0) > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span className="text-xs font-semibold">{(trustSignals.averageRating ?? 0).toFixed(1)}</span>
                          <span className="text-[10px] text-muted-foreground">
                            ({trustSignals.totalReviews} review{trustSignals.totalReviews === 1 ? "" : "s"})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <CapacityBadge capacity={profile.currentCapacity} accepting={profile.acceptingWork} />
                    {trustSignals && trustSignals.reputationScore > 0 && (
                      <ReputationBadge score={trustSignals.reputationScore} />
                    )}
                    {profile.leadTime && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                        <Clock className="w-2.5 h-2.5" /> {profile.leadTime}
                      </span>
                    )}
                  </div>

                  {trustSignals && ((trustSignals.totalCompleted ?? 0) > 0 || (trustSignals.onTimeRate ?? 0) > 0) && (
                    <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-white/5">
                      <div className="text-center">
                        <div className="text-sm font-bold">{trustSignals.totalCompleted ?? 0}</div>
                        <div className="text-[9px] text-muted-foreground">completed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold">{Math.round((trustSignals.onTimeRate ?? 0) * 100)}%</div>
                        <div className="text-[9px] text-muted-foreground">on time</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold">{Math.round((trustSignals.repeatClientRate ?? 0) * 100)}%</div>
                        <div className="text-[9px] text-muted-foreground">repeat</div>
                      </div>
                    </div>
                  )}

                  {trustSignals && trustSignals.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {trustSignals.badges.map((badge) => (
                        <span
                          key={badge.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                          title={badge.label}
                        >
                          <BadgeIcon icon={badge.icon} />
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {profile.positioningStatement && (
                    <p className="text-sm text-muted-foreground leading-relaxed italic border-l-2 border-[hsl(var(--kf-accent1))]/30 pl-3">
                      {profile.positioningStatement}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {profile.industry && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium">
                        <Briefcase className="w-3 h-3" />
                        {profile.industry}
                      </span>
                    )}
                    {(profile.city || profile.country) && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/30 text-muted-foreground text-xs">
                        <MapPin className="w-3 h-3" />
                        {[profile.city, profile.country].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {profile.businessStage && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                        <Sparkles className="w-3 h-3" />
                        {profile.businessStage}
                      </span>
                    )}
                  </div>

                  {profile.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.skills.slice(0, 6).map((skill) => (
                        <span key={skill} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 text-muted-foreground border border-white/5">
                          {skill}
                          {trustSignals?.topEndorsedSkills.some(s => s.skill === skill) && (
                            <Award className="w-2 h-2 inline ml-0.5 text-amber-400" />
                          )}
                        </span>
                      ))}
                      {profile.skills.length > 6 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground">
                          +{profile.skills.length - 6} more
                        </span>
                      )}
                    </div>
                  )}

                  {topOffering && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
                      <Store className="w-4 h-4 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{topOffering.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {topOffering.currency} {topOffering.price.toLocaleString()}
                        </p>
                      </div>
                      {((profile.products?.length || 0) + (profile.services?.length || 0)) > 1 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{(profile.products?.length || 0) + (profile.services?.length || 0) - 1} more
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/30">
                    <div className="text-center">
                      <div className="text-lg font-bold">{profile._count?.communityPosts || 0}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <MessageSquare className="w-3 h-3" /> Posts
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold">{profile._count?.networkConnectionsTo || 0}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <Users className="w-3 h-3" /> Followers
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold">{trustSignals?.endorsementCount || 0}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <Award className="w-3 h-3" /> Endorsed
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground mt-1.5 flex items-center justify-center gap-1">
                        <Calendar className="w-3 h-3" /> Joined
                      </div>
                      <div className="text-xs font-medium">{memberSince}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {profile.slug && (
                      <button
                        onClick={() => {
                          onClose();
                          router.push(`/book/${profile.slug}`);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] text-xs font-medium transition-colors"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        View Store
                      </button>
                    )}
                    {profile.slug && (
                      <button
                        onClick={() => {
                          onClose();
                          router.push(`/book/${profile.slug}?action=book`);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] text-xs font-medium transition-colors"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Book Service
                      </button>
                    )}
                    {profile.slug && (
                      <button
                        onClick={() => {
                          onClose();
                          router.push(`/book/${profile.slug}?action=quote`);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-xs font-medium transition-colors border border-white/10"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Request Quote
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onClose();
                        router.push(`/app/community?message=${profile.id}`);
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-xs font-medium transition-colors border border-white/10"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Send Message
                    </button>
                    <button
                      onClick={() => {
                        onClose();
                        router.push(`/app/community/profile/${profile.id}`);
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-xs font-medium transition-colors border border-white/10 col-span-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Full Profile
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-6 pb-6 -mt-10">
                  <p className="text-sm text-muted-foreground">Profile not found</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
