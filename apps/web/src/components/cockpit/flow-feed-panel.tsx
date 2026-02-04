"use client";

import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, CreditCard, MessageCircle, Sparkles } from "lucide-react";

export type FeedItem = {
  type: "payment" | "booking" | "message" | "automation";
  title: string;
  time: string;
  description: string;
  suggestion?: string;
  meta?: { invoiceId?: string; contactEmail?: string };
};

const defaultFeed: FeedItem[] = [
  {
    type: "payment",
    title: "Invoice #004 paid by Sarah Smith",
    time: "2 min ago",
    description: "TTD 850.00 received via Stripe.",
    suggestion: "Send review request",
  },
  {
    type: "booking",
    title: "New booking: Consultation with Dr. Ali",
    time: "18 min ago",
    description: "Wed 3:00–4:00 PM, 60 min consult.",
    suggestion: "Confirm & send prep instructions",
  },
  {
    type: "message",
    title: "New WhatsApp lead: John from Instagram",
    time: "35 min ago",
    description: "Asking about first-time visit pricing.",
    suggestion: "Send pricing & booking link",
  },
];

function iconFor(type: FeedItem["type"]) {
  if (type === "payment") return CreditCard;
  if (type === "booking") return CalendarClock;
  if (type === "automation") return Sparkles;
  return MessageCircle;
}

export function FlowFeedPanel({
  items = defaultFeed,
  onAsk,
  onAction,
}: {
  items?: FeedItem[];
  onAsk?: (item: FeedItem) => void | Promise<void>;
  onAction?: (item: FeedItem) => void | Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">Flow Feed</h2>
          <p className="text-xs text-muted-foreground">Live stream of bookings, payments, and leads.</p>
        </div>
        <button 
          className="text-xs font-medium hover:underline inline-flex items-center gap-1"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          View all
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {items.map((item, index) => {
          const Icon = iconFor(item.type);
          const useAccent2 = item.type === "booking" || item.type === "automation";
          return (
            <motion.div
              key={`${item.title}-${index}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * index }}
              className="group relative rounded-xl border border-border bg-muted/30 hover:bg-muted/50 px-3 py-3 text-xs flex flex-col gap-2 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span 
                  className="mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ 
                    background: useAccent2 
                      ? "hsl(var(--kf-accent2) / 0.15)" 
                      : "hsl(var(--kf-accent1) / 0.15)"
                  }}
                >
                  <Icon 
                    className="w-4 h-4" 
                    style={{ 
                      color: useAccent2 
                        ? "hsl(var(--kf-accent2))" 
                        : "hsl(var(--kf-accent1))"
                    }}
                  />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{item.title}</span>
                    <span className="text-muted-foreground shrink-0">· {item.time}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">{item.description}</p>
                </div>
              </div>
              {item.suggestion && (
                <div className="ml-11 flex items-center gap-2">
                  <button
                    onClick={() => onAsk?.(item)}
                    className="inline-flex items-center gap-1 hover:underline"
                    style={{ color: "hsl(var(--kf-accent2))" }}
                  >
                    <Sparkles className="w-3 h-3" />
                    Ask AI: {item.suggestion}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
