"use client";

import { useState, useCallback } from "react";
import { SideSheet } from "./side-sheet";
import { TabNav } from "./tab-nav";

export interface BusinessObjectTab {
  key: string;
  label: string;
  icon?: React.ElementType;
  content: React.ReactNode;
  count?: number;
}

export interface BusinessObjectDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  tabs: BusinessObjectTab[];
  defaultTab?: string;
  width?: "sm" | "md" | "lg";
  footer?: React.ReactNode;
  /** Called when a tab is changed */
  onTabChange?: (key: string) => void;
}

export function BusinessObjectDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  tabs,
  defaultTab,
  width = "lg",
  footer,
  onTabChange,
}: BusinessObjectDrawerProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.key ?? "");

  const handleTabChange = useCallback(
    (key: string) => {
      setActiveTab(key);
      onTabChange?.(key);
    },
    [onTabChange]
  );

  const activeTabContent = tabs.find((t) => t.key === activeTab)?.content ?? null;

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={width}
      footer={footer}
    >
      {badge && <div className="mb-3">{badge}</div>}

      {tabs.length > 1 && (
        <TabNav
          tabs={tabs.map((t) => ({
            key: t.key,
            label: t.label,
            icon: t.icon,
            count: t.count,
          }))}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          layoutId="bod-tab-underline"
        />
      )}

      <div className="min-h-[200px]">{activeTabContent}</div>
    </SideSheet>
  );
}
