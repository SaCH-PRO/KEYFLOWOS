"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Users, Link2, Settings, Webhook, Bell, Code2, Palette, Sparkles, CreditCard, Brain, Crown, Shield, ShieldCheck, FileCheck, Layers, Zap, Gift, BarChart3, FormInput, Bot } from "lucide-react";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import { useNavigationContext } from "@/lib/navigation-context";

const navItems = [
  { href: "/app/settings/billing", label: "Billing", icon: Crown, description: "Subscription & usage" },
  { href: "/app/settings/invite", label: "Invite & Earn", icon: Gift, description: "Refer friends, earn credits" },
  { href: "/app/settings/business", label: "Payment Gateways", icon: CreditCard, description: "Customer payment methods" },
  { href: "/app/settings/catalog", label: "Catalog", icon: Layers, description: "Products & services" },
  { href: "/app/settings/team", label: "Team", icon: Users, description: "Staff & roles" },
  { href: "/app/key-connect", label: "Connect", icon: Link2, description: "Integrations hub" },

  { href: "/app/settings/custom-fields", label: "Custom Fields", icon: FormInput, description: "Structured contact attributes" },
  { href: "/app/settings/notifications", label: "Notifications", icon: Bell, description: "Customer emails" },
  { href: "/app/settings/webhooks", label: "Webhooks", icon: Webhook, description: "Event hooks" },
  { href: "/app/settings/templates", label: "Templates", icon: Palette, description: "Gallery" },
  { href: "/app/settings/output-templates", label: "AI Output", icon: Sparkles, description: "AI style" },
  { href: "/app/settings/developers", label: "Developers", icon: Code2, description: "API & extensions" },
  { href: "/app/settings/ai-control", label: "AI Control", icon: Brain, description: "AI governance" },
  { href: "/app/settings/autonomy", label: "Autonomy", icon: Bot, description: "KEY autonomy & kill switch" },
  { href: "/app/settings/ai", label: "L4 AI", icon: Zap, description: "Capacity & authority" },
  { href: "/app/settings/privacy", label: "Privacy", icon: Shield, description: "GDPR & forget" },
  { href: "/app/settings/compliance", label: "Compliance", icon: FileCheck, description: "Consent & records" },
  { href: "/app/settings/security", label: "Security", icon: ShieldCheck, description: "Audit & checks" },
  { href: "/app/settings/insights", label: "Insights", icon: BarChart3, description: "Product events & feedback" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { getOriginContext } = useNavigationContext();
  const origin = getOriginContext();

  const showContinuityHeader = !!origin && origin.workspace !== "Studio";

  const getTaskLabel = () => {
    const item = navItems.find((n) => pathname === n.href || pathname.startsWith(n.href));
    return item ? `Configure ${item.label}` : `Studio`;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {showContinuityHeader && (
        <TaskContinuityHeader
          taskLabel={getTaskLabel()}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Billing, payment gateways, integrations, and workspace configuration</p>
        </div>
      </motion.div>

      <motion.nav
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex gap-1 p-1 rounded-2xl bg-muted/30 backdrop-blur-sm border border-border/40 overflow-x-auto scrollbar-none"
        role="tablist"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/app/settings" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={isActive}
              className={`relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 shrink-0 ${
                isActive
                  ? "text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="settings-tab-bg"
                  className="absolute inset-0 rounded-xl bg-background border border-border/60 shadow-sm"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </span>
            </Link>
          );
        })}
      </motion.nav>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
