"use client";

import { useEffect, useState } from "react";
import { AchievementsStrip } from "@/components/cockpit/achievements-strip";
import { FeedItem, FlowFeedPanel } from "@/components/cockpit/flow-feed-panel";
import { FlowGraphPanel, Phase } from "@/components/cockpit/flow-graph-panel";
import { FlowStatsRow } from "@/components/cockpit/flow-stats-row";
import { MomentumBar } from "@keyflow/ui";
import { fetchBookings, fetchContacts, fetchProducts, fetchInvoices, Invoice } from "@/lib/client";
import { apiPost } from "@/lib/api";

export default function AppHome() {
  const [stats, setStats] = useState({
    mrr: "TTD --",
    conversionRate: "--",
    avgResponseTime: "--",
  });
  const [loading, setLoading] = useState(true);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [momentum, setMomentum] = useState(0.35);
  const [streaks, setStreaks] = useState<string[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
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

      const initialFeed = buildFeed({
        contactsCount: contactCount,
        bookingCount,
        productCount,
        invoices: invs ?? [],
      });
      setFeedItems(initialFeed);

      setPhases([
        { label: "Leads", value: Math.max(contactCount, 5) },
        { label: "Conversations", value: Math.max(Math.round(contactCount * 0.6), 3) },
        { label: "Quotes Sent", value: Math.max(Math.round(contactCount * 0.4), 2) },
        { label: "Invoices Paid", value: Math.max(Math.round(invoiceCount * 0.7), 1) },
        { label: "Bookings", value: Math.max(bookingCount, 1) },
      ]);

      const momentumScore = Math.min(
        1,
        0.15 + bookingCount * 0.08 + productCount * 0.05 + contactCount * 0.03 + invoicesPaid * 0.06,
      );
      setMomentum(momentumScore);
      setStreaks([
        bookingCount >= 3 ? "Booking streak" : "Create bookings",
        invoicesPaid >= 2 ? "Revenue streak" : "Collect payments",
      ]);
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
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Cockpit</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Your business graph, live. Watch leads flow into bookings and revenue in real-time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
            Run AI Health Check
          </button>
          <button className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
            Export Report
          </button>
        </div>
      </div>

      <FlowStatsRow stats={stats} />
      <MomentumBar value={momentum} streaks={streaks} />
      {!loading && <AchievementsStrip />}

      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <FlowFeedPanel
          items={feedItems}
          onAsk={(item) => {
            void requestAiSuggestion(item, (msg) => setAiSuggestion(msg));
          }}
          onAction={(item) => {
            if (item.meta?.invoiceId) {
              window.open(`/commerce/invoices/${item.meta.invoiceId}/receipt`, "_blank");
            }
          }}
        />
        <FlowGraphPanel phases={phases} bottleneck="Quotes → Paid" />
      </div>

      {aiSuggestion && (
        <div className="rounded-2xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm text-primary">
          {aiSuggestion}
        </div>
      )}

      {invoices.length > 0 && (
        <div className="rounded-3xl border border-border/60 bg-slate-950/70 backdrop-blur px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Recent invoices</div>
          <div className="flex flex-wrap gap-2">
            {invoices.slice(0, 4).map((inv) => (
              <span
                key={inv.id}
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-slate-900/60 px-3 py-1 text-xs text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {inv.invoiceNumber ?? inv.id} · {inv.status}
              </span>
            ))}
          </div>
        </div>
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
        meta: { invoiceId: inv.id },
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

async function requestAiSuggestion(item: FeedItem, setAiSuggestion: (msg: string) => void) {
  const { data, error } = await apiPost<{ suggestion: string }>({
    path: "/api/ai/suggest",
    body: { title: item.title, type: item.type, suggestion: item.suggestion },
  });
  setAiSuggestion(data?.suggestion ?? error ?? "AI is thinking...");
}
