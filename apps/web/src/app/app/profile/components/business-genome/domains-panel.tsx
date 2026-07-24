"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Landmark,
  Users,
  Cog,
  TrendingUp,
  Building2,
  ChevronRight,
} from "lucide-react";
import { KeyGenomeFinancePanel } from "./key-genome-finance-panel";
import { KeyGenomeCustomerSalesPanel } from "./key-genome-customer-sales-panel";
import { KeyGenomeOperationsPanel } from "./key-genome-operations-panel";
import { KeyGenomeMarketingGrowthPanel } from "./key-genome-marketing-growth-panel";
import { KeyGenomeDepartmentsPanel } from "./key-genome-departments-panel";

type DomainId =
  | "finance"
  | "customer-sales"
  | "operations"
  | "marketing-growth"
  | "departments";

interface DomainMeta {
  id: DomainId;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  color: string;
}

const DOMAINS: DomainMeta[] = [
  {
    id: "finance",
    label: "Finance",
    shortLabel: "Finance",
    icon: Landmark,
    color: "hsl(var(--kf-success, 160 70% 45%))",
  },
  {
    id: "customer-sales",
    label: "Customer & Sales",
    shortLabel: "Cust. & Sales",
    icon: Users,
    color: "hsl(var(--kf-accent1))",
  },
  {
    id: "operations",
    label: "Operations",
    shortLabel: "Operations",
    icon: Cog,
    color: "hsl(var(--kf-warning, 30 90% 55%))",
  },
  {
    id: "marketing-growth",
    label: "Marketing & Growth",
    shortLabel: "Mkt. & Growth",
    icon: TrendingUp,
    color: "hsl(320 80% 60%)",
  },
  {
    id: "departments",
    label: "Departments",
    shortLabel: "Departments",
    icon: Building2,
    color: "hsl(260 70% 60%)",
  },
];

const DOMAIN_COMPONENTS: Record<DomainId, React.ComponentType<{ onGenomeUpdate?: () => void }>> = {
  finance: KeyGenomeFinancePanel,
  "customer-sales": KeyGenomeCustomerSalesPanel,
  operations: KeyGenomeOperationsPanel,
  "marketing-growth": KeyGenomeMarketingGrowthPanel,
  departments: KeyGenomeDepartmentsPanel,
};

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

export function DomainsPanel({ onGenomeUpdate }: { onGenomeUpdate?: () => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawDomain = searchParams.get("domain") as DomainId | null;
  const activeDomain = DOMAINS.some((d) => d.id === rawDomain)
    ? (rawDomain as DomainId)
    : "finance";

  const setDomain = useCallback(
    (domain: DomainId) => {
      if (domain === activeDomain) return;
      const url = `/app/profile?tab=business-genome&section=domains&domain=${domain}`;
      router.replace(url, { scroll: false });
    },
    [activeDomain, router],
  );

  const ActiveComponent = DOMAIN_COMPONENTS[activeDomain];
  const activeMeta = DOMAINS.find((d) => d.id === activeDomain)!;

  return (
    <div className="space-y-4">
      {/* Hero header */}
      <div
        className="rounded-2xl p-4 sm:p-5 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${activeMeta.color}15` }}
          >
            <activeMeta.icon className="w-6 h-6" style={{ color: activeMeta.color }} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{activeMeta.label}</h2>
            <p className="text-xs text-muted-foreground">
              Domain deep-dive · select another domain to compare and manage.
            </p>
          </div>
        </div>
      </div>

      {/* Domain switcher — mobile: horizontal scroll; desktop: top pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {DOMAINS.map((domain) => {
          const Icon = domain.icon;
          const isActive = activeDomain === domain.id;
          return (
            <button
              key={domain.id}
              onClick={() => setDomain(domain.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap flex-shrink-0"
              style={{
                background: isActive ? `${domain.color}15` : "hsl(var(--kf-card))",
                color: isActive ? domain.color : "hsl(var(--kf-muted-foreground))",
                border: `1px solid ${isActive ? `${domain.color}30` : "hsl(var(--kf-border) / 0.2)"}`,
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{domain.label}</span>
              <span className="sm:hidden">{domain.shortLabel}</span>
              {isActive && <ChevronRight className="w-3 h-3" />}
            </button>
          );
        })}
      </div>

      {/* Active domain panel */}
      <AnimatePresence mode="wait">
        <motion.div key={activeDomain} {...fade}>
          <ActiveComponent onGenomeUpdate={onGenomeUpdate} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
