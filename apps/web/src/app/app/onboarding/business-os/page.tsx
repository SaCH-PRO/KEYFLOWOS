"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ArrowRight,
  CheckCircle2,
  Circle,
  Zap,
  Package,
  Users,
  Landmark,
  Clock,
  Bot,
  Rocket,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";

const STEPS = [
  { id: "profile", label: "Complete your business profile", icon: Building2 },
  { id: "products", label: "Add products or services", icon: Package },
  { id: "customers", label: "Add customers and leads", icon: Users },
  { id: "accounts", label: "Add financial accounts", icon: Landmark },
  { id: "hours", label: "Set working hours", icon: Clock },
  { id: "key", label: "Set KEY autonomy preferences", icon: Bot },
  { id: "revenue", label: "Create first revenue action", icon: Rocket },
];

export default function OnboardingBusinessOsPage() {
  const router = useRouter();
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allDone = completed.size === STEPS.length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        icon={Zap}
        title="Set Up Your Business OS"
        subtitle="Complete these steps to activate your command center and let KEY help you run your business."
      />

      <SectionCard icon={Rocket} title="Setup Checklist">
        <div className="space-y-3">
          {STEPS.map((step, idx) => {
            const done = completed.has(step.id);
            return (
              <button
                key={step.id}
                onClick={() => toggle(step.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  done ? "bg-emerald-500/5 border-emerald-500/20" : "hover:bg-muted/50"
                }`}
                style={{ borderColor: done ? undefined : "hsl(var(--kf-border))" }}
              >
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${done ? "line-through opacity-60" : ""}`}>
                    {idx + 1}. {step.label}
                  </p>
                </div>
                <step.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            );
          })}
        </div>

        {allDone && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 text-center">
            <p className="font-semibold text-emerald-600">You&apos;re ready to run your business!</p>
            <button
              onClick={() => router.push("/app/command-center")}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
            >
              Open Command Center
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
