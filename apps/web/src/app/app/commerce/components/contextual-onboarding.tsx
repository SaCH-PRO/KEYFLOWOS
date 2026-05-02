"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Package,
  FileText,
  CreditCard,
  RefreshCw,
  BarChart3,
  Brain,
  CheckCircle,
  DollarSign,
  ChevronRight,
  Lightbulb,
  Rocket,
  BookOpen,
} from "lucide-react";

const ONBOARDING_KEY = "kf_commerce_onboarding_v2";

interface OnboardingState {
  completedFeatures: string[];
  dismissedTours: string[];
  checklistDismissed: boolean;
}

function loadState(): OnboardingState {
  if (typeof window === "undefined") return { completedFeatures: [], dismissedTours: [], checklistDismissed: false };
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return { completedFeatures: [], dismissedTours: [], checklistDismissed: false };
    return JSON.parse(raw);
  } catch {
    return { completedFeatures: [], dismissedTours: [], checklistDismissed: false };
  }
}

function saveState(state: OnboardingState) {
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state)); } catch {}
}

const CHECKLIST_ITEMS = [
  { id: "first-product", label: "Add your first product", icon: Package, color: "text-teal-400", check: (data: { productCount: number }) => data.productCount > 0 },
  { id: "first-invoice", label: "Create an invoice", icon: CreditCard, color: "text-emerald-400", check: (data: { invoiceCount: number }) => data.invoiceCount > 0 },
  { id: "first-quote", label: "Send a quote", icon: FileText, color: "text-violet-400", check: (data: { quoteCount: number }) => data.quoteCount > 0 },
  { id: "first-recurring", label: "Set up recurring billing", icon: RefreshCw, color: "text-cyan-400", check: (_data: any) => false },
  { id: "explore-ai", label: "Try AI-powered insights", icon: Brain, color: "text-amber-400", check: (_data: any) => false },
] as const;

interface SmartChecklistProps {
  productCount: number;
  invoiceCount: number;
  quoteCount: number;
  onNavigate?: (tab: string, segment?: string) => void;
}

export function SmartChecklist({ productCount, invoiceCount, quoteCount, onNavigate }: SmartChecklistProps) {
  const [state, setState] = useState<OnboardingState>(loadState);

  const completionData = useMemo(() => ({ productCount, invoiceCount, quoteCount }), [productCount, invoiceCount, quoteCount]);

  const completedItems = useMemo(() => {
    return CHECKLIST_ITEMS.filter(item =>
      state.completedFeatures.includes(item.id) || item.check(completionData)
    );
  }, [state.completedFeatures, completionData]);

  const allDone = completedItems.length === CHECKLIST_ITEMS.length;

  useEffect(() => {
    const autoCompleted = CHECKLIST_ITEMS.filter(item => item.check(completionData) && !state.completedFeatures.includes(item.id));
    if (autoCompleted.length > 0) {
      setState(prev => {
        const next = { ...prev, completedFeatures: [...prev.completedFeatures, ...autoCompleted.map(i => i.id)] };
        saveState(next);
        return next;
      });
    }
  }, [completionData]);

  const markComplete = useCallback((id: string) => {
    setState(prev => {
      const next = { ...prev, completedFeatures: [...new Set([...prev.completedFeatures, id])] };
      saveState(next);
      return next;
    });
  }, []);

  const dismiss = useCallback(() => {
    setState(prev => {
      const next = { ...prev, checklistDismissed: true };
      saveState(next);
      return next;
    });
  }, []);

  if (state.checklistDismissed || allDone) return null;

  const progress = Math.round((completedItems.length / CHECKLIST_ITEMS.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
    >
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Rocket className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Get Started</h3>
            <p className="text-[10px] text-muted-foreground">{completedItems.length} of {CHECKLIST_ITEMS.length} complete</p>
          </div>
        </div>
        <button onClick={dismiss} className="p-1 rounded-lg hover:bg-muted/50 transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="px-4 pb-2">
        <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      <div className="px-4 pb-4 space-y-1">
        {CHECKLIST_ITEMS.map(item => {
          const Icon = item.icon;
          const isComplete = completedItems.some(c => c.id === item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!isComplete) {
                  markComplete(item.id);
                  if (item.id === "first-product") onNavigate?.("invoices");
                  else if (item.id === "first-invoice") onNavigate?.("invoices");
                  else if (item.id === "first-quote") onNavigate?.("quotes");
                  else if (item.id === "first-recurring") onNavigate?.("recurring");
                }
              }}
              className={`w-full flex items-center gap-2.5 p-2 rounded-lg transition-colors ${isComplete ? "opacity-60" : "hover:bg-muted/20"}`}
            >
              <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isComplete ? "bg-emerald-500/15" : "bg-muted/30"}`}>
                {isComplete ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Icon className={`w-3 h-3 ${item.color}`} />}
              </div>
              <span className={`text-xs flex-1 text-left ${isComplete ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
              {!isComplete && <ChevronRight className="w-3 h-3 text-muted-foreground/30" />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

interface SpotlightTourProps {
  featureId: string;
  title: string;
  description: string;
  icon?: React.ElementType;
  position?: "top" | "bottom";
}

export function SpotlightTour({ featureId, title, description, icon: Icon = Lightbulb, position = "bottom" }: SpotlightTourProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const state = loadState();
    if (!state.dismissedTours.includes(featureId)) {
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [featureId]);

  const dismiss = useCallback(() => {
    setVisible(false);
    const state = loadState();
    state.dismissedTours = [...new Set([...state.dismissedTours, featureId])];
    saveState(state);
  }, [featureId]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: position === "bottom" ? -8 : 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`absolute ${position === "bottom" ? "top-full mt-2" : "bottom-full mb-2"} left-0 right-0 z-30 mx-auto max-w-xs`}
        >
          <div className="rounded-xl border border-amber-500/30 bg-card shadow-xl p-3">
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0">
                <Icon className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold mb-0.5">{title}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
              </div>
              <button onClick={dismiss} className="p-0.5 rounded hover:bg-muted/50 shrink-0">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface EmptyStateEducationProps {
  type: "invoices" | "quotes" | "products" | "recurring" | "collections";
  onAction?: () => void;
}

const EMPTY_STATE_CONFIG = {
  invoices: {
    icon: CreditCard,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    title: "Create your first invoice",
    description: "Bill clients professionally with line items, tax calculations, payment terms, and shareable payment links.",
    actionLabel: "Create Invoice",
    tips: [
      "Link invoices to CRM contacts for complete relationship tracking",
      "Set up payment terms like Net 30 for automatic due dates",
      "Generate payment links for easy online collection",
    ],
  },
  quotes: {
    icon: FileText,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    title: "Send your first quote",
    description: "Create professional proposals and convert them to invoices when accepted.",
    actionLabel: "Create Quote",
    tips: [
      "Quotes can be converted to invoices with one click",
      "Set expiry dates to create urgency",
      "Track conversion rates in the AI Catalog tab",
    ],
  },
  products: {
    icon: Package,
    color: "text-teal-400",
    bgColor: "bg-teal-500/10",
    title: "Build your product catalog",
    description: "Add products and services that you can quickly add to invoices and quotes.",
    actionLabel: "Add Product",
    tips: [
      "Organize items as Service, Product, or Package",
      "Add images to make your catalog more professional",
      "Use AI pricing advisor for competitive pricing",
    ],
  },
  recurring: {
    icon: RefreshCw,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    title: "Set up recurring billing",
    description: "Automate invoice generation for retainer clients, subscriptions, or regular services.",
    actionLabel: "Create Schedule",
    tips: [
      "Choose from weekly, monthly, quarterly, or yearly",
      "Pause and resume schedules any time",
      "AI will monitor for churn risk automatically",
    ],
  },
  collections: {
    icon: BarChart3,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    title: "Collections intelligence",
    description: "AI-powered recovery scoring helps you prioritize which overdue invoices to pursue first.",
    actionLabel: "Run Analysis",
    tips: [
      "Each invoice gets a recovery likelihood score",
      "AI suggests the best channel and timing for follow-up",
      "Create payment plans for large overdue amounts",
    ],
  },
};

export function EmptyStateEducation({ type, onAction }: EmptyStateEducationProps) {
  const config = EMPTY_STATE_CONFIG[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center max-w-md mx-auto">
      <div className={`w-14 h-14 rounded-xl ${config.bgColor} border border-border/50 flex items-center justify-center mb-4`}>
        <Icon className={`w-7 h-7 ${config.color}`} />
      </div>
      <h3 className="text-lg font-semibold mb-1">{config.title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{config.description}</p>

      {onAction && (
        <button
          onClick={onAction}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium mb-6 transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          {config.actionLabel}
        </button>
      )}

      <div className="w-full text-left space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quick Tips</p>
        {config.tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lightbulb className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
            <span>{tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SearchableHelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (tab: string, segment?: string) => void;
}

const HELP_TOPICS = [
  { id: "invoices", category: "Billing", title: "Creating Invoices", desc: "Build professional invoices with line items, tax, and payment terms. Link to CRM contacts.", icon: CreditCard, tab: "invoices" },
  { id: "quotes", category: "Billing", title: "Sending Quotes", desc: "Create proposals, set expiry dates, and convert accepted quotes to invoices.", icon: FileText, tab: "quotes" },
  { id: "recurring", category: "Billing", title: "Recurring Billing", desc: "Automate invoice generation on weekly, monthly, or custom schedules.", icon: RefreshCw, tab: "recurring" },
  { id: "payments", category: "Payments", title: "Payments & Collections", desc: "Track received payments, pending amounts, overdue recovery, and payment methods.", icon: DollarSign, tab: "payments" },
  { id: "ai-tools", category: "Intelligence", title: "AI Copilot", desc: "Revenue analysis, cash flow forecasts, pricing advice, and natural language search.", icon: Brain, tab: "invoices" },
  { id: "collections", category: "Intelligence", title: "Collections Scoring", desc: "AI scores overdue invoices for recovery likelihood and recommends follow-up timing.", icon: BarChart3, tab: "payments" },
  { id: "payment-plans", category: "Intelligence", title: "Payment Plans", desc: "AI suggests installment structures based on invoice amount and customer history.", icon: CreditCard, tab: "payments" },
  { id: "churn-risk", category: "Intelligence", title: "Churn Alerts", desc: "Detect declining payment patterns and risk signals in recurring customers.", icon: RefreshCw, tab: "recurring" },
  { id: "revenue-journey", category: "Intelligence", title: "Revenue Journey", desc: "Visualize the CRM contact → Quote → Invoice → Payment conversion funnel.", icon: BarChart3, tab: "payments" },
];

export function SearchableHelpDrawer({ isOpen, onClose, onNavigate }: SearchableHelpDrawerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return HELP_TOPICS;
    const q = query.toLowerCase();
    return HELP_TOPICS.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    filtered.forEach(topic => {
      const list = groups.get(topic.category) ?? [];
      list.push(topic);
      groups.set(topic.category, list);
    });
    return groups;
  }, [filtered]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[400px] max-w-full kf-card border-l border-border shadow-2xl flex flex-col"
          >
            <div className="flex items-center gap-2.5 p-4 border-b border-border/40">
              <div className="p-1.5 rounded-lg bg-amber-400/10">
                <BookOpen className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Commerce Help</h3>
                <p className="text-[10px] text-muted-foreground">Search features and guides</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-white/[0.03] px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search help topics..."
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
                  autoFocus
                />
                {query && (
                  <button onClick={() => setQuery("")} className="p-0.5 rounded hover:bg-white/10">
                    <X className="w-3 h-3 text-muted-foreground/50" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {[...grouped.entries()].map(([category, topics]) => (
                <div key={category}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{category}</p>
                  <div className="space-y-1">
                    {topics.map(topic => {
                      const Icon = topic.icon;
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => { onNavigate?.(topic.tab); onClose(); }}
                          className="w-full flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/20 transition-colors text-left"
                        >
                          <div className="w-6 h-6 rounded-md bg-muted/30 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">{topic.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{topic.desc}</p>
                          </div>
                          <ChevronRight className="w-3 h-3 text-muted-foreground/30 mt-1 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {filtered.length === 0 && (
                <div className="py-8 text-center">
                  <Search className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/50">No topics match &quot;{query}&quot;</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
