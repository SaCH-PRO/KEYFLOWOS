"use client";

import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, CreditCard, MessageCircle } from "lucide-react";

export type FeedItem = {
  type: "payment" | "booking" | "message" | "automation";
  title: string;
  time: string;
  description: string;
  suggestion?: string;
  meta?: { invoiceId?: string };
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
    <div className="rounded-3xl border border-border/60 bg-slate-950/80 backdrop-blur-xl p-3 md:p-4 flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold">Flow Feed</h2>
          <p className="text-[11px] text-muted-foreground">Live stream of bookings, payments, and leads.</p>
        </div>
        <button className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
          View all
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto space-y-2 pr-1">
        {items.map((item, index) => {
          const Icon = iconFor(item.type);
          return (
            <motion.div
              key={`${item.title}-${index}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * index }}
              className="group relative rounded-2xl border border-border/60 bg-slate-900/70 px-3 py-2.5 text-xs flex flex-col gap-1.5"
            >
              <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 bg-primary/10 blur-xl transition-opacity pointer-events-none" />
              <div className="relative flex items-start gap-2">
                <span className="mt-0.5 h-7 w-7 rounded-2xl bg-slate-950/80 border border-border/60 flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                </span>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[12px] leading-snug">{item.title}</p>
                    <span className="text-[10px] text-muted-foreground">· {item.time}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{item.description}</p>
                  {item.suggestion && (
                    <button
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] mt-1 hover:bg-primary/20"
                      onClick={() => onAsk?.(item)}
                    >
                      <span>Ask AI: {item.suggestion}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  {item.meta?.invoiceId && (
                    <button
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-primary hover:border-primary/60"
                      onClick={() => onAction?.(item)}
                    >
                      Open receipt
                      <ArrowRight className="w-3 h-3" />
                    </button>
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
