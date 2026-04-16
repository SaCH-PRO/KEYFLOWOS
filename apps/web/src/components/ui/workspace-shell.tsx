"use client";

import { useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { AiHubTrigger, AiCommandHub } from "@/components/ai/ai-command-hub";
import type { UseModuleAiReturn } from "@/hooks/use-module-ai";
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
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  actionDataAttr?: string;
  headerRight?: React.ReactNode;
  metricStrip?: React.ReactNode;
  banners?: React.ReactNode;
  ai?: {
    hook: UseModuleAiReturn;
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
  actionLabel,
  actionIcon,
  onAction,
  actionDataAttr,
  headerRight,
  metricStrip,
  banners,
  ai,
  enableSwipe = false,
  enableSlideAnimation = false,
  iconColor,
  className = "",
  children,
}: WorkspaceShellProps) {
  const { setCurrentMeta, current } = useNavigationContext();
  const searchParams = useSearchParams();
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

  useEffect(() => {
    if (tabRestored.current || !tabs || !onTabChange) return;

    const urlTab = searchParams.get("tab");
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
  }, [tabs, onTabChange, searchParams, current, activeTab, tabKeys]);

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

      {metricStrip && <div className="mb-4">{metricStrip}</div>}

      {tabs && tabs.length > 0 && activeTab && onTabChange && (
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          layoutId={tabLayoutId ?? `${title.toLowerCase().replace(/\s+/g, "-")}-tabs`}
        />
      )}

      {contentWrapper}

      {ai && !ai.hook.useGlobalCopilot && (
        <>
          <AiHubTrigger ai={ai.hook} moduleName={ai.moduleName} />
          <AnimatePresence>
            {ai.hook.panelOpen && (
              <AiCommandHub
                ai={ai.hook}
                moduleName={ai.moduleName}
                onAction={ai.onAction}
                toolResultRenderer={ai.toolResultRenderer}
              />
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

export type { WorkspaceShellProps, WorkspaceTab };
