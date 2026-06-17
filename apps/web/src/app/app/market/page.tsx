"use client";

import { Target } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MarketStrategyPanel } from "./components/MarketStrategyPanel";

export default function MarketStrategyPage() {
  return (
    <WorkspaceShell title="Market Strategy & Intelligence" icon={Target}>
      <MarketStrategyPanel />
    </WorkspaceShell>
  );
}
