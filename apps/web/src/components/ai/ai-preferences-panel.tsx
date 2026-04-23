"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Target, MessageSquare, ShieldAlert, Send, Clock,
  Star, AlertCircle, BarChart3, Loader2, Plus, X,
  RefreshCw, Trash2, Save,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiMemory,
  upsertAiMemory,
  upsertAiMemoryBulk,
  deleteAiMemory,
  summarizeAiPatterns,
  type AiMemoryEntry,
  type AiMemoryCategory,
} from "@/lib/client";

const TONE_OPTIONS = ["professional", "friendly", "caribbean-casual", "formal", "warm", "direct"];
const RISK_OPTIONS = ["conservative", "moderate", "aggressive"];
const OUTREACH_OPTIONS = ["personal", "automated", "mixed", "warm-first"];
const CADENCE_OPTIONS = ["daily", "weekly", "bi-weekly", "monthly"];

interface PreferenceFieldProps {
  label: string;
  icon: typeof Target;
  value: string;
  options: string[];
  onChange: (val: string) => void;
  saving: boolean;
}

function PreferenceSelect({ label, icon: Icon, value, options, onChange, saving }: PreferenceFieldProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent1))]/10 shrink-0">
        <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={saving}
          className="block w-full mt-1 text-xs bg-background/50 border border-border/30 rounded-lg px-2 py-1.5 text-foreground/80 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 disabled:opacity-50"
        >
          <option value="">Not set</option>
          {options.map(o => (
            <option key={o} value={o}>{o.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface ListFieldProps {
  label: string;
  icon: typeof Target;
  category: AiMemoryCategory;
  items: AiMemoryEntry[];
  onAdd: (category: AiMemoryCategory, value: string) => void;
  onRemove: (category: AiMemoryCategory, key: string) => void;
  saving: boolean;
  placeholder?: string;
}

function ListField({ label, icon: Icon, category, items, onAdd, onRemove, saving, placeholder }: ListFieldProps) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const val = input.trim();
    if (!val) return;
    onAdd(category, val);
    setInput("");
  };

  return (
    <div className="p-3 rounded-xl border border-border/30 bg-card/30">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent1))]/10 shrink-0">
          <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        </div>
        <span className="text-xs font-medium text-foreground/80">{label}</span>
      </div>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          placeholder={placeholder || `Add ${label.toLowerCase()}...`}
          disabled={saving}
          className="flex-1 text-xs bg-background/50 border border-border/30 rounded-lg px-2 py-1.5 text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 disabled:opacity-50"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !input.trim()}
          className="px-2 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => (
            <span
              key={item.id}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted/20 text-foreground/70 border border-border/20"
            >
              {item.value}
              <button
                onClick={() => onRemove(category, item.key)}
                disabled={saving}
                className="text-muted-foreground/40 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {items.length === 0 && (
        <p className="text-[10px] text-muted-foreground/40 italic">No {label.toLowerCase()} set yet</p>
      )}
    </div>
  );
}

export function AiPreferencesPanel() {
  const [memories, setMemories] = useState<AiMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchAiMemory(biz);
      if (res.data) setMemories(res.data.memories);
      else if (res.error) toast.error(res.error);
    } catch {
      toast.error("Failed to load AI preferences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getByCategory = (cat: string) => memories.filter(m => m.category === cat);
  const getSingleValue = (cat: string, key: string) => {
    const entry = memories.find(m => m.category === cat && m.key === key);
    return entry?.value || "";
  };

  const handleSelectChange = useCallback(async (category: AiMemoryCategory, key: string, value: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setSaving(true);
    try {
      if (!value) {
        const delRes = await deleteAiMemory(biz, category, key);
        if (delRes.error) { toast.error(delRes.error); return; }
        setMemories(prev => prev.filter(m => !(m.category === category && m.key === key)));
        toast.success("Preference cleared");
      } else {
        const res = await upsertAiMemory(biz, { category, key, value });
        if (res.error) { toast.error(res.error); return; }
        if (res.data) {
          setMemories(prev => {
            const filtered = prev.filter(m => !(m.category === category && m.key === key));
            return [...filtered, res.data!.memory];
          });
          toast.success("Preference saved");
        }
      }
    } catch {
      toast.error("Failed to save preference");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleAddListItem = useCallback(async (category: AiMemoryCategory, value: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setSaving(true);
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
    try {
      const res = await upsertAiMemory(biz, { category, key, value });
      if (res.error) { toast.error(res.error); return; }
      if (res.data) {
        setMemories(prev => {
          const filtered = prev.filter(m => !(m.category === category && m.key === key));
          return [...filtered, res.data!.memory];
        });
        toast.success("Added");
      }
    } catch {
      toast.error("Failed to add item");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleRemoveListItem = useCallback(async (category: AiMemoryCategory, key: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setSaving(true);
    try {
      const delRes = await deleteAiMemory(biz, category, key);
      if (delRes.error) { toast.error(delRes.error); return; }
      setMemories(prev => prev.filter(m => !(m.category === category && m.key === key)));
      toast.success("Removed");
    } catch {
      toast.error("Failed to remove item");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSummarizePatterns = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setSummarizing(true);
    try {
      const res = await summarizeAiPatterns(biz);
      if (res.data) {
        toast.success(`${res.data.patterns.length} pattern(s) detected`);
        await load();
      } else {
        toast.error(res.error || "Failed to analyze patterns");
      }
    } catch {
      toast.error("Failed to analyze patterns");
    } finally {
      setSummarizing(false);
    }
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  const patterns = getByCategory("patterns");
  const corrections = getByCategory("corrections");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground/80 mb-1">AI Preferences</h2>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Teach your AI copilot how you prefer to work. These preferences shape recommendations, communication style, and planning decisions.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreferenceSelect
          label="Communication Tone"
          icon={MessageSquare}
          value={getSingleValue("tone", "preferred")}
          options={TONE_OPTIONS}
          onChange={val => handleSelectChange("tone", "preferred", val)}
          saving={saving}
        />
        <PreferenceSelect
          label="Risk Tolerance"
          icon={ShieldAlert}
          value={getSingleValue("riskTolerance", "level")}
          options={RISK_OPTIONS}
          onChange={val => handleSelectChange("riskTolerance", "level", val)}
          saving={saving}
        />
        <PreferenceSelect
          label="Outreach Style"
          icon={Send}
          value={getSingleValue("outreachStyle", "preferred")}
          options={OUTREACH_OPTIONS}
          onChange={val => handleSelectChange("outreachStyle", "preferred", val)}
          saving={saving}
        />
        <PreferenceSelect
          label="Reporting Cadence"
          icon={Clock}
          value={getSingleValue("reportingCadence", "preferred")}
          options={CADENCE_OPTIONS}
          onChange={val => handleSelectChange("reportingCadence", "preferred", val)}
          saving={saving}
        />
      </div>

      <div className="grid grid-cols-1 gap-3">
        <ListField
          label="Business Goals"
          icon={Target}
          category="goals"
          items={getByCategory("goals")}
          onAdd={handleAddListItem}
          onRemove={handleRemoveListItem}
          saving={saving}
          placeholder="e.g. Reach $50K monthly revenue by Q3"
        />
        <ListField
          label="Current Priorities"
          icon={Star}
          category="priorities"
          items={getByCategory("priorities")}
          onAdd={handleAddListItem}
          onRemove={handleRemoveListItem}
          saving={saving}
          placeholder="e.g. Reduce client churn by 20%"
        />
        <ListField
          label="Known Bottlenecks"
          icon={AlertCircle}
          category="bottlenecks"
          items={getByCategory("bottlenecks")}
          onAdd={handleAddListItem}
          onRemove={handleRemoveListItem}
          saving={saving}
          placeholder="e.g. Manual invoicing takes too long"
        />
      </div>

      <div className="border-t border-border/20 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground/80">Behavioral Patterns</h3>
            <p className="text-xs text-muted-foreground/60">
              Auto-detected patterns from your AI usage history
            </p>
          </div>
          <button
            onClick={handleSummarizePatterns}
            disabled={summarizing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors disabled:opacity-50"
          >
            {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {summarizing ? "Analyzing..." : "Analyze Patterns"}
          </button>
        </div>
        {patterns.length > 0 ? (
          <div className="space-y-1.5">
            {patterns.map(p => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/20">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                  <span className="text-xs text-foreground/70">{p.value}</span>
                </div>
                <span className="text-[10px] text-muted-foreground/40">
                  {Math.round(p.confidence * 100)}% confidence
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic py-2">
            No patterns detected yet. Use Flow to take actions and then click Analyze Patterns.
          </p>
        )}
      </div>

      {corrections.length > 0 && (
        <div className="border-t border-border/20 pt-4">
          <h3 className="text-sm font-semibold text-foreground/80 mb-2">Learned Corrections</h3>
          <p className="text-xs text-muted-foreground/60 mb-3">
            Signals from your approval and rejection history that shape future AI behavior
          </p>
          <div className="space-y-1.5">
            {corrections.map(c => (
              <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/20">
                <span className="text-xs text-foreground/70">{c.value}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/40">
                    {Math.round(c.confidence * 100)}%
                  </span>
                  <button
                    onClick={() => handleRemoveListItem("corrections", c.key)}
                    disabled={saving}
                    className="text-muted-foreground/30 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
