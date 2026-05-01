"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Send } from "lucide-react";
import { fetchMessageThread, sendBusinessMessage, type BusinessMessageItem } from "@/lib/client";
import { API_BASE } from "@/lib/api";

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  otherBusinessId: string;
  otherBusinessName: string;
  otherBusinessLogo?: string;
}

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

export function MessageModal({ isOpen, onClose, businessId, otherBusinessId, otherBusinessName, otherBusinessLogo }: MessageModalProps) {
  const [messages, setMessages] = useState<BusinessMessageItem[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !businessId || !otherBusinessId) return;
    setLoading(true);
    fetchMessageThread(businessId, otherBusinessId)
      .then((res) => {
        if (res.data?.messages) setMessages(res.data.messages);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, businessId, otherBusinessId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      const res = await sendBusinessMessage(businessId, {
        toBusinessId: otherBusinessId,
        content: newMessage.trim(),
      });
      if (res.data) {
        setMessages((prev) => [...prev, res.data!]);
        setNewMessage("");
      }
    } catch {}
    setSending(false);
  };

  const resolvedLogo = otherBusinessLogo
    ? otherBusinessLogo.startsWith("http") ? otherBusinessLogo : `${API_BASE}${otherBusinessLogo}`
    : null;

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
            className="fixed inset-x-4 top-[5%] bottom-[5%] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-auto sm:w-full sm:max-w-md sm:h-[70vh]"
          >
            <div className="kf-card border border-border/50 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-full">
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-sm font-bold overflow-hidden">
                    {resolvedLogo ? (
                      <img src={resolvedLogo} alt={otherBusinessName} className="w-full h-full object-cover" />
                    ) : (
                      otherBusinessName[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{otherBusinessName}</h3>
                    <p className="text-[10px] text-muted-foreground">Direct message</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loading ? (
                  <div className="space-y-3 animate-pulse">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : ""}`}>
                        <div className="h-8 w-48 bg-muted/30 rounded-xl" />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.fromBusinessId === businessId;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? "justify-end" : ""}`}>
                        <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                          isMine
                            ? "bg-[hsl(var(--kf-accent1))] text-white rounded-br-md"
                            : "bg-muted/30 rounded-bl-md"
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <p className={`text-[9px] mt-1 ${isMine ? "text-white/60" : "text-muted-foreground/60"}`}>
                            {timeAgo(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="p-3 border-t border-border/30">
                <div className="flex gap-2">
                  <input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    placeholder="Type a message..."
                    className="flex-1 px-3 py-2 rounded-xl bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                    className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
