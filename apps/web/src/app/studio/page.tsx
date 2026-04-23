"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Users,
  CreditCard,
  Calendar,
  Megaphone,
  Store,
  Settings,
  CheckCircle2,
  Circle,
  ArrowRight,
  Zap,
  Shield,
  Link2,
  Webhook,
  Bell,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getBusinessById,
  fetchServices,
  fetchContacts,
  fetchProducts,
} from "@/lib/client";

interface SetupItem {
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
  checkFn?: (ctx: SetupContext) => boolean;
  category: "essential" | "growth";
}

interface SetupContext {
  hasProfile: boolean;
  hasServices: boolean;
  hasContacts: boolean;
  hasProducts: boolean;
  hasHours: boolean;
  hasLogo: boolean;
  hasComplianceChecked: boolean;
}

const SETUP_ITEMS: SetupItem[] = [
  {
    label: "Business Profile",
    description: "Name, address, branding, and logo",
    icon: Settings,
    href: "/app/settings/business",
    checkFn: (c) => c.hasProfile && c.hasLogo,
    category: "essential",
  },
  {
    label: "Services & Products",
    description: "Define what you sell and your pricing",
    icon: CreditCard,
    href: "/app/store?tab=products",
    checkFn: (c) => c.hasServices || c.hasProducts,
    category: "essential",
  },
  {
    label: "Business Hours",
    description: "Set your weekly availability",
    icon: Calendar,
    href: "/app/bookings?tab=catalog",
    checkFn: (c) => c.hasHours,
    category: "essential",
  },
  {
    label: "Contacts & CRM",
    description: "Import or add your first contacts",
    icon: Users,
    href: "/app/crm",
    checkFn: (c) => c.hasContacts,
    category: "essential",
  },
  {
    label: "Compliance & Tax",
    description: "Legal registration, tax rates, and policies",
    icon: Shield,
    href: "/app/settings/compliance",
    checkFn: (c) => c.hasComplianceChecked,
    category: "essential",
  },
  {
    label: "Online Store",
    description: "Customize your public storefront",
    icon: Store,
    href: "/app/store",
    category: "growth",
  },
  {
    label: "Marketing Campaigns",
    description: "Create and schedule your first campaign",
    icon: Megaphone,
    href: "/app/marketing",
    category: "growth",
  },
  {
    label: "Automations",
    description: "Set up event-driven workflows",
    icon: Zap,
    href: "/app/projects?tab=playbooks",
    category: "growth",
  },
  {
    label: "Payment Gateways",
    description: "Configure WiPay, PayPal, or bank transfer",
    icon: CreditCard,
    href: "/app/settings/business?tab=payments",
    category: "growth",
  },
  {
    label: "Integrations",
    description: "Connect Google Calendar, Gmail, and more",
    icon: Link2,
    href: "/app/settings/connections",
    category: "growth",
  },
  {
    label: "Webhooks & API",
    description: "Developer tools and event data to external systems",
    icon: Webhook,
    href: "/app/settings/developers",
    category: "growth",
  },
  {
    label: "Notifications",
    description: "Configure customer email notifications",
    icon: Bell,
    href: "/app/settings/notifications",
    category: "growth",
  },
];

export default function StudioPage() {
  const [ctx, setCtx] = useState<SetupContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const businessId = getStoredBusinessId();
      if (!businessId) {
        setLoading(false);
        return;
      }
      try {
        const [bizRes, svcRes, contactRes, prodRes] = await Promise.all([
          getBusinessById(businessId),
          fetchServices(businessId),
          fetchContacts(businessId),
          fetchProducts(businessId),
        ]);
        const biz = bizRes.data;
        setCtx({
          hasProfile: !!(biz?.name && biz?.name !== "My Business"),
          hasLogo: !!biz?.logoUrl,
          hasServices: (svcRes.data?.length ?? 0) > 0,
          hasContacts: (contactRes.data?.contacts?.length ?? 0) > 0,
          hasProducts: (prodRes.data?.length ?? 0) > 0,
          hasHours: !!((biz as any)?.businessHours && Object.values((biz as any).businessHours as Record<string, { enabled?: boolean }>).some((h) => h?.enabled)),
          hasComplianceChecked: !!biz?.complianceStatus,
        });
      } catch {
        setCtx({
          hasProfile: false,
          hasLogo: false,
          hasServices: false,
          hasContacts: false,
          hasProducts: false,
          hasHours: false,
          hasComplianceChecked: false,
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const essentialItems = SETUP_ITEMS.filter((i) => i.category === "essential");
  const growthItems = SETUP_ITEMS.filter((i) => i.category === "growth");

  const completedCount = ctx
    ? essentialItems.filter((i) => i.checkFn?.(ctx)).length
    : 0;
  const totalEssential = essentialItems.filter((i) => i.checkFn).length;
  const progressPct = totalEssential > 0 ? Math.round((completedCount / totalEssential) * 100) : 0;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div
          className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: "hsl(var(--kf-accent1) / 0.15)",
            border: "1px solid hsl(var(--kf-accent1) / 0.3)",
          }}
        >
          <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Business Setup</h1>
          <p className="text-sm text-muted-foreground">
            Configure your business, then operate daily from each module.
          </p>
        </div>
      </div>

      {!loading && ctx && (
        <div className="kf-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Setup Progress</span>
            <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
              {completedCount}/{totalEssential} complete
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-border) / 0.3)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                background: progressPct === 100
                  ? "hsl(var(--kf-success))"
                  : "hsl(var(--kf-accent1))",
              }}
            />
          </div>
          {progressPct === 100 && (
            <p className="text-xs" style={{ color: "hsl(var(--kf-success))" }}>
              All essentials configured — you&apos;re ready to operate!
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Essential Setup
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {essentialItems.map((item) => {
            const Icon = item.icon;
            const done = ctx ? item.checkFn?.(ctx) ?? false : false;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="group kf-card p-4 flex items-center gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: done
                      ? "hsl(var(--kf-success) / 0.12)"
                      : "hsl(var(--kf-accent1) / 0.1)",
                  }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{
                      color: done
                        ? "hsl(var(--kf-success))"
                        : "hsl(var(--kf-accent1))",
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.label}</span>
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                    ) : (
                      <Circle className="w-3.5 h-3.5 shrink-0 text-muted-foreground/30" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Grow Your Business
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {growthItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="group kf-card p-4 flex items-center gap-3 transition-all hover:border-[hsl(var(--kf-accent2)_/_0.4)]"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
                >
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{item.label}</span>
                  <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            );
          })}
        </div>
      </div>

      <div
        className="rounded-2xl p-4 space-y-3"
        style={{
          background: "hsl(var(--kf-card) / 0.5)",
          border: "1px solid hsl(var(--kf-border) / 0.3)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Blueprint Mode</div>
            <p className="text-sm text-muted-foreground">Visual entity relationships for your business.</p>
          </div>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px]"
            style={{
              border: "1px solid hsl(var(--kf-accent1) / 0.4)",
              background: "hsl(var(--kf-accent1) / 0.08)",
              color: "hsl(var(--kf-accent1))",
            }}
          >
            Coming Soon
          </span>
        </div>
        <div
          className="rounded-xl p-4"
          style={{
            border: "1px dashed hsl(var(--kf-border) / 0.3)",
            background: "hsl(var(--kf-card) / 0.3)",
          }}
        >
          <div className="text-xs text-muted-foreground mb-2">Graph: Business → Contacts → Invoices → Bookings</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-muted-foreground">
            {[
              { title: "Business", items: "Contacts, Products, Invoices" },
              { title: "Contacts", items: "Invoices, Bookings" },
              { title: "Invoices", items: "Items, Payments, Booking" },
              { title: "Bookings", items: "Service, Staff, Contact" },
            ].map((node) => (
              <div
                key={node.title}
                className="rounded-xl p-3"
                style={{
                  border: "1px solid hsl(var(--kf-border) / 0.3)",
                  background: "hsl(var(--kf-card) / 0.5)",
                }}
              >
                <div className="font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{node.title}</div>
                <div>{node.items}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
