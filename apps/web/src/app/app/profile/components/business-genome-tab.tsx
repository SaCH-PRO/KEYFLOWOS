"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Dna, Grid3X3, MessageSquare, FileText, Settings, Loader2, ScrollText, Briefcase, Sparkles, Radio } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { GenomeOverview } from "./business-genome/genome-overview";
import { DnaSectionsList } from "./business-genome/dna-sections-list";
import { GenomeChatPanel } from "./business-genome/genome-chat-panel";
import { GenomeReportsPanel } from "./business-genome/genome-reports-panel";
import { ConstitutionPanel } from "./business-genome/constitution-panel";
import { AdvancedEditorPanel } from "./business-genome/advanced-editor-panel";
import { AssetRegistryPanel } from "./business-genome/asset-registry-panel";
import { EvolutionProposalsPanel } from "./business-genome/evolution-proposals-panel";
import { KeyGenomeSignalsPanel } from "./business-genome/key-genome-signals-panel";

type GenomeSubTab = "overview" | "dna-sections" | "genome-chat" | "reports" | "constitution" | "assets" | "evolution-proposals" | "signals" | "advanced-editor";

const SUB_TABS: { id: GenomeSubTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Dna },
  { id: "dna-sections", label: "DNA Sections", icon: Grid3X3 },
  { id: "genome-chat", label: "Genome Chat", icon: MessageSquare },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "constitution", label: "Constitution", icon: ScrollText },
  { id: "assets", label: "Asset Registry", icon: Briefcase },
  { id: "evolution-proposals", label: "Evolution Proposals", icon: Sparkles },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "advanced-editor", label: "Advanced Editor", icon: Settings },
];

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

export function BusinessGenomeTab() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawSection = searchParams.get("section") || "overview";
  const activeSubTab = SUB_TABS.some((t) => t.id === rawSection)
    ? (rawSection as GenomeSubTab)
    : "overview";

  const [genome, setGenome] = useState<GenomeIntegrityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: apiError } = await getGenome(businessId);
    if (apiError || !data) {
      setError(apiError || "Failed to load Business Genome");
    } else {
      setGenome(data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  const handleGenomeUpdate = useCallback(
    (result?: GenomeIntegrityResult) => {
      if (result) {
        setGenome(result);
      } else {
        void refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of Business Genome data
    refresh();
  }, [refresh]);

  const handleSubTabChange = (tab: GenomeSubTab) => {
    const url = tab === "overview" ? "/app/profile?tab=business-genome" : `/app/profile?tab=business-genome&section=${tab}`;
    router.replace(url, { scroll: false });
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Business Genome...</p>
      </div>
    );
  }

  if (error || !genome) {
    return (
      <div className="kf-card p-8 text-center">
        <p className="text-sm text-destructive">{error || "Business Genome unavailable."}</p>
        <button
          onClick={refresh}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="flex gap-1 p-1 rounded-xl overflow-x-auto"
        style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
        role="tablist"
        aria-label="Business Genome"
      >
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleSubTabChange(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-xs font-medium transition-all min-h-[40px] whitespace-nowrap"
              style={{
                background: isActive ? "hsl(var(--kf-card))" : "transparent",
                color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
                border: isActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
              }}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === "overview" && (
          <motion.div key="overview" {...fade}>
            <GenomeOverview genome={genome} onSectionClick={() => handleSubTabChange("dna-sections")} />
          </motion.div>
        )}

        {activeSubTab === "dna-sections" && (
          <motion.div key="dna-sections" {...fade}>
            <DnaSectionsList genome={genome} onUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "genome-chat" && (
          <motion.div key="genome-chat" {...fade}>
            <div className="kf-card p-4 sm:p-6">
              <GenomeChatPanel genome={genome} onGenomeUpdate={handleGenomeUpdate} />
            </div>
          </motion.div>
        )}

        {activeSubTab === "reports" && (
          <motion.div key="reports" {...fade}>
            <GenomeReportsPanel
              genome={genome}
              onOpenConstitution={() => handleSubTabChange("constitution")}
              onOpenDnaSections={() => handleSubTabChange("dna-sections")}
            />
          </motion.div>
        )}

        {activeSubTab === "constitution" && (
          <motion.div key="constitution" {...fade}>
            <ConstitutionPanel genome={genome} />
          </motion.div>
        )}

        {activeSubTab === "assets" && (
          <motion.div key="assets" {...fade}>
            <AssetRegistryPanel />
          </motion.div>
        )}

        {activeSubTab === "evolution-proposals" && (
          <motion.div key="evolution-proposals" {...fade}>
            <EvolutionProposalsPanel onGenomeUpdate={handleGenomeUpdate} />
          </motion.div>
        )}

        {activeSubTab === "signals" && (
          <motion.div key="signals" {...fade}>
            <KeyGenomeSignalsPanel onGenomeUpdate={handleGenomeUpdate} />
          </motion.div>
        )}

        {activeSubTab === "advanced-editor" && (
          <motion.div key="advanced-editor" {...fade}>
            <AdvancedEditorPanel onGenomeUpdate={handleGenomeUpdate} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
