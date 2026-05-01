"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Loader2, MessageSquare, Handshake, Sparkles } from "lucide-react";
import {
  sendDirectMessage,
  createCollabRequest,
  draftAiIntroMessage,
} from "@/lib/client";

interface SendMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string | null;
  targetBusiness: { id: string; name: string; logoUrl?: string; headline?: string } | null;
  onMessageSent?: () => void;
}

export function SendMessageModal({ isOpen, onClose, businessId, targetBusiness, onMessageSent }: SendMessageModalProps) {
  const [mode, setMode] = useState<"message" | "collab">("message");
  const [content, setContent] = useState("");
  const [collabTitle, setCollabTitle] = useState("");
  const [collabType, setCollabType] = useState("COLLABORATION");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleAiDraft = useCallback(async () => {
    if (!businessId || !targetBusiness || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const goal: 'introduce' | 'collaborate' = mode === "collab" ? "collaborate" : "introduce";
      const res = await draftAiIntroMessage(businessId, targetBusiness.id, {
        goal,
        context: content.trim() || (mode === "collab" ? collabTitle.trim() : "") || undefined,
      });
      if (res.data?.draft) {
        setContent(res.data.draft);
      } else {
        setDraftError("Couldn't generate a draft");
      }
    } catch {
      setDraftError("Couldn't generate a draft");
    }
    setDrafting(false);
  }, [businessId, targetBusiness, mode, content, collabTitle, drafting]);

  const handleSend = useCallback(async () => {
    if (!businessId || !targetBusiness) return;
    setSending(true);

    try {
      if (mode === "message") {
        if (!content.trim()) { setSending(false); return; }
        const res = await sendDirectMessage(businessId, targetBusiness.id, content.trim());
        if (res.data && !('error' in res.data)) {
          setSuccess(true);
          setTimeout(() => { setSuccess(false); onClose(); setContent(""); onMessageSent?.(); }, 1200);
        }
      } else {
        if (!collabTitle.trim()) { setSending(false); return; }
        const res = await createCollabRequest(businessId, {
          toBusinessId: targetBusiness.id,
          type: collabType,
          title: collabTitle.trim(),
          message: content.trim() || undefined,
        });
        if (res.data && !('error' in res.data)) {
          setSuccess(true);
          setTimeout(() => { setSuccess(false); onClose(); setContent(""); setCollabTitle(""); onMessageSent?.(); }, 1200);
        }
      }
    } catch {}
    setSending(false);
  }, [businessId, targetBusiness, mode, content, collabTitle, collabType, onClose, onMessageSent]);

  if (!isOpen || !targetBusiness) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative kf-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 z-10"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                {targetBusiness.logoUrl ? (
                  <img src={targetBusiness.logoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  targetBusiness.name.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">{targetBusiness.name}</p>
                {targetBusiness.headline && (
                  <p className="text-[10px] text-muted-foreground">{targetBusiness.headline}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted/50 transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/30 border border-border mb-4">
            <button
              onClick={() => setMode("message")}
              className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "message" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              Message
            </button>
            <button
              onClick={() => setMode("collab")}
              className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "collab" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Handshake className="w-3 h-3" />
              Collaborate
            </button>
          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-8 text-center"
            >
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-400/10 flex items-center justify-center mb-3">
                <Send className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium">
                {mode === "message" ? "Message sent!" : "Request sent!"}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {mode === "collab" && (
                <>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Type</label>
                    <select
                      value={collabType}
                      onChange={(e) => setCollabType(e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
                    >
                      <option value="COLLABORATION">Collaboration</option>
                      <option value="REFERRAL">Referral</option>
                      <option value="PARTNERSHIP">Partnership</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Title</label>
                    <input
                      type="text"
                      value={collabTitle}
                      onChange={(e) => setCollabTitle(e.target.value)}
                      placeholder="e.g. Joint workshop opportunity"
                      className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                </>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {mode === "message" ? "Message" : "Details (optional)"}
                  </label>
                  <button
                    type="button"
                    onClick={handleAiDraft}
                    disabled={drafting}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors disabled:opacity-50"
                    title="Generate a personalised opener with AI"
                  >
                    {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {drafting ? "Drafting…" : (content.trim() ? "Refine with AI" : "Draft with AI")}
                  </button>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={mode === "message" ? "Write your message..." : "Add any details about this request..."}
                  className="w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))] min-h-[100px]"
                  rows={4}
                />
                {draftError && <p className="mt-1 text-[10px] text-destructive">{draftError}</p>}
              </div>
              <button
                onClick={handleSend}
                disabled={sending || (mode === "message" ? !content.trim() : !collabTitle.trim())}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-all"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {mode === "message" ? "Send Message" : "Send Request"}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
