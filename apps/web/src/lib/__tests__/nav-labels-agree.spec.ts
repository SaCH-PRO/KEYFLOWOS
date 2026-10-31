/**
 * One screen, one name.
 *
 * /app/command-center was "Cockpit" on the rail, "Command Center" in the
 * breadcrumb and "Business Command Center" in its own header. /app/commerce was
 * "Sales" in the nav and the breadcrumb and "Revenue" on the page. An owner who
 * follows the rail to a screen titled something else reasonably wonders whether
 * they arrived (CF-20).
 *
 * Which name wins is decision D-09, and the owner has not ruled. Until then the
 * default is the label the codebase already shows most for each route, and it
 * lives in ONE exported constant, NAV_ROUTE_LABELS in lib/semantic-routes.ts.
 * Every assertion here is against that constant, never a hard-coded string, so
 * the ruling is a one-line change there and this spec says what else must move.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_ROUTE_LABELS, getLabel } from '../semantic-routes';
import { primaryNav, operateSections } from '../nav-config';
import { MODE_OPERATE_ITEMS } from '../disclosure-mode';

const WEB_SRC = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');

/** The header title(s) a page passes to WorkspaceShell, read from source. */
function workspaceShellTitles(pageRel: string): string[] {
  return [...read(pageRel).matchAll(/<WorkspaceShell\b[\s\S]*?\btitle="([^"]+)"/g)].map((m) => m[1]);
}

const COCKPIT = '/app/command-center';
const COMMERCE = '/app/commerce';

describe('the D-09 label constant exists and names real routes', () => {
  it('has a non-empty label for the cockpit and for commerce', () => {
    expect(typeof NAV_ROUTE_LABELS?.[COCKPIT]).toBe('string');
    expect(typeof NAV_ROUTE_LABELS?.[COMMERCE]).toBe('string');
    expect(NAV_ROUTE_LABELS[COCKPIT].trim()).not.toBe('');
    expect(NAV_ROUTE_LABELS[COMMERCE].trim()).not.toBe('');
  });

  it('keys are routes that have a page', () => {
    for (const route of Object.keys(NAV_ROUTE_LABELS ?? {})) {
      expect(fs.existsSync(path.join(WEB_SRC, 'app', route, 'page.tsx')), route).toBe(true);
    }
  });
});

describe('/app/command-center: nav, breadcrumb and page title agree', () => {
  it('the rail entry reads the constant', () => {
    const rail = primaryNav.find((i) => i.href === COCKPIT);
    expect(rail, 'no rail entry for the cockpit').toBeDefined();
    expect(rail!.label).toBe(NAV_ROUTE_LABELS[COCKPIT]);
  });

  it('the breadcrumb (semantic route) reads the constant', () => {
    expect(getLabel('command-center')).toBe(NAV_ROUTE_LABELS[COCKPIT]);
  });

  it('the rail and the breadcrumb say the same thing', () => {
    // The plain agreement claim, independent of the constant.
    expect(primaryNav.find((i) => i.href === COCKPIT)?.label).toBe(getLabel('command-center'));
  });

  it('the page header names the screen with the same label', () => {
    const titles = workspaceShellTitles('app/app/command-center/page.tsx');
    expect(titles.length, 'WorkspaceShell title not found — extractor is broken').toBeGreaterThan(0);
    for (const t of titles) expect(t).toContain(NAV_ROUTE_LABELS[COCKPIT]);
  });

  it('neither registry hard-codes the label beside the constant', () => {
    expect(read('lib/nav-config.ts')).toMatch(/id: "cockpit", label: NAV_ROUTE_LABELS\["\/app\/command-center"\]/);
    expect(read('lib/semantic-routes.ts')).toMatch(
      /segment: "command-center", label: NAV_ROUTE_LABELS\["\/app\/command-center"\]/,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The other surfaces that name /app/command-center.
 *
 * The rail rename put the desktop rail in line with the breadcrumb and the
 * header. It also put it out of line with the mobile drawer's cockpit link and
 * the ⌘H shortcut labels, which still say "Cockpit". Before R0-08 the desktop
 * rail and the mobile drawer agreed with each other, so this disagreement is
 * new. Those three files are outside the R0-08 write set, so it is ledgered
 * here instead of going unnoticed. The ledger is shrink-only and cleans itself:
 * once a surface reads the constant, its entry has to go.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Everything inside one <Link …>…</Link> that opens the cockpit (or its stub). */
const NOT_LINK_END = '(?:(?!</Link>)[\\s\\S])*?';
const cockpitLink = (tail: string) =>
  new RegExp(`<Link\\s+href="/app/(?:command-center|keyflow-command)"${NOT_LINK_END}${tail}`);

interface CockpitSurface {
  file: string;
  what: string;
  inWriteSet: boolean;
  /** The source text the surface shows, or undefined if the extractor broke. */
  extract: (src: string) => string | undefined;
}

const COCKPIT_SURFACES: CockpitSurface[] = [
  {
    file: 'components/layout/desktop-sidebar.tsx',
    what: 'logo tooltip',
    inWriteSet: true,
    extract: (s) => s.match(cockpitLink('title=(\\{[^\\n]*\\}|"[^"]*")'))?.[1],
  },
  {
    file: 'components/addon-pack-gate.tsx',
    what: 'add-on gate back link',
    inWriteSet: true,
    extract: (s) => s.match(cockpitLink('<ArrowLeft[^>]*/>\\s*([^<]+?)\\s*</Link>'))?.[1],
  },
  {
    file: 'components/layout/mobile-drawer.tsx',
    what: 'mobile drawer cockpit link',
    inWriteSet: false,
    extract: (s) => s.match(cockpitLink('<span>([^<]+)</span>\\s*</Link>'))?.[1],
  },
  {
    file: 'components/functional/keyboard-shortcuts-help.tsx',
    what: '⌘H in the shortcut help',
    inWriteSet: false,
    extract: (s) => s.match(/keys: \["⌘", "H"\], description: ("[^"]*"|[^}\n]+)/)?.[1],
  },
  {
    file: 'hooks/use-keyboard-shortcuts.ts',
    what: 'kf:go-home shortcut description',
    inWriteSet: false,
    extract: (s) => s.match(/"kf:go-home"\)\),\s*description: ("[^"]*"|[^,\n]+)/)?.[1],
  },
];

/**
 * Surfaces outside the R0-08 write set that still name the cockpit with a
 * label other than NAV_ROUTE_LABELS["/app/command-center"].
 */
const COCKPIT_LABEL_OUTSIDE_WRITE_SET: Record<string, string> = {
  'components/layout/mobile-drawer.tsx':
    '<span>Cockpit</span>, while the desktop rail says the D-09 label (the link also targets the keyflow-command stub)',
  'components/functional/keyboard-shortcuts-help.tsx': '"Go to Cockpit"',
  'hooks/use-keyboard-shortcuts.ts': '"Go to Cockpit"',
};

const agreesWithConstant = (shown: string) =>
  shown.includes('NAV_ROUTE_LABELS["/app/command-center"]') || shown.includes(NAV_ROUTE_LABELS[COCKPIT]);

describe('/app/command-center: the other nav surfaces agree, or are ledgered', () => {
  const shown = () => COCKPIT_SURFACES.map((s) => ({ ...s, text: s.extract(read(s.file)) }));

  it('every surface extractor finds its label — the checks below are not vacuous', () => {
    for (const s of shown()) {
      expect(s.text?.trim(), `${s.what} (${s.file}) not found — extractor is broken`).toBeTruthy();
    }
  });

  it('the surfaces in the R0-08 write set name the cockpit with the constant', () => {
    const off = shown()
      .filter((s) => s.inWriteSet && !agreesWithConstant(s.text ?? ''))
      .map((s) => `${s.what} (${s.file}): ${s.text}`);
    expect(off).toEqual([]);
  });

  it('every surface outside the write set agrees, or is a ledgered disagreement', () => {
    const off = shown()
      .filter((s) => !s.inWriteSet && !agreesWithConstant(s.text ?? ''))
      .filter((s) => !(s.file in COCKPIT_LABEL_OUTSIDE_WRITE_SET))
      .map((s) => `${s.what} (${s.file}): ${s.text}`);
    expect(off, `these name the cockpit as something other than "${NAV_ROUTE_LABELS[COCKPIT]}"`).toEqual([]);
  });

  it('the label ledger only names surfaces that still disagree', () => {
    const surfaces = shown();
    for (const [file, reason] of Object.entries(COCKPIT_LABEL_OUTSIDE_WRITE_SET)) {
      const s = surfaces.find((x) => x.file === file);
      expect(s, `${file} is ledgered but is not a known cockpit surface`).toBeDefined();
      expect(s!.inWriteSet, `${file} is in the write set — fix it, do not ledger it`).toBe(false);
      expect(agreesWithConstant(s!.text ?? ''), `${file} ("${reason}") now agrees — remove its entry`).toBe(false);
    }
  });
});

describe('/app/commerce: nav, breadcrumb and page title agree', () => {
  const navEntry = () => operateSections.flatMap((s) => s.items).find((i) => i.href === COMMERCE);

  it('the Money nav entry carries the constant', () => {
    expect(navEntry(), 'no nav entry for /app/commerce').toBeDefined();
    expect(navEntry()!.label).toBe(NAV_ROUTE_LABELS[COMMERCE]);
  });

  it('the breadcrumb (semantic route) reads the constant', () => {
    expect(getLabel('commerce')).toBe(NAV_ROUTE_LABELS[COMMERCE]);
    expect(read('lib/semantic-routes.ts')).toMatch(
      /segment: "commerce", label: NAV_ROUTE_LABELS\["\/app\/commerce"\]/,
    );
  });

  it('every disclosure mode shows the commerce entry under the same label', () => {
    // use-app-layout filters the Operate nav by an exact-label allowlist, so a
    // D-09 rename of this entry must also rename it in disclosure-mode.ts or the
    // money screen disappears from the default nav.
    for (const mode of ['startup', 'growth', 'enterprise'] as const) {
      expect(MODE_OPERATE_ITEMS[mode], mode).toContain(NAV_ROUTE_LABELS[COMMERCE]);
    }
  });

  it('the page header still has a title to agree with', () => {
    expect(workspaceShellTitles('app/app/commerce/page.tsx').length).toBeGreaterThan(0);
  });

  // BLOCKED (R0-08 deviation): app/app/commerce/page.tsx is outside the R0-08
  // write set and its header says "Revenue" (WorkspaceShell title, plus the
  // KeyflowUnifiedShell help-context pageTitle). Under the D-09 default the
  // header should read NAV_ROUTE_LABELS["/app/commerce"]. Restore as:
  //   for (const t of workspaceShellTitles('app/app/commerce/page.tsx'))
  //     expect(t).toContain(NAV_ROUTE_LABELS[COMMERCE]);
  it.todo(
    'the page header names the screen with the same label — blocked: commerce/page.tsx is outside the R0-08 write set',
  );
});
