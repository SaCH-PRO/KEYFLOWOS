"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Dna, Grid3X3, Zap, Brain, MessageSquare, ChevronLeft } from "lucide-react";
import { useGenome } from "@/contexts/genome-context";
import { TabNav } from "@/components/ui/tab-nav";
import { Button } from "@/components/ui/button";
import { GenomeOrb } from "@/components/genome/genome-orb";
import { GenomeQuickLauncher } from "./genome-quick-launcher";
import { GenomeHero } from "./genome-hero";
import { DnaConstellation } from "./dna-constellation";
import { GenomeActionFeed } from "./genome-action-feed";
import { GenomeMemoryStrip } from "./genome-memory-strip";
import { GenomeChatFloat } from "./genome-chat-float";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";

const TABS = [
  { key: "overview", label: "Overview", icon: Dna },
  { key: "dna", label: "DNA", icon: Grid3X3 },
  { key: "actions", label: "Actions", icon: Zap },
  { key: "memory", label: "Memory", icon: Brain },
  { key: "chat", label: "Chat", icon: MessageSquare },
];

type GenomeTab = (typeof TABS)[number]["key"];

export function GenomeHubShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { genome, loading, error, refresh } = useGenome();

  const initialTab = useMemo(() => {
    const raw = searchParams.get("tab");
    return TABS.some((t) => t.key === raw) ? (raw as GenomeTab) : "overview";
  }, [searchParams]);

  const [activeTab, setActiveTab] = useState<GenomeTab>(initialTab);

  const handleTabChange = useCallback(
    (tab: GenomeTab) => {
      setActiveTab(tab);
      const url = tab === "overview" ? "/app/genome" : `/app/genome?tab=${tab}`;
      router.replace(url, { scroll: false });
    },
    [router],
  );

  const { swipeHandlers } = useSwipeTabs({
    tabs: TABS.map((t) => t.key),
    activeTab,
    onTabChange: handleTabChange,
  });

  if (loading || !genome) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="h-40 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="h-64 rounded-2xl bg-muted/50 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <p className="text-destructive">{error}</p>
        <Button onClick={refresh} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 pb-28 md:pb-8 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => router.push("/app/command-center")}
            className="hidden sm:flex h-10 w-10 rounded-xl items-center justify-center bg-muted/50 hover:bg-muted transition-colors"
            aria-label="Back to Command Center"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Business Genome</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {genome.threePillarMinimumMet
                ? "Three-pillar minimum met — your genome is operational."
                : "Keep building your genome so KEY can operate at full capability."}
            </p>
          </div>
        </div>
        <GenomeQuickLauncher />
      </div>

      {/* Orb hero card */}
      <GenomeOrb genome={genome} />

      {/* Tabs */}
      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} variant="pill" layoutId="genome-tab" />

      {/* Tab content with swipe support */}
      <div {...swipeHandlers} className="min-h-[300px]">
        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <GenomeHero genome={genome} onDnaClick={() => handleTabChange("dna")} />
              <GenomeActionFeed compact />
              <GenomeMemoryStrip compact />
            </motion.div>
          )}

          {activeTab === "dna" && (
            <motion.div
              key="dna"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <DnaConstellation genome={genome} />
            </motion.div>
          )}

          {activeTab === "actions" && (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <GenomeActionFeed />
            </motion.div>
          )}

          {activeTab === "memory" && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <GenomeMemoryStrip />
            </motion.div>
          )}

          {activeTab === "chat" && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="kf-card p-0 overflow-hidden min-h-[500px]">
                <GenomeChatFloat inline />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
