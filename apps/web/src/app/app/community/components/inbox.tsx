"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Circle,
  Loader2,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";
import {
  fetchConversations,
  fetchConversationMessages,
  sendDirectMessage,
  type ConversationSummary,
  type DirectMessageItem,
} from "@/lib/client";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface InboxProps {
  businessId: string | null;
  openConversationWith?: string | null;
  onClearOpenWith?: () => void;
}

export function Inbox({ businessId, openConversationWith, onClearOpenWith }: InboxProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [otherBusiness, setOtherBusiness] = useState<{ id: string; name: string; logoUrl?: string; headline?: string } | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchConversations(businessId);
      if (res.data) setConversations(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void loadConversations();
  }, [loadConversations]);

  const openConversation = useCallback(async (conversationId: string) => {
    if (!businessId) return;
    setActiveConversation(conversationId);
    setLoadingMessages(true);
    try {
      const res = await fetchConversationMessages(businessId, conversationId);
      if (res.data && !('error' in res.data)) {
        setMessages(res.data.messages);
        setOtherBusiness(res.data.otherBusiness);
      }
    } catch {}
    setLoadingMessages(false);
  }, [businessId]);

  useEffect(() => {
    if (openConversationWith && businessId && conversations.length > 0) {
      const existingConv = conversations.find((c) => c.otherBusiness.id === openConversationWith);
      if (existingConv) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
        openConversation(existingConv.id);
      }
      onClearOpenWith?.();
    }
  }, [openConversationWith, businessId, conversations, openConversation, onClearOpenWith]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!businessId || !otherBusiness || !newMessage.trim() || sending) return;
    setSending(true);
    try {
      const res = await sendDirectMessage(businessId, otherBusiness.id, newMessage.trim());
      if (res.data && !('error' in res.data)) {
        setMessages((prev) => [...prev, res.data!]);
        setNewMessage("");
        void loadConversations();
      }
    } catch {}
    setSending(false);
  }, [businessId, otherBusiness, newMessage, sending, loadConversations]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (activeConversation && otherBusiness) {
    return (
      <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
        <div className="flex items-center gap-3 p-3 border-b border-border">
          <button
            onClick={() => { setActiveConversation(null); setMessages([]); setOtherBusiness(null); }}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
            {otherBusiness.logoUrl ? (
              <Image src={otherBusiness.logoUrl} alt="" className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
            ) : (
              otherBusiness.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{otherBusiness.name}</p>
            {otherBusiness.headline && (
              <p className="text-[10px] text-muted-foreground truncate">{otherBusiness.headline}</p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingMessages ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Start the conversation by sending a message below.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.senderBusinessId === businessId;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      isMine
                        ? "bg-[hsl(var(--kf-accent1))] text-white rounded-br-md"
                        : "kf-card border border-border rounded-bl-md"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${isMine ? "text-white/60" : "text-muted-foreground"}`}>
                      {timeAgo(msg.createdAt)}
                    </p>
                  </div>
                </motion.div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-border">
          <div className="flex items-end gap-2">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))] min-h-[40px] max-h-[120px]"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!newMessage.trim() || sending}
              className="p-2.5 rounded-xl bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 disabled:opacity-40 transition-all"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="kf-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-2.5 bg-muted rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Visit a business profile in the Directory and send them a message to start a conversation."
        />
      ) : (
        <AnimatePresence mode="popLayout">
          {conversations.map((conv, i) => (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => openConversation(conv.id)}
              className="w-full kf-card border border-border rounded-xl p-3.5 hover:border-[hsl(var(--kf-accent1))]/30 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                  {conv.otherBusiness.logoUrl ? (
                    <Image src={conv.otherBusiness.logoUrl} alt="" className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                  ) : (
                    conv.otherBusiness.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
                      {conv.otherBusiness.name}
                    </p>
                    {conv.lastMessage && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {timeAgo(conv.lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  {conv.lastMessage ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {!conv.lastMessage.isMine && !conv.lastMessage.readAt && (
                        <Circle className="w-2 h-2 fill-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))] flex-shrink-0" />
                      )}
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.lastMessage.isMine ? "You: " : ""}
                        {conv.lastMessage.content}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic mt-0.5">No messages yet</p>
                  )}
                </div>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
