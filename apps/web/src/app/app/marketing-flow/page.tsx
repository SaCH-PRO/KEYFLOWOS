"use client";

import { Megaphone, Mail, PenTool, Share2, Target, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { FlowShell } from "@/components/layout/flow-shell";

export default function MarketingFlowPage() {
  const router = useRouter();
  const sections = [
    { label: "Campaigns", href: "/app/marketing", icon: Mail, desc: "Email campaigns and automations" },
    { label: "Content", href: "/app/content-ops", icon: PenTool, desc: "Content and publishing" },
    { label: "Social", href: "/app/social", icon: Share2, desc: "Social media management" },
    { label: "Offers", href: "/app/marketing", icon: Target, desc: "Promotions and lead capture" },
  ];

  return (
    <FlowShell
      title="Marketing Flow"
      subtitle="Create demand. Campaigns, content, and lead capture."
      icon={Megaphone}
      activeFlowId="marketing"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => (
          <button key={s.label} onClick={() => router.push(s.href)} className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </FlowShell>
  );
}
