"use client";

import { useEffect, useState } from "react";
import { BriefcaseBusiness, FolderKanban, CheckSquare, FileText, Layers, ArrowRight, Plus, Loader2, Trash2, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { FlowQuickLauncher } from "@/components/layout/flow-quick-launcher";
import type { ModuleLauncherSection } from "@/components/ui/module-launcher-sheet";
import { fetchSops, createSop, deleteSop, type SopDocument } from "@/lib/api/sop";

export default function OperationsFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [sops, setSops] = useState<SopDocument[]>([]);
  const [loadingSops, setLoadingSops] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newBody, setNewBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    async function load() {
      const res = await fetchSops(businessId);
      if (!cancelled && res.data) setSops(res.data);
      setLoadingSops(false);
    }
    load();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleAdd = async () => {
    if (!businessId || !newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await createSop(businessId, { title: newTitle.trim(), department: newDept.trim() || undefined, body: newBody.trim() || "No content yet." });
      if (res.data) {
        setSops((prev) => [res.data!, ...prev]);
        setNewTitle("");
        setNewDept("");
        setNewBody("");
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteSop(businessId, id);
    setSops((prev) => prev.filter((s) => s.id !== id));
  };

  const sections = [
    { label: "Projects", href: "/app/projects", icon: FolderKanban, desc: "Active work and delivery" },
    { label: "Tasks", href: "/app/approvals", icon: CheckSquare, desc: "Task management" },
    { label: "Workflows", href: "/app/workflows", icon: Layers, desc: "Automated workflows" },
  ];

  const launcherSections: ModuleLauncherSection[] = [
    {
      id: "work",
      label: "Work",
      items: [
        { id: "projects", label: "Projects", icon: FolderKanban, href: "/app/projects", tone: "violet" },
        { id: "tasks", label: "Tasks", icon: CheckSquare, href: "/app/approvals", tone: "orange" },
        { id: "workflows", label: "Workflows", icon: Layers, href: "/app/workflows", tone: "teal" },
      ],
    },
    {
      id: "system",
      label: "System",
      items: [
        { id: "automations", label: "Automations", icon: Layers, href: "/app/flows", tone: "mint" },
        { id: "structure", label: "Structure", icon: BriefcaseBusiness, href: "/app/structure", tone: "sky" },
        { id: "settings", label: "Settings", icon: Settings, href: "/app/settings", tone: "default" },
      ],
    },
  ];

  return (
    <FlowShell
      title="Operations Flow"
      subtitle="Run the business. Processes, projects, and workflows."
      icon={BriefcaseBusiness}
      activeFlowId="operations"
      headerActions={
        <FlowQuickLauncher
          title="Operations Modules"
          subtitle="Work and system tools"
          sections={launcherSections}
        />
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        {sections.map((s, idx) => (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.25 }}
            onClick={() => router.push(s.href)}
            className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group"
          >
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
          </motion.button>
        ))}
      </motion.div>

      {/* SOPs */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Standard Operating Procedures</p>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            {showAdd ? "Cancel" : "Add SOP"}
          </button>
        </div>

        {showAdd && (
          <div className="kf-card p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="SOP title"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                placeholder="Department"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Procedure description..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 resize-none"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            />
            <button
              onClick={handleAdd}
              disabled={!newTitle.trim() || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create SOP
            </button>
          </div>
        )}

        {loadingSops ? (
          <div className="animate-pulse h-16 kf-card" />
        ) : sops.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No SOPs yet. Add one to document your processes.</p>
        ) : (
          <div className="space-y-2">
            {sops.map((sop) => (
              <div key={sop.id} className="kf-card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{sop.title}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">v{sop.version}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{sop.department}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sop.body}</p>
                </div>
                <button
                  onClick={() => handleDelete(sop.id)}
                  className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </FlowShell>
  );
}
