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

function getAccent(type: FeedItem["type"]) {
  if (type === "booking" || type === "automation") return 2;
  return 1;
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
    <div className="kf-card p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Flow Feed</h2>
          <p className="text-sm text-muted-foreground">Real-time business activity</p>
        </div>
        <button 
          className="text-sm font-medium hover:underline inline-flex items-center gap-1"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          View all
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {items.map((item, index) => {
          const Icon = iconFor(item.type);
          const accent = getAccent(item.type);
          const accentVar = accent === 1 ? "--kf-accent1" : "--kf-accent2";
          
          return (
            <motion.div
              key={`${item.title}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * index }}
              className="group p-3 rounded-xl border border-border bg-background hover:bg-muted/50 transition-all"
            >
              <div className="flex items-start gap-3">
                <div 
                  className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `hsl(var(${accentVar}) / 0.15)` }}
                >
                  <Icon className="w-5 h-5" style={{ color: `hsl(var(${accentVar}))` }} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium truncate">{item.title}</h3>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{item.time}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                  
                  {item.suggestion && (
                    <div className="mt-2 flex items-center gap-2">
                      <button 
                        className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                        style={{ color: `hsl(var(${accentVar}))` }}
                        onClick={() => onAsk?.(item)}
                      >
                        <Sparkles className="w-3 h-3" />
                        Ask AI: {item.suggestion}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
