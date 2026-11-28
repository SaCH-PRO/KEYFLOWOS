/**
 * WEDGE-HIDE-STORE (P225; owner ruling D-263 'wedge', orchestrator decision option (A) part 1, #273 7207944212): the
 * hidden-module list (packages/shared/src/v1-modules.ts, the one list, D-152) carries a `store` module. A business with
 * store orders or quick sales (both are marketplace_orders rows; a quick sale's number starts QS-, quick-sale.service.ts)
 * is on its legacy list and keeps selling; any other business is not offered selling online at launch.
 *
 * The module census: `store` is listed, counts every marketplace_orders row of the business (the table has no
 * soft-delete column), reads only business_id (an id: v1-module-usage-count V61-01's allowed columns), hides no route
 * here (/app/store also manages the booking page, journey F; the gates land with the entries, part 2 and the follow-on
 * packets) and classifies no KEY tool (the FLOW tool split is unchanged).
 */
import { describe, it, expect } from 'vitest';
import { V1_HIDDEN_MODULES, V1_HIDDEN_MODULE_KEYS, v1HiddenModule } from '../../../../../packages/shared/src/v1-modules';

describe('WEDGE-HIDE-STORE: the hidden-module list carries the store (D-263)', () => {
  it('[WHS-01] RED-BEFORE: `store` is a hidden module key, listed once', () => {
    expect([...V1_HIDDEN_MODULE_KEYS]).toContain('store');
    expect(V1_HIDDEN_MODULES.filter((m) => m.key === 'store')).toHaveLength(1);
  });

  it('[WHS-02] RED-BEFORE: it is deferred to after launch under D-263, counts marketplace_orders by business_id alone, hides no route and classifies no KEY tool', () => {
    const store = v1HiddenModule('store');
    expect(store, 'v1HiddenModule("store")').toBeDefined();
    expect(store!.treatment).toBe('defer-v1plus');
    expect(store!.rulings).toContain('D-263');
    expect(store!.routes).toEqual([]);
    expect(store!.pages ?? []).toEqual([]);
    expect(store!.keyTools).toEqual([]);
    expect(store!.tables).toEqual([
      expect.objectContaining({ table: 'marketplace_orders', businessColumn: 'business_id' }),
    ]);
    const [orders] = store!.tables;
    // Every row counts: store orders and quick sales alike, whatever their status; the table has no soft delete.
    expect(orders.where).toBeUndefined();
    expect(orders.whereColumns ?? []).toEqual([]);
    expect(orders.softDeleteColumn).toBeUndefined();
  });
});
