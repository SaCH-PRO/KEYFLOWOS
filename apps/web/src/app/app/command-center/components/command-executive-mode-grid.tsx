"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Users, TrendingUp, Megaphone, Settings2, Scale, Rocket, ShieldAlert, ClipboardList } from "lucide-react";
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

interface CommandExecutiveModeGridProps {
  modes: CommandCenterExecutiveMode[];
}

export function CommandExecutiveModeGrid({ modes }: CommandExecutiveModeGridProps) {
  const router = useRouter();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {modes.map((mode, index) => {
        const Icon = ICONS[mode.mode] ?? Users;
        return (
          <motion.button
            key={mode.mode}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            onClick={() => router.push(mode.href)}
            className="flex flex-col items-start gap-2 p-3 rounded-xl border border-border/30 bg-card/40 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left"
          >
            <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <div>
              <div className="text-xs font-medium text-foreground">{mode.label}</div>
              <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{mode.summary}</p>
              <div className="flex items-center gap-2 mt-1.5 text-[9px] text-muted-foreground">
                {mode.riskCount > 0 && <span className="text-destructive">{mode.riskCount} risk</span>}
                {mode.opportunityCount > 0 && <span className="text-[hsl(var(--kf-accent1))]">{mode.opportunityCount} opp</span>}
                {mode.riskCount === 0 && mode.opportunityCount === 0 && <span>Clear</span>}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
