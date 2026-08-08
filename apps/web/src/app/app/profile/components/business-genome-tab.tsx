"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dna,
  Grid3X3,
  MessageSquare,
  FileText,
  Settings,
  Loader2,
  ScrollText,
  Briefcase,
  Sparkles,
  Radio,
  Lightbulb,
  Shield,
  Brain,
  LayoutGrid,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";
import { useGenome } from "@/contexts/genome-context";
import { GenomeOrb } from "@/components/genome/genome-orb";
import type { GenomeIntegrityResult } from "@/lib/api/business-genome";

interface OverviewPanelProps {
  genome: GenomeIntegrityResult;
  onSectionClick: () => void;
}

interface DnaSectionsPanelProps {
  genome: GenomeIntegrityResult;
  onUpdate: () => void;
}

interface ChatPanelProps {
  genome: GenomeIntegrityResult;
  onGenomeUpdate: (result?: GenomeIntegrityResult) => void;
}

interface ReportsPanelProps {
  genome: GenomeIntegrityResult;
  onOpenConstitution: () => void;
  onOpenDnaSections: () => void;
}

interface ConstitutionPanelProps {
  genome: GenomeIntegrityResult;
}

interface CallbackPanelProps {
  onGenomeUpdate?: () => void;
}

interface RequiredResultCallbackPanelProps {
  onGenomeUpdate: (result?: GenomeIntegrityResult) => void;
}

interface OptionalGenomeArgCallbackPanelProps {
  onGenomeUpdate?: (genome: GenomeIntegrityResult) => void;
}

const OverviewPanel = dynamic<OverviewPanelProps>(
  () => import("./business-genome/genome-overview").then((m) => ({ default: m.GenomeOverview })),
  { ssr: false, loading: PanelSkeleton },
);

const DnaSectionsPanel = dynamic<DnaSectionsPanelProps>(
  () => import("./business-genome/dna-sections-list").then((m) => ({ default: m.DnaSectionsList })),
  { ssr: false, loading: PanelSkeleton },
);

const ChatPanel = dynamic<ChatPanelProps>(
  () => import("./business-genome/genome-chat-panel").then((m) => ({ default: m.GenomeChatPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const ReportsPanel = dynamic<ReportsPanelProps>(
  () => import("./business-genome/genome-reports-panel").then((m) => ({ default: m.GenomeReportsPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const ConstitutionPanel = dynamic<ConstitutionPanelProps>(
  () => import("./business-genome/constitution-panel").then((m) => ({ default: m.ConstitutionPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const AssetRegistryPanel = dynamic(
  () => import("./business-genome/asset-registry-panel").then((m) => ({ default: m.AssetRegistryPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const EvolutionProposalsPanel = dynamic<OptionalGenomeArgCallbackPanelProps>(
  () => import("./business-genome/evolution-proposals-panel").then((m) => ({ default: m.EvolutionProposalsPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const SignalsPanel = dynamic<CallbackPanelProps>(
  () => import("./business-genome/key-genome-signals-panel").then((m) => ({ default: m.KeyGenomeSignalsPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const RecommendationsPanel = dynamic<CallbackPanelProps>(
  () => import("./business-genome/key-genome-recommendations-panel").then((m) => ({ default: m.KeyGenomeRecommendationsPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const GovernancePanel = dynamic<CallbackPanelProps>(
  () => import("./business-genome/key-genome-governance-console").then((m) => ({ default: m.KeyGenomeGovernanceConsole })),
  { ssr: false, loading: PanelSkeleton },
);

const MemoryPanel = dynamic<CallbackPanelProps>(
  () => import("./business-genome/key-genome-memory-panel").then((m) => ({ default: m.KeyGenomeMemoryPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const DomainsPanel = dynamic<CallbackPanelProps>(
  () => import("./business-genome/domains-panel").then((m) => ({ default: m.DomainsPanel })),
  { ssr: false, loading: PanelSkeleton },
);

const AdvancedEditorPanel = dynamic<RequiredResultCallbackPanelProps>(
  () => import("./business-genome/advanced-editor-panel").then((m) => ({ default: m.AdvancedEditorPanel })),
  { ssr: false, loading: PanelSkeleton },
);

type GenomeSubTab =
  | "overview"
  | "dna-sections"
  | "genome-chat"
  | "reports"
  | "constitution"
  | "assets"
  | "evolution-proposals"
  | "signals"
  | "recommendations"
  | "governance"
  | "memory"
  | "domains"
  | "advanced-editor";

interface SubTab {
  id: GenomeSubTab;
  label: string;
  icon: React.ElementType;
  primary?: boolean;
}

const SUB_TABS: SubTab[] = [
  { id: "overview", label: "Overview", icon: Dna, primary: true },
  { id: "dna-sections", label: "DNA Sections", icon: Grid3X3, primary: true },
  { id: "genome-chat", label: "Genome Chat", icon: MessageSquare, primary: true },
  { id: "reports", label: "Reports", icon: FileText, primary: true },
  { id: "advanced-editor", label: "Editor", icon: Settings, primary: true },
  { id: "constitution", label: "Constitution", icon: ScrollText },
  { id: "assets", label: "Asset Registry", icon: Briefcase },
  { id: "evolution-proposals", label: "Evolution Proposals", icon: Sparkles },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "recommendations", label: "Recommendations", icon: Lightbulb },
  { id: "governance", label: "Governance", icon: Shield },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "domains", label: "Domains", icon: LayoutGrid },
];

const LEGACY_DOMAIN_SECTIONS: Record<string, string> = {
  finance: "finance",
  "customer-sales": "customer-sales",
  operations: "operations",
  "marketing-growth": "marketing-growth",
  departments: "departments",
};



const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function PanelSkeleton() {
  return (
    <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading panel...</p>
    </div>
  );
}

export function BusinessGenomeTab() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { genome, loading, error, refresh } = useGenome();

  const rawSection = searchParams.get("section") || "overview";
  const activeSubTab = SUB_TABS.some((t) => t.id === rawSection)
    ? (rawSection as GenomeSubTab)
    : "overview";

  const handleSubTabChange = useCallback(
    (tab: GenomeSubTab) => {
      const url =
        tab === "overview"
          ? "/app/profile?tab=business-genome"
          : `/app/profile?tab=business-genome&section=${tab}`;
      router.replace(url, { scroll: false });
    },
    [router],
  );

  const primaryTabs = SUB_TABS.filter((t) => t.primary);
  const moreTabs = SUB_TABS.filter((t) => !t.primary);
  const activeTabMeta = SUB_TABS.find((t) => t.id === activeSubTab);
  const isMoreActive = activeTabMeta ? !activeTabMeta.primary : false;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  // Redirect legacy domain sections into the unified Domains panel.
  useEffect(() => {
    const legacyDomain = LEGACY_DOMAIN_SECTIONS[rawSection];
    if (legacyDomain) {
      router.replace(
        `/app/profile?tab=business-genome&section=domains&domain=${legacyDomain}`,
        { scroll: false },
      );
    }
  }, [rawSection, router]);

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
      <GenomeOrb genome={genome} />

      <div
        className="flex gap-1 p-1 rounded-xl overflow-x-auto"
        style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
        role="tablist"
        aria-label="Business Genome"
      >
        {primaryTabs.map((tab) => {
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

        <div className="relative flex-1" ref={moreRef}>
          <button
            role="tab"
            aria-selected={isMoreActive}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-xs font-medium transition-all min-h-[40px] whitespace-nowrap"
            style={{
              background: isMoreActive ? "hsl(var(--kf-card))" : "transparent",
              color: isMoreActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
              boxShadow: isMoreActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
              border: isMoreActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
            }}
          >
            <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">More</span>
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          </button>

          {moreOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-xl border border-border bg-card shadow-lg p-1"
              role="menu"
            >
              {moreTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    role="menuitem"
                    onClick={() => {
                      handleSubTabChange(tab.id);
                      setMoreOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors hover:bg-muted"
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === "overview" && (
          <motion.div key="overview" {...fade}>
            <OverviewPanel genome={genome} onSectionClick={() => handleSubTabChange("dna-sections")} />
          </motion.div>
        )}

        {activeSubTab === "dna-sections" && (
          <motion.div key="dna-sections" {...fade}>
            <DnaSectionsPanel genome={genome} onUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "genome-chat" && (
          <motion.div key="genome-chat" {...fade}>
            <div className="kf-card p-4 sm:p-6">
              <ChatPanel genome={genome} onGenomeUpdate={refresh} />
            </div>
          </motion.div>
        )}

        {activeSubTab === "reports" && (
          <motion.div key="reports" {...fade}>
            <ReportsPanel
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
            <EvolutionProposalsPanel onGenomeUpdate={() => refresh()} />
          </motion.div>
        )}

        {activeSubTab === "signals" && (
          <motion.div key="signals" {...fade}>
            <SignalsPanel onGenomeUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "recommendations" && (
          <motion.div key="recommendations" {...fade}>
            <RecommendationsPanel onGenomeUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "governance" && (
          <motion.div key="governance" {...fade}>
            <GovernancePanel onGenomeUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "memory" && (
          <motion.div key="memory" {...fade}>
            <MemoryPanel onGenomeUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "domains" && (
          <motion.div key="domains" {...fade}>
            <DomainsPanel onGenomeUpdate={refresh} />
          </motion.div>
        )}

        {activeSubTab === "advanced-editor" && (
          <motion.div key="advanced-editor" {...fade}>
            <AdvancedEditorPanel onGenomeUpdate={refresh} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
