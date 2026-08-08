"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { motion, AnimatePresence } from "framer-motion";

interface WorkspaceTab {
  key: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
  tooltip?: string;
}

interface WorkspaceShellProps {
  icon: React.ElementType;
  title: string;
  subtitle?: React.ReactNode;
  tabs?: WorkspaceTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  tabLayoutId?: string;
  tabVariant?: "underline" | "pill";
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  actionDataAttr?: string;
  headerRight?: React.ReactNode;
  metricStrip?: React.ReactNode;
  banners?: React.ReactNode;
  ai?: {
    hook: unknown;
    moduleName: string;
    onAction?: (actionKey: string) => void;
    toolResultRenderer?: (toolId: string, result: unknown) => React.ReactNode;
  };
  enableSwipe?: boolean;
  enableSlideAnimation?: boolean;
  iconColor?: string;
  className?: string;
  children: React.ReactNode;
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export function useWorkspaceReturnNav() {
  return useReturnNavigation({ restoreScrollOnMount: true });
}

export function WorkspaceShell({
  icon,
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  tabLayoutId,
  tabVariant,
  actionLabel,
  actionIcon,
  onAction,
  actionDataAttr,
  headerRight,
  metricStrip,
  banners,
  enableSwipe = false,
  enableSlideAnimation = false,
  iconColor,
  className = "",
  children,
}: WorkspaceShellProps) {
  const { setCurrentMeta, current } = useNavigationContext();

  const tabRestored = useRef(false);

  useReturnNavigation({ restoreScrollOnMount: true });

  const tabKeys = useMemo(() => (tabs ?? []).map((t) => t.key), [tabs]);

  const { swipeHandlers, swipeDirection } = useSwipeTabs({
    tabs: tabKeys,
    activeTab: activeTab ?? "",
    onTabChange: onTabChange ?? (() => {}),
  });

  useEffect(() => {
    setCurrentMeta({ selectedEntityLabel: title });
  }, [setCurrentMeta, title]);

  const [queryTab, _setQueryTab] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("tab");
  });

  useEffect(() => {
    if (tabRestored.current || !tabs || !onTabChange) return;

    const urlTab = queryTab;
    if (urlTab && tabKeys.includes(urlTab) && urlTab !== activeTab) {
      onTabChange(urlTab);
      tabRestored.current = true;
      return;
    }

    const navTab = current?.tab;
    if (navTab && tabKeys.includes(navTab) && navTab !== activeTab) {
      onTabChange(navTab);
      tabRestored.current = true;
      return;
    }

    tabRestored.current = true;
  }, [tabs, onTabChange, queryTab, current, activeTab, tabKeys]);

  useEffect(() => {
    if (activeTab) {
      setCurrentMeta({ tab: activeTab });
    }
  }, [activeTab, setCurrentMeta]);

  const contentWrapper = enableSwipe ? (
    <div
      {...swipeHandlers}
      className="min-h-[200px]"
    >
      {enableSlideAnimation ? (
        <AnimatePresence mode="wait" custom={swipeDirection.current}>
          <motion.div
            key={activeTab}
            custom={swipeDirection.current}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      ) : (
        children
      )}
    </div>
  ) : (
    <div className="min-h-[200px]">
      {children}
    </div>
  );

  return (
    <div className={`space-y-0 ${className}`}>
      <PageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        actionLabel={actionLabel}
        actionIcon={actionIcon}
        onAction={onAction}
        actionDataAttr={actionDataAttr}
        rightSlot={headerRight}
        iconColor={iconColor}
      />

      {banners && <div className="space-y-2 mb-4">{banners}</div>}

      {metricStrip && <div className="mb-5">{metricStrip}</div>}

      {tabs && tabs.length > 0 && activeTab && onTabChange && (
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          layoutId={tabLayoutId ?? `${title.toLowerCase().replace(/\s+/g, "-")}-tabs`}
          variant={tabVariant}
        />
      )}

      {contentWrapper}

      {/* AI hub centralized in Cockpit — module pages stay clean */}
    </div>
  );
}

export type { WorkspaceShellProps, WorkspaceTab };
