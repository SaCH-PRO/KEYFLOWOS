/**
 * CATALOG-1 web, review round 1 (orchestrator ruling on commerce/page.tsx; journey B1, B5, B6): Sales offers a
 * Products door to Sales > Products (/app/commerce/products), in the page header, on every tab.
 *
 * The harness is commerce-tab-follows-url.test.tsx's (every child the page composes stubbed to a marker), with the
 * shell stub also drawing the header's right-hand side, where the door is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/navigation-context', () => ({
  useNavigationContext: () => ({ getOriginContext: () => null }),
}));
vi.mock('@/lib/use-return-navigation', () => ({
  useReturnNavigation: () => ({ getReturnLabel: () => 'Back', navigateBack: vi.fn() }),
}));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: () => {} }));
// The app shell's composer provider, which the quotes panel's send reads.
vi.mock('@/components/email/compose-context', () => ({ useCompose: () => ({ open: () => {} }) }));
vi.mock('@/hooks/use-module-events', () => ({ useModuleEvent: () => {} }));
vi.mock('@/hooks/use-plan', () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));

vi.mock('@/components/guide/keyflow-unified-shell', () => ({
  KeyflowUnifiedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
/** The tab strip, reduced to what the page passes it: the tabs and the active one. */
vi.mock('@/components/ui/workspace-shell', () => ({
  WorkspaceShell: ({
    tabs, activeTab, onTabChange, headerRight, children,
  }: {
    tabs: Array<{ key: string; label: string }>;
    activeTab: string;
    onTabChange: (k: string) => void;
    headerRight?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="shell" data-active-tab={activeTab}>
      <div data-testid="header-right">{headerRight}</div>
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onTabChange(t.key)}>{t.label}</button>
      ))}
      {children}
    </div>
  ),
}));
vi.mock('@/components/ui/skeleton', () => ({ ListPageSkeleton: () => <div>loading</div> }));
vi.mock('@/components/ui/workspace-error', () => ({ WorkspaceError: () => <div>error</div> }));
vi.mock('@/components/ui/mobile-action-sheet', () => ({ MobileActionSheet: () => null }));
vi.mock('@/components/layout/flow-quick-launcher', () => ({ FlowQuickLauncher: () => null }));

vi.mock('../hooks/use-commerce-shell', () => ({
  useCommerceShell: () => ({
    businessId: 'biz_1', businessCurrency: 'TTD',
    workspaceLoading: false, workspaceError: null,
    products: [], setProducts: vi.fn(),
    invoices: [], setInvoices: vi.fn(),
    quotes: [], setQuotes: vi.fn(),
    contacts: [], loading: false, error: null,
  }),
}));
vi.mock('../hooks/use-billing-workspace', () => ({
  useBillingWorkspace: () => ({
    pendingPrefill: null, prefillForContact: vi.fn(), clearPrefill: vi.fn(),
    triggerNewQuote: 0, triggerNewInvoice: 0, triggerNewSchedule: 0,
    setTriggerNewQuote: vi.fn(), setTriggerNewInvoice: vi.fn(), setTriggerNewSchedule: vi.fn(),
  }),
}));

vi.mock('../quotes/quotes-panel', () => ({ default: () => <div data-testid="tab-quotes" /> }));
vi.mock('../payments/payments-tab', () => ({ default: () => <div data-testid="tab-collections" /> }));
vi.mock('../../finance/components/revenue-composer', () => ({ RevenueComposer: () => null }));
vi.mock('../recurring/recurring-panel', () => ({ default: () => <div data-testid="tab-recurring" /> }));
vi.mock('../components/commerce-overview-tab', () => ({
  CommerceOverviewTab: () => <div data-testid="tab-snapshot" />,
}));
vi.mock('../components/tab-frame', () => ({
  TabFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/commerce-kpi-strip', () => ({ CommerceKpiStrip: () => null }));
vi.mock('../components/revenue-record-drawer', () => ({ RevenueRecordDrawer: () => null }));
vi.mock('../components/commerce-banners', () => ({ CommerceBanners: () => null }));
vi.mock('../components/commerce-header-right', () => ({ CommerceHeaderRight: () => null }));
vi.mock('../components/revenue-action-menu', () => ({ RevenueActionMenu: () => null }));
vi.mock('../components/standalone-payment-recorder', () => ({ StandalonePaymentRecorder: () => null }));

import CommercePage from '../page';

beforeEach(() => {
  window.history.replaceState({}, '', '/app/commerce');
});
afterEach(cleanup);

describe('Sales offers a Products door (CATALOG-1)', () => {
  it.each(['/app/commerce', '/app/commerce?tab=quotes', '/app/commerce?tab=recurring'])('at %s: a link named "Products" to /app/commerce/products', (url) => {
    window.history.replaceState({}, '', url);
    render(<CommercePage />);
    const door = screen.getByRole('link', { name: /^products$/i });
    expect(door).toHaveAttribute('href', '/app/commerce/products');
  });
});
