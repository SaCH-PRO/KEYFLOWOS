"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Landmark,
  LayoutDashboard,
  Banknote,
  Wallet,
  BookOpen,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { TabFrame } from "../commerce/components/tab-frame";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchFinanceOverview, type FinanceOverview } from "@/lib/client";
import { BooksSnapshotTab } from "./components/books-snapshot-tab";
import { BooksCashflowTab } from "./components/books-cashflow-tab";
import { BooksAccountsTab } from "./components/books-accounts-tab";
import { BooksJournalTab } from "./components/books-journal-tab";

const TABS = [
  { key: "snapshot", label: "Snapshot", icon: LayoutDashboard },
  { key: "cashflow", label: "Cashflow", icon: Banknote },
  { key: "accounts", label: "Accounts", icon: Wallet },
  { key: "journal", label: "Journal", icon: BookOpen },
];

type TabKey = "snapshot" | "cashflow" | "accounts" | "journal";

export default function BooksPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = (["snapshot", "cashflow", "accounts", "journal"] as TabKey[]).includes(tabParam as TabKey) ? tabParam! : "snapshot";

  const setActiveTab = useCallback((tab: string) => {
    router.replace(`${pathname}?tab=${tab}`, { scroll: false });
  }, [router, pathname]);

  /* ── Snapshot data ── */
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setOverviewLoading(true);
    fetchFinanceOverview(businessId).then((res) => {
      if (cancelled) return;
      if (res.data) setOverview(res.data);
      setOverviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [businessId]);

  const currency = overview?.currency ?? "TTD";

  return (
    <KeyflowUnifiedShell
      module="finance"
      pageTitle="Books"
      availableActions={["View cashflow", "Add account", "New journal entry", "View tax"]}
    >
      <WorkspaceShell
        icon={Landmark}
        title="Books"
        subtitle="Cashflow, accounts, journal, reconciliation and tax"
        tabLayoutId="books-tabs"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === "snapshot" && (
          <TabFrame loading={overviewLoading}>
            <BooksSnapshotTab
              data={overview}
              currency={currency}
              loading={overviewLoading}
              onNavigate={setActiveTab}
            />
          </TabFrame>
        )}

        {activeTab === "cashflow" && (
          <TabFrame loading={false}>
            <BooksCashflowTab />
          </TabFrame>
        )}

        {activeTab === "accounts" && (
          <TabFrame loading={false}>
            <BooksAccountsTab />
          </TabFrame>
        )}

        {activeTab === "journal" && (
          <TabFrame loading={false}>
            <BooksJournalTab />
          </TabFrame>
        )}
      </WorkspaceShell>
    </KeyflowUnifiedShell>
  );
}
