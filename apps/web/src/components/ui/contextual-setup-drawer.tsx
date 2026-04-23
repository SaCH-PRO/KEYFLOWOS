"use client";

import { SideSheet } from "@/components/ui/side-sheet";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

interface ContextualSetupDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  settingsHref?: string;
  settingsLabel?: string;
  footer?: React.ReactNode;
}

export function ContextualSetupDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  settingsHref,
  settingsLabel = "Open in Settings",
  footer,
}: ContextualSetupDrawerProps) {
  const footerContent = footer ?? (
    settingsHref ? (
      <Link
        href={settingsHref}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
        {settingsLabel}
      </Link>
    ) : null
  );

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="md"
      footer={footerContent ?? undefined}
    >
      {children}
    </SideSheet>
  );
}
