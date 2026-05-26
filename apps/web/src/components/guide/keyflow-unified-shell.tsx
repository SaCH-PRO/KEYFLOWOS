"use client";

import { type ReactNode } from "react";
import { GuideOverlay } from "./guide-overlay";

interface KeyflowUnifiedShellProps {
  children: ReactNode;
  /** Which module/workspace (maps to CopilotModule) */
  module: string;
  /** Page title for help context */
  pageTitle: string;
  /** Available actions on this page */
  availableActions?: string[];
  /** Current page state */
  pageContext?: Record<string, unknown>;
}

/**
 * Wraps any app page with the unified KEY experience:
 * - Guide overlay system for interactive walkthroughs
 * - (Page help button removed — use the KEY orb in the bottom-right)
 *
 * Usage:
 * ```tsx
 * <KeyflowUnifiedShell module="revenue" pageTitle="Revenue Dashboard" availableActions={["Create invoice","Send quote"]}>
 *   <YourPageContent />
 * </KeyflowUnifiedShell>
 * ```
 */
export function KeyflowUnifiedShell({
  children,
}: KeyflowUnifiedShellProps) {
  return (
    <>
      {children}
      <GuideOverlay />
    </>
  );
}
