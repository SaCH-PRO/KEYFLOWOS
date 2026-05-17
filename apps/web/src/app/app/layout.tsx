"use client";

import { Suspense } from "react";
import { OriginAwareBreadcrumbs } from "@/components/ui/origin-aware-breadcrumbs";
import { NavigationContextProvider } from "@/lib/navigation-context";
import { AiContextProvider } from "@/contexts/ai-context";
import { NotesProvider } from "@/components/keyflow/notes-context";
import { KeyflowNotesDrawer } from "@/components/keyflow/keyflow-notes-drawer";
import { NotesQueryParamTrigger } from "@/components/keyflow/notes-query-param-trigger";
import { PlanLimitDialog } from "@/components/ui/upgrade-prompt";
import { KeyflowOSStoreDrawer } from "@/components/keyflowos-store-drawer";
import { MobileFab } from "@/components/ui/mobile-fab";
import { RequireAuth } from "@/components/require-auth";
import { KeyAgent } from "@/components/key";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { MobileDrawer } from "@/components/layout/mobile-drawer";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { useAppLayout } from "@/hooks/use-app-layout";

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const layout = useAppLayout();

  return (
    <div className="h-dvh bg-background text-foreground overflow-hidden">
      <div className="flex h-full">
        <DesktopSidebar
          drawerSurface={layout.drawerSurface}
          setDrawerSurface={layout.setDrawerSurface}
          isPrimaryActive={layout.isPrimaryActive}
          visibleWorkspacesNav={layout.visibleWorkspacesNav}
          visibleStudioNav={layout.visibleStudioNav}
          visiblePublicNav={layout.visiblePublicNav}
          visibleComingSoonNav={layout.visibleComingSoonNav}
          isSecondaryActive={layout.isSecondaryActive}
          isFeatureLocked={layout.isFeatureLocked}
          connectorAlertCount={layout.connectorAlertCount}
          isAdminUser={layout.isAdminUser}
          setKfStoreOpen={layout.setKfStoreOpen}
        />

        <main role="main" className="flex-1 flex flex-col h-full min-w-0">
          <AppHeader
            setMobileDrawerOpen={layout.setMobileDrawerOpen}
            copilotModule={layout.copilotModule}
            disclosureMode={layout.disclosureMode}
            setDisclosureMode={layout.setDisclosureMode}
            modeMenuOpen={layout.modeMenuOpen}
            setModeMenuOpen={layout.setModeMenuOpen}
            modeMenuRef={layout.modeMenuRef}
            addMenuOpen={layout.addMenuOpen}
            setAddMenuOpen={layout.setAddMenuOpen}
            notifications={layout.notifications}
            unreadCount={layout.unreadCount}
            notifOpen={layout.notifOpen}
            setNotifOpen={layout.setNotifOpen}
            notifRef={layout.notifRef}
            markAllRead={layout.markAllRead}
            displayName={layout.displayName}
            initials={layout.initials}
            avatarUrl={layout.avatarUrl}
            isAdminUser={layout.isAdminUser}
            userMenuOpen={layout.userMenuOpen}
            setUserMenuOpen={layout.setUserMenuOpen}
            userMenuRef={layout.userMenuRef}
            handleLogout={layout.handleLogout}
          />
          <div className="px-3 md:px-6 pt-1">
            <OriginAwareBreadcrumbs />
          </div>
          <div data-scroll-root="app" className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 pb-24 md:pb-6">
            {children}
          </div>
        </main>
      </div>

      <MobileDrawer
        mobileDrawerOpen={layout.mobileDrawerOpen}
        setMobileDrawerOpen={layout.setMobileDrawerOpen}
        pathname={layout.pathname}
        displayName={layout.displayName}
        initials={layout.initials}
        avatarUrl={layout.avatarUrl}
        visibleWorkspacesNav={layout.visibleWorkspacesNav}
        visibleStudioNav={layout.visibleStudioNav}
        visiblePublicNav={layout.visiblePublicNav}
        visibleComingSoonNav={layout.visibleComingSoonNav}
        isSecondaryActive={layout.isSecondaryActive}
        isFeatureLocked={layout.isFeatureLocked}
        connectorAlertCount={layout.connectorAlertCount}
        isAdminUser={layout.isAdminUser}
        setKfStoreOpen={layout.setKfStoreOpen}
        handleLogout={layout.handleLogout}
      />

      <MobileBottomNav
        pathname={layout.pathname}
        mobileDrawerOpen={layout.mobileDrawerOpen}
        setMobileDrawerOpen={layout.setMobileDrawerOpen}
        notifOpen={layout.notifOpen}
        setNotifOpen={layout.setNotifOpen}
        unreadCount={layout.unreadCount}
      />

      <PlanLimitDialog planLimit={layout.planLimitHit} onClose={layout.clearPlanLimit} />
      <KeyflowOSStoreDrawer open={layout.kfStoreOpen} onClose={() => layout.setKfStoreOpen(false)} />
      <KeyAgent currentModule={layout.copilotModule} />
      <MobileFab />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Suspense fallback={null}>
        <NavigationContextProvider>
          <AiContextProvider>
            <NotesProvider>
              <NotesQueryParamTrigger />
              <AppLayoutInner>{children}</AppLayoutInner>
              <KeyflowNotesDrawer />
            </NotesProvider>
          </AiContextProvider>
        </NavigationContextProvider>
      </Suspense>
    </RequireAuth>
  );
}
