"use client";

import { Lock } from "lucide-react";
import { EmptyState } from "./empty-state";

/**
 * The one no-access state (FAILURE-KIT, re-cut v1 plan step 3): what a screen shows instead of its data when the
 * server refused this member the read (lib/failure-kit.ts readState(...).kind === "no-access"). A refused read used to
 * fall through to the screen's empty values: "0 owner 0 admin 0 staff" and an active Invite on Settings > Team
 * (BUG-063), "TTD $0.00" and "No expenses found" on Expenses (BUG-064). Journey J6: a refused screen says "No access,
 * ask the owner", never zeros.
 *
 * It offers no button: there is nothing this member can do here but ask the owner.
 */
export const NO_ACCESS_TITLE = "No access - ask the owner";

interface NoAccessStateProps {
  /** Why, as lib/failure-kit.ts readState / readRefusal says it (PR195's moduleReadRefusal words). */
  message?: string | null;
  /** What the screen shows, in the owner's words ("expenses", "your team"), for the line said when no message is given. */
  what?: string;
  variant?: "default" | "compact" | "inline";
  className?: string;
}

export function NoAccessState({ message, what, variant = "default", className }: NoAccessStateProps) {
  const reason = message?.trim() || `You don't have access to ${what ?? "this"} in this business.`;
  return (
    <div role="status" data-state="no-access" className={className}>
      <EmptyState icon={Lock} title={NO_ACCESS_TITLE} description={reason} variant={variant} />
    </div>
  );
}
