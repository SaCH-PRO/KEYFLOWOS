"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Send,
  Pencil,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { EmailCampaign } from "@/lib/client";

interface CampaignActionQueueProps {
  campaigns: EmailCampaign[];
  onEdit: (campaign: EmailCampaign) => void;
  onSend: (id: string) => void;
  onAiWrite: () => void;
}

interface QueueSection {
  key: string;
  label: string;
  color: string;
  colorBg: string;
  items: { campaign: EmailCampaign; description: string }[];
  actionLabel: string;
  actionIcon: React.ElementType;
  onAction: (campaign: EmailCampaign) => void;
}

export const CampaignActionQueue = React.memo(function CampaignActionQueue({
  campaigns,
  onEdit,
  onSend,
  onAiWrite,
}: CampaignActionQueueProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const queues = useMemo<QueueSection[]>(() => {
    const readyToSend = campaigns.filter(
      (c) =>
        c.status === "DRAFT" &&
        c.name?.trim() &&
        c.subject?.trim() &&
        c.body?.trim() &&
        c.totalRecipients > 0
    );

    const needsContent = campaigns.filter(
      (c) => c.status === "DRAFT" && (!c.body || !c.body.trim())
    );

    const lowEngagement = campaigns.filter((c) => {
      if (c.status !== "SENT" || c.totalRecipients === 0) return false;
      const openRate = c.openCount / c.totalRecipients;
      return openRate < 0.15;
    });

    const sections: QueueSection[] = [];

    if (readyToSend.length > 0) {
      sections.push({
        key: "ready",
        label: "Ready to Send",
        color: "#10b981",
        colorBg: "#10b98120",
        items: readyToSend.map((c) => ({
          campaign: c,
          description: `${c.totalRecipients} recipients`,
        })),
        actionLabel: "Send",
        actionIcon: Send,
        onAction: (c) => onSend(c.id),
      });
    }

    if (needsContent.length > 0) {
      sections.push({
        key: "content",
        label: "Needs Content",
        color: "#f59e0b",
        colorBg: "#f59e0b20",
        items: needsContent.map((c) => ({
          campaign: c,
          description: "Missing email body",
        })),
        actionLabel: "AI Write",
        actionIcon: Sparkles,
        onAction: () => onAiWrite(),
      });
    }

    if (lowEngagement.length > 0) {
      sections.push({
        key: "engagement",
        label: "Low Engagement",
        color: "#ef4444",
        colorBg: "#ef444420",
        items: lowEngagement.map((c) => {
          const rate =
            c.totalRecipients > 0
              ? ((c.openCount / c.totalRecipients) * 100).toFixed(1)
              : "0";
          return {
            campaign: c,
            description: `${rate}% open rate`,
          };
        }),
        actionLabel: "Edit",
        actionIcon: Pencil,
        onAction: (c) => onEdit(c),
      });
    }

    return sections;
  }, [campaigns, onEdit, onSend, onAiWrite]);

  if (queues.length === 0) return null;

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="kf-card border border-border/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border/20">
        <AlertTriangle className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-sm font-semibold">Campaign Actions</span>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: "hsl(var(--kf-accent1) / 0.15)",
            color: "hsl(var(--kf-accent1))",
          }}
        >
          {queues.reduce((sum, q) => sum + q.items.length, 0)}
        </span>
      </div>

      <div className="divide-y divide-border/20">
        {queues.map((queue) => {
          const isOpen = expanded[queue.key] !== false;
          return (
            <div key={queue.key}>
              <button
                onClick={() => toggleSection(queue.key)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium hover:bg-muted/30 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: queue.color }}
                />
                <span>{queue.label}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                  style={{ background: queue.colorBg, color: queue.color }}
                >
                  {queue.items.length}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-1.5">
                      {queue.items.map(({ campaign, description }) => (
                        <div
                          key={campaign.id}
                          className="flex items-center gap-3 bg-muted/20 rounded-lg px-3 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">
                              {campaign.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {description}
                            </p>
                          </div>
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0"
                            style={{
                              background:
                                campaign.status === "DRAFT"
                                  ? "#f59e0b20"
                                  : "#22c55e20",
                              color:
                                campaign.status === "DRAFT"
                                  ? "#f59e0b"
                                  : "#22c55e",
                            }}
                          >
                            {campaign.status}
                          </span>
                          <button
                            onClick={() => queue.onAction(campaign)}
                            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors shrink-0"
                            style={{
                              background: queue.colorBg,
                              color: queue.color,
                            }}
                          >
                            <queue.actionIcon className="w-3 h-3" />
                            {queue.actionLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
});
