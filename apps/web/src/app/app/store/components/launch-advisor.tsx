"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertCircle,
  Info,
  ExternalLink,
  Copy,
  PartyPopper,
  Rocket,
  Eye,
  EyeOff,
  TrendingUp,
  ShieldCheck,
  Megaphone,
} from "lucide-react";

export type ReadinessDimension = {
  id: string;
  label: string;
  score: number;
  weight: number;
};

export type ReadinessItem = {
  id: string;
  dimension: string;
  title: string;
  description: string;
  severity: "critical" | "important" | "recommended";
  aiExplanation?: string;
  resolveLabel: string;
  resolveTab: string;
  resolveContext?: string;
  complete: boolean;
};

type Props = {
  hasLogo: boolean;
  hasHeroImage: boolean;
  hasHeroHeadline: boolean;
  hasHeroCta: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  servicesCount: number;
  productsCount: number;
  storeEnabled: boolean;
  hasMetaTitle: boolean;
  hasMetaDescription: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasPolicies: boolean;
  hasFaq: boolean;
  activeDeliveryCount: number;
  onTabChange: (tab: string) => void;
  slug?: string;
  storeName?: string;
};

const SEV_CONFIG = {
  critical: {
    label: "Critical",
    color: "hsl(var(--kf-error, 0 84% 60%))",
    bg: "hsl(var(--kf-error, 0 84% 60%) / 0.1)",
    icon: AlertCircle,
  },
  important: {
    label: "Important",
    color: "hsl(var(--kf-warning))",
    bg: "hsl(var(--kf-warning) / 0.1)",
    icon: AlertTriangle,
  },
  recommended: {
    label: "Recommended",
    color: "hsl(var(--kf-accent1))",
    bg: "hsl(var(--kf-accent1) / 0.1)",
    icon: Info,
  },
};

function buildItems(p: Props): ReadinessItem[] {
  return [
    {
      id: "slug",
      dimension: "Launch",
      title: "Set a public store URL",
      description: "Your storefront needs a custom URL so customers can find and share it.",
      severity: "critical",
      aiExplanation: "Without a store URL, your storefront is inaccessible to the public. This is the single most critical step before going live.",
      resolveLabel: "Set URL",
      resolveTab: "launch",
      complete: p.hasSlug,
    },
    {
      id: "catalog",
      dimension: "Catalog",
      title: "Add products or services",
      description: "You need at least one offering for customers to browse and purchase.",
      severity: "critical",
      aiExplanation: "An empty catalog means zero conversions. Visitors who land on your storefront need something to buy or book — even one item dramatically improves engagement.",
      resolveLabel: "Add Items",
      resolveTab: "catalog",
      complete: p.servicesCount > 0 || p.productsCount > 0,
    },
    {
      id: "go-live",
      dimension: "Launch",
      title: "Publish your store",
      description: "Your store is currently in draft mode and not visible to customers.",
      severity: "critical",
      aiExplanation: "A draft store is completely hidden from customers. Publishing it is the final step that makes your storefront live on the internet.",
      resolveLabel: "Go Live",
      resolveTab: "operations",
      complete: p.storeEnabled,
    },
    {
      id: "hero-image",
      dimension: "Design",
      title: "Upload a hero image or cover photo",
      description: "A compelling hero image is the first thing visitors see. It establishes your brand in seconds.",
      severity: "important",
      aiExplanation: "Storefronts with a hero banner see up to 40% higher engagement. Visual first impressions drive whether visitors stay or leave within 3 seconds of arriving.",
      resolveLabel: "Customize",
      resolveTab: "design",
      complete: p.hasHeroImage,
    },
    {
      id: "hero-copy",
      dimension: "Design",
      title: "Write a headline and call-to-action",
      description: "Your hero section should have a clear value proposition and a compelling CTA.",
      severity: "important",
      aiExplanation: "Weak or missing hero copy is one of the top conversion killers. Visitors need to instantly understand what you offer and what to do next. A strong CTA can increase click-through rates by 90%.",
      resolveLabel: "Edit Hero Copy",
      resolveTab: "design",
      complete: p.hasHeroHeadline && p.hasHeroCta,
    },
    {
      id: "logo",
      dimension: "Design",
      title: "Upload your brand logo",
      description: "A logo builds credibility and brand recognition across your storefront.",
      severity: "important",
      aiExplanation: "Businesses with a visible logo score 13% higher on trust surveys. Your logo appears in the store header and social share previews — it's a core trust signal.",
      resolveLabel: "Upload Logo",
      resolveTab: "design",
      complete: p.hasLogo,
    },
    {
      id: "hours",
      dimension: "Operations",
      title: "Set business hours",
      description: "Customers need to know when you're available for orders and bookings.",
      severity: "important",
      aiExplanation: "Setting business hours reduces friction for customers wondering when they can reach you. It also signals legitimacy — random visitors are more likely to trust businesses that operate on a defined schedule.",
      resolveLabel: "Set Hours",
      resolveTab: "operations",
      complete: p.hoursConfigured,
    },
    {
      id: "delivery",
      dimension: "Operations",
      title: "Configure a delivery or fulfillment method",
      description: "Tell customers how they'll receive their orders — in-person, shipping, or digital delivery.",
      severity: "important",
      aiExplanation: "Customers abandon carts when they can't see how their order will be fulfilled. A clear delivery method removes a critical purchase barrier, especially for first-time buyers.",
      resolveLabel: "Configure Delivery",
      resolveTab: "operations",
      complete: p.activeDeliveryCount > 0,
    },
    {
      id: "testimonials",
      dimension: "Trust",
      title: "Add at least 3 customer testimonials",
      description: "Social proof is the #1 trust signal for new visitors deciding whether to buy.",
      severity: "important",
      aiExplanation: "92% of consumers read reviews before making a purchase. Storefronts with 3+ visible testimonials convert at significantly higher rates than those without — social proof works by reducing perceived risk.",
      resolveLabel: "Add Testimonials",
      resolveTab: "merchandising",
      complete: p.hasTestimonials,
    },
    {
      id: "contact",
      dimension: "Contact",
      title: "Add contact information",
      description: "An email or phone number tells customers how to reach you — boosting trust.",
      severity: "recommended",
      aiExplanation: "Visible contact information (phone, email, or WhatsApp) dramatically increases trust for new customers. It signals that a real person is behind the store and reduces purchase anxiety.",
      resolveLabel: "Update Profile",
      resolveTab: "design",
      complete: p.hasPhone || p.hasEmail,
    },
    {
      id: "seo",
      dimension: "SEO",
      title: "Set an SEO title and meta description",
      description: "Help search engines and social platforms understand and surface your store.",
      severity: "recommended",
      aiExplanation: "A well-crafted meta title and description can improve your click-through rate from search results by 30%+. Without them, search engines generate generic previews that rarely attract clicks.",
      resolveLabel: "Edit SEO",
      resolveTab: "merchandising",
      complete: p.hasMetaTitle && p.hasMetaDescription,
    },
    {
      id: "policies",
      dimension: "Trust",
      title: "Publish at least one store policy",
      description: "Refund or privacy policies build compliance trust and reduce buyer hesitation.",
      severity: "recommended",
      aiExplanation: "Visible policies — especially refund terms — are among the top 5 factors that determine whether a first-time buyer completes their purchase. They signal you're a legitimate, accountable business.",
      resolveLabel: "Add Policies",
      resolveTab: "merchandising",
      complete: p.hasPolicies,
    },
    {
      id: "faq",
      dimension: "Trust",
      title: "Create a FAQ section",
      description: "Answer common questions upfront to reduce friction and support requests.",
      severity: "recommended",
      aiExplanation: "FAQs handle objections before they arise. Stores with FAQ sections see lower bounce rates because visitors get their questions answered without leaving the page to search elsewhere.",
      resolveLabel: "Add FAQ",
      resolveTab: "merchandising",
      complete: p.hasFaq,
    },
  ];
}

function buildDimensions(items: ReadinessItem[]): ReadinessDimension[] {
  const groups: Record<string, { total: number; done: number; weight: number }> = {
    Launch: { total: 0, done: 0, weight: 25 },
    Catalog: { total: 0, done: 0, weight: 20 },
    Design: { total: 0, done: 0, weight: 20 },
    Operations: { total: 0, done: 0, weight: 15 },
    Trust: { total: 0, done: 0, weight: 10 },
    SEO: { total: 0, done: 0, weight: 5 },
    Contact: { total: 0, done: 0, weight: 5 },
  };
  for (const item of items) {
    const g = groups[item.dimension];
    if (!g) continue;
    g.total++;
    if (item.complete) g.done++;
  }
  return Object.entries(groups).map(([label, g]) => ({
    id: label.toLowerCase(),
    label,
    score: g.total === 0 ? 100 : Math.round((g.done / g.total) * 100),
    weight: g.weight,
  }));
}

function computeOverallScore(dims: ReadinessDimension[]): number {
  const totalWeight = dims.reduce((a, d) => a + d.weight, 0);
  const weighted = dims.reduce((a, d) => a + (d.score * d.weight) / 100, 0);
  return Math.round((weighted / totalWeight) * 100);
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const color =
    score >= 80 ? "hsl(var(--kf-success))" : score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))";
  const r = (size / 2) * 0.75;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--kf-muted)/0.2)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={size * 0.22} fontWeight="bold" fill={color}>
        {score}
      </text>
    </svg>
  );
}

export function LaunchAdvisor({
  hasLogo,
  hasHeroImage,
  hasHeroHeadline,
  hasHeroCta,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  servicesCount,
  productsCount,
  storeEnabled,
  hasMetaTitle,
  hasMetaDescription,
  hasPhone,
  hasEmail,
  hasPolicies,
  hasFaq,
  activeDeliveryCount,
  onTabChange,
  slug,
  storeName,
}: Props) {
  const items = buildItems({
    hasLogo, hasHeroImage, hasHeroHeadline, hasHeroCta, hoursConfigured,
    hasTestimonials, hasSlug, servicesCount, productsCount, storeEnabled,
    hasMetaTitle, hasMetaDescription, hasPhone, hasEmail, hasPolicies,
    hasFaq, activeDeliveryCount, onTabChange, slug, storeName,
  });
  const dims = buildDimensions(items);
  const score = computeOverallScore(dims);
  const incomplete = items.filter((i) => !i.complete);
  const criticals = incomplete.filter((i) => i.severity === "critical");
  const importants = incomplete.filter((i) => i.severity === "important");
  const recommendeds = incomplete.filter((i) => i.severity === "recommended");
  const allComplete = incomplete.length === 0;

  const [open, setOpen] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPostLaunch, setShowPostLaunch] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const storeUrl = slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/book/${slug}`
    : "";

  const scoreColor =
    score >= 80 ? "hsl(var(--kf-success))" : score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))";

  const preLaunchVisible: { icon: React.ElementType; label: string; value: string; good: boolean }[] = [
    { icon: Eye, label: "Store status", value: storeEnabled ? "Live — visible to customers" : "Draft — hidden from public", good: storeEnabled },
    { icon: ShieldCheck, label: "Catalog", value: (servicesCount + productsCount) > 0 ? `${servicesCount + productsCount} item(s) available` : "No items — empty catalog", good: (servicesCount + productsCount) > 0 },
    { icon: EyeOff, label: "Policies", value: hasPolicies ? "At least one policy published" : "No policies — may reduce trust", good: hasPolicies },
    { icon: ShieldCheck, label: "Testimonials", value: hasTestimonials ? "Social proof visible" : "No testimonials — trust gap", good: hasTestimonials },
  ];

  const postLaunchSuggestions = [
    { icon: Megaphone, title: "Launch campaign", description: "Share your store link on social media with a launch announcement to drive initial traffic." },
    { icon: TrendingUp, title: "Promote bestsellers", description: "Feature your top-selling or most popular items prominently in your catalog." },
    { icon: ShieldCheck, title: "Enable review collection", description: "Ask your first customers to leave testimonials to build social proof quickly." },
    { icon: Sparkles, title: "Improve hero copy", description: "Use AI to generate a compelling headline and call-to-action for your hero section." },
    { icon: Rocket, title: "Add urgency", description: "Consider adding a limited-time offer or promotional banner to your storefront." },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-3"
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full text-left px-4 py-4 flex items-center gap-4 transition-colors hover:bg-[hsl(var(--kf-muted)/0.05)]"
        >
          <ScoreRing score={score} size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold">
                {allComplete ? "Store Ready to Launch!" : "Launch Readiness"}
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${scoreColor}15`, color: scoreColor }}
              >
                {score}/100
              </span>
              {criticals.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-error, 0 84% 60%) / 0.12)", color: "hsl(var(--kf-error, 0 84% 60%))" }}>
                  {criticals.length} critical
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {dims.map((d) => (
                <div key={d.id} className="space-y-0.5">
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${d.score}%`,
                        background: d.score >= 80 ? "hsl(var(--kf-success))" : d.score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))",
                      }}
                    />
                  </div>
                  <p className="text-[8px]" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}>{d.label}</p>
                </div>
              ))}
            </div>
          </div>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                {allComplete ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-3 flex items-start gap-3 px-3 py-3 rounded-xl"
                    style={{ background: "hsl(var(--kf-success)/0.08)", border: "1px solid hsl(var(--kf-success)/0.2)" }}
                  >
                    <PartyPopper className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-success))" }} />
                    <div>
                      <p className="text-sm font-bold" style={{ color: "hsl(var(--kf-success))" }}>All checks complete!</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Your store meets all readiness criteria. Share it with the world.</p>
                    </div>
                  </motion.div>
                ) : (
                  <div className="pt-2 space-y-1">
                    {([
                      ["critical", criticals],
                      ["important", importants],
                      ["recommended", recommendeds],
                    ] as const).map(([sev, list]) => {
                      if (!list.length) return null;
                      const cfg = SEV_CONFIG[sev];
                      const SevIcon = cfg.icon;
                      return (
                        <div key={sev}>
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <SevIcon className="w-3 h-3 flex-shrink-0" style={{ color: cfg.color }} />
                            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>
                              {cfg.label} ({list.length})
                            </span>
                          </div>
                          {list.map((item) => {
                            const isExpanded = expandedItem === item.id;
                            return (
                              <motion.div
                                key={item.id}
                                layout
                                className="rounded-xl overflow-hidden mb-1"
                                style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                                  className="w-full flex items-start gap-3 px-3 py-2.5 text-left group"
                                >
                                  <SevIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold leading-tight">{item.title}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                    </motion.div>
                                  </div>
                                </button>
                                <AnimatePresence initial={false}>
                                  {isExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.15 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${cfg.color}15` }}>
                                        {item.aiExplanation && (
                                          <div className="pt-2 flex gap-2">
                                            <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
                                            <p className="text-[10px] leading-relaxed" style={{ color: "hsl(var(--kf-foreground)/0.7)" }}>
                                              {item.aiExplanation}
                                            </p>
                                          </div>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => onTabChange(item.resolveTab)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px]"
                                          style={{ background: cfg.color, color: "white" }}
                                        >
                                          {item.resolveLabel}
                                          <ArrowRight className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {storeUrl && (
                  <div className="pt-1 flex gap-2">
                    <a
                      href={`/book/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium min-h-[40px] transition-colors"
                      style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Preview Store
                    </a>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(storeUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium min-h-[40px] transition-colors"
                      style={{ background: "hsl(var(--kf-muted)/0.12)", color: "hsl(var(--kf-foreground)/0.7)" }}
                    >
                      {copied ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          aria-expanded={showPreview}
          className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-[hsl(var(--kf-muted)/0.05)] transition-colors"
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.1)" }}>
            <Eye className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Pre-Launch Summary</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">What customers will see when your store goes live</p>
          </div>
          <motion.div animate={{ rotate: showPreview ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>
        <AnimatePresence initial={false}>
          {showPreview && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                <p className="text-[10px] text-muted-foreground pt-2">Here's what your storefront looks like right now from a customer's perspective:</p>
                {preLaunchVisible.map((row, i) => {
                  const Icon = row.icon;
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl" style={{ background: row.good ? "hsl(var(--kf-success)/0.06)" : "hsl(var(--kf-warning)/0.06)", border: `1px solid ${row.good ? "hsl(var(--kf-success)/0.15)" : "hsl(var(--kf-warning)/0.15)"}` }}>
                      <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: row.good ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }} />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold">{row.label}</p>
                        <p className="text-[10px] text-muted-foreground">{row.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <button
          type="button"
          onClick={() => setShowPostLaunch(!showPostLaunch)}
          aria-expanded={showPostLaunch}
          className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-[hsl(var(--kf-muted)/0.05)] transition-colors"
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-success)/0.1)" }}>
            <Rocket className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Post-Launch Playbook</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">What to do after going live to maximize momentum</p>
          </div>
          <motion.div animate={{ rotate: showPostLaunch ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>
        <AnimatePresence initial={false}>
          {showPostLaunch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                <p className="text-[10px] text-muted-foreground pt-2">You're live — here's how to turn your launch into momentum:</p>
                {postLaunchSuggestions.map((s, i) => {
                  const Icon = s.icon;
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl" style={{ background: "hsl(var(--kf-accent1)/0.05)", border: "1px solid hsl(var(--kf-accent1)/0.1)" }}>
                      <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                      <div>
                        <p className="text-xs font-semibold">{s.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
