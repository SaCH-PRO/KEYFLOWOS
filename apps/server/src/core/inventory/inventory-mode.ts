/**
 * What a NULL `inventoryMode` means — decided once, for everyone.
 *
 * `Product.inventoryMode` is `String?` with no default, and nothing on the
 * create path sets it, so it is NULL for every product whose owner never
 * opened inventory settings. Four places resolved that NULL independently and
 * did not agree:
 *
 *   store-order.service         NULL -> tracked   refused the checkout
 *   catalog.service             NULL -> tracked   hid the product from the shop
 *   fulfillment-routing.service NULL -> tracked   routed it as stocked
 *   inventory-risk.service      `mode === 'tracked' || stocks.length > 0`
 *
 * So a merchant who added a product and never touched inventory got a product
 * that did not appear in their storefront and could not be bought if it did,
 * while the risk service reported it as untracked and therefore fine. Every
 * surface was self-consistent and they disagreed with each other, which is why
 * nothing looked broken from inside any one of them.
 *
 * The rule is the risk service's, because it matches what the merchant
 * actually did rather than what the schema failed to say:
 *
 *   an explicit choice always wins, in either direction
 *   otherwise, keeping stock for a product means it is tracked
 *   otherwise, it is untracked
 *
 * Someone who never configured inventory is not opted into an inventory
 * invariant, and enforcing one against them protects a number nobody is
 * maintaining. Products that ARE tracked are unaffected: they still cannot
 * oversell, still need a warehouse and a stock row, and still fail a checkout
 * that would breach either.
 *
 * If this rule ever changes it must change here, not in one caller.
 */
export type InventoryMode = 'tracked' | 'untracked' | 'virtual' | (string & {});

export function resolveInventoryMode(
  inventoryMode: string | null | undefined,
  hasStock: boolean,
): InventoryMode {
  if (inventoryMode) return inventoryMode;
  return hasStock ? 'tracked' : 'untracked';
}

/** True when stock invariants apply — the only question most callers have. */
export function isStockTracked(
  inventoryMode: string | null | undefined,
  hasStock: boolean,
): boolean {
  return resolveInventoryMode(inventoryMode, hasStock) === 'tracked';
}
