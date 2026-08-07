/**
 * A door that opened onto a wall.
 *
 * marketplace/page.tsx held, inside a useEffect:
 *
 *   if (params.get("tab") === "inventory" || activeTab === "inventory") {
 *     window.location.replace("/app/commerce?tab=inventory");
 *   }
 *
 * A migration to Commerce that was started and never finished. /app/commerce
 * has tabs snapshot | invoices | quotes | products | recurring — no inventory —
 * so the redirect landed on a page that ignored the parameter and showed the
 * snapshot. Because the condition also matched `activeTab === "inventory"`,
 * clicking the Inventory tab inside Marketplace bounced you out of it.
 *
 * The 2,032-line InventoryCommandCenter was mounted at marketplace/page.tsx:488
 * and could never render. CommerceInventoryTab, 262 lines written for the
 * destination, was imported by nothing.
 *
 * This is the third redirect defect in this codebase's history and each had a
 * different shape: the settings prefix rule sent 17 finished screens to a URL
 * with no page; three settings redirects pointed at contentless ModuleShells;
 * this one pointed at a real page that silently dropped the only parameter that
 * mattered. Existence was the wrong test twice. "Renders the thing you asked
 * for" is the test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP = path.join(WEB_SRC, 'app', 'app');

const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');

describe('inventory has a door of its own', () => {
  it('/app/inventory renders a page', () => {
    expect(fs.existsSync(path.join(APP, 'inventory', 'page.tsx'))).toBe(true);
  });

  it('and that page mounts the command centre rather than reimplementing it', () => {
    // The component is finished and 2,032 lines. The failure was reach, not
    // capability, so the fix is a container — not a second inventory screen.
    const page = read(APP, 'inventory', 'page.tsx');
    expect(page).toMatch(/InventoryCommandCenter/);
  });

  it('and it can write', () => {
    const page = read(APP, 'inventory', 'page.tsx');
    expect(page).toMatch(/apiPost|apiPatch|apiDelete/);
  });

  it('it is in the nav, which it never was', () => {
    const nav = read(WEB_SRC, 'lib', 'nav-config.ts');
    expect(nav).toMatch(/label: "Inventory", href: "\/app\/inventory"/);
  });

  it('and the disclosure allowlists know the label, or it is hidden again', () => {
    // The failure mode this repeats: a nav label absent from MODE_OPERATE_ITEMS
    // is filtered out silently, and `.filter(s => s.items.length > 0)` then
    // drops the whole section. That is how the default nav once showed three
    // items.
    const modes = read(WEB_SRC, 'lib', 'disclosure-mode.ts');
    const growth = modes.slice(modes.indexOf('growth: ['), modes.indexOf('enterprise: ['));
    const enterprise = modes.slice(modes.indexOf('enterprise: ['));

    expect(growth).toMatch(/"Inventory"/);
    expect(enterprise).toMatch(/"Inventory"/);
  });
});

describe('the abandoned redirect points somewhere real', () => {
  const marketplace = read(APP, 'marketplace', 'page.tsx');

  it('no longer sends inventory to a commerce tab that does not exist', () => {
    expect(
      marketplace,
      'inventory is being redirected back into /app/commerce, which has no inventory tab',
    ).not.toMatch(/replace\("\/app\/commerce\?tab=inventory"\)/);
  });

  it('sends it to the inventory page instead', () => {
    expect(marketplace).toMatch(/replace\("\/app\/inventory"\)/);
  });

  it('and the target of that redirect actually renders', () => {
    // The assertion the earlier redirect defects all needed: follow the string
    // and confirm something is there.
    const target = marketplace.match(/window\.location\.replace\("(\/app\/[^"]+)"\)/)?.[1];
    expect(target, 'no redirect found to check').toBeTruthy();

    const segments = (target ?? '').replace('/app/', '').split('?')[0].split('/');
    expect(fs.existsSync(path.join(APP, ...segments, 'page.tsx'))).toBe(true);
  });
});

describe('KEY files adjustments a human could have filed', () => {
  it('the tool offers exactly the reasons the form offers', () => {
    // Two lists of strings in two apps that must agree, which is the single
    // most repeated defect in this codebase — nav labels vs mode allowlists,
    // compensation keys vs tool names, tool enums vs domain enums, a badge
    // route vs the config's. Each drifted silently and removed a feature.
    //
    // Here the cost of drift is subtler: KEY files a reason code no human could
    // have chosen, and the movement history stops being a list of things
    // people did.
    const ui = read(APP, 'marketplace', 'components', 'inventory-command-center.tsx');
    const block = ui.slice(ui.indexOf('const REASON_CODES = ['));
    const uiCodes = [...block.slice(0, 600).matchAll(/value: "([A-Z_]+)"/g)].map((m) => m[1]);

    const registry = fs.readFileSync(
      path.join(WEB_SRC, '..', '..', 'server', 'src', 'modules', 'ai', 'flow-tool-registry.ts'),
      'utf8',
    );
    const at = registry.indexOf("name: 'inventory_adjust_stock'");
    expect(at, 'inventory_adjust_stock is gone').toBeGreaterThan(-1);
    const reasonBlock = registry.slice(registry.indexOf('reasonCode:', at), registry.indexOf('note:', at));
    const toolCodes = [...reasonBlock.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

    expect(uiCodes.length, 'no reason codes found in the UI').toBeGreaterThan(0);
    expect([...toolCodes].sort(), 'the tool and the form disagree about valid reasons').toEqual(
      [...uiCodes].sort(),
    );
  });
});
