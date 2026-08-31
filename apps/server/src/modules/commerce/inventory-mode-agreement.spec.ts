/**
 * What a NULL `inventoryMode` means — one rule, four callers.
 *
 * `Product.inventoryMode` is `String?` with no default, and nothing on the
 * create path sets it. Four services resolved that NULL independently and did
 * not agree:
 *
 *   store-order.service          NULL -> tracked   refused the checkout
 *   catalog.service              NULL -> tracked   hid it from the storefront
 *   fulfillment-routing.service  NULL -> tracked   routed it as stocked
 *   inventory-risk.service       `mode === 'tracked' || stocks.length > 0`
 *
 * A merchant who added a product and never touched inventory got one that did
 * not appear in their shop and could not be bought if it did, while the risk
 * service reported it as untracked and fine. Every surface was internally
 * consistent; they disagreed with each other. That is why nothing looked
 * broken from inside any one of them, and it is why the fix is a shared
 * resolver rather than three more edits.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInventoryMode, isStockTracked } from '../../core/inventory/inventory-mode';

const SRC = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('the rule itself', () => {
  it('an explicit choice always wins, in either direction', () => {
    expect(resolveInventoryMode('tracked', false)).toBe('tracked');
    expect(resolveInventoryMode('untracked', true)).toBe('untracked');
    expect(resolveInventoryMode('virtual', true)).toBe('virtual');
  });

  it('unconfigured with no stock is untracked — the case that was broken', () => {
    expect(resolveInventoryMode(null, false)).toBe('untracked');
    expect(isStockTracked(null, false)).toBe(false);
  });

  it('unconfigured but with stock kept IS tracked', () => {
    // Keeping stock is the merchant tracking it in practice, which is the
    // condition inventory-risk already used.
    expect(resolveInventoryMode(null, true)).toBe('tracked');
    expect(isStockTracked(null, true)).toBe(true);
  });

  it('undefined behaves like null', () => {
    expect(resolveInventoryMode(undefined, false)).toBe('untracked');
  });
});

describe('every caller uses it, so they cannot drift apart again', () => {
  const callers: Array<[string, string]> = [
    ['store-order', '../site/store-order.service.ts'],
    ['catalog', '../catalog/catalog.service.ts'],
    ['fulfillment-routing', '../marketplace/fulfillment-routing.service.ts'],
  ];

  it('reads the callers — this gate is not vacuous', () => {
    for (const [name, rel] of callers) {
      expect(SRC(rel).length, `${name} not read`).toBeGreaterThan(500);
    }
  });

  for (const [name, rel] of callers) {
    it(`${name} resolves through the shared rule`, () => {
      expect(SRC(rel)).toContain('resolveInventoryMode(');
    });

    it(`${name} no longer defaults NULL straight to tracked`, () => {
      expect(SRC(rel), 'this is the exact defect').not.toContain("inventoryMode ?? 'tracked'");
    });
  }

  it('tracked products are still protected from overselling', () => {
    // The protection must survive the fix — it was never the problem.
    const store = SRC('../site/store-order.service.ts');
    expect(store).toContain('no active warehouse configured for tracked products');
    expect(store).toContain('insufficient stock for product');
    expect(store).toContain('allow_backorder');
  });
});
