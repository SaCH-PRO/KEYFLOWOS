/**
 * The Sales (commerce) page shows the tab its URL names, for as long as it is
 * mounted — not only on its first render.
 *
 * Next keeps a page mounted across a navigation that changes only the search
 * params (layout-router keys the segment without them). So a nav door that
 * points back at /app/commerce with a different ?tab — Money > Quotes is
 * /app/commerce?tab=pipeline&view=quotes, Money > Sales is bare /app/commerce —
 * reaches a page that is already on screen. While the page read ?tab once on
 * mount, clicking Quotes from the Snapshot tab changed the URL and left the
 * Snapshot on screen (review R0-08b F2).
 *
 * MOUNT-QUOTES: the pipeline left Sales. The Quotes door lands on the Quotes
 * tab (quotes-panel.tsx), the invoices doors go to /app/commerce/invoices and
 * the collections door lands on the Collections tab; the W9-WEB-COMMERCE-NAV
 * cases about the pipeline following ?view while mounted are now the doors
 * switching tabs while mounted (the full landing table is pinned by
 * commerce-no-pipeline-tab.test.tsx).
 *
 * useSearchParams is read from window.location here, which is what Next does:
 * it patches history.pushState/replaceState so the hook follows both. A
 * navigation is a pushState plus the re-render Next would do; the page's own
 * tab clicks go through its replaceState, exactly as in the browser.
 *
 * Every child the page composes is stubbed to a marker naming the tab it
 * belongs to: what is under test is which tab the page chose, not the tabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

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
    tabs, activeTab, onTabChange, children,
  }: {
    tabs: Array<{ key: string; label: string }>;
    activeTab: string;
    onTabChange: (k: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="shell" data-active-tab={activeTab}>
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

const activeTab = () => screen.getByTestId('shell').getAttribute('data-active-tab');
const shown = () => ['snapshot', 'quotes', 'collections', 'recurring'].filter((t) => screen.queryByTestId(`tab-${t}`));

/** Open the page at this URL, as a fresh mount. */
function openAt(url: string) {
  window.history.replaceState({}, '', url);
  return render(<CommercePage />);
}

/**
 * A client-side navigation that changes only the search params: the URL moves,
 * the page stays mounted and re-renders, as Next does.
 */
function navigate(rerender: (ui: React.ReactElement) => void, url: string) {
  act(() => {
    window.history.pushState({}, '', url);
    rerender(<CommercePage />);
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/app/commerce');
  nav.router.replace.mockClear();
});
afterEach(cleanup);

describe('the commerce page shows the tab its URL names, while mounted (R0-08b F2)', () => {
  it('mounts on the tab the URL names', () => {
    openAt('/app/commerce?tab=pipeline&view=quotes');
    expect(activeTab()).toBe('quotes');
    expect(shown()).toEqual(['quotes']);
  });

  it('Money > Quotes clicked from the Snapshot tab opens the Quotes tab', () => {
    const { rerender } = openAt('/app/commerce');
    expect(activeTab()).toBe('snapshot');

    navigate(rerender, '/app/commerce?tab=pipeline&view=quotes');

    expect(activeTab()).toBe('quotes');
    expect(shown()).toEqual(['quotes']);
  });

  it('Money > Sales (bare /app/commerce) clicked from the Quotes tab returns to the Snapshot', () => {
    const { rerender } = openAt('/app/commerce?tab=pipeline&view=quotes');
    expect(activeTab()).toBe('quotes');

    navigate(rerender, '/app/commerce');

    expect(activeTab()).toBe('snapshot');
    expect(shown()).toEqual(['snapshot']);
  });

  it('a legacy ?tab=quotes arriving after mount lands on the Quotes tab and is rewritten', () => {
    const { rerender } = openAt('/app/commerce');
    navigate(rerender, '/app/commerce?tab=quotes');
    expect(activeTab()).toBe('quotes');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('quotes');
  });

  it('a tab picked on the page sticks: following the URL does not undo the click', () => {
    openAt('/app/commerce?tab=quotes');
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }));
    expect(activeTab()).toBe('recurring');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('recurring');
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect(activeTab()).toBe('snapshot');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('snapshot');
  });

  it('an unknown ?tab leaves the current tab alone, as on mount', () => {
    const { rerender } = openAt('/app/commerce?tab=recurring');
    navigate(rerender, '/app/commerce?tab=nonsense');
    expect(activeTab()).toBe('recurring');
  });

  // W9-WEB-COMMERCE-NAV, as it reads once the pipeline left Sales (MOUNT-QUOTES):
  // the Quotes door clicked while another tab is on screen switches to the
  // Quotes tab; the collections door, to Collections.
  it("Money > Quotes clicked from the Collections tab switches to the Quotes tab, and the collections door back (W9-WEB-COMMERCE-NAV)", () => {
    const { rerender } = openAt('/app/commerce?tab=pipeline&view=collections');
    expect(activeTab()).toBe('collections');
    expect(shown()).toEqual(['collections']);

    navigate(rerender, '/app/commerce?tab=pipeline&view=quotes');
    expect(activeTab()).toBe('quotes');
    expect(shown()).toEqual(['quotes']);
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();

    navigate(rerender, '/app/commerce?tab=pipeline&view=collections');
    expect(activeTab()).toBe('collections');
    expect(shown()).toEqual(['collections']);
  });

  // CR-W9WCN-1 (W9-WEB-COMMERCE-NAV review), as it reads now: the command
  // palette's Quotes / New Quote / Invoices, the new-entity menu's Quote and
  // the contact actions still push the legacy ?tab=quotes / ?tab=invoices.
  // The quotes door lands on the Quotes tab; the invoices door leaves for the
  // invoices list, on a fresh mount and while the page is mounted.
  it("CR-W9WCN-1: a legacy ?tab=quotes door lands on the Quotes tab and ?tab=invoices goes to /app/commerce/invoices, on a fresh mount and while mounted", () => {
    openAt('/app/commerce?tab=quotes');
    expect(activeTab()).toBe('quotes');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('quotes');
    cleanup();

    openAt('/app/commerce?tab=invoices');
    expect(nav.router.replace).toHaveBeenCalledWith('/app/commerce/invoices');
    nav.router.replace.mockClear();
    cleanup();

    const { rerender } = openAt('/app/commerce?tab=pipeline&view=quotes');
    navigate(rerender, '/app/commerce?tab=invoices');
    expect(nav.router.replace).toHaveBeenCalledWith('/app/commerce/invoices');
    nav.router.replace.mockClear();

    // Control: ?tab=payments lands on Collections (the pipeline's collections view).
    navigate(rerender, '/app/commerce?tab=payments');
    expect(activeTab()).toBe('collections');
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});
