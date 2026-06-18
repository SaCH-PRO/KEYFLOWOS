"use client";

import { Clock } from "lucide-react";
import { FlowShell } from "@/components/layout/flow-shell";
import { TemporalFlowShell } from "./components/temporal-flow-shell";

export default function TemporalFlowPage() {
  return (
    <FlowShell
      title="Temporal Flow"
      subtitle="The living timeline of your business — events, reminders, and KEY intelligence."
      icon={Clock}
      activeFlowId="temporal"
    >
      <TemporalFlowShell />
    </FlowShell>
  );
}
