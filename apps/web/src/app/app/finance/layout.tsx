"use client";

/**
 * Books — Layout shell for the bookkeeping section of Financial Flow.
 *
 * The tab navigation is now handled by WorkspaceShell in the root page.
 * This layout provides a minimal container for the tab content.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
