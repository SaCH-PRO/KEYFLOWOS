"use client";

import { Users, TrendingUp, Megaphone, Settings2, Scale, Rocket, ShieldAlert, ClipboardList } from "lucide-react";
import type { KeyExecutiveMode, KeyModeListItem } from "@/lib/api/intelligence";

const MODE_ICONS: Record<KeyExecutiveMode, React.ElementType> = {
  STRATEGIST: Users,
  CFO: TrendingUp,
  CMO: Megaphone,
  COO: Settings2,
  LEGAL_GUIDE: Scale,
  GROWTH_ADVISOR: Rocket,
  RISK_OFFICER: ShieldAlert,
  EXECUTIVE_ASSISTANT: ClipboardList,
};

interface KeyModeSelectorProps {
  modes: KeyModeListItem[];
  active?: KeyExecutiveMode | null;
  onSelect: (mode: KeyExecutiveMode) => void;
}

export function KeyModeSelector({ modes, active, onSelect }: KeyModeSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {modes.map((mode) => {
        const Icon = MODE_ICONS[mode.mode];
        const isActive = active === mode.mode;
        return (
          <button
            key={mode.mode}
            onClick={() => onSelect(mode.mode)}
            className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border text-left transition-all ${
              isActive
                ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                : "border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20"
            }`}
          >
            <Icon
              className="w-5 h-5"
              style={{ color: isActive ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))" }}
            />
            <div className="text-center">
              <div className="text-[10px] font-semibold leading-tight">{mode.label}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{mode.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
