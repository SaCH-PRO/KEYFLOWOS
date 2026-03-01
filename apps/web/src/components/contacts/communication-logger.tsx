"use client";

import { useState } from "react";
import { Phone, Mail, MessageCircle, Users, MessageSquare, X, Clock, CheckCircle2, Loader2 } from "lucide-react";

const CHANNEL_TYPES = [
  { value: "call", label: "Call", icon: Phone, color: "text-violet-400", bg: "bg-violet-500/10" },
  { value: "email", label: "Email", icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { value: "meeting", label: "Meeting", icon: Users, color: "text-amber-400", bg: "bg-amber-500/10" },
  { value: "sms", label: "SMS", icon: MessageSquare, color: "text-pink-400", bg: "bg-pink-500/10" },
] as const;

const OUTCOMES: Record<string, { value: string; label: string }[]> = {
  call: [
    { value: "answered", label: "Answered" },
    { value: "voicemail", label: "Voicemail" },
    { value: "no-answer", label: "No Answer" },
  ],
  email: [
    { value: "sent", label: "Sent" },
    { value: "received", label: "Received" },
  ],
  whatsapp: [
    { value: "sent", label: "Sent" },
    { value: "received", label: "Received" },
  ],
  meeting: [
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "no-answer", label: "No Show" },
  ],
  sms: [
    { value: "sent", label: "Sent" },
    { value: "received", label: "Received" },
  ],
};

interface CommunicationLoggerProps {
  open: boolean;
  contactName?: string;
  onClose: () => void;
  onSubmit: (data: { channelType: string; outcome: string; duration?: number; notes?: string }) => Promise<void>;
}

export function CommunicationLogger({ open, contactName, onClose, onSubmit }: CommunicationLoggerProps) {
  const [channelType, setChannelType] = useState("call");
  const [outcome, setOutcome] = useState("answered");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const outcomes = OUTCOMES[channelType] ?? OUTCOMES.call;
  const showDuration = channelType === "call" || channelType === "meeting";

  const handleChannelChange = (ch: string) => {
    setChannelType(ch);
    const firstOutcome = OUTCOMES[ch]?.[0]?.value ?? "answered";
    setOutcome(firstOutcome);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        channelType,
        outcome,
        duration: showDuration && duration ? Number(duration) : undefined,
        notes: notes.trim() || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setChannelType("call");
        setOutcome("answered");
        setDuration("");
        setNotes("");
        onClose();
      }, 1200);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border/50 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div>
            <h3 className="text-base font-semibold">Log Interaction</h3>
            {contactName && <p className="text-xs text-muted-foreground mt-0.5">with {contactName}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {success ? (
          <div className="p-8 flex flex-col items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-400">Interaction logged!</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Channel</label>
              <div className="grid grid-cols-5 gap-1.5">
                {CHANNEL_TYPES.map((ch) => {
                  const Icon = ch.icon;
                  const isActive = channelType === ch.value;
                  return (
                    <button
                      key={ch.value}
                      onClick={() => handleChannelChange(ch.value)}
                      className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl text-[10px] font-medium transition-all ${
                        isActive
                          ? `${ch.bg} ${ch.color} ring-1 ring-current/30`
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {ch.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Outcome</label>
              <div className="flex flex-wrap gap-1.5">
                {outcomes.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setOutcome(o.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      outcome === o.value
                        ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] ring-1 ring-[hsl(var(--kf-accent1))]/30"
                        : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {showDuration && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  max="480"
                  placeholder="e.g. 15"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="kf-input w-full text-sm"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Notes (optional)</label>
              <textarea
                placeholder="What was discussed? Key takeaways..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="kf-input w-full min-h-[80px] resize-none text-sm"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/90 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging...
                </>
              ) : (
                "Log Interaction"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
