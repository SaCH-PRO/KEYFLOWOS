"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AchievementsStrip } from "@/components/cockpit/achievements-strip";
import { FeedItem, FlowFeedPanel } from "@/components/cockpit/flow-feed-panel";
import { FlowGraphPanel, Phase } from "@/components/cockpit/flow-graph-panel";
import { FlowStatsRow } from "@/components/cockpit/flow-stats-row";
import { fetchBookings, fetchContacts, fetchProducts, fetchInvoices, Invoice } from "@/lib/client";
import { apiPost } from "@/lib/api";
import { Sparkles, FileText, Zap } from "lucide-react";

export default function AppHome() {
  const [stats, setStats] = useState({ mrr: "TTD --", conversionRate: "--", avgResponseTime: "--" });
  const [loading, setLoading] = useState(true);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [bottleneck, setBottleneck] = useState<string>("Quotes Sent");
  const [momentum, setMomentum] = useState(0.35);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: contacts }, { data: bookings }, { data: products }, { data: invs }] = await Promise.all([
        fetchContacts(),
        fetchBookings(),
        fetchProducts(),
        fetchInvoices(),
      ]);
      const contactCount = Array.isArray(contacts) ? contacts.length : 0;
      const bookingCount = Array.isArray(bookings) ? bookings.length : 0;
      const productCount = Array.isArray(products) ? products.length : 0;
      const invoiceCount = Array.isArray(invs) ? invs.length : 0;
      const invoicesPaid = Array.isArray(invs) ? invs.filter((i) => i.status?.toUpperCase() === "PAID").length : 0;

      setStats({
        mrr: `TTD ${Math.max(5000, bookingCount * 2000 + productCount * 1200).toLocaleString()}`,
        conversionRate: `${Math.min(80, 20 + contactCount * 3)}%`,
        avgResponseTime: `${Math.max(2, 6 - contactCount * 0.2).toFixed(1)}m`,
      });

      const initialFeed = buildFeed({ contactsCount: contactCount, bookingCount, productCount, invoices: invs ?? [] });
      setFeedItems(initialFeed);

      const phaseValues: Phase[] = [
        { label: "Leads", value: Math.max(contactCount, 1) },
        { label: "Quotes Sent", value: Math.max(invoiceCount, 1) },
        { label: "Invoices Paid", value: Math.max(invoicesPaid, 1) },
        { label: "Bookings", value: Math.max(bookingCount, 1) },
      ];
      setPhases(phaseValues);
      const minPhase = phaseValues.reduce((a, b) => (b.value < a.value ? b : a), phaseValues[0]);
      setBottleneck(minPhase.label);

      const momentumScore = Math.min(
        1,
        0.15 + bookingCount * 0.08 + productCount * 0.05 + contactCount * 0.03 + invoicesPaid * 0.06,
      );
      setMomentum(momentumScore);
      setInvoices(invs ?? []);
      setLoading(false);
    };
    void load();

    if (typeof window !== "undefined") {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent).detail as { invoiceNumber?: string; total?: number; currency?: string; invoiceId?: string };
        const newItem: FeedItem = {
          type: "payment",
          title: `${detail.invoiceNumber ?? "Invoice"} marked PAID`,
          time: "just now",
          description: `${detail.currency ?? "TTD"} ${Number(detail.total ?? 0).toLocaleString()}`,
          suggestion: "Send receipt",
          meta: detail.invoiceId ? { invoiceId: detail.invoiceId } : undefined,
        };
        setFeedItems((prev) => [newItem, ...prev].slice(0, 8));
      };
      window.addEventListener("kf:invoicePaid", handler as EventListener);
      return () => window.removeEventListener("kf:invoicePaid", handler as EventListener);
    }
  }, []);

  return (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's happening with your business today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="kf-btn-primary inline-flex items-center gap-2"
            onClick={async () => {
              setAiLoading(true);
              const msg = await requestAiSuggestion({
                type: "automation",
                title: "Health Check",
                time: "now",
                description: "AI health check",
                suggestion: "Summarize health",
              });
              setAiSuggestion(msg);
              setActionMessage(msg);
              setAiLoading(false);
            }}
            disabled={aiLoading}
          >
            <Sparkles className="w-4 h-4" />
            {aiLoading ? "Analyzing..." : "AI Health Check"}
          </button>
          <button className="kf-btn-secondary inline-flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </motion.div>

      <FlowStatsRow stats={stats} />
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="kf-card p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-sm font-medium">Momentum</span>
          </div>
          <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
            {Math.round(momentum * 100)}%
          </span>
        </div>
        <div className="kf-momentum-bar">
          <div className="kf-momentum-fill" style={{ width: `${momentum * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Keep the momentum going! Focus on {bottleneck.toLowerCase()} to boost your score.
        </p>
      </motion.div>

      {!loading && <AchievementsStrip />}

      <div className="grid gap-6 lg:grid-cols-2">
        <FlowFeedPanel
          items={feedItems}
          onAsk={(item) => {
            void requestAiSuggestion(item).then((msg) => {
              setAiSuggestion(msg);
              setActionMessage(msg);
            });
          }}
          onAction={(item) => {
            if (item.meta?.invoiceId) {
              window.open(`/commerce/invoices/${item.meta.invoiceId}/receipt`, "_blank");
              void sendAction("send-receipt", { invoiceId: item.meta.invoiceId }).then((msg) => setActionMessage(msg));
              setTimeout(() => setActionMessage(null), 2000);
            }
            if (item.meta?.contactEmail) {
              void sendAction("remind-contact", { contactEmail: item.meta.contactEmail }).then((msg) => setActionMessage(msg));
            }
          }}
        />
        <div className="space-y-4">
          <FlowGraphPanel phases={phases} bottleneck={bottleneck} />
          <button
            className="w-full kf-btn-secondary inline-flex items-center justify-center gap-2"
            onClick={async () => {
              const msg = await requestAiSuggestion({
                type: "automation",
                title: "Fix bottleneck",
                time: "now",
                description: bottleneck,
                suggestion: `Improve ${bottleneck}`,
              });
              setAiSuggestion(msg);
              setActionMessage(msg);
            }}
          >
            <Sparkles className="w-4 h-4" />
            Ask AI to improve {bottleneck}
          </button>
        </div>
      </div>

      {aiSuggestion && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="kf-card-accent p-4"
        >
          <div className="flex items-start gap-3">
            <div 
              className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">AI Suggestion</div>
              <p className="text-sm text-muted-foreground">{aiSuggestion}</p>
            </div>
          </div>
        </motion.div>
      )}

      {actionMessage && !aiSuggestion && (
        <div className="kf-card p-3 text-sm text-muted-foreground">
          {actionMessage}
        </div>
      )}

      {invoices.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="kf-card p-4"
        >
          <div className="text-sm font-medium mb-3">Recent Invoices</div>
          <div className="flex flex-wrap gap-2">
            {invoices.slice(0, 4).map((inv) => (
              <span
                key={inv.id}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm"
              >
                <span 
                  className="h-2 w-2 rounded-full" 
                  style={{ background: inv.status === "PAID" ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))" }}
                />
                {inv.invoiceNumber ?? inv.id}
                <span className="text-xs text-muted-foreground">{inv.status}</span>
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function buildFeed(input: { contactsCount: number; bookingCount: number; productCount: number; invoices: Invoice[] }): FeedItem[] {
  const minutesAgo = (n: number) => `${n} min ago`;
  const items: FeedItem[] = [];

  if (input.bookingCount > 0) {
    items.push({
      type: "booking",
      title: "New booking confirmed",
      time: minutesAgo(5),
      description: "Client reserved a slot today.",
      suggestion: "Send prep checklist",
    });
  }

  if (input.productCount > 0) {
    items.push({
      type: "payment",
      title: "Invoice paid",
      time: minutesAgo(12),
      description: "TTD 850.00 received via Stripe.",
      suggestion: "Send review request",
    });
  }

  if (input.invoices.length > 0) {
    input.invoices.slice(0, 2).forEach((inv, idx) => {
      items.push({
        type: "payment",
        title: `${inv.invoiceNumber ?? "Invoice"} ${inv.status}`,
        time: minutesAgo(20 + idx * 3),
        description: `${inv.currency} ${Number(inv.total).toLocaleString()} · ${inv.status}`,
        suggestion: inv.status === "PAID" ? "Send receipt" : "Remind contact",
        meta: { invoiceId: inv.id, contactEmail: inv.contact?.email ?? undefined },
      });
    });
  }

  items.push({
    type: "message",
    title: "New lead from social",
    time: minutesAgo(28),
    description: "Asked for pricing on Instagram DM.",
    suggestion: "Send pricing & booking link",
  });

  return items;
}

async function requestAiSuggestion(item: FeedItem): Promise<string> {
  const { data, error } = await apiPost<{ suggestion: string }>({
    path: "/api/ai/suggest",
    body: { title: item.title, type: item.type, suggestion: item.suggestion },
  });
  return data?.suggestion ?? error ?? "AI is thinking...";
}

async function sendAction(
  type: "remind-contact" | "send-receipt",
  payload: { contactEmail?: string; invoiceId?: string },
): Promise<string> {
  const { data, error } = await apiPost<{ message: string }>({
    path: "/api/actions",
    body: { type, ...payload },
  });
  return data?.message ?? error ?? "Action queued";
}
