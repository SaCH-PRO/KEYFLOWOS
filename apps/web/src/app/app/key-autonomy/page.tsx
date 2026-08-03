"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { ShieldCheck, Loader2, AlertTriangle, Plus, LayoutDashboard } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  listKeyActionProposals,
  type KeyActionProposal,
  type KeyActionProposalStatus,
} from "@/lib/api/key-autonomy";
import { ProposalCard } from "./components/proposal-card";
import { ReflexPanel } from "./components/reflex-panel";

const TABS: { key: string; label: string; status?: KeyActionProposalStatus }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending", status: "PENDING" },
  { key: "approved", label: "Approved", status: "APPROVED" },
  { key: "executed", label: "Executed", status: "EXECUTED" },
  { key: "rejected", label: "Rejected", status: "REJECTED" },
];

export default function KeyAutonomyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<KeyActionProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeTab = searchParams.get("tab") || "all";

  useEffect(() => {
    setBusinessId(getStoredBusinessId() ?? null);
  }, []);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const tab = TABS.find((t) => t.key === activeTab);
    const { data, error: apiError } = await listKeyActionProposals(
      businessId,
      tab?.status ? { status: tab.status } : {},
    );
    if (apiError || !data) {
      setError(apiError || "Failed to load proposals");
      setProposals([]);
    } else {
      setProposals(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, activeTab]);

  const handleTabChange = (key: string) => {
    router.replace(`/app/key-autonomy?tab=${key}`);
  };

  if (loading && proposals.length === 0) {
    return (
      <WorkspaceShell
        icon={ShieldCheck}
        title="KEY Autonomy"
        subtitle="Review, approve, and execute KEY action proposals"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      >
        <div className="rounded-2xl border border-border/40 bg-card/40 p-8 flex flex-col items-center justify-center gap-3 h-48 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading proposals...</p>
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !businessId) {
    return (
      <WorkspaceShell
        icon={ShieldCheck}
        title="KEY Autonomy"
        subtitle="Review, approve, and execute KEY action proposals"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      >
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">{error || "No business selected"}</p>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={ShieldCheck}
      title="KEY Autonomy"
      subtitle="Review, approve, and execute KEY action proposals"
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      actionLabel="Request approval"
      actionIcon={Plus}
      onAction={() => router.push("/app/key-modes")}
    >
      <Link
        href="/app/command-center"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Back to Command Center
      </Link>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        {proposals.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-border/40 p-8 text-center">
            <p className="text-sm text-muted-foreground">No proposals in this tab.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Go to KEY Executive Modes to request an action that requires approval.
            </p>
          </div>
        )}
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} businessId={businessId} proposal={proposal} onUpdated={load} />
        ))}
      </motion.div>

      {/* The autonomic switch. Approvals above are KEY asking permission; these
          are the events it may respond to without asking at all. */}
      <div className="mt-6">
        <ReflexPanel businessId={businessId} />
      </div>
    </WorkspaceShell>
  );
}
