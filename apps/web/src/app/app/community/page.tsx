"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  MessageSquare,
  Heart,
  Send,
  Plus,
  X,
  Trophy,
  HelpCircle,
  BookOpen,
  MessageCircle,
  Tag,
  ChevronLeft,
  UserPlus,
  UserMinus,
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

const POST_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof MessageSquare }> = {
  DISCUSSION: { label: "Discussion", color: "text-blue-400", bg: "bg-blue-500/20", icon: MessageCircle },
  QUESTION: { label: "Question", color: "text-purple-400", bg: "bg-purple-500/20", icon: HelpCircle },
  WIN: { label: "Win", color: "text-amber-400", bg: "bg-amber-500/20", icon: Trophy },
  RESOURCE: { label: "Resource", color: "text-emerald-400", bg: "bg-emerald-500/20", icon: BookOpen },
};

const POST_TYPES = ["ALL", "DISCUSSION", "QUESTION", "WIN", "RESOURCE"];

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

export default function CommunityPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "cohorts">("feed");
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [myCohorts, setMyCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("ALL");
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostType, setNewPostType] = useState("DISCUSSION");
  const [newPostTags, setNewPostTags] = useState("");
  const [posting, setPosting] = useState(false);
  const [expandedPost, setExpandedPost] = useState<(CommunityPost & { comments?: CommunityComment[] }) | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [joiningCohort, setJoiningCohort] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterType !== "ALL" ? { type: filterType } : undefined;
      const res = await fetchCommunityPosts(params);
      if (res.data) setPosts(res.data);
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
    } else {
      void loadCohorts();
    }
  }, [tab, loadFeed, loadCohorts]);

  const handleCreatePost = async () => {
    if (!businessId || !newPostContent.trim()) return;
    setPosting(true);
    try {
      const tags = newPostTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await createCommunityPost(businessId, {
        title: newPostTitle.trim() || undefined,
        content: newPostContent.trim(),
        type: newPostType,
        tags,
      });
      if (res.data) {
        setPosts((prev) => [res.data!, ...prev]);
      }
      setNewPostTitle("");
      setNewPostContent("");
      setNewPostType("DISCUSSION");
      setNewPostTags("");
      setShowNewPost(false);
    } catch {}
    setPosting(false);
  };

  const handleLike = async (postId: string) => {
    try {
      const res = await likeCommunityPost(postId);
      if (res.data) {
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: (p.likes || 0) + 1 } : p)));
        if (expandedPost?.id === postId) {
          setExpandedPost((prev) => (prev ? { ...prev, likes: (prev.likes || 0) + 1 } : prev));
        }
      }
    } catch {}
  };

  const handleExpandPost = async (postId: string) => {
    try {
      const res = await fetchCommunityPost(postId);
      if (res.data) {
        setExpandedPost(res.data);
      }
    } catch {}
  };

  const handleAddComment = async () => {
    if (!businessId || !expandedPost || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await addCommunityComment(businessId, expandedPost.id, commentText.trim());
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
        setCommentText("");
      }
    } catch {}
    setSubmittingComment(false);
  };

  const handleJoinCohort = async (cohortId: string) => {
    if (!businessId) return;
    setJoiningCohort(cohortId);
    try {
      await joinCohort(businessId, cohortId);
      await loadCohorts();
    } catch {}
    setJoiningCohort(null);
  };

  const handleLeaveCohort = async (cohortId: string) => {
    if (!businessId) return;
    setJoiningCohort(cohortId);
    try {
      await leaveCohort(businessId, cohortId);
      await loadCohorts();
    } catch {}
    setJoiningCohort(null);
  };

  const myCohortIds = new Set(myCohorts.map((c) => c.id));

  if (expandedPost) {
    const typeConfig = POST_TYPE_CONFIG[expandedPost.type] || POST_TYPE_CONFIG.DISCUSSION;
    const TypeIcon = typeConfig.icon;
    return (
      <div className="space-y-4">
        <button
          onClick={() => setExpandedPost(null)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Feed
        </button>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {expandedPost.business?.name?.[0] || "?"}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{expandedPost.business?.name || "Anonymous"}</p>
              <p className="text-xs text-muted-foreground">{timeAgo(expandedPost.createdAt)}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeConfig.bg} ${typeConfig.color} flex items-center gap-1`}>
              <TypeIcon className="w-3 h-3" />
              {typeConfig.label}
            </span>
          </div>

          {expandedPost.title && <h2 className="text-lg font-semibold">{expandedPost.title}</h2>}
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{expandedPost.content}</p>

          {expandedPost.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {expandedPost.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 pt-2 border-t border-white/10">
            <button
              onClick={() => handleLike(expandedPost.id)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
            >
              <Heart className="w-4 h-4" />
              {expandedPost.likes || 0}
            </button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="w-4 h-4" />
              {expandedPost.comments?.length || 0} comments
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Comments</h3>
          {expandedPost.comments?.length ? (
            expandedPost.comments.map((comment) => (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold">
                    {comment.business?.name?.[0] || "?"}
                  </div>
                  <span className="text-xs font-medium">{comment.business?.name || "Anonymous"}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                </div>
                <p className="text-sm text-muted-foreground pl-8">{comment.content}</p>
              </motion.div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No comments yet. Be the first!</p>
          )}

          <div className="flex gap-2">
            <input
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
            />
            <button
              onClick={handleAddComment}
              disabled={submittingComment || !commentText.trim()}
              className="kf-btn-primary px-3 py-2 rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-6 md:p-8"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.1))",
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-8 h-8" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Community</h1>
        </div>
        <p className="text-muted-foreground">Connect with fellow entrepreneurs</p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 pb-0">
        {(["feed", "cohorts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "feed" ? "Feed" : "Cohorts"}
            {tab === t && (
              <motion.div
                layoutId="community-tab"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: "hsl(var(--kf-accent1))" }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === "feed" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1 flex-wrap">
              {POST_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filterType === type
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {type === "ALL" ? "All" : POST_TYPE_CONFIG[type]?.label || type}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setNewPostType("WIN");
                  setShowNewPost(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
              >
                <Trophy className="w-3 h-3" />
                Share a Win
              </button>
              <button
                onClick={() => {
                  setNewPostType("QUESTION");
                  setShowNewPost(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
              >
                <HelpCircle className="w-3 h-3" />
                Ask a Question
              </button>
              <button
                onClick={() => setShowNewPost(true)}
                className="kf-btn-primary flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                New Post
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showNewPost && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">New Post</h3>
                    <button onClick={() => setShowNewPost(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    placeholder="Title (optional)"
                    value={newPostTitle}
                    onChange={(e) => setNewPostTitle(e.target.value)}
                    className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
                  />
                  <textarea
                    placeholder="What's on your mind?"
                    value={newPostContent}
                    onChange={(e) => setNewPostContent(e.target.value)}
                    rows={4}
                    className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20 resize-none"
                  />
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Type:</span>
                      {Object.entries(POST_TYPE_CONFIG).map(([key, config]) => (
                        <button
                          key={key}
                          onClick={() => setNewPostType(key)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                            newPostType === key ? `${config.bg} ${config.color}` : "bg-white/5 text-muted-foreground"
                          }`}
                        >
                          {config.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    placeholder="Tags (comma separated)"
                    value={newPostTags}
                    onChange={(e) => setNewPostTags(e.target.value)}
                    className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleCreatePost}
                      disabled={posting || !newPostContent.trim()}
                      className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {posting ? "Posting..." : "Post"}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 h-32 animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-8 text-center">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No posts yet. Start the conversation!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post, i) => {
                const typeConfig = POST_TYPE_CONFIG[post.type] || POST_TYPE_CONFIG.DISCUSSION;
                const TypeIcon = typeConfig.icon;
                return (
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => handleExpandPost(post.id)}
                    className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3 cursor-pointer hover:bg-white/[0.07] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
                        {post.business?.name?.[0] || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{post.business?.name || "Anonymous"}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeConfig.bg} ${typeConfig.color} flex items-center gap-1`}>
                        <TypeIcon className="w-3 h-3" />
                        {typeConfig.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
                    </div>

                    {post.title && <h3 className="text-sm font-semibold">{post.title}</h3>}
                    <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>

                    {post.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {post.tags.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground flex items-center gap-0.5">
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLike(post.id);
                        }}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Heart className="w-3.5 h-3.5" />
                        {post.likes || 0}
                      </button>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {post._count?.comments || 0}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "cohorts" && (
        <div className="space-y-6">
          {myCohorts.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                My Cohorts
              </h2>
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {myCohorts.map((cohort) => (
                  <motion.div
                    key={cohort.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3"
                  >
                    <h3 className="text-sm font-semibold">{cohort.name}</h3>
                    {cohort.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{cohort.description}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {cohort._count?.members ?? 0} / {cohort.maxMembers}
                        </span>
                        {cohort.industry && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                            {cohort.industry}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleLeaveCohort(cohort.id)}
                        disabled={joiningCohort === cohort.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        <UserMinus className="w-3 h-3" />
                        Leave
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">All Cohorts</h2>
            {loading ? (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 h-36 animate-pulse" />
                ))}
              </div>
            ) : cohorts.length === 0 ? (
              <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-8 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No cohorts available yet</p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {cohorts.map((cohort, i) => {
                  const isMember = myCohortIds.has(cohort.id);
                  const isFull = (cohort._count?.members ?? 0) >= cohort.maxMembers;
                  return (
                    <motion.div
                      key={cohort.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3"
                    >
                      <h3 className="text-sm font-semibold">{cohort.name}</h3>
                      {cohort.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{cohort.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {cohort._count?.members ?? 0} / {cohort.maxMembers}
                          </span>
                          {cohort.industry && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                              {cohort.industry}
                            </span>
                          )}
                        </div>
                        {isMember ? (
                          <span className="text-xs text-green-400 font-medium">Joined</span>
                        ) : (
                          <button
                            onClick={() => handleJoinCohort(cohort.id)}
                            disabled={isFull || joiningCohort === cohort.id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                          >
                            <UserPlus className="w-3 h-3" />
                            {isFull ? "Full" : "Join"}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
