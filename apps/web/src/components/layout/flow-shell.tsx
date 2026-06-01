"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Banknote,
  Clock,
  Users,
  TrendingUp,
  Megaphone,
  BriefcaseBusiness,
  Truck,
  UserCog,
  FolderArchive,
  BrainCircuit,
  Target,
  ShieldCheck,
  Zap,
  ArrowLeft,
  Bot,
  Command,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FlowDef {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  category: string;
  color: string;
}

const FLOWS: FlowDef[] = [
  { id: "financial", label: "Money", href: "/app/financial-flow", icon: Banknote, category: "MONEY", color: "#10b981" },
  { id: "temporal", label: "Time", href: "/app/temporal-flow", icon: Clock, category: "TIME", color: "#3b82f6" },
  { id: "people", label: "People", href: "/app/people-flow", icon: Users, category: "PEOPLE", color: "#a855f7" },
  { id: "sales", label: "Sales", href: "/app/sales-flow", icon: TrendingUp, category: "SALES", color: "#ec4899" },
  { id: "marketing", label: "Marketing", href: "/app/marketing-flow", icon: Megaphone, category: "MARKETING", color: "#f97316" },
  { id: "operations", label: "Ops", href: "/app/operations-flow", icon: BriefcaseBusiness, category: "WORK", color: "#6366f1" },
  { id: "delivery", label: "Delivery", href: "/app/delivery-flow", icon: Truck, category: "WORK", color: "#14b8a6" },
  { id: "team", label: "Team", href: "/app/team-flow", icon: UserCog, category: "PEOPLE", color: "#8b5cf6" },
  { id: "asset", label: "Assets", href: "/app/asset-flow", icon: FolderArchive, category: "SYSTEM", color: "#64748b" },
  { id: "intelligence", label: "Intel", href: "/app/intelligence-flow", icon: BrainCircuit, category: "SYSTEM", color: "#06b6d4" },
  { id: "strategy", label: "Strategy", href: "/app/strategy-flow", icon: Target, category: "STRATEGY", color: "#d946ef" },
  { id: "governance", label: "Gov", href: "/app/governance-flow", icon: ShieldCheck, category: "GOVERNANCE", color: "#ef4444" },
];

interface FlowShellProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  activeFlowId: string;
  showBackToCenter?: boolean;
}

export function FlowShell({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  children,
  activeFlowId,
  showBackToCenter = true,
}: FlowShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const activeFlow = FLOWS.find((f) => f.id === activeFlowId);
  const accent = iconColor ?? activeFlow?.color ?? "hsl(var(--kf-accent1))";

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 space-y-5">
      {/* Flow navigation pills */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {showBackToCenter && (
          <button
            onClick={() => router.push("/app/command-center")}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:bg-muted/80 mr-1"
            title="Command Center"
          >
            <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
            Home
          </button>
        )}
        <div className="w-px h-4 bg-border flex-shrink-0 mr-1" />
        {FLOWS.map((flow) => {
          const isActive = flow.id === activeFlowId;
          return (
            <button
              key={flow.id}
              onClick={() => router.push(flow.href)}
              className={cn(
                "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                isActive
                  ? "text-white shadow-sm"
                  : "hover:bg-muted/80 text-muted-foreground"
              )}
              style={isActive ? { backgroundColor: flow.color } : undefined}
            >
              <flow.icon className="w-3 h-3" />
              {flow.label}
            </button>
          );
        })}
      </div>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}15` }}
        >
          <Icon className="w-5 h-5" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  );
}

export { FLOWS };
