"use client";

import Link from "next/link";
import { ArrowRightLeft, BookOpen } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { BooksJournalTab } from "../components/books-journal-tab";

export default function GeneralJournalPage() {
  return (
    <UnifiedPageShell
      title="General Journal"
      subtitle="Post balanced double-entry journal adjustments and inspect manual journal history."
      icon={ArrowRightLeft}
      maxWidth="6xl"
      headerActions={
        <Link
          href="/app/finance/ledger"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          style={{ borderColor: "hsl(var(--kf-border))" }}
        >
          <BookOpen className="h-3.5 w-3.5" />
          General Ledger
        </Link>
      }
    >
      <BooksJournalTab />
    </UnifiedPageShell>
  );
}
