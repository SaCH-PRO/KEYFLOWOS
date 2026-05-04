"use client";

import { useEffect, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SideSheet } from "@/components/ui/side-sheet";
import { EmailEditor } from "@/app/app/marketing/components/email-editor";
import { apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

export interface ComposePrefill {
  to?: string;
  subject?: string;
  body?: string;
  threadId?: string;
  inReplyTo?: string;
}

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  prefill?: ComposePrefill;
  onSent?: () => void;
}

export function ComposeModal({ open, onClose, prefill, onSent }: ComposeModalProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setTo(prefill?.to ?? "");
      setSubject(prefill?.subject ?? "");
      setBody(prefill?.body ?? "");
    }
  }, [open, prefill]);

  const isReply = Boolean(prefill?.threadId && prefill?.inReplyTo);

  const handleSend = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      toast.error("No business selected");
      return;
    }
    if (!to.trim()) {
      toast.error("Recipient is required");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (!body.trim() || body === "<p></p>") {
      toast.error("Message body is empty");
      return;
    }

    setSending(true);
    try {
      const path = isReply
        ? `/commerce/businesses/${businessId}/gmail/threads/${prefill!.threadId}/reply`
        : `/commerce/businesses/${businessId}/gmail/messages/send`;
      const payload = isReply
        ? { inReplyTo: prefill!.inReplyTo, to, subject, htmlBody: body }
        : { to, subject, htmlBody: body };

      const res = await apiPostSimple<{ messageId: string }>(path, payload);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(isReply ? "Reply sent" : "Email sent");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={isReply ? "Reply" : "New message"}
      subtitle={isReply ? prefill?.subject : "Compose a Gmail message"}
      width="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-3 py-1.5 text-xs kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium kf-radius-md disabled:opacity-50"
            style={{
              background: "hsl(var(--kf-accent1))",
              color: "hsl(var(--kf-primary-foreground))",
            }}
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? "Sending…" : isReply ? "Send reply" : "Send"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">To</label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            disabled={isReply}
            className="w-full px-3 py-2 text-sm bg-muted/30 border border-border/40 kf-radius-md focus:outline-none focus:border-border disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full px-3 py-2 text-sm bg-muted/30 border border-border/40 kf-radius-md focus:outline-none focus:border-border"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Message</label>
          <EmailEditor value={body} onChange={setBody} placeholder="Write your message…" />
        </div>
      </div>
    </SideSheet>
  );
}
