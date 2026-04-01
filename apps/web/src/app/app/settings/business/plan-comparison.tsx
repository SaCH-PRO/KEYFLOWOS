"use client";

import { Check, X, Crown, Zap, Star, Infinity } from "lucide-react";

type PlanTier = "FREE" | "FLOW" | "KEYFLOW";

interface PlanComparisonProps {
  currentPlan: PlanTier;
  currency: "TTD" | "USD";
  onSelectPlan: (plan: PlanTier) => void;
}

const PLAN_META: Record<PlanTier, { name: string; tagline: string; icon: typeof Star; color: string; price: { TTD: number; USD: number } }> = {
  FREE: { name: "Free", tagline: "Get started", icon: Star, color: "text-muted-foreground", price: { TTD: 0, USD: 0 } },
  FLOW: { name: "Flow", tagline: "Growing businesses", icon: Zap, color: "text-amber-400", price: { TTD: 99, USD: 15 } },
  KEYFLOW: { name: "KeyFlow", tagline: "Full power", icon: Crown, color: "text-violet-400", price: { TTD: 249, USD: 39 } },
};

type FeatureValue = boolean | string | number;

interface FeatureRow {
  label: string;
  free: FeatureValue;
  flow: FeatureValue;
  keyflow: FeatureValue;
}

interface FeatureGroup {
  category: string;
  features: FeatureRow[];
}

const FEATURE_GRID: FeatureGroup[] = [
  {
    category: "Core",
    features: [
      { label: "Contacts", free: "50", flow: "500", keyflow: "Unlimited" },
      { label: "Invoices / month", free: "10", flow: "100", keyflow: "Unlimited" },
      { label: "Bookings / month", free: "20", flow: "200", keyflow: "Unlimited" },
      { label: "Products", free: "10", flow: "100", keyflow: "Unlimited" },
      { label: "Staff members", free: "1", flow: "5", keyflow: "Unlimited" },
    ],
  },
  {
    category: "Marketing",
    features: [
      { label: "Campaigns / month", free: "2", flow: "20", keyflow: "Unlimited" },
      { label: "Lead forms", free: "1", flow: "10", keyflow: "Unlimited" },
      { label: "Email templates", free: false, flow: true, keyflow: true },
      { label: "Audience segmentation", free: false, flow: true, keyflow: true },
      { label: "Social scheduling", free: false, flow: false, keyflow: true },
    ],
  },
  {
    category: "AI & Automation",
    features: [
      { label: "AI credits / month", free: "25", flow: "200", keyflow: "Unlimited" },
      { label: "AI Command Hub", free: true, flow: true, keyflow: true },
      { label: "Playbook automations", free: "2", flow: "20", keyflow: "Unlimited" },
      { label: "AI cash flow forecast", free: false, flow: true, keyflow: true },
      { label: "AI next-best-actions", free: false, flow: true, keyflow: true },
      { label: "Custom AI prompts", free: false, flow: false, keyflow: true },
    ],
  },
  {
    category: "Commerce & Payments",
    features: [
      { label: "Payment links", free: true, flow: true, keyflow: true },
      { label: "Recurring invoices", free: false, flow: true, keyflow: true },
      { label: "Multi-currency", free: false, flow: true, keyflow: true },
      { label: "Quote-to-invoice", free: false, flow: true, keyflow: true },
      { label: "Expense tracking", free: true, flow: true, keyflow: true },
      { label: "Budget management", free: false, flow: true, keyflow: true },
    ],
  },
  {
    category: "Reporting & Analytics",
    features: [
      { label: "Basic reports", free: true, flow: true, keyflow: true },
      { label: "AI-powered reports", free: false, flow: true, keyflow: true },
      { label: "PDF export", free: false, flow: true, keyflow: true },
      { label: "Financial copilot", free: false, flow: false, keyflow: true },
      { label: "Predictive revenue", free: false, flow: false, keyflow: true },
    ],
  },
  {
    category: "Store & Branding",
    features: [
      { label: "Public storefront", free: true, flow: true, keyflow: true },
      { label: "Custom domain", free: false, flow: false, keyflow: true },
      { label: "Remove branding", free: false, flow: false, keyflow: true },
      { label: "Testimonials", free: "3", flow: "20", keyflow: "Unlimited" },
    ],
  },
  {
    category: "Support",
    features: [
      { label: "Community support", free: true, flow: true, keyflow: true },
      { label: "Priority email support", free: false, flow: true, keyflow: true },
      { label: "Dedicated onboarding", free: false, flow: false, keyflow: true },
    ],
  },
];

function CellValue({ value }: { value: FeatureValue }) {
  if (value === true) return <Check className="w-4 h-4 mx-auto" style={{ color: "hsl(var(--kf-success))" }} />;
  if (value === false) return <X className="w-4 h-4 mx-auto text-muted-foreground/30" />;
  if (value === "Unlimited") return <Infinity className="w-4 h-4 mx-auto" style={{ color: "hsl(var(--kf-accent1))" }} />;
  return <span className="text-xs font-medium">{value}</span>;
}

export function PlanComparison({ currentPlan, currency, onSelectPlan }: PlanComparisonProps) {
  const plans: PlanTier[] = ["FREE", "FLOW", "KEYFLOW"];
  const currSymbol = currency === "TTD" ? "TT$" : "US$";

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr>
              <th className="text-left py-3 px-2 w-[40%]" />
              {plans.map((p) => {
                const meta = PLAN_META[p];
                const PIcon = meta.icon;
                const isCurrent = p === currentPlan;
                return (
                  <th key={p} className="text-center py-3 px-2 w-[20%]">
                    <div className={`rounded-xl p-3 ${isCurrent ? "border-2 border-[hsl(var(--kf-accent1))]" : "border border-border/40"}`}>
                      <PIcon className={`w-5 h-5 mx-auto mb-1 ${meta.color}`} />
                      <div className="font-bold">{meta.name}</div>
                      <div className="text-[10px] text-muted-foreground">{meta.tagline}</div>
                      <div className="mt-1">
                        <span className="text-lg font-bold">{currSymbol}{meta.price[currency]}</span>
                        <span className="text-[10px] text-muted-foreground">/mo</span>
                      </div>
                      {isCurrent ? (
                        <div className="mt-2 text-[10px] px-2 py-1 rounded-full bg-muted/30 font-medium">Current Plan</div>
                      ) : (
                        <button
                          onClick={() => onSelectPlan(p)}
                          className="mt-2 text-[10px] px-3 py-1 rounded-full font-medium transition-all"
                          style={{
                            background: "hsl(var(--kf-accent1))",
                            color: "white",
                          }}
                        >
                          {p === "FREE" ? "Downgrade" : "Upgrade"}
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {FEATURE_GRID.map((group) => (
              <>
                <tr key={`group-${group.category}`}>
                  <td
                    colSpan={4}
                    className="py-2 px-2 text-xs font-semibold uppercase tracking-wider border-b border-border/30"
                    style={{ color: "hsl(var(--kf-accent1))" }}
                  >
                    {group.category}
                  </td>
                </tr>
                {group.features.map((f) => (
                  <tr key={f.label} className="border-b border-border/10 hover:bg-muted/5">
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{f.label}</td>
                    <td className="py-2.5 px-2 text-center"><CellValue value={f.free} /></td>
                    <td className="py-2.5 px-2 text-center"><CellValue value={f.flow} /></td>
                    <td className="py-2.5 px-2 text-center"><CellValue value={f.keyflow} /></td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
