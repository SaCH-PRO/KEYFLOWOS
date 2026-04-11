"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Star,
  RotateCcw,
  Loader2,
  FileText,
  MessageSquare,
  BarChart3,
  Zap,
  Megaphone,
  Settings2,
  ChevronDown,
  ChevronUp,
  X,
  Check,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api";
import { toast } from "sonner";

type OutputCategory = "documents" | "messages" | "reports" | "briefings" | "marketing" | "general";

const CATEGORY_META: Record<OutputCategory, { label: string; icon: typeof FileText; color: string; desc: string }> = {
  documents: { label: "Documents", icon: FileText, color: "hsl(var(--kf-accent1))", desc: "Business plans, contracts, formal documents" },
  messages: { label: "Messages", icon: MessageSquare, color: "hsl(var(--kf-info))", desc: "Client outreach, follow-ups, drafts" },
  reports: { label: "Reports", icon: BarChart3, color: "hsl(var(--kf-success))", desc: "Business analytics, financial reports" },
  briefings: { label: "Briefings", icon: Zap, color: "hsl(var(--kf-warning))", desc: "Daily/weekly AI summaries" },
  marketing: { label: "Marketing", icon: Megaphone, color: "hsl(var(--kf-accent2))", desc: "Campaign copy, email content" },
  general: { label: "General", icon: Settings2, color: "hsl(var(--muted-foreground))", desc: "All other AI outputs" },
};

const TONES = ["formal", "professional", "friendly", "caribbean-casual"];
const FORMALITIES = ["high", "medium", "low"];
const LENGTHS = ["brief", "medium", "comprehensive"];

const SYSTEM_DEFAULTS: Record<OutputCategory, { tone: string; formality: string; targetLength: string; requiredSections: string[] }> = {
  documents: { tone: "professional", formality: "high", targetLength: "comprehensive", requiredSections: [] },
  messages: { tone: "friendly", formality: "medium", targetLength: "brief", requiredSections: [] },
  reports: { tone: "professional", formality: "high", targetLength: "comprehensive", requiredSections: ["Executive Summary", "Key Findings", "Recommendations"] },
  briefings: { tone: "professional", formality: "medium", targetLength: "medium", requiredSections: ["Summary", "Priorities", "Action Items"] },
  marketing: { tone: "friendly", formality: "low", targetLength: "medium", requiredSections: [] },
  general: { tone: "professional", formality: "medium", targetLength: "medium", requiredSections: [] },
};

interface OutputTemplate {
  id: string;
  name: string;
  category: OutputCategory;
  tone: string;
  formality: string;
  targetLength: string;
  requiredSections: string[];
  customInstructions: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface FormState {
  name: string;
  category: OutputCategory;
  tone: string;
  formality: string;
  targetLength: string;
  requiredSections: string[];
  customInstructions: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "general",
  tone: "professional",
  formality: "medium",
  targetLength: "medium",
  requiredSections: [],
  customInstructions: "",
  isDefault: false,
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

export default function OutputTemplatesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<OutputTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<OutputCategory | "all">("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [resetting, setResetting] = useState<OutputCategory | null>(null);
  const [sectionInput, setSectionInput] = useState("");

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<OutputTemplate[]>(`/api/ai/businesses/${businessId}/output-templates`);
      if (res.data) setTemplates(res.data);
    } catch {
      toast.error("Failed to load output templates");
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category: activeCategory === "all" ? "general" : activeCategory });
    setSectionInput("");
    setShowForm(true);
  };

  const openEdit = (t: OutputTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      category: t.category,
      tone: t.tone,
      formality: t.formality,
      targetLength: t.targetLength,
      requiredSections: [...t.requiredSections],
      customInstructions: t.customInstructions || "",
      isDefault: t.isDefault,
    });
    setSectionInput("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!businessId || !form.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        category: form.category,
        tone: form.tone,
        formality: form.formality,
        targetLength: form.targetLength,
        requiredSections: form.requiredSections,
        customInstructions: form.customInstructions.trim() || null,
        isDefault: form.isDefault,
      };
      if (editingId) {
        await apiPut(`/api/ai/businesses/${businessId}/output-templates/${editingId}`, body);
        toast.success("Template updated");
      } else {
        await apiPost({ path: `/api/ai/businesses/${businessId}/output-templates`, body });
        toast.success("Template created");
      }
      setShowForm(false);
      load();
    } catch {
      toast.error("Failed to save template");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    setDeleting(id);
    try {
      await apiDelete(`/api/ai/businesses/${businessId}/output-templates/${id}`);
      toast.success("Template deleted");
      load();
    } catch {
      toast.error("Failed to delete template");
    }
    setDeleting(null);
  };

  const handleSetDefault = async (id: string) => {
    if (!businessId) return;
    setSettingDefault(id);
    try {
      await apiPost({ path: `/api/ai/businesses/${businessId}/output-templates/${id}/set-default`, body: {} });
      toast.success("Default template updated");
      load();
    } catch {
      toast.error("Failed to set default");
    }
    setSettingDefault(null);
  };

  const handleReset = async (category: OutputCategory) => {
    if (!businessId) return;
    setResetting(category);
    try {
      await apiPost({ path: `/api/ai/businesses/${businessId}/output-templates/reset/${category}`, body: {} });
      toast.success(`${CATEGORY_META[category].label} reset to system defaults`);
      load();
    } catch {
      toast.error("Failed to reset category");
    }
    setResetting(null);
  };

  const addSection = () => {
    const s = sectionInput.trim();
    if (s && !form.requiredSections.includes(s)) {
      setForm(f => ({ ...f, requiredSections: [...f.requiredSections, s] }));
    }
    setSectionInput("");
  };

  const removeSection = (s: string) => {
    setForm(f => ({ ...f, requiredSections: f.requiredSections.filter(x => x !== s) }));
  };

  const filtered = activeCategory === "all" ? templates : templates.filter(t => t.category === activeCategory);
  const categories = Object.keys(CATEGORY_META) as OutputCategory[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          AI Output Templates
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize how AI formats and styles its responses across different content types
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const count = templates.filter(t => t.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`rounded-xl p-3 text-left border transition-all ${
                activeCategory === cat
                  ? "border-border bg-background shadow-sm"
                  : "border-border/40 bg-muted/20 hover:border-border/60"
              }`}
            >
              <meta.icon className="w-4 h-4 mb-1.5" style={{ color: meta.color }} />
              <div className="text-xs font-semibold">{meta.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{count} custom</div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {activeCategory === "all"
            ? `${templates.length} custom template${templates.length !== 1 ? "s" : ""}`
            : `${filtered.length} template${filtered.length !== 1 ? "s" : ""} for ${CATEGORY_META[activeCategory].label}`}
        </div>
        <div className="flex items-center gap-2">
          {activeCategory !== "all" && (
            <button
              onClick={() => handleReset(activeCategory)}
              disabled={resetting === activeCategory}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground transition-colors min-h-[32px]"
            >
              {resetting === activeCategory ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Reset to defaults
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white transition-colors min-h-[32px]"
            style={{ background: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            New template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading templates...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/40 border-dashed p-10 text-center space-y-3">
          <Sparkles className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No custom templates yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              System defaults are active. Create a template to override AI output style for{" "}
              {activeCategory === "all" ? "any category" : CATEGORY_META[activeCategory as OutputCategory].label.toLowerCase()}.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white"
            style={{ background: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            Create first template
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((t) => {
            const meta = CATEGORY_META[t.category];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${meta.color}18` }}
                    >
                      <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{t.name}</span>
                        {t.isDefault && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                            style={{ background: `${meta.color}18`, color: meta.color }}
                          >
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{meta.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!t.isDefault && (
                      <button
                        onClick={() => handleSetDefault(t.id)}
                        disabled={settingDefault === t.id}
                        title="Set as default"
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center"
                      >
                        {settingDefault === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(t)}
                      title="Edit"
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                      title="Delete"
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400 min-h-[28px] min-w-[28px] flex items-center justify-center"
                    >
                      {deleting === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Tone", value: capitalize(t.tone) },
                    { label: "Formality", value: capitalize(t.formality) },
                    { label: "Length", value: capitalize(t.targetLength) },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium">{label}</div>
                      <div className="text-[11px] font-medium mt-0.5">{value}</div>
                    </div>
                  ))}
                </div>

                {t.requiredSections.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.requiredSections.map(s => (
                      <span
                        key={s}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {t.customInstructions && (
                  <p className="text-[11px] text-muted-foreground italic line-clamp-2 border-l-2 border-border/40 pl-2">
                    {t.customInstructions}
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base">{editingId ? "Edit Template" : "New Output Template"}</h3>
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Template Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Formal Client Reports"
                    className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category</label>
                  <div className="grid grid-cols-3 gap-2">
                    {categories.map(cat => {
                      const meta = CATEGORY_META[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => setForm(f => ({ ...f, category: cat, ...SYSTEM_DEFAULTS[cat] }))}
                          className={`rounded-lg p-2.5 text-left border transition-all ${
                            form.category === cat ? "border-primary/50 bg-primary/5" : "border-border/40 hover:border-border"
                          }`}
                        >
                          <meta.icon className="w-3.5 h-3.5 mb-1" style={{ color: meta.color }} />
                          <div className="text-[11px] font-medium">{meta.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Tone</label>
                    <select
                      value={form.tone}
                      onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                      className="w-full text-xs px-2.5 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {TONES.map(t => <option key={t} value={t}>{capitalize(t)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Formality</label>
                    <select
                      value={form.formality}
                      onChange={e => setForm(f => ({ ...f, formality: e.target.value }))}
                      className="w-full text-xs px-2.5 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {FORMALITIES.map(f => <option key={f} value={f}>{capitalize(f)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Length</label>
                    <select
                      value={form.targetLength}
                      onChange={e => setForm(f => ({ ...f, targetLength: e.target.value }))}
                      className="w-full text-xs px-2.5 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {LENGTHS.map(l => <option key={l} value={l}>{capitalize(l)}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Required Sections</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sectionInput}
                      onChange={e => setSectionInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSection(); } }}
                      placeholder="Add a section name..."
                      className="flex-1 text-xs px-2.5 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={addSection}
                      className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {form.requiredSections.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {form.requiredSections.map((s, idx) => (
                        <div
                          key={s}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/30 border border-border/30"
                        >
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => {
                                if (idx === 0) return;
                                const next = [...form.requiredSections];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                setForm(f => ({ ...f, requiredSections: next }));
                              }}
                              disabled={idx === 0}
                              className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-30"
                              title="Move up"
                            >
                              <ChevronUp className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (idx === form.requiredSections.length - 1) return;
                                const next = [...form.requiredSections];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                setForm(f => ({ ...f, requiredSections: next }));
                              }}
                              disabled={idx === form.requiredSections.length - 1}
                              className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-30"
                              title="Move down"
                            >
                              <ChevronDown className="w-2.5 h-2.5" />
                            </button>
                          </div>
                          <span className="flex-1 text-[11px] font-medium">{s}</span>
                          <span className="text-[9px] text-muted-foreground/50 tabular-nums mr-1">{idx + 1}</span>
                          <button onClick={() => removeSection(s)} className="hover:text-red-400 transition-colors p-0.5 rounded">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Custom Instructions</label>
                  <textarea
                    value={form.customInstructions}
                    onChange={e => setForm(f => ({ ...f, customInstructions: e.target.value }))}
                    placeholder="Additional instructions for the AI (e.g. 'Always mention our company name', 'Use simple language suitable for non-technical readers')..."
                    rows={3}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    onClick={() => setForm(f => ({ ...f, isDefault: !f.isDefault }))}
                    className={`w-9 h-5 rounded-full transition-colors relative ${form.isDefault ? "" : "bg-muted"}`}
                    style={form.isDefault ? { background: "hsl(var(--kf-accent1))" } : {}}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        form.isDefault ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                  <span className="text-xs font-medium">Set as default for {CATEGORY_META[form.category].label}</span>
                </label>

                <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Directive Preview</div>
                  <div className="text-[11px] text-muted-foreground space-y-1 font-mono leading-relaxed">
                    <div><span className="text-foreground/60">Tone:</span> {capitalize(form.tone)}</div>
                    <div><span className="text-foreground/60">Formality:</span> {capitalize(form.formality)}</div>
                    <div><span className="text-foreground/60">Length:</span> {capitalize(form.targetLength)}</div>
                    {form.requiredSections.length > 0 && (
                      <div><span className="text-foreground/60">Sections:</span> {form.requiredSections.join(", ")}</div>
                    )}
                    {form.customInstructions.trim() && (
                      <div className="pt-1 border-t border-border/30">
                        <span className="text-foreground/60">Custom:</span> {form.customInstructions.trim().slice(0, 120)}{form.customInstructions.trim().length > 120 ? "..." : ""}
                      </div>
                    )}
                    <div className="pt-1 border-t border-border/30 text-muted-foreground/60 italic">
                      These directives will be appended to every AI system prompt in the {CATEGORY_META[form.category].label} category.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <button
                  onClick={() => setShowForm(false)}
                  className="text-xs px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors min-h-[36px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg text-white transition-colors min-h-[36px] disabled:opacity-50"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  {editingId ? "Save changes" : "Create template"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-xl border border-border/30 bg-muted/10 p-4 space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Defaults</h4>
        <p className="text-xs text-muted-foreground">
          When no custom template is set as default for a category, the system uses built-in quality standards.
          Custom templates override these defaults and are injected into every AI call for that category.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">
          {categories.map(cat => {
            const meta = CATEGORY_META[cat];
            const def = SYSTEM_DEFAULTS[cat];
            const hasCustomDefault = templates.some(t => t.category === cat && t.isDefault);
            return (
              <div key={cat} className="rounded-lg border border-border/30 p-3 bg-background/50">
                <div className="flex items-center gap-1.5 mb-2">
                  <meta.icon className="w-3 h-3" style={{ color: meta.color }} />
                  <span className="text-[11px] font-semibold">{meta.label}</span>
                  {hasCustomDefault ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-auto" style={{ background: `${meta.color}18`, color: meta.color }}>
                      Custom
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-auto bg-muted text-muted-foreground">
                      System
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <div>Tone: {capitalize(def.tone)} · Formality: {capitalize(def.formality)}</div>
                  <div>Length: {capitalize(def.targetLength)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
