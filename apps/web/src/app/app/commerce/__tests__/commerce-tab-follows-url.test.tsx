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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
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
// The app shell's composer provider, which the real pipeline's send modal reads.
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

/**
 * What the shell hands the page. Empty for the tab cases; the pipeline-view
 * case gives it one quote and one invoice, so which of the two the real
 * pipeline lists says which view it is on.
 */
const shellData = vi.hoisted(() => ({ invoices: [] as unknown[], quotes: [] as unknown[] }));
/** When set, the Pipeline tab is the real FinancePipeline instead of its marker. */
const pipelineMode = vi.hoisted(() => ({ real: false }));

vi.mock('../hooks/use-commerce-shell', () => ({
  useCommerceShell: () => ({
    businessId: 'biz_1', businessCurrency: 'TTD',
    workspaceLoading: false, workspaceError: null,
    products: [], setProducts: vi.fn(),
    invoices: shellData.invoices, setInvoices: vi.fn(),
    quotes: shellData.quotes, setQuotes: vi.fn(),
    contacts: [], loading: false, error: null,
  }),
}));
vi.mock('../hooks/use-billing-workspace', () => ({
  useBillingWorkspace: () => ({
    pendingPrefill: null, prefillForContact: vi.fn(),
    triggerNewQuote: 0, triggerNewInvoice: 0, triggerNewSchedule: 0,
    setTriggerNewQuote: vi.fn(), setTriggerNewInvoice: vi.fn(), setTriggerNewSchedule: vi.fn(),
  }),
}));

vi.mock('../../finance/components/finance-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../finance/components/finance-pipeline')>();
  return {
    FinancePipeline: (props: React.ComponentProps<typeof actual.FinancePipeline>) => (
      <div data-testid="tab-pipeline">{pipelineMode.real ? <actual.FinancePipeline {...props} /> : null}</div>
    ),
  };
});
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
const shown = () => ['snapshot', 'pipeline', 'recurring'].filter((t) => screen.queryByTestId(`tab-${t}`));

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
  pipelineMode.real = false;
  shellData.invoices = [];
  shellData.quotes = [];
});
afterEach(cleanup);

describe('the commerce page shows the tab its URL names, while mounted (R0-08b F2)', () => {
  it('mounts on the tab the URL names', () => {
    openAt('/app/commerce?tab=pipeline&view=quotes');
    expect(activeTab()).toBe('pipeline');
    expect(shown()).toEqual(['pipeline']);
  });

  it('Money > Quotes clicked from the Snapshot tab opens the pipeline', () => {
    const { rerender } = openAt('/app/commerce');
    expect(activeTab()).toBe('snapshot');

    navigate(rerender, '/app/commerce?tab=pipeline&view=quotes');

    expect(activeTab()).toBe('pipeline');
    // The pipeline mounts fresh here, so it reads ?view=quotes on its mount.
    expect(shown()).toEqual(['pipeline']);
  });

  it('Money > Sales (bare /app/commerce) clicked from the pipeline returns to the Snapshot', () => {
    const { rerender } = openAt('/app/commerce?tab=pipeline&view=quotes');
    expect(activeTab()).toBe('pipeline');

    navigate(rerender, '/app/commerce');

    expect(activeTab()).toBe('snapshot');
    expect(shown()).toEqual(['snapshot']);
  });

  it('a legacy ?tab=quotes arriving after mount lands on the pipeline and is rewritten', () => {
    const { rerender } = openAt('/app/commerce');
    navigate(rerender, '/app/commerce?tab=quotes');
    expect(activeTab()).toBe('pipeline');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('pipeline');
  });

  it('a tab picked on the page sticks: following the URL does not undo the click', () => {
    openAt('/app/commerce?tab=pipeline');
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

  // W9-WEB-COMMERCE-NAV (was it.todo, BLOCKED outside the R0-08b write set):
  // from the pipeline tab itself (say its Invoices view), Money > Quotes
  // changes only ?view, and the pipeline is already mounted. It read ?view
  // once on mount, so the Invoices view stayed on screen under a quotes URL.
  // The real pipeline is mounted here: it holds one quote and one invoice, so
  // the record it lists says the view it is on. It must follow ?view without
  // remounting, so what the owner typed in its search is still there.
  it("Money > Quotes clicked from the pipeline's Invoices view switches the pipeline to its quotes view (W9-WEB-COMMERCE-NAV, was it.todo)", () => {
    pipelineMode.real = true;
    shellData.quotes = [{ id: 'v95q_quote_1', quoteNumber: 'Q-V95Q-1', status: 'SENT', total: 100, currency: 'TTD', items: [], createdAt: '2026-11-01T00:00:00.000Z', issueDate: '2026-11-01T00:00:00.000Z' }];
    shellData.invoices = [{ id: 'v95q_inv_1', invoiceNumber: 'INV-V95Q-1', status: 'SENT', total: 200, currency: 'TTD', items: [], issueDate: '2026-11-01T00:00:00.000Z' }];
    const listed = () => ['Q-V95Q-1', 'INV-V95Q-1'].filter((n) => screen.queryAllByText(n).length > 0);

    const { rerender } = openAt('/app/commerce?tab=pipeline&view=invoices');
    expect(activeTab()).toBe('pipeline');
    expect(listed()).toEqual(['INV-V95Q-1']);
    const search = screen.getByPlaceholderText('Search records...') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'V95Q' } });
    expect(listed()).toEqual(['INV-V95Q-1']);

    navigate(rerender, '/app/commerce?tab=pipeline&view=quotes');

    expect(activeTab()).toBe('pipeline');
    expect(listed()).toEqual(['Q-V95Q-1']);
    // The same pipeline, not a remount: the search the owner typed is kept.
    expect((screen.getByPlaceholderText('Search records...') as HTMLInputElement).value).toBe('V95Q');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('quotes');

    // A view picked in the pipeline still sticks: following ?view does not undo it.
    fireEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    expect(listed()).toEqual(['INV-V95Q-1']);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('invoices');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(listed()).toEqual(['Q-V95Q-1', 'INV-V95Q-1']);
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });
});
