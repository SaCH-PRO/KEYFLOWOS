"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Mail, Phone, Instagram, Facebook, Check, X, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMessageIntake,
  approveMessageIntake,
  rejectMessageIntake,
  type MessageIntakeItem,
} from "@/lib/api/message-intake";

interface MessageIntakeQueueProps {
  businessId: string;
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  email: Mail,
  sms: Phone,
  instagram: Instagram,
  messenger: Facebook,
};

function statusBadge(status: MessageIntakeItem["status"]) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-600",
    extracted: "bg-blue-500/10 text-blue-600",
    reviewing: "bg-purple-500/10 text-purple-600",
    approved: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-slate-500/10 text-slate-600",
    error: "bg-rose-500/10 text-rose-600",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function formatSummary(item: MessageIntakeItem): string {
  const plan = item.proposedActions as { summary?: string } | null;
  if (plan?.summary) return plan.summary;
  if (item.intentType) {
    return `${item.intentType.replace(/_/g, " ")} (${Math.round((item.confidence ?? 0) * 100)}% confidence)`;
  }
  return "Processing...";
}

export function MessageIntakeQueue({ businessId }: MessageIntakeQueueProps) {
  const [items, setItems] = useState<MessageIntakeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const res = await fetchMessageIntake(businessId, {
      status: "reviewing",
      sourceChannel: filterChannel || undefined,
      limit: 50,
    });
    if (res.data) setItems(res.data.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [businessId, filterChannel]);

  const handleApprove = async (id: string) => {
    setActionId(id);
    try {
      const res = await approveMessageIntake(businessId, id);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Message actions applied");
        await load();
      }
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionId(id);
    try {
      const res = await rejectMessageIntake(businessId, id);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Message intake rejected");
        await load();
      }
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Message Intake Queue
        </h2>
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs text-foreground/70"
        >
          <option value="">All channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="instagram">Instagram</option>
          <option value="messenger">Messenger</option>
        </select>
      </div>

      {loading && items.length === 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading message intake...
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No messages waiting for approval. When message intake is enabled, inbound messages from connected channels will appear here.
        </p>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const Icon = CHANNEL_ICONS[item.sourceChannel] ?? MessageSquare;
          const sender = item.contact
            ? `${item.contact.firstName ?? ""} ${item.contact.lastName ?? ""}`.trim() || item.contact.email || item.contact.phone || item.from
            : item.fromName || item.from;
          return (
            <div
              key={item.id}
              className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="w-3 h-3 text-muted-foreground" />
                    <p className="text-xs font-medium truncate">{sender}</p>
                  </div>
                  {item.subject && <p className="text-[10px] text-muted-foreground truncate">{item.subject}</p>}
                  <p className="text-xs text-foreground/80 line-clamp-2 mt-1">{item.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatSummary(item)}</p>
                  {item.errorMessage && (
                    <p className="text-[10px] text-rose-500 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" /> {item.errorMessage}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge(item.status)}`}>
                  {item.status}
                </span>
              </div>

              {item.status === "reviewing" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApprove(item.id)}
                    disabled={actionId === item.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {actionId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    disabled={actionId === item.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-rose-500 text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
