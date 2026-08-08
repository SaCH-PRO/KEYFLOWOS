"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Store,
  Building2,
  Ticket,
  Megaphone,
  CreditCard,
  Receipt,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

interface HubModule {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  color: string;
  badge?: string;
}

const MODULES: HubModule[] = [
  {
    id: "storefront",
    label: "Storefront",
    description: "Sell products, bookings, and services online.",
    href: "/app/store",
    icon: Store,
    color: "hsl(var(--kf-accent1))",
  },
  {
    id: "portal",
    label: "Business Portal",
    description: "Client self-service hub for invoices & bookings.",
    href: "/app/portal",
    icon: Building2,
    color: "hsl(var(--kf-accent2))",
  },
  {
    id: "events",
    label: "Events & Ticketing",
    description: "Create events, sell tickets, check in attendees.",
    href: "/app/events",
    icon: Ticket,
    color: "hsl(320 80% 60%)",
  },
  {
    id: "mass-comms",
    label: "Mass Comms",
    description: "Campaigns, broadcasts, and customer messaging.",
    href: "/app/communicate/campaigns",
    icon: Megaphone,
    color: "hsl(var(--kf-warning, 30 90% 55%))",
  },
  {
    id: "gateway",
    label: "Payment Gateway",
    description: "Collect across invoices, orders, and tickets.",
    href: "/app/commerce/gateway",
    icon: CreditCard,
    color: "hsl(var(--kf-success, 160 70% 45%))",
  },
  {
    id: "invoices",
    label: "Invoices & Pipeline",
    description: "Quotes, invoices, collections, and revenue flow.",
    href: "/app/commerce?tab=pipeline",
    icon: Receipt,
    color: "hsl(210 80% 60%)",
  },
];

export function CommerceHub() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border/40 p-4 sm:p-5"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.08) 100%)",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Commerce Hub</h2>
          <p className="text-xs text-muted-foreground">
            Storefront, portal, events, messaging, and payments in one place.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map((module, index) => {
          const Icon = module.icon;
          return (
            <motion.div
              key={module.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
            >
              <Link
                href={module.href}
                className="group flex items-start gap-3 rounded-xl border border-border/30 bg-card/40 p-3 transition-all hover:bg-card/80 hover:border-border/50 hover:shadow-sm h-full"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${module.color}15` }}
                >
                  <Icon className="h-5 w-5" style={{ color: module.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{module.label}</span>
                    {module.badge && (
                      <span
                        className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ background: `${module.color}15`, color: module.color }}
                      >
                        {module.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {module.description}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 shrink-0 mt-1" />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
