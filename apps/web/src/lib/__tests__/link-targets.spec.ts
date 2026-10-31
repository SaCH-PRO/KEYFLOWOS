/**
 * Every hardcoded link goes somewhere that exists.
 *
 * The nav is already guarded from both directions — nav-destinations.spec.ts
 * asserts each nav href resolves, nav-reachability.spec.ts asserts each page has
 * a door. Neither looks at the other several hundred links in the product: the
 * "Manage contacts" button on a settings card, the back-arrow at the top of a
 * detail page. Those are the ones nobody clicks until a customer does.
 *
 * Found when this was first run, both live in the shipped product:
 *
 *   /app/contacts   "Manage contacts", on the accounting page's customer-sync
 *                   card. The route is /app/crm/contacts. Fixed here.
 *   /app/plans      the back-arrow on /app/plans/[planId]. There is no plans
 *                   index — the directory holds only [planId]. Acknowledged
 *                   below rather than fixed, because the destination does not
 *                   exist and inventing one is a product decision.
 *
 * This is the same defect that put six KEY tools on /app/finance/reports, an
 * 8-line redirect, and it is invisible to typecheck: `href` is a string, and
 * every string is a valid one.
 *
 * WHY ONLY LITERALS. nav-reachability measured this app's navigation as 39
 * static <Link href="/app/…">, 222 dynamic href={…} and 293 router.push(…) —
 * about 93% computed — and dropped a static link-graph for that reason. That
 * reasoning is about REACHABILITY, where a missed edge invents an orphan and
 * the gate turns noisy. The direction here is the safe one: a literal string
 * naming a route that does not exist is wrong no matter what the other 93% do.
 * Skipping computed targets costs coverage; it cannot cost correctness.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { operateSections } from '../nav-config';
import { MODE_OPERATE_ITEMS } from '../disclosure-mode';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP_DIR = path.join(WEB_SRC, 'app');
const PUBLIC_DIR = path.join(WEB_SRC, '..', 'public');

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

/**
 * Link targets that do not resolve, and are staying that way for now.
 * Shrink-only: an entry here is a promise to fix, not permission to add more.
 */
const ACKNOWLEDGED: Record<string, string> = {
  '/app/plans':
    'back-arrow on /app/plans/[planId], which nav-reachability already carries ' +
    'as todo-connect. No plans index exists; building one is a product call.',
};

/** Route -> the file that would serve it, using the app-router conventions. */
function resolvesToRoute(route: string): boolean {
  let dir = APP_DIR;
  for (const seg of route.replace(/^\//, '').split('/').filter(Boolean)) {
    const literal = path.join(dir, seg);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dynamic = isDir(dir)
      ? fs.readdirSync(dir).find((d) => /^[[(]/.test(d) && isDir(path.join(dir, d)))
      : undefined;
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, 'page.tsx')) || fs.existsSync(path.join(dir, 'route.ts'));
}

/**
 * Next generates these from a file whose name is not the URL, so they resolve
 * at runtime while looking absent on disk.
 */
const GENERATED: Record<string, string> = {
  '/manifest.webmanifest': 'manifest.ts',
  '/robots.txt': 'robots.ts',
  '/sitemap.xml': 'sitemap.ts',
};

function resolvesToAsset(target: string): boolean {
  const generated = GENERATED[target];
  if (generated && fs.existsSync(path.join(APP_DIR, generated))) return true;
  return fs.existsSync(path.join(PUBLIC_DIR, target.replace(/^\//, '')));
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.next', 'dist'].includes(e.name)) continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/__tests__|\.spec\.|\.test\./.test(p)) {
        out.push(p);
      }
    }
  };
  walk(WEB_SRC);
  return out;
}

/** Only forms where the destination is a literal in the source. */
const PATTERNS: RegExp[] = [
  /href="(\/[^"#?]*)"/g,
  /href=\{'(\/[^'#?]*)'\}/g,
  /router\.push\('(\/[^'#?]*)'\)/g,
  /router\.replace\('(\/[^'#?]*)'\)/g,
  /\bredirect\('(\/[^'#?]*)'\)/g,
];

function literalTargets(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const target = m[1];
        if (!found.has(target)) found.set(target, []);
        const where = path.relative(WEB_SRC, file).split(path.sep).join('/');
        if (!found.get(target)!.includes(where)) found.get(target)!.push(where);
      }
    }
  }
  return found;
}

describe('hardcoded links point at routes that exist', () => {
  const targets = literalTargets();

  it('finds links to check — this gate is not vacuous', () => {
    // Without this, deleting a pattern above makes every assertion below pass
    // by having nothing to say. That failure mode has happened five times in
    // this repository; see gate-vacuity.spec.ts on the server.
    expect(targets.size, 'no literal link targets found — the extractor is broken').toBeGreaterThan(
      25,
    );
    expect([...targets.keys()], 'the nav links are missing — expected extraction to see them').toContain(
      '/app/settings',
    );
  });

  it('the resolver recognises a route that exists and rejects one that does not', () => {
    // A resolver that returns true for everything would pass the real assertion
    // silently, which is how a green gate comes to be measuring nothing.
    expect(resolvesToRoute('/app/settings'), 'a known-good route was rejected').toBe(true);
    expect(resolvesToRoute('/app/definitely-not-a-real-route-xyz'), 'a bogus route resolved').toBe(
      false,
    );
  });

  it('every literal target resolves to a route, an asset, or is acknowledged', () => {
    const broken = [...targets.entries()]
      .filter(([t]) => !(t in ACKNOWLEDGED))
      .filter(([t]) => !resolvesToRoute(t) && !resolvesToAsset(t))
      .map(([t, files]) => `${t}  <- ${files.slice(0, 3).join(', ')}`);

    expect(
      broken,
      'these hardcoded links go nowhere. Either the route moved and the link ' +
        'was not updated, or the destination was never built. Fix the href, or ' +
        'add it to ACKNOWLEDGED with the reason it cannot be fixed yet.',
    ).toEqual([]);
  });

  it('the acknowledged list only contains links that are still broken', () => {
    // Keeps the ledger shrink-only and self-cleaning: once a destination is
    // built, its excuse has to go, or the list slowly stops meaning anything.
    for (const [target, reason] of Object.entries(ACKNOWLEDGED)) {
      const stillUsed = targets.has(target);
      const stillBroken = !resolvesToRoute(target) && !resolvesToAsset(target);
      expect(
        stillUsed && stillBroken,
        `${target} is acknowledged ("${reason}") but is now ` +
          `${!stillUsed ? 'no longer linked anywhere' : 'a real destination'} — remove the entry.`,
      ).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * R0-08-WEB-NAV-LINKS (CF-20, CF-21, M08)
 *
 * The literal-only gate above cannot see these: each is a link to a route that
 * EXISTS, carrying a query the destination ignores. /app/commerce rewrites
 * ?tab=invoices to the pipeline tab and never reads ?invoice=, so an owner who
 * clicks "Invoice" on a payment row lands on a list, not the invoice.
 * /app/settings/business renders the payments tab whatever ?tab says, so
 * "Upgrade" lands on gateways, not the plan. The checks below read the source
 * for the specific shape of each defect.
 * ──────────────────────────────────────────────────────────────────────────── */

const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
const relOf = (file: string) => path.relative(WEB_SRC, file).split(path.sep).join('/');

/**
 * A link into the commerce workspace that carries an invoice id. Three shapes,
 * whatever the interpolated variable is called:
 *   - the template interpolates something named invoiceId;
 *   - it sets an invoice= or invoiceId= query key;
 *   - it pairs tab=invoices with an id= key, in either order. The contact
 *     timeline's "View Invoice" passes data.invoiceId as `entityId`, so a
 *     name-based check alone never sees it.
 * Only /app/commerce is in scope — quotes-panel deliberately opens
 * /app/payments filtered by an invoice id, which is a search, not a deep link.
 */
const INVOICE_LINK =
  /`(\/app\/commerce[^`]*(?:\$\{[^}]*invoiceId[^}]*\}|[?&](?:invoice|invoiceId)=|[?&]tab=invoices&(?:[^`]*&)?id=|[?&]id=[^`]*[?&]tab=invoices\b)[^`]*)`/g;
/**
 * The one shape that opens the invoice: the detail route with the id passed
 * through encodeURIComponent, any query after it. A raw `${t.invoiceId}` is
 * rejected (review ST-R008-2): an id with a slash or a `?` in it, or an
 * undefined one, otherwise builds a different URL from the one the row names.
 */
const INVOICE_DETAIL = /^\/app\/commerce\/invoices\/\$\{encodeURIComponent\([^`]+?\)\}(?:\?[^`]*)?$/;

/**
 * Every template link to the invoice detail route, whatever the id is called.
 * INVOICE_LINK only sees a detail link whose interpolation names invoiceId, so
 * a fixed `${encodeURIComponent(inv.id)}` would be invisible to it; this is how
 * the per-file counts below see the links they are counting.
 */
const DETAIL_LINK = /`(\/app\/commerce\/invoices\/\$\{[^`]*)`/g;

function invoiceLinks(): Array<{ file: string; target: string }> {
  const out: Array<{ file: string; target: string }> = [];
  for (const file of sourceFiles()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(INVOICE_LINK)) {
      out.push({ file: relOf(file), target: m[1] });
    }
  }
  return out;
}

const detailLinksIn = (rel: string) => [...read(rel).matchAll(DETAIL_LINK)].map((m) => m[1]);
const invoiceLinksIn = (rel: string) => [...read(rel).matchAll(INVOICE_LINK)].map((m) => m[1]);

/** Broken links per file: an invoice id carried somewhere other than INVOICE_DETAIL. */
function brokenByFile(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of invoiceLinks()) {
    if (INVOICE_DETAIL.test(l.target)) continue;
    out.set(l.file, [...(out.get(l.file) ?? []), l.target]);
  }
  return out;
}

interface LedgerEntry {
  /** How many broken links the file holds. Exact: a second one fails (F3). */
  count: number;
  reason: string;
}

/**
 * Files that still carry an invoice id to a commerce TAB instead of the detail
 * route. Empty since R0-08b: the eight files R0-08 ledgered are fixed. Keyed by
 * file AND count (review F3), so a ledgered file that grows a second broken
 * link fails instead of hiding behind the first. Shrink-only, self-cleaning.
 */
const INVOICE_LINK_OUTSIDE_WRITE_SET: Record<string, LedgerEntry> = {};

/**
 * Files outside the R0-08b write set whose link already opens the detail route
 * but splices the id in raw, which INVOICE_DETAIL now rejects (ST-R008-2). They
 * reach the right screen for an ordinary cuid; they are recorded here rather
 * than fixed because the files belong to other packets. Same count rule.
 */
const UNENCODED_INVOICE_DETAIL_OUTSIDE_WRITE_SET: Record<string, LedgerEntry> = {
  'app/app/financial-flow/page.tsx': {
    count: 1,
    reason: '`${signal.payload?.invoiceId}` raw; a signal without an invoice id opens /invoices/undefined',
  },
  'app/app/commerce/invoices/[id]/edit/page.tsx': {
    count: 2,
    reason: '`${invoiceId}` from the route params, raw (back arrow and post-save push)',
  },
};

/**
 * Every link that carries an invoice id in the files R0-08 ledgered, plus the
 * payments console R0-08 fixed, and how many each holds. Each must be
 * INVOICE_DETAIL. Exact counts (F3): a file cannot pass by fixing one link of
 * three, and a link that disappears is noticed rather than silently uncounted.
 */
const INVOICE_DETAIL_LINKS: Record<string, number> = {
  'app/app/payments/page.tsx': 2,
  'components/ai/cross-module-links.tsx': 1,
  'app/app/money/components/money-activity-feed.tsx': 3,
  'app/app/projects/components/project-detail-tabs/revenue-tab.tsx': 2,
  'app/app/projects/components/project-detail-tabs/overview-tab.tsx': 1,
  'app/app/commerce/recurring/recurring-panel.tsx': 1,
  'app/app/bookings/components/booking-detail-drawer.tsx': 1,
  'app/app/bookings/page.tsx': 1,
  // The CTA map the cross-module journey uses, and both "View Invoice" buttons.
  'components/contacts/timeline-tab-panel.tsx': 3,
};

describe('a link that names an invoice opens that invoice (CF-21)', () => {
  it('the invoice detail route exists, so the target below is a real screen', () => {
    expect(resolvesToRoute('/app/commerce/invoices/inv_123')).toBe(true);
  });

  it('commerce still drops ?tab=invoices onto the pipeline — the defect these links fell into', () => {
    // Characterises the destination: if commerce ever honours ?tab=invoices
    // with an id, this fails and the ledger below can be revisited.
    const commerce = read('app/app/commerce/page.tsx');
    expect(commerce).toMatch(/\["quotes", "invoices", "payments"\]\.includes\(paramTab\)/);
    expect(commerce, 'commerce now reads ?invoice= — revisit this gate').not.toMatch(
      /get\("invoice(Id)?"\)/,
    );
    expect(commerce, 'commerce now reads ?id= — revisit this gate').not.toMatch(/get\("id"\)/);
  });

  it('the extractor sees every shape that carries an invoice id, whatever the variable is called', () => {
    // The completeness claim below is only as good as this regex. The samples
    // are shapes found in the product, plus the id= key before tab=invoices;
    // the last two must NOT be read as an invoice deep link (a contact filter,
    // and commerce's own record drawer, which honours recordType/recordId).
    const tpl = (s: string) => '`' + s + '`';
    const seen = (s: string) => [...tpl(s).matchAll(INVOICE_LINK)].map((m) => m[1]);
    const carries = [
      '/app/commerce?tab=invoices&id=${encodeURIComponent(entityId)}',
      '/app/commerce?tab=invoices&id=${encodeURIComponent(inv.id)}',
      '/app/commerce?id=${x}&tab=invoices',
      '/app/commerce?tab=invoices&invoice=${entry.id}',
      '/app/commerce?tab=pipeline&invoice=${inv.id}',
      '/app/commerce?tab=invoices&invoiceId=${inv.id}',
      '/app/commerce?tab=invoices&id=${project.invoiceId}',
      '/app/commerce/invoices/${encodeURIComponent(t.invoiceId)}',
    ];
    for (const s of carries) expect(seen(s), s).toEqual([s]);
    for (const s of [
      '/app/commerce?tab=invoices&contactId=${contactId}',
      '/app/commerce?recordType=invoice&recordId=${id}',
    ]) {
      expect(seen(s), s).toEqual([]);
    }
  });

  it('the detail shape requires the id to be encoded (ST-R008-2)', () => {
    // Accepts the encoded detail route, with or without a query after it.
    for (const s of [
      '/app/commerce/invoices/${encodeURIComponent(t.invoiceId)}',
      '/app/commerce/invoices/${encodeURIComponent(inv.id)}',
      '/app/commerce/invoices/${encodeURIComponent(inv.id)}?action=record-payment',
    ]) {
      expect(INVOICE_DETAIL.test(s), s).toBe(true);
    }
    // Rejects a raw id, and every commerce tab that ignores the id.
    for (const s of [
      '/app/commerce/invoices/${t.invoiceId}',
      '/app/commerce/invoices/${signal.payload?.invoiceId}',
      '/app/commerce/invoices/${t.invoiceId}?x=${encodeURIComponent(y)}',
      '/app/commerce?tab=invoices&invoiceId=${encodeURIComponent(inv.id)}',
      '/app/commerce?tab=pipeline&invoice=${inv.id}',
    ]) {
      expect(INVOICE_DETAIL.test(s), s).toBe(false);
    }
  });

  it('finds the contact timeline\'s "View Invoice" links, which name the id entityId', () => {
    // Regression for the review finding: these escaped the name-based regex.
    // Once fixed they are detail links that INVOICE_LINK may no longer see by
    // name, so both extractors are consulted.
    const rel = 'components/contacts/timeline-tab-panel.tsx';
    const timeline = new Set([...invoiceLinksIn(rel), ...detailLinksIn(rel)]);
    expect(timeline.size, 'timeline invoice links not found — extractor is broken').toBeGreaterThanOrEqual(3);
  });

  it('the payments console links each transaction to its invoice detail page', () => {
    const payments = invoiceLinks().filter((l) => l.file === 'app/app/payments/page.tsx');

    // The table row and the detail drawer: two links. Zero would be vacuous.
    expect(payments.length, 'payments invoice links not found — extractor is broken').toBeGreaterThanOrEqual(2);
    expect(
      payments.filter((l) => !INVOICE_DETAIL.test(l.target)).map((l) => l.target),
      'these payments links carry an invoice id to a commerce tab that ignores it',
    ).toEqual([]);
  });

  it('each formerly ledgered file opens the invoice detail page from every invoice link, by count', () => {
    const off: string[] = [];
    for (const [rel, expected] of Object.entries(INVOICE_DETAIL_LINKS)) {
      const wrongShape = invoiceLinksIn(rel).filter((t) => !INVOICE_DETAIL.test(t));
      const detail = detailLinksIn(rel);
      const unencoded = detail.filter((t) => !INVOICE_DETAIL.test(t));
      if (wrongShape.length) off.push(`${rel}: still links a commerce tab: ${wrongShape.join(' | ')}`);
      if (unencoded.length) off.push(`${rel}: id not encoded: ${unencoded.join(' | ')}`);
      if (detail.length !== expected) off.push(`${rel}: ${detail.length} detail links, expected ${expected}`);
    }
    expect(off, 'point these at /app/commerce/invoices/${encodeURIComponent(id)}').toEqual([]);
  });

  it('every other commerce link carrying an invoice id opens the detail route, or is ledgered by count', () => {
    const off: string[] = [];
    for (const [file, targets] of brokenByFile()) {
      const allowed =
        (INVOICE_LINK_OUTSIDE_WRITE_SET[file]?.count ?? 0) +
        (UNENCODED_INVOICE_DETAIL_OUTSIDE_WRITE_SET[file]?.count ?? 0);
      if (targets.length > allowed) off.push(`${file}: ${targets.length} broken, ${allowed} ledgered: ${targets.join(' | ')}`);
    }
    expect(off, 'point these at /app/commerce/invoices/${encodeURIComponent(id)}').toEqual([]);
  });

  it('both invoice-link ledgers hold exactly what is still broken', () => {
    const broken = brokenByFile();
    for (const [file, { count, reason }] of Object.entries(INVOICE_LINK_OUTSIDE_WRITE_SET)) {
      const wrongShape = (broken.get(file) ?? []).filter((t) => !t.startsWith('/app/commerce/invoices/'));
      expect(wrongShape.length, `${file} ("${reason}"): ledger count is stale — update or remove it`).toBe(count);
    }
    for (const [file, { count, reason }] of Object.entries(UNENCODED_INVOICE_DETAIL_OUTSIDE_WRITE_SET)) {
      const unencoded = (broken.get(file) ?? []).filter((t) => t.startsWith('/app/commerce/invoices/'));
      expect(unencoded.length, `${file} ("${reason}"): ledger count is stale — update or remove it`).toBe(count);
      expect(file in INVOICE_DETAIL_LINKS, `${file} is in the R0-08b write set — fix it, do not ledger it`).toBe(false);
    }
  });

  it('the invoice-tab ledger is empty: every R0-08 entry was fixed, none may return', () => {
    expect(Object.keys(INVOICE_LINK_OUTSIDE_WRITE_SET)).toEqual([]);
  });
});

describe('billing links land on the billing screen', () => {
  it('/app/settings/business ignores ?tab, so ?tab=billing there is a dead deep link', () => {
    // Characterises the destination. If the page starts honouring ?tab, this
    // fails and the assertion below can be reconsidered.
    const business = read('app/app/settings/business/page.tsx');
    expect(business).not.toMatch(/useSearchParams|get\("tab"\)/);
    expect(resolvesToRoute('/app/settings/billing'), 'the billing screen moved').toBe(true);
    expect(read('app/app/settings/billing/page.tsx')).toMatch(/<BillingTab\s*\/>/);
  });

  it('no file links /app/settings/business?tab=billing', () => {
    const offenders = sourceFiles()
      .filter((f) => fs.readFileSync(f, 'utf8').includes('/app/settings/business?tab=billing'))
      .map(relOf);

    expect(offenders, 'link /app/settings/billing instead').toEqual([]);
  });
});

describe('the cockpit is linked directly, not through its redirect stub', () => {
  it('the /app/keyflow-command stub still exists and still forwards (no route is deleted)', () => {
    // D-2 consolidation (CWS-BP4/5) is V1+ backlog. This packet re-points
    // links; it does not remove the stub that bookmarks rely on.
    expect(read('app/app/keyflow-command/page.tsx')).toMatch(/redirect\("\/app\/command-center"\)/);
    expect(resolvesToRoute('/app/command-center')).toBe(true);
  });

  it('the sidebar logo goes straight to /app/command-center', () => {
    const sidebar = read('components/layout/desktop-sidebar.tsx');
    expect(sidebar, 'the logo still targets the redirect stub').not.toContain('/app/keyflow-command');
    expect(sidebar).toMatch(/href="\/app\/command-center"/);
  });

  it('no file in the R0-08 write set links the redirect stub', () => {
    const writeSet = [
      'lib/nav-config.ts',
      'lib/semantic-routes.ts',
      'components/layout/desktop-sidebar.tsx',
      'components/addon-pack-gate.tsx',
      'components/ui/upgrade-prompt.tsx',
      'components/ui/upgrade-modal.tsx',
      'app/app/payments/page.tsx',
      'app/app/commerce/components/revenue-setup-drawer.tsx',
    ];
    expect(writeSet.filter((f) => /["'`]\/app\/keyflow-command["'`#]/.test(read(f)))).toEqual([]);
  });

  it('no file in the R0-08b write set links the redirect stub', () => {
    // The mobile drawer's cockpit link and the ⌘H shortcut both went through
    // the stub. A pathname comparison against the stub counts too: once the
    // link goes straight to the cockpit, the drawer must light up on the
    // cockpit's own path, which is where the user now is.
    const writeSet = [
      'lib/disclosure-mode.ts',
      'hooks/use-keyboard-shortcuts.ts',
      'components/functional/keyboard-shortcuts-help.tsx',
      'components/layout/mobile-drawer.tsx',
      'components/layout/new-entity-menu.tsx',
      'app/app/commerce/page.tsx',
      ...Object.keys(INVOICE_DETAIL_LINKS),
    ];
    expect(writeSet.filter((f) => /["'`]\/app\/keyflow-command["'`#]/.test(read(f)))).toEqual([]);
  });

  it('the mobile drawer\'s cockpit link goes straight to /app/command-center', () => {
    const drawer = read('components/layout/mobile-drawer.tsx');
    expect(drawer).toMatch(/<Link\s+href="\/app\/command-center"/);
    expect(drawer, 'the drawer link is not lit on the cockpit itself').toMatch(
      /pathname\.startsWith\("\/app\/command-center"\)/,
    );
  });

  it('the go-home shortcut (kf:go-home) targets /app/command-center', () => {
    expect(read('hooks/use-keyboard-shortcuts.ts')).toMatch(
      /goHome = \(\) => router\.push\("\/app\/command-center"\)/,
    );
  });
});

describe('the nav has a door to invoices and quotes (CF-20)', () => {
  // There is no /app/commerce/quotes page; quotes live in the pipeline tab,
  // which reads ?view=quotes on mount (finance-pipeline.tsx).
  const operate = (() => {
    const src = read('lib/nav-config.ts');
    return src.slice(src.indexOf('export const operateSections'), src.indexOf('export const buildSections'));
  })();
  const money = () => operateSections.find((s) => s.id === 'money')?.items ?? [];
  const MODES = ['startup', 'growth', 'enterprise'] as const;
  /** What use-app-layout shows: an exact-label allowlist, enterprise unfiltered. */
  const shownIn = (mode: (typeof MODES)[number]) =>
    money().filter((i) => mode === 'enterprise' || MODE_OPERATE_ITEMS[mode].includes(i.label));

  it('the destinations the entries would use exist today', () => {
    expect(resolvesToRoute('/app/commerce/invoices')).toBe(true);
    expect(read('app/app/finance/components/finance-pipeline.tsx')).toMatch(/searchParams\.get\("view"\)/);
  });

  it('Invoices opens the existing invoices hub', () => {
    expect(operate).toMatch(/label: "Invoices", href: "\/app\/commerce\/invoices"/);
    expect(money().find((i) => i.label === 'Invoices')?.href, 'not in the Money section').toBe(
      '/app/commerce/invoices',
    );
  });

  it('Quotes opens the existing quotes view of the pipeline', () => {
    expect(operate).toMatch(/label: "Quotes", href: "\/app\/commerce\?tab=pipeline&view=quotes"/);
    const quotes = money().find((i) => i.label === 'Quotes');
    expect(quotes?.href, 'not in the Money section').toBe('/app/commerce?tab=pipeline&view=quotes');
    expect(quotes?.matchTab).toBe('pipeline');
  });

  it('every disclosure mode shows both doors, so a new owner (startup, the default) sees them', () => {
    for (const mode of MODES) {
      expect(MODE_OPERATE_ITEMS[mode], mode).toEqual(expect.arrayContaining(['Invoices', 'Quotes']));
      const hrefs = shownIn(mode).map((i) => i.href);
      expect(hrefs, mode).toContain('/app/commerce/invoices');
      expect(hrefs, mode).toContain('/app/commerce?tab=pipeline&view=quotes');
    }
  });

  // The href is only half the door: Next keeps /app/commerce mounted when a nav
  // click changes only its search params, so the page must follow ?tab after
  // mount. That is rendered, not string-matched, in
  // app/app/commerce/__tests__/commerce-tab-follows-url.test.tsx (review F2).
  it('the commerce page follows ?tab while mounted, so the Quotes door works from another commerce tab', () => {
    const commerce = read('app/app/commerce/page.tsx');
    expect(commerce).toMatch(/const paramTab = searchParams\.get\("tab"\);/);
    expect(commerce).toMatch(/\}, \[paramTab\]\);/);
  });

  // BLOCKED (outside the R0-08b write set, review F2): the rail's active state.
  // use-app-layout.ts refreshes queryTab only when the pathname changes, so a
  // search-param-only click (Sales -> Quotes on /app/commerce) leaves the rail
  // lit as it was; and matchTab "pipeline" lights Quotes for every pipeline
  // view, Invoices included, because isSecondaryActive cannot match ?view.
  // Both need apps/web/src/hooks/use-app-layout.ts (read the search params
  // reactively; a matchView on NavItem), which this packet may not edit.
  // Sales lighting beside Quotes is the existing parent-entry rule (Sales also
  // lights on /app/commerce/invoices and /app/commerce/gateway), not a defect
  // of this entry.
  it.todo('Quotes lights only on the quotes view, and the rail follows a search-param-only click');
});

describe('the "+ Contact" entry opens the add-contact form', () => {
  it('the contacts page opens quick-add only for ?action=new', () => {
    expect(read('app/app/crm/contacts/page.tsx')).toMatch(/action === "new"/);
  });

  it('new-entity-menu links /app/crm/contacts?action=new', () => {
    expect(read('components/layout/new-entity-menu.tsx')).toMatch(
      /label: "Contact", icon: Users, href: "\/app\/crm\/contacts\?action=new"/,
    );
  });
});
