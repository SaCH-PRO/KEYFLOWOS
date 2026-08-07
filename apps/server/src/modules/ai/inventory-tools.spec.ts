/**
 * Stock: ten models, a full REST surface, and nobody could see it.
 *
 * Until 2026-08-07 inventory had zero tools AND no nav entry AND no reachable
 * screen — three separate failures stacked on the same domain:
 *
 *   models    InventoryStock, StockMovement, Warehouse, StockCount,
 *             GoodsReceipt, DeliveryNote, PurchaseOrder, Shipment,
 *             ShippingZone, FulfillmentRoute
 *   service   ~19 continental-ops methods plus adjust/transfer/summary/
 *             movements/alerts on MarketplaceService
 *   UI        a 2,032-line command centre with reason-coded adjustments,
 *             warehouse transfers, Drive sheet sync and Excel import/export
 *   tools     none
 *   nav       none
 *   reachable no — marketplace/page.tsx redirected ?tab=inventory to
 *             /app/commerce?tab=inventory, and commerce has no inventory tab
 *
 * The screen existed, was finished, and was behind a door that opened onto a
 * wall. That is the "unwired, not underbuilt" thesis in its purest form.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const tools = FLOW_TOOLS.filter((t) => t.name.startsWith('inventory_'));

describe('KEY can see and move stock', () => {
  it('reads cover level, value, risk and history', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const verb of [
      'inventory_list_stock',
      'inventory_summary',
      'inventory_low_stock_alerts',
      'inventory_list_movements',
      'inventory_list_warehouses',
    ]) {
      expect(names.has(verb), `${verb} is missing`).toBe(true);
    }
  });

  it('writes cover the two things that change a count, plus procurement', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const verb of [
      'inventory_adjust_stock',
      'inventory_transfer_stock',
      'inventory_create_purchase_order',
      'inventory_advance_purchase_order',
    ]) {
      expect(names.has(verb), `${verb} is missing`).toBe(true);
    }
  });

  it('every inventory tool has a handler', () => {
    for (const tool of tools) {
      expect(
        orchestrator.includes(`case '${tool.name}':`),
        `${tool.name} is advertised with no case in executeToolAction`,
      ).toBe(true);
    }
  });

  it('every inventory tool points at the screen that was finally given a door', () => {
    for (const tool of tools) {
      expect(tool.manualEquivalentRoute, `${tool.name} points elsewhere`).toBe('/app/inventory');
    }
  });
});

describe('a transfer can name its warehouses', () => {
  it('inventory_list_warehouses exists', () => {
    // Same prerequisite trap as deals_list_stages: transferInventory takes two
    // warehouse IDs and the model has no other way to learn them. Ship the
    // write without the lookup and it invents ids that will never match.
    expect(getToolByName('inventory_list_warehouses')?.family).toBe('read');
  });

  it('and the transfer tool says to call it first', () => {
    expect(getToolByName('inventory_transfer_stock')?.description).toMatch(/inventory_list_warehouses/);
  });

  it('the transfer requires both ends and a quantity', () => {
    const required = getToolByName('inventory_transfer_stock')?.parameters.required ?? [];
    for (const p of ['productId', 'fromWarehouseId', 'toWarehouseId', 'quantity']) {
      expect(required).toContain(p);
    }
  });
});

describe('an adjustment has to say why', () => {
  it('reasonCode is required, not optional', () => {
    // A quantity that changed for no recorded reason is how a count becomes
    // untrustworthy. StockMovement.reasonCode is a nullable column, so nothing
    // at the database level forces this — the tool does.
    expect(getToolByName('inventory_adjust_stock')?.parameters.required).toContain('reasonCode');
  });

  it('a MANUAL adjustment without a note is refused before the server sees it', () => {
    // marketplace.controller.ts:401-402 rejects this with a 400. Catching it in
    // the handler means KEY explains what to do instead of surfacing an error
    // from a layer the user never mentioned.
    const at = orchestrator.indexOf("case 'inventory_adjust_stock':");
    expect(at).toBeGreaterThan(-1);
    const body = orchestrator.slice(at, orchestrator.indexOf('      case ', at + 10));

    expect(body).toMatch(/args\.reasonCode === 'MANUAL'/);
    expect(body).toMatch(/throw new Error/);
  });

  it('the note parameter says it is conditionally required', () => {
    // An optional-looking parameter that is sometimes mandatory is worth
    // spelling out; the model only sees the description.
    expect(getToolByName('inventory_adjust_stock')?.parameters.properties.note?.description).toMatch(
      /REQUIRED when reasonCode is MANUAL/,
    );
  });
});

describe('purchase orders advance forward only', () => {
  it('the status enum is exactly what the controller accepts', () => {
    // marketplace.controller.ts:306-313 types the body as
    // 'SUBMITTED' | 'ACKNOWLEDGED' | 'SHIPPED' | 'RECEIVED'. An enum wider than
    // the domain's is how calendar_create_event failed 100% of its calls.
    expect(getToolByName('inventory_advance_purchase_order')?.parameters.properties.status?.enum).toEqual([
      'SUBMITTED',
      'ACKNOWLEDGED',
      'SHIPPED',
      'RECEIVED',
    ]);
  });

  it('DRAFT is not offered as a destination', () => {
    const statuses = getToolByName('inventory_advance_purchase_order')?.parameters.properties.status?.enum ?? [];
    expect(statuses, 'advancing is forward-only; a PO cannot be un-submitted').not.toContain('DRAFT');
  });
});

describe('the roles that carry stock can reach it', () => {
  const roleEngine = readFileSync(join(__dirname, 'role-engine.service.ts'), 'utf8');
  const roleBlock = (name: string, next: string) =>
    roleEngine.slice(roleEngine.indexOf(`  ${name}: {`), roleEngine.indexOf(`  ${next}: {`));

  it('operations gets the full set — stock is its job', () => {
    expect(roleBlock('operations', 'marketing')).toMatch(/'inventory_\*'/);
  });

  it('sales can see stock but not move it', () => {
    // A rep needs to know whether they can promise delivery. They should not be
    // adjusting counts to make a promise true.
    const sales = roleBlock('sales', 'finance');
    expect(sales).toMatch(/'inventory_list_stock'/);
    expect(sales, 'sales must not get blanket inventory access').not.toMatch(/'inventory_\*'/);
  });

  it('executive sees the capital tied up, nothing more', () => {
    const exec = roleEngine.slice(roleEngine.indexOf('  executive: {'));
    expect(exec).toMatch(/'inventory_summary'/);
    expect(exec).not.toMatch(/'inventory_\*'/);
  });
});
