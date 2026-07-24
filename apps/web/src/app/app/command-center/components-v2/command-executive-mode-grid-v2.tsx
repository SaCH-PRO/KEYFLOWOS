"use client";

import { useRouter } from "next/navigation";
import {
  Users,
  TrendingUp,
  Megaphone,
  Settings2,
  Scale,
  Rocket,
  ShieldAlert,
  ClipboardList,
} from "lucide-react";
import { MissionCard } from "@/components/ui-v2/mission-card";
import type { CommandCenterExecutiveMode } from "@/lib/api/business-command-center";

const ICONS: Record<string, React.ElementType> = {
  STRATEGIST: Users,
  CFO: TrendingUp,
  CMO: Megaphone,
  COO: Settings2,
  LEGAL_GUIDE: Scale,
  GROWTH_ADVISOR: Rocket,
  RISK_OFFICER: ShieldAlert,
  EXECUTIVE_ASSISTANT: ClipboardList,
};

interface CommandExecutiveModeGridV2Props {
  modes: CommandCenterExecutiveMode[];
}

export function CommandExecutiveModeGridV2({ modes }: CommandExecutiveModeGridV2Props) {
  const router = useRouter();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {modes.map((mode, index) => {
        const Icon = ICONS[mode.mode] ?? Users;
        const status = mode.riskCount > 0 ? "attention" : mode.opportunityCount > 0 ? "ready" : "ready";
        const badge =
          mode.riskCount > 0
            ? `${mode.riskCount} risk`
            : mode.opportunityCount > 0
              ? `${mode.opportunityCount} opp`
              : "Clear";

        return (
          <MissionCard
            key={mode.mode}
            icon={Icon}
            title={mode.label}
            description={mode.summary}
            status={status}
            badge={badge}
            onClick={() => router.push(mode.href)}
            className="animate-reveal"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        );
      })}
    </div>
  );
}
