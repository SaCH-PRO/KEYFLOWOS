"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  MessageSquare,
  Lightbulb,
  X,
  Search,
} from "lucide-react";
import {
  fetchCommunityPosts,
  createCommunityPost,
  likeCommunityPost,
  fetchCommunityPost,
  addCommunityComment,
  fetchCohorts,
  joinCohort,
  leaveCohort,
  fetchMyCohorts,
  CommunityPost,
  CommunityComment,
  Cohort,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { Feed } from "./components/feed";
import { CohortList } from "./components/cohort-list";
import { ProfileCard } from "./components/profile-card";
import { Directory } from "./components/directory";
import { useRouter } from "next/navigation";

const COMMUNITY_TABS = [
  { key: "feed", label: "Feed", icon: MessageSquare, tooltip: "Community posts, discussions, and updates from other business owners." },
  { key: "directory", label: "Directory", icon: Search, tooltip: "Search and discover businesses in the network by industry, skills, and availability." },
  { key: "cohorts", label: "Cohorts", icon: Users, tooltip: "Join or browse peer groups organized by industry or business stage." },
];
const TAB_KEYS = COMMUNITY_TABS.map((t) => t.key);

export default function CommunityPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState("feed");
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [myCohorts, setMyCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("ALL");
  const [expandedPost, setExpandedPost] = useState<(CommunityPost & { comments?: CommunityComment[] }) | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [joiningCohort, setJoiningCohort] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [profileCardBusinessId, setProfileCardBusinessId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterType !== "ALL" ? { type: filterType } : undefined;
      const res = await fetchCommunityPosts(params);
      if (Array.isArray(res.data)) setPosts(res.data);
      else if (res.data && Array.isArray((res.data as any).data)) setPosts((res.data as any).data);
      else setPosts([]);
    } catch {}
    setLoading(false);
  }, [filterType]);

  const loadCohorts = useCallback(async () => {
    setLoading(true);
    try {
      const [cohortsRes, myCohortsRes] = await Promise.all([
        fetchCohorts(),
        businessId ? fetchMyCohorts(businessId) : Promise.resolve({ data: [] as Cohort[], error: null }),
      ]);
      if (cohortsRes.data) setCohorts(cohortsRes.data);
      if (myCohortsRes.data) setMyCohorts(myCohortsRes.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    if (tab === "feed") {
      void loadFeed();
    } else if (tab === "cohorts") {
      void loadCohorts();
    }
  }, [tab, loadFeed, loadCohorts]);

  const handleCreatePost = useCallback(async (data: { title: string; content: string; type: string; tags: string }) => {
    if (!businessId || !data.content.trim()) return;
    try {
      const tags = data.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await createCommunityPost(businessId, {
        title: data.title.trim() || undefined,
        content: data.content.trim(),
        type: data.type,
        tags,
      });
      if (res.data) {
        setPosts((prev) => [res.data!, ...prev]);
      }
    } catch {}
  }, [businessId]);

  const handleLike = useCallback(async (postId: string) => {
    try {
      const res = await likeCommunityPost(postId);
      if (res.data) {
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: (p.likes || 0) + 1 } : p)));
        setExpandedPost((prev) => (prev?.id === postId ? { ...prev, likes: (prev.likes || 0) + 1 } : prev));
      }
    } catch {}
  }, []);

  const handleExpandPost = useCallback(async (postId: string) => {
    try {
      const res = await fetchCommunityPost(postId);
      if (res.data) {
        setExpandedPost(res.data);
      }
    } catch {}
  }, []);

  const handleCollapsePost = useCallback(() => setExpandedPost(null), []);

  const handleAddComment = useCallback(async (text: string) => {
    if (!businessId || !expandedPost) return;
    setSubmittingComment(true);
    try {
      const res = await addCommunityComment(businessId, expandedPost.id, text);
      if (res.data) {
        setExpandedPost((prev) =>
          prev ? { ...prev, comments: [...(prev.comments || []), res.data!] } : prev
        );
        setPosts((prev) =>
          prev.map((p) =>
            p.id === expandedPost.id
              ? { ...p, _count: { comments: (p._count?.comments || 0) + 1 } }
              : p
          )
        );
      }
    } catch {}
    setSubmittingComment(false);
  }, [businessId, expandedPost]);

  const handleJoinCohort = useCallback(async (cohortId: string) => {
    if (!businessId) return;
    setJoiningCohort(cohortId);
    try {
      await joinCohort(businessId, cohortId);
      await loadCohorts();
    } catch {}
    setJoiningCohort(null);
  }, [businessId, loadCohorts]);

  const handleLeaveCohort = useCallback(async (cohortId: string) => {
    if (!businessId) return;
    setJoiningCohort(cohortId);
    try {
      await leaveCohort(businessId, cohortId);
      await loadCohorts();
    } catch {}
    setJoiningCohort(null);
  }, [businessId, loadCohorts]);

  const handleTabChange = useCallback((t: string) => {
    setTab(t);
  }, []);

  const handleViewProfile = useCallback((bizId: string) => {
    router.push(`/app/community/profile/${bizId}`);
  }, [router]);

  const communityShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Community Navigation",
      shortcuts: [
        { key: "1", description: "Feed tab", action: () => handleTabChange("feed") },
        { key: "2", description: "Directory tab", action: () => handleTabChange("directory") },
        { key: "3", description: "Cohorts tab", action: () => handleTabChange("cohorts") },
        { key: "n", description: "New post", action: () => { handleTabChange("feed"); } },
        { key: "r", description: "Refresh", action: () => { if (tab === "feed") void loadFeed(); else if (tab === "cohorts") void loadCohorts(); } },
        { key: "g", description: "Toggle guide", action: () => setShowGuide((p) => !p) },
        { key: "Escape", description: "Close expanded post", action: () => { if (expandedPost) setExpandedPost(null); if (showGuide) setShowGuide(false); } },
      ],
    },
  ], [handleTabChange, tab, loadFeed, loadCohorts, expandedPost, showGuide]);

  useKeyboardShortcuts(communityShortcuts);

  return (
    <WorkspaceShell
      icon={Users}
      title="Community"
      subtitle="Connect with fellow entrepreneurs"
      tabs={COMMUNITY_TABS}
      activeTab={tab}
      onTabChange={handleTabChange}
      tabLayoutId="community-tab"
      enableSwipe
      enableSlideAnimation
      headerRight={
        <button
          onClick={() => setShowGuide(!showGuide)}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
            showGuide
              ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
              : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
          }`}
          aria-label="Getting started guide"
          title="Getting started guide"
        >
          <Lightbulb className="w-3.5 h-3.5" />
        </button>
      }
    >
      <AnimatePresence>
        {showGuide && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-amber-400/10">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold">Getting Started</h4>
                  <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                </div>
                <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { step: "1", title: "Browse the Feed", desc: "Read posts from other business owners covering discussions, questions, wins, and resources." },
                  { step: "2", title: "Discover Businesses", desc: "Use the Directory to find businesses by industry, skills, availability, and location." },
                  { step: "3", title: "Engage", desc: "Like and comment on posts, follow businesses, and save them to your shortlist." },
                  { step: "4", title: "Complete Your Store Profile", desc: "Set your availability status, positioning statement, and preferred project types to attract opportunities." },
                ].map((item) => (
                  <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                    <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                      {item.step}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {tab === "feed" && (
        <Feed
          posts={posts}
          loading={loading}
          filterType={filterType}
          onFilterChange={setFilterType}
          expandedPost={expandedPost}
          onExpandPost={handleExpandPost}
          onCollapsePost={handleCollapsePost}
          onLike={handleLike}
          onCreatePost={handleCreatePost}
          onAddComment={handleAddComment}
          submittingComment={submittingComment}
          onAuthorClick={setProfileCardBusinessId}
        />
      )}

      {tab === "directory" && (
        <Directory onViewProfile={handleViewProfile} />
      )}

      {tab === "cohorts" && (
        <CohortList
          cohorts={cohorts}
          myCohorts={myCohorts}
          loading={loading}
          joiningCohort={joiningCohort}
          onJoin={handleJoinCohort}
          onLeave={handleLeaveCohort}
        />
      )}

      <ProfileCard
        businessId={profileCardBusinessId || ""}
        isOpen={!!profileCardBusinessId}
        onClose={() => setProfileCardBusinessId(null)}
      />
    </WorkspaceShell>
  );
}
