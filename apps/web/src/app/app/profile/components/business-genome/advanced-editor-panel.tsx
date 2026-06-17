"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Settings, Loader2, Save, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { Textarea } from "@/components/ui/textarea";
import type { BlueprintData } from "@/lib/blueprint-types";
import type { GenomeIntegrityResult } from "@/lib/api/business-genome";

interface AdvancedEditorPanelProps {
  onGenomeUpdate: (result?: GenomeIntegrityResult) => void;
}

export function AdvancedEditorPanel({ onGenomeUpdate }: AdvancedEditorPanelProps) {
  const businessId = getStoredBusinessId();
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editEnabled, setEditEnabled] = useState(false);
  const parseError = useMemo<string | null>(() => {
    if (!editEnabled) return null;
    try {
      JSON.parse(raw);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [raw, editEnabled]);

  useEffect(() => {
    if (!businessId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of raw Business Genome JSON
    setLoading(true);
    apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`).then(({ data, error }) => {
      if (error || !data) {
        toast.error(error || "Failed to load Business Genome JSON");
      } else {
        setBlueprint(data);
        setRaw(JSON.stringify(data, null, 2));
      }
      setLoading(false);
    });
  }, [businessId]);

  const handleSave = async () => {
    if (!businessId || parseError) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    setSaving(true);
    const { data, error } = await apiPatch<BlueprintData>(`/blueprint/businesses/${businessId}`, parsed);
    setSaving(false);

    if (error || !data) {
      toast.error(error || "Failed to save Business Genome");
      return;
    }

    toast.success("Business Genome saved. Genome Integrity will refresh.");
    setBlueprint(data);
    setRaw(JSON.stringify(data, null, 2));
    setEditEnabled(false);
    onGenomeUpdate();
  };

  const handleReset = () => {
    if (blueprint) {
      setRaw(JSON.stringify(blueprint, null, 2));
    }
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading raw Business Genome JSON...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{
          background: "hsl(var(--kf-muted) / 0.08)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Advanced Editor</h2>
            <p className="text-xs text-muted-foreground">
              Power-user access to the raw Business Genome JSON. Edit with care.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditEnabled((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
          >
            {editEnabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {editEnabled ? "Disable editing" : "Enable editing"}
          </button>
          {editEnabled && (
            <>
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-3 py-2 rounded-lg text-xs font-medium border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors disabled:opacity-60"
              >
                Reset
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !!parseError}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {editEnabled && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{
            background: "hsl(var(--kf-warning) / 0.08)",
            border: "1px solid hsl(var(--kf-warning) / 0.2)",
            color: "hsl(var(--kf-warning))",
          }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            You are editing raw JSON. Invalid data can break genome scoring and downstream features. Make backups
            before saving.
          </span>
        </motion.div>
      )}

      {parseError && (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{
            background: "hsl(var(--kf-destructive) / 0.08)",
            border: "1px solid hsl(var(--kf-destructive) / 0.2)",
            color: "hsl(var(--kf-destructive))",
          }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{parseError}</span>
        </div>
      )}

      {!parseError && editEnabled && (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{
            background: "hsl(var(--kf-success) / 0.08)",
            border: "1px solid hsl(var(--kf-success) / 0.2)",
            color: "hsl(var(--kf-success))",
          }}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>JSON is valid and ready to save.</span>
        </div>
      )}

      <Textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        readOnly={!editEnabled}
        className="min-h-[480px] font-mono text-xs leading-relaxed rounded-xl resize-y"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border) / 0.3)",
        }}
      />
    </div>
  );
}
