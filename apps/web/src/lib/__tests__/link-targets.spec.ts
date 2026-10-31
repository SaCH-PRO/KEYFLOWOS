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
 * A link into the commerce workspace that carries an invoice id: the template
 * either interpolates something named invoiceId, or sets an invoice/invoiceId
 * query key. Only /app/commerce is in scope — quotes-panel deliberately opens
 * /app/payments filtered by an invoice id, which is a search, not a deep link.
 */
const INVOICE_LINK =
  /`(\/app\/commerce[^`]*(?:\$\{[^}]*invoiceId[^}]*\}|[?&](?:invoice|invoiceId)=)[^`]*)`/g;
/** The one shape that opens the invoice: the detail route, any query after it. */
const INVOICE_DETAIL = /^\/app\/commerce\/invoices\/\$\{[^}]+\}(?:\?[^`]*)?$/;

function invoiceLinks(): Array<{ file: string; target: string }> {
  const out: Array<{ file: string; target: string }> = [];
  for (const file of sourceFiles()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(INVOICE_LINK)) {
      out.push({ file: relOf(file), target: m[1] });
    }
  }
  return out;
}

/**
 * Files outside the R0-08 write set that still carry an invoice id to a commerce
 * tab. Shrink-only, and self-cleaning below: fix the link, remove the line.
 */
const INVOICE_LINK_OUTSIDE_WRITE_SET: Record<string, string> = {
  'components/ai/cross-module-links.tsx': 'tab=invoices&invoiceId=',
  'app/app/money/components/money-activity-feed.tsx': 'tab=pipeline&invoice= (x3)',
  'app/app/projects/components/project-detail-tabs/revenue-tab.tsx': 'tab=invoices&id= (x2)',
  'app/app/projects/components/project-detail-tabs/overview-tab.tsx': 'tab=invoices&id=',
  'app/app/commerce/recurring/recurring-panel.tsx': 'tab=invoices&invoice=',
  'app/app/bookings/components/booking-detail-drawer.tsx': 'tab=invoices&invoiceId=',
  'app/app/bookings/page.tsx': 'tab=invoices&invoiceId=',
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

  it('every other commerce link carrying an invoice id opens the detail route, or is ledgered', () => {
    const broken = invoiceLinks()
      .filter((l) => !INVOICE_DETAIL.test(l.target))
      .filter((l) => !(l.file in INVOICE_LINK_OUTSIDE_WRITE_SET))
      .map((l) => `${l.target}  <- ${l.file}`);

    expect(broken, 'point these at /app/commerce/invoices/${id}').toEqual([]);
  });

  it('the invoice-link ledger only names files that are still broken', () => {
    const brokenFiles = new Set(
      invoiceLinks()
        .filter((l) => !INVOICE_DETAIL.test(l.target))
        .map((l) => l.file),
    );
    for (const [file, reason] of Object.entries(INVOICE_LINK_OUTSIDE_WRITE_SET)) {
      expect(brokenFiles.has(file), `${file} ("${reason}") is fixed — remove its entry`).toBe(true);
    }
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

  it('the go-home shortcut (kf:go-home) targets /app/command-center', () => {
    expect(read('hooks/use-keyboard-shortcuts.ts')).toMatch(
      /goHome = \(\) => router\.push\("\/app\/command-center"\)/,
    );
  });
});

describe('the nav has a door to invoices and quotes (CF-20)', () => {
  // Read from source, like nav-destinations.spec.ts: label and href literals.
  const nav = read('lib/nav-config.ts');
  const operate = nav.slice(nav.indexOf('export const operateSections'), nav.indexOf('export const operateNav'));

  it('Invoices opens the existing invoices hub', () => {
    expect(operate).toMatch(/label: "Invoices", href: "\/app\/commerce\/invoices"/);
    expect(resolvesToRoute('/app/commerce/invoices')).toBe(true);
  });

  it('Quotes opens the existing quotes view of the pipeline', () => {
    // There is no /app/commerce/quotes page; quotes live in the pipeline tab,
    // which reads ?view=quotes on mount (finance-pipeline.tsx).
    expect(operate).toMatch(/label: "Quotes", href: "\/app\/commerce\?tab=pipeline&view=quotes"/);
    expect(read('app/app/finance/components/finance-pipeline.tsx')).toMatch(/searchParams\.get\("view"\)/);
  });
});

describe('the "+ Contact" entry opens the add-contact form', () => {
  it('new-entity-menu links /app/crm/contacts?action=new, the only action the contacts page reads', () => {
    expect(read('app/app/crm/contacts/page.tsx')).toMatch(/action === "new"/);
    expect(read('components/layout/new-entity-menu.tsx')).toMatch(
      /label: "Contact", icon: Users, href: "\/app\/crm\/contacts\?action=new"/,
    );
  });
});
