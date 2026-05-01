"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  MessageSquare,
  Inbox,
} from "lucide-react";
import {
  fetchMessageThreads,
  type MessageThread,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { MessageModal } from "../components/message-modal";

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
  return `${days}d ago`;
}

export default function MessagesPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<{
    otherBusinessId: string;
    otherBusinessName: string;
    otherBusinessLogo?: string;
  } | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadThreads = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchMessageThreads(businessId);
      if (res.data) setThreads(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => router.push("/app/community")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Community
      </button>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10">
          <Inbox className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Messages</h1>
          <p className="text-xs text-muted-foreground">Your business-to-business conversations</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/20 rounded-xl" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Visit a business profile to start a conversation</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const biz = thread.otherBusiness;
            const logo = biz?.logoUrl
              ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
              : null;
            return (
              <motion.div
                key={thread.threadId}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                onClick={() => setActiveThread({
                  otherBusinessId: biz.id,
                  otherBusinessName: biz.name,
                  otherBusinessLogo: biz.logoUrl,
                })}
                className="kf-card rounded-xl p-3 border border-border/30 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-sm font-bold overflow-hidden flex-shrink-0">
                  {logo ? (
                    <img src={logo} alt={biz.name} className="w-full h-full object-cover" />
                  ) : (
                    biz.name[0]?.toUpperCase() || "?"
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold truncate">{biz.name}</h3>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {timeAgo(thread.lastMessage.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{thread.lastMessage.content}</p>
                </div>

                {thread.unreadCount > 0 && (
                  <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-white">{thread.unreadCount}</span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {businessId && activeThread && (
        <MessageModal
          isOpen={!!activeThread}
          onClose={() => {
            setActiveThread(null);
            void loadThreads();
          }}
          businessId={businessId}
          otherBusinessId={activeThread.otherBusinessId}
          otherBusinessName={activeThread.otherBusinessName}
          otherBusinessLogo={activeThread.otherBusinessLogo}
        />
      )}
    </div>
  );
}
