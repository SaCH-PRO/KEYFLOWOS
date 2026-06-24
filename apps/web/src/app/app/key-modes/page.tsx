"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Brain, Loader2, AlertTriangle, LayoutDashboard } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getKeyExecutiveModes,
  getKeyExecutiveModeBrief,
  type KeyExecutiveMode,
  type KeyExecutiveModeBrief,
  type KeyModeListItem,
} from "@/lib/api/intelligence";
import { KeyModeSelector } from "./components/key-mode-selector";
import { KeyModeBriefPanel } from "./components/key-mode-brief-panel";

export default function KeyModesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businessId] = useState<string | null>(() => getStoredBusinessId() ?? null);
  const [modes, setModes] = useState<KeyModeListItem[]>([]);
  const [selected, setSelected] = useState<KeyExecutiveMode | null>(() =>
    searchParams.get("mode") as KeyExecutiveMode | null,
  );
  const [brief, setBrief] = useState<KeyExecutiveModeBrief | null>(null);
  const [loadingModes, setLoadingModes] = useState(() => !!businessId);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;

    const loadModes = async () => {
      setError(null);
      const { data, error: apiError } = await getKeyExecutiveModes(businessId);
      if (apiError || !data) {
        setError(apiError || "Failed to load executive modes");
        setModes([]);
      } else {
        setModes(data);
      }
      setLoadingModes(false);
    };

    void loadModes();
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !selected) return;

    const loadBrief = async () => {
      setLoadingBrief(true);
      setError(null);
      const { data, error: apiError } = await getKeyExecutiveModeBrief(businessId, selected);
      if (apiError || !data) {
        setError(apiError || "Failed to load mode brief");
        setBrief(null);
      } else {
        setBrief(data);
      }
      setLoadingBrief(false);
    };

    void loadBrief();
  }, [businessId, selected]);

  const handleSelect = (mode: KeyExecutiveMode) => {
    setSelected(mode);
    router.replace(`/app/key-modes?mode=${mode}`);
  };

  if (loadingModes) {
    return (
      <WorkspaceShell icon={Brain} title="KEY Executive Modes" subtitle="Ask KEY to think like a specialist executive">
        <div className="rounded-2xl border border-border/40 bg-card/40 p-8 flex flex-col items-center justify-center gap-3 h-48 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading executive modes...</p>
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !businessId) {
    return (
      <WorkspaceShell icon={Brain} title="KEY Executive Modes" subtitle="Ask KEY to think like a specialist executive">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">{error || "No business selected"}</p>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Brain} title="KEY Executive Modes" subtitle="Ask KEY to think like a specialist executive">
      <Link
        href="/app/command-center"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Back to Command Center
      </Link>
      <div className="space-y-5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-5"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
            border: "1px solid hsl(var(--kf-border) / 0.2)",
          }}
        >
          <h2 className="text-sm font-semibold text-foreground">Choose a mode</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Select an executive lens to see what KEY thinks as that role.
          </p>
        </motion.div>

        <KeyModeSelector modes={modes} active={selected} onSelect={handleSelect} />

        {selected && loadingBrief && (
          <div className="rounded-2xl border border-border/40 bg-card/40 p-8 flex flex-col items-center justify-center gap-3 h-48 animate-pulse">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating {selected.replace(/_/g, " ").toLowerCase()} brief...</p>
          </div>
        )}

        {selected && !loadingBrief && brief && <KeyModeBriefPanel brief={brief} mode={selected} businessId={businessId} />}

        {!selected && (
          <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}>
            <p className="text-sm text-muted-foreground">Select a mode above to generate a role-specific brief.</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
