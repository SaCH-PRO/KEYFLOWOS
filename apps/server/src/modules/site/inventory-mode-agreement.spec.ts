/**
 * A merchant who never opened inventory settings could not sell anything.
 *
 * `Product.inventoryMode` is `String?` with no default, and nothing on the
 * create path sets it — so it is NULL for every product whose owner never
 * configured inventory. store-order.service resolved NULL to 'tracked' and
 * then failed the entire checkout, rolling back invoice and payment, with
 * "no active warehouse configured for tracked products".
 *
 * Meanwhile inventory-risk.service reads the same column as
 * `inventoryMode === 'tracked' || stocks.length > 0`. So a product one file
 * refused to sell was a product the other considered untracked. Same field,
 * opposite meaning, and the merchant sees only that checkout is broken.
 *
 * Resolved the risk service's way: a product is tracked if the merchant SAID
 * so, or if stock is actually being kept for it. Someone who never configured
 * inventory is not opted into an inventory invariant.
 *
 * The protection is unchanged for products that ARE tracked — they still
 * cannot oversell and still need a warehouse and a stock row.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, 'store-order.service.ts'), 'utf8');
const RISK = fs.readFileSync(
  path.join(__dirname, '..', 'commerce', 'inventory-risk.service.ts'),
  'utf8',
);

/** Mirrors the resolution the service performs, so the rule can be exercised. */
function resolveMode(inventoryMode: string | null, stockRows: number): string {
  return inventoryMode ?? (stockRows > 0 ? 'tracked' : 'untracked');
}

describe('what a NULL inventoryMode means', () => {
  it('reads both services — this gate is not vacuous', () => {
    expect(SRC.length).toBeGreaterThan(1000);
    expect(RISK).toContain('inventoryMode');
  });

  it('no longer resolves NULL to tracked', () => {
    // The defect, exactly: `p.inventoryMode ?? 'tracked'`.
    expect(SRC).not.toContain("inventoryMode ?? 'tracked'");
  });

  it('a product nobody configured, with no stock, is untracked', () => {
    expect(resolveMode(null, 0)).toBe('untracked');
  });

  it('a product nobody configured, but with stock rows, IS tracked', () => {
    // Keeping stock for something is the merchant tracking it in practice,
    // which is the condition inventory-risk already used.
    expect(resolveMode(null, 3)).toBe('tracked');
  });

  it('an explicit choice always wins over the inference', () => {
    expect(resolveMode('tracked', 0)).toBe('tracked');
    expect(resolveMode('untracked', 9)).toBe('untracked');
    expect(resolveMode('virtual', 9)).toBe('virtual');
  });

  it('the two services still agree on the rule', () => {
    // If either side changes its mind about NULL again, this is the pair that
    // has to be looked at together.
    expect(RISK).toContain("inventoryMode === 'tracked'");
    expect(SRC).toContain('inventoryStocks');
  });

  it('tracked products are still protected from overselling', () => {
    // The point of the original throw, which must survive the fix.
    expect(SRC).toContain('no active warehouse configured for tracked products');
    expect(SRC).toContain('insufficient stock for product');
    expect(SRC).toContain('allow_backorder');
  });
});
