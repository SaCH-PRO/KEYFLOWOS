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
