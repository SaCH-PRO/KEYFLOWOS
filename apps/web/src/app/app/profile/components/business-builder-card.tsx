"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb, Rocket, Settings, TrendingUp, ChevronRight,
  Sparkles, Target, DollarSign, Users, BarChart3,
  FileText, Calendar, ShoppingBag, Mail, Megaphone,
  CheckCircle2, ArrowRight, Zap, Brain, Loader2,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type ProgressKey =
  | "hasProfile" | "hasServices" | "hasStore" | "storeEnabled"
  | "hasDocs" | "hasContacts" | "hasBookings" | "hasInvoices"
  | "hasExpenses" | "hasProjects" | "hasSequences" | "hasRecurring"
  | "hasCampaigns" | "hasReports" | "hasAI" | "hasAutomations";

interface PhaseAction {
  label: string;
  description: string;
  icon: React.ElementType;
  route: string;
  doneKey: ProgressKey;
}

interface Phase {
  id: string;
  label: string;
  tagline: string;
  icon: React.ElementType;
  colorVar: string;
  actions: PhaseAction[];
}

const PHASES: Phase[] = [
  {
    id: "conceptualise",
    label: "Conceptualise",
    tagline: "Define your vision and foundation",
    icon: Lightbulb,
    colorVar: "--kf-accent2",
    actions: [
      { label: "Business Profile", description: "Define your name, industry, and stage", icon: Target, route: "/app/profile", doneKey: "hasProfile" },
      { label: "Service Catalog", description: "Create your offerings and pricing", icon: ShoppingBag, route: "/app/bookings", doneKey: "hasServices" },
      { label: "Brand Identity", description: "Logo, colors, and storefront design", icon: Sparkles, route: "/app/store", doneKey: "hasStore" },
      { label: "Business Documents", description: "Generate contracts, policies, and plans", icon: FileText, route: "/app/profile?tab=documents", doneKey: "hasDocs" },
    ],
  },
  {
    id: "execute",
    label: "Execute",
    tagline: "Launch and start serving customers",
    icon: Rocket,
    colorVar: "--kf-accent1",
    actions: [
      { label: "Go Live", description: "Publish your storefront to the world", icon: Zap, route: "/app/store", doneKey: "storeEnabled" },
      { label: "First Contact", description: "Add or import your first customers", icon: Users, route: "/app/contacts", doneKey: "hasContacts" },
      { label: "First Booking", description: "Accept your first appointment or order", icon: Calendar, route: "/app/bookings", doneKey: "hasBookings" },
      { label: "Payment Setup", description: "Configure how you get paid", icon: DollarSign, route: "/app/commerce", doneKey: "hasInvoices" },
    ],
  },
  {
    id: "maintain",
    label: "Maintain",
    tagline: "Streamline your daily operations",
    icon: Settings,
    colorVar: "--kf-info",
    actions: [
      { label: "Expense Tracking", description: "Monitor and categorize spending", icon: BarChart3, route: "/app/expenses", doneKey: "hasExpenses" },
      { label: "Client Follow-ups", description: "Automate reminders and sequences", icon: Mail, route: "/app/contacts", doneKey: "hasSequences" },
      { label: "Recurring Revenue", description: "Set up subscriptions and billing", icon: DollarSign, route: "/app/commerce", doneKey: "hasRecurring" },
      { label: "Project Management", description: "Track tasks and deliverables", icon: Target, route: "/app/projects", doneKey: "hasProjects" },
    ],
  },
  {
    id: "profit",
    label: "Profit & Scale",
    tagline: "Grow revenue and expand reach",
    icon: TrendingUp,
    colorVar: "--kf-success",
    actions: [
      { label: "Marketing Campaigns", description: "Email campaigns and lead capture", icon: Megaphone, route: "/app/marketing", doneKey: "hasCampaigns" },
      { label: "Revenue Reports", description: "Track income, expenses, and margins", icon: BarChart3, route: "/app/reports", doneKey: "hasReports" },
      { label: "AI Insights", description: "Get recommendations to grow faster", icon: Brain, route: "/app", doneKey: "hasAI" },
      { label: "Scale Operations", description: "Automations and team workflows", icon: Zap, route: "/app/settings", doneKey: "hasAutomations" },
    ],
  },
];

function safeArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function useBusinessProgress(businessId: string | null) {
  const [progress, setProgress] = useState<Record<ProgressKey, boolean> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    const settle = <T,>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> =>
      p.then((v) => ({ ok: true as const, value: v })).catch(() => ({ ok: false as const }));

    Promise.all([
      settle(apiGet<Record<string, unknown>>(`/identity/businesses/${businessId}`)),
      settle(apiGet<unknown[]>(`/bookings/businesses/${businessId}/services`)),
      settle(apiGet<unknown[]>(`/crm/businesses/${businessId}/contacts?limit=1`)),
      settle(apiGet<unknown[]>(`/commerce/businesses/${businessId}/invoices?limit=1`)),
      settle(apiGet<unknown[]>(`/documents/businesses/${businessId}/instances`)),
      settle(apiGet<unknown[]>(`/expenses/businesses/${businessId}?limit=1`)),
      settle(apiGet<unknown[]>(`/projects/businesses/${businessId}?limit=1`)),
    ]).then(([bizRes, servicesRes, contactsRes, invoicesRes, docsRes, expensesRes, projectsRes]) => {
      const biz = bizRes.ok ? (bizRes.value.data as Record<string, unknown> | null) : null;
      setProgress({
        hasProfile: !!(biz?.name && biz?.industry),
        hasServices: safeArray(servicesRes.ok ? servicesRes.value.data : []).length > 0,
        hasStore: !!biz?.storeEnabled,
        storeEnabled: !!biz?.storeEnabled,
        hasDocs: safeArray(docsRes.ok ? docsRes.value.data : []).length > 0,
        hasContacts: safeArray(contactsRes.ok ? contactsRes.value.data : []).length > 0,
        hasBookings: false,
        hasInvoices: safeArray(invoicesRes.ok ? invoicesRes.value.data : []).length > 0,
        hasExpenses: safeArray(expensesRes.ok ? expensesRes.value.data : []).length > 0,
        hasProjects: safeArray(projectsRes.ok ? projectsRes.value.data : []).length > 0,
        hasSequences: false,
        hasRecurring: false,
        hasCampaigns: false,
        hasReports: false,
        hasAI: false,
        hasAutomations: false,
      });
      setLoading(false);
    });
  }, [businessId]);

  return { progress, loading };
}

export default function BusinessBuilderCard() {
  const router = useRouter();
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const businessId = typeof window !== "undefined" ? getStoredBusinessId() : null;
  const { progress, loading } = useBusinessProgress(businessId);

  const getPhaseProgress = useCallback((phase: Phase) => {
    if (!progress) return { done: 0, total: phase.actions.length, pct: 0 };
    const done = phase.actions.filter((a) => progress[a.doneKey]).length;
    return { done, total: phase.actions.length, pct: Math.round((done / phase.actions.length) * 100) };
  }, [progress]);

  const totalDone = PHASES.reduce((acc, p) => acc + getPhaseProgress(p).done, 0);
  const totalActions = PHASES.reduce((acc, p) => acc + p.actions.length, 0);
  const overallPct = Math.round((totalDone / totalActions) * 100);

  const activePhaseIndex = PHASES.findIndex((p) => {
    const { pct } = getPhaseProgress(p);
    return pct < 100;
  });
  const currentPhase = activePhaseIndex >= 0 ? PHASES[activePhaseIndex] : PHASES[PHASES.length - 1];

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div
        className="p-5 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.06))",
        }}
      >
        <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.03]"
          style={{
            background: `radial-gradient(circle, hsl(var(--kf-accent1)), transparent 70%)`,
          }}
        />

        <div className="flex items-start gap-4 relative">
          <div
            className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
              boxShadow: "0 4px 12px hsl(var(--kf-accent1) / 0.3)",
            }}
          >
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[hsl(var(--kf-foreground))]">Business Builder</h3>
            <p className="text-xs text-[hsl(var(--kf-muted-foreground))] mt-0.5">
              From idea to profit — your complete business roadmap
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--kf-muted-foreground))]" />
            ) : (
              <>
                <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{overallPct}%</span>
                <span className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">{totalDone}/{totalActions} complete</span>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {PHASES.map((phase, i) => {
            const { pct } = getPhaseProgress(phase);
            const isActive = phase.id === currentPhase.id;
            return (
              <div key={phase.id} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className="w-full h-1.5 rounded-full overflow-hidden"
                  style={{ background: "hsl(var(--kf-muted) / 0.2)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `hsl(var(${phase.colorVar}))` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                  />
                </div>
                <div className="flex items-center gap-1">
                  {isActive && <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: `hsl(var(${phase.colorVar}))` }} />}
                  <span className={`text-[9px] font-medium ${isActive ? "" : "text-[hsl(var(--kf-muted-foreground))]"}`}
                    style={isActive ? { color: `hsl(var(${phase.colorVar}))` } : undefined}
                  >
                    {phase.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: "hsl(var(--kf-border) / 0.15)" }}>
        {PHASES.map((phase) => {
          const PhaseIcon = phase.icon;
          const { done, total, pct } = getPhaseProgress(phase);
          const isExpanded = expandedPhase === phase.id;
          const isComplete = pct === 100;

          return (
            <div key={phase.id}>
              <button
                onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[hsl(var(--kf-muted)/0.06)] transition-colors text-left min-h-[52px]"
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isComplete ? `hsl(var(${phase.colorVar}) / 0.1)` : "hsl(var(--kf-muted) / 0.1)",
                    border: `1px solid ${isComplete ? `hsl(var(${phase.colorVar}) / 0.2)` : "hsl(var(--kf-border) / 0.15)"}`,
                  }}
                >
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4" style={{ color: `hsl(var(${phase.colorVar}))` }} />
                  ) : (
                    <PhaseIcon className="w-4 h-4" style={{ color: `hsl(var(${phase.colorVar}))` }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[hsl(var(--kf-foreground))]">{phase.label}</span>
                    {isComplete && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: `hsl(var(${phase.colorVar}) / 0.1)`, color: `hsl(var(${phase.colorVar}))` }}
                      >
                        Done
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">{phase.tagline}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-medium text-[hsl(var(--kf-muted-foreground))]">
                    {done}/{total}
                  </span>
                  <ChevronRight
                    className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))] transition-transform"
                    style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }}
                  />
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 space-y-1.5">
                      {phase.actions.map((action) => {
                        const ActionIcon = action.icon;
                        const isDone = progress ? progress[action.doneKey] : false;
                        return (
                          <button
                            key={action.label}
                            onClick={() => router.push(action.route)}
                            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl hover:bg-[hsl(var(--kf-muted)/0.08)] transition-all text-left group min-h-[48px]"
                            style={{
                              border: isDone
                                ? `1px solid hsl(var(${phase.colorVar}) / 0.15)`
                                : "1px solid hsl(var(--kf-border) / 0.1)",
                              background: isDone
                                ? `hsl(var(${phase.colorVar}) / 0.04)`
                                : "transparent",
                            }}
                          >
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{
                                background: isDone
                                  ? `hsl(var(${phase.colorVar}) / 0.1)`
                                  : "hsl(var(--kf-muted) / 0.08)",
                              }}
                            >
                              {isDone ? (
                                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: `hsl(var(${phase.colorVar}))` }} />
                              ) : (
                                <ActionIcon className="w-3.5 h-3.5 text-[hsl(var(--kf-muted-foreground))]" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${isDone ? "text-[hsl(var(--kf-muted-foreground))]" : "text-[hsl(var(--kf-foreground))]"}`}>
                                {action.label}
                              </span>
                              <p className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">{action.description}</p>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-[hsl(var(--kf-muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          </button>
                        );
                      })}
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
}
