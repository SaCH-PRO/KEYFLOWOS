"use client";

import { useEffect, useState } from "react";
import { Megaphone, Mail, PenTool, Share2, Target, ArrowRight, Plus, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { fetchCampaignPlans, createCampaignPlan, deleteCampaignPlan, type CampaignPlan } from "@/lib/api/marketing";

export default function MarketingFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [campaigns, setCampaigns] = useState<CampaignPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    async function load() {
      const res = await fetchCampaignPlans(businessId);
      if (!cancelled && res.data) setCampaigns(res.data);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleAdd = async () => {
    if (!businessId || !newName.trim()) return;
    setSaving(true);
    try {
      const res = await createCampaignPlan(businessId, { name: newName.trim(), goal: newGoal.trim() || undefined, channel: newChannel.trim() || undefined, budget: newBudget ? Number(newBudget) : undefined });
      if (res.data) {
        setCampaigns((prev) => [res.data!, ...prev]);
        setNewName("");
        setNewGoal("");
        setNewChannel("");
        setNewBudget("");
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteCampaignPlan(businessId, id);
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  const sections = [
    { label: "Campaigns", href: "/app/marketing", icon: Mail, desc: "Email campaigns and automations" },
    { label: "Content", href: "/app/content-ops", icon: PenTool, desc: "Content and publishing" },
    { label: "Social", href: "/app/social", icon: Share2, desc: "Social media management" },
    { label: "Offers", href: "/app/marketing", icon: Target, desc: "Promotions and lead capture" },
  ];

  const statusColors: Record<string, string> = {
    DRAFT: "bg-slate-500/10 text-slate-600",
    ACTIVE: "bg-emerald-500/10 text-emerald-600",
    PAUSED: "bg-amber-500/10 text-amber-600",
    COMPLETED: "bg-blue-500/10 text-blue-600",
  };

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

      {/* Campaign Plans */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaign Plans</p>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            {showAdd ? "Cancel" : "Add plan"}
          </button>
        </div>

        {showAdd && (
          <div className="kf-card p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Campaign name"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
                placeholder="Channel (email, social, etc)"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="Goal"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                placeholder="Budget"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create plan
            </button>
          </div>
        )}

        {loading ? (
          <div className="animate-pulse h-16 kf-card" />
        ) : campaigns.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No campaign plans yet. Add one to track your marketing initiatives.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="kf-card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Megaphone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[c.status] ?? "bg-muted text-muted-foreground"}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    {c.goal && <span>Goal: {c.goal}</span>}
                    {c.channel && <span>Channel: {c.channel}</span>}
                    {c.budget && <span>Budget: {c.budget.toLocaleString()}</span>}
                    {c.expectedRevenue && <span>Expected: {c.expectedRevenue.toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </FlowShell>
  );
}
