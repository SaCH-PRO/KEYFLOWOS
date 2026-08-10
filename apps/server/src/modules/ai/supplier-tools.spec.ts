/**
 * Sourcing: what a product costs to land, and what it earns.
 *
 * SupplierService has twenty-four methods and a controller. It had no tools, so
 * KEY could raise a purchase order through procurement_* but could not say what
 * any product actually costs us or what margin it makes. Those are the two
 * questions that decide whether to stock something.
 *
 * WHAT THIS FILE IS REALLY GUARDING
 *
 * `getDecryptedCredentials` sits on the same service. A tool for it would hand
 * supplier API secrets to a model that writes its inputs and outputs into a
 * chat transcript, and from there into memory rows and prompt context. The
 * strongest assertion here is the one that says no such tool exists — and it is
 * written over the WHOLE registry rather than over a list of names, because the
 * next credential-returning tool will not be called suppliers_get_credentials.
 *
 * The service already strips credentials on both read paths
 * (`{ ...row, credentials: undefined }`), which is why no handler here has to
 * remember to redact. That is asserted too: if the service ever stops
 * stripping, a tool that faithfully returns what it was given starts leaking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BIZ = 'biz_supplier_spec';

const SUPPLIER_TOOLS = [
  'suppliers_list_connections',
  'suppliers_get_connection',
  'suppliers_list_products',
  'suppliers_get_cost_profile',
  'suppliers_get_margins',
  'suppliers_create_product_from_supplier',
] as const;

function makeSupplierStub() {
  return {
    getSupplierConnections: vi.fn(async () => ({ data: [{ id: 'c1' }], total: 1 })),
    getSupplierConnection: vi.fn(async (_b: string, id: string) => ({ id, displayName: 'Acme' })),
    getSupplierProducts: vi.fn(async () => ({ data: [{ id: 'sp1' }], total: 1 })),
    getProductCostProfile: vi.fn(async () => ({ productId: 'p1', landedCost: 12.5 })),
    getMarginSnapshots: vi.fn(async () => [{ margin: 0.4 }]),
    createProductFromSupplier: vi.fn(async () => ({ id: 'p_new', name: 'Widget', price: 30 })),
    // Present on the real service and deliberately unreachable from any tool.
    getDecryptedCredentials: vi.fn(async () => ({ apiKey: 'sk-should-never-surface' })),
  };
}

let suppliers: ReturnType<typeof makeSupplierStub>;
let svc: FlowOrchestratorService;

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

beforeEach(() => {
  suppliers = makeSupplierStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => suppliers },
  }) as FlowOrchestratorService;
});

describe('no tool can reach supplier credentials', () => {
  const registry = readFileSync(join(__dirname, 'flow-tool-registry.ts'), 'utf8');
  const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

  it('no handler anywhere calls getDecryptedCredentials', () => {
    // Over the whole orchestrator, not just the supplier block. The next
    // credential leak will not be in the section named "suppliers".
    expect(
      orchestrator.includes('getDecryptedCredentials'),
      'a tool handler reaches decrypted supplier credentials',
    ).toBe(false);
  });

  it('no tool advertises credentials, secrets or keys in its description', () => {
    const leaky = FLOW_TOOLS.filter((t) =>
      /\b(credential|api key|secret|password|token)s?\b/i.test(t.description) &&
      /\b(return|get|show|list|fetch|read|reveal)\b/i.test(t.description) &&
      !/never (be )?returned|not returned|never returns/i.test(t.description),
    );
    expect(leaky.map((t) => t.name), 'these advertise handing out secrets').toEqual([]);
  });

  it('and the two connection reads say so in their descriptions', () => {
    for (const name of ['suppliers_list_connections', 'suppliers_get_connection']) {
      expect(getToolByName(name)!.description).toMatch(/credentials are never returned/i);
    }
  });

  it('the service still strips credentials on both read paths', () => {
    // The tools rely on this rather than redacting themselves. If it ever stops
    // being true, a handler that faithfully returns what it was given begins
    // leaking, and nothing in the handler would change.
    const service = readFileSync(
      join(__dirname, '..', 'supplier', 'supplier.service.ts'),
      'utf8',
    );
    const list = service.slice(service.indexOf('async getSupplierConnections'), service.indexOf('async updateSupplierConnection'));
    expect(list, 'getSupplierConnection(s) no longer strips credentials').toMatch(
      /credentials: undefined/,
    );
    expect((list.match(/credentials: undefined/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('registry has no tool for establishing a connection, which would take credentials', () => {
    expect(registry.includes("name: 'suppliers_create_connection'")).toBe(false);
    expect(registry.includes("name: 'suppliers_update_connection'")).toBe(false);
  });
});

describe('the six tools exist and are shaped honestly', () => {
  it('all six are registered', () => {
    for (const name of SUPPLIER_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('the reads are reads and the one write is a write', () => {
    const reads = SUPPLIER_TOOLS.filter((n) => getToolByName(n)!.family === 'read');
    expect(reads.length).toBe(5);
    expect(getToolByName('suppliers_create_product_from_supplier')!.family).toBe('crud');
  });

  it('has no tool for importAndNormalizeProduct, which takes a function', () => {
    // Its fourth parameter is a normalizer callback. KEY cannot supply a
    // function, so a tool for it could never actually be called — the
    // schedule_action rule: a tool that cannot keep its promise is not
    // advertised.
    expect(getToolByName('suppliers_import_product')).toBeUndefined();
    expect(getToolByName('suppliers_import_and_normalize_product')).toBeUndefined();
  });

  it('has no delete tools', () => {
    expect(FLOW_TOOLS.filter((t) => /^suppliers_.*delete/.test(t.name))).toEqual([]);
  });
});

describe('handlers pass the caller\'s business through and report what came back', () => {
  it('list connections is scoped and paged', async () => {
    await run('suppliers_list_connections', { page: 2, pageSize: 10 });
    expect(suppliers.getSupplierConnections).toHaveBeenCalledWith(BIZ, 2, 10);
  });

  it('list connections defaults its paging rather than passing undefined', async () => {
    await run('suppliers_list_connections', {});
    expect(suppliers.getSupplierConnections).toHaveBeenCalledWith(BIZ, 1, 50);
  });

  it('get connection is scoped', async () => {
    const out = (await run('suppliers_get_connection', { connectionId: 'c9' })) as { id: string };
    expect(suppliers.getSupplierConnection).toHaveBeenCalledWith(BIZ, 'c9');
    expect(out.id).toBe('c9');
  });

  it('list products passes the availability filter only when given', async () => {
    await run('suppliers_list_products', { connectionId: 'c1' });
    expect(suppliers.getSupplierProducts).toHaveBeenCalledWith(BIZ, 'c1', 1, 50, undefined);

    await run('suppliers_list_products', { connectionId: 'c1', availability: 'in_stock' });
    expect(suppliers.getSupplierProducts).toHaveBeenLastCalledWith(BIZ, 'c1', 1, 50, {
      availability: 'in_stock',
    });
  });

  it('margins come back wrapped with the product they belong to', async () => {
    const out = (await run('suppliers_get_margins', { productId: 'p1' })) as {
      productId: string;
      snapshots: unknown[];
    };
    expect(suppliers.getMarginSnapshots).toHaveBeenCalledWith(BIZ, 'p1', 20);
    expect(out.productId).toBe('p1');
    expect(out.snapshots).toHaveLength(1);
  });

  it('"no cost profile recorded" is not reported as a cost of zero', async () => {
    // getProductCostProfile uses findUnique and returns null when nothing has
    // been recorded. A bare null gives the model nothing it can say to a
    // person, and "we have no cost profile" is a different answer from "it
    // costs nothing".
    suppliers.getProductCostProfile.mockResolvedValueOnce(null as never);
    const out = (await run('suppliers_get_cost_profile', { productId: 'p1' })) as {
      productId: string;
      costProfile: unknown;
    };
    expect(out.productId).toBe('p1');
    expect(out.costProfile).toBeNull();
  });

  it('a real cost profile is returned as the service gave it', async () => {
    const out = (await run('suppliers_get_cost_profile', { productId: 'p1' })) as {
      landedCost: number;
    };
    expect(out.landedCost).toBe(12.5);
  });
});

describe('creating a product from a supplier item', () => {
  it('sends no overrides object when none were given', async () => {
    // An empty {} is not the same as undefined: the normalisation service
    // treats an override object as "the caller has opinions" and an absent one
    // as "use the supplier's values".
    await run('suppliers_create_product_from_supplier', { supplierProductId: 'sp1' });
    expect(suppliers.createProductFromSupplier).toHaveBeenCalledWith(BIZ, 'sp1', undefined);
  });

  it('sends only the overrides that were actually supplied', async () => {
    await run('suppliers_create_product_from_supplier', {
      supplierProductId: 'sp1',
      price: 49.99,
    });
    expect(suppliers.createProductFromSupplier).toHaveBeenCalledWith(BIZ, 'sp1', { price: 49.99 });
  });

  it('does not leak supplierProductId or stray keys into the overrides', async () => {
    // The bug a spread would have caused: `{ ...args }` forwards
    // supplierProductId and anything else the model invented into an object the
    // normalisation service writes onto the product.
    await run('suppliers_create_product_from_supplier', {
      supplierProductId: 'sp1',
      name: 'Widget',
      somethingInvented: 'nonsense',
    });
    const [, , overrides] = suppliers.createProductFromSupplier.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(overrides)).toEqual(['name']);
  });

  it('reports the product the service created', async () => {
    const out = (await run('suppliers_create_product_from_supplier', {
      supplierProductId: 'sp1',
      name: 'Ignored By Stub',
    })) as { id: string; name: string };
    // The stub returns 'Widget' regardless of the requested name. A handler
    // answering from `args` would say 'Ignored By Stub'.
    expect(out.id).toBe('p_new');
    expect(out.name).toBe('Widget');
  });
});
