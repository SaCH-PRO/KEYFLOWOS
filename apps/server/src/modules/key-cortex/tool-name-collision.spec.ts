/**
 * Two different tools shared one name, and which safety class applied was
 * decided by module initialisation order.
 *
 * `cortex.query_database` was registered twice:
 *
 *   key-cortex-actions.service.ts:130      tier 4, requiresApproval: true
 *                                          "Run a raw database query"
 *   key-cortex-safe-database.service.ts    tier 2, requiresApproval: false
 *                                          read-only, allow-listed, business-
 *                                          scoped, capped at 100 rows
 *
 * Both are legitimate — they were never the same tool. But `register()`
 * overwrote on collision with only a warning, so the handler that ran and the
 * tier that gated it depended on which module initialised last, and nothing
 * made that order deterministic. A tier-4 raw query could be executing under a
 * tier-2 gate, or the safe query could be demanding approval it does not need.
 *
 * They are named apart now. This guards the class rather than the instance: on
 * a tier disagreement the registry keeps the HIGHER tier, so an accidental
 * collision can only ever make KEY more cautious.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexSafeDatabaseService } from './key-cortex-safe-database.service';

function makeRegistry() {
  const errors: string[] = [];
  return Object.assign(Object.create(KeyCortexToolRegistryService.prototype), {
    tools: new Map(),
    logger: { warn: vi.fn(), error: vi.fn((m: string) => errors.push(m)), log: vi.fn() },
    errors,
  });
}

function tool(name: string, riskTier: number, module: string, requiresApproval = false) {
  return {
    name,
    module,
    description: 'x',
    parameters: { type: 'object' as const, properties: {}, required: [] },
    riskTier,
    requiresApproval,
    handler: vi.fn(),
  };
}

describe('the two query tools no longer collide', () => {
  it('the safe read-only query has its own name', () => {
    const svc = Object.create(KeyCortexSafeDatabaseService.prototype);
    const def = svc.getQueryToolDefinition();

    expect(def.name).toBe('cortex.query_business_data');
  });

  it('and it is still the low-risk one', () => {
    // Read-only, allow-listed, business-scoped and row-capped. Tier 2 is
    // correct FOR THIS TOOL — the problem was only ever that a raw tier-4 query
    // wore the same name.
    const svc = Object.create(KeyCortexSafeDatabaseService.prototype);

    expect(svc.getQueryToolDefinition().riskTier).toBe(2);
  });

  it('leaves the dangerous name attached to the dangerous tool', () => {
    // If one of the two had to keep `cortex.query_database`, it should be the
    // raw one. A name that sounds unrestricted resolving to a restricted tool
    // is the wrong way round for anyone reading a log.
    const svc = Object.create(KeyCortexSafeDatabaseService.prototype);

    expect(svc.getQueryToolDefinition().name).not.toBe('cortex.query_database');
  });
});

describe('a collision cannot silently lower a safety class', () => {
  it('keeps the higher tier when two registrations disagree', () => {
    const registry = makeRegistry();

    registry.register(tool('cortex.thing', 4, 'actions', true));
    registry.register(tool('cortex.thing', 2, 'safe-db', false));

    expect(registry.getTool('cortex.thing').riskTier).toBe(4);
  });

  it('holds regardless of which order they register in', () => {
    // The whole defect was order-dependence. Both orders must land the same.
    const first = makeRegistry();
    first.register(tool('cortex.thing', 2, 'safe-db'));
    first.register(tool('cortex.thing', 4, 'actions'));

    const second = makeRegistry();
    second.register(tool('cortex.thing', 4, 'actions'));
    second.register(tool('cortex.thing', 2, 'safe-db'));

    expect(first.getTool('cortex.thing').riskTier).toBe(4);
    expect(second.getTool('cortex.thing').riskTier).toBe(4);
  });

  it('keeps requiresApproval if either registration demanded it', () => {
    const registry = makeRegistry();

    registry.register(tool('cortex.thing', 4, 'actions', true));
    registry.register(tool('cortex.thing', 2, 'safe-db', false));

    expect(registry.getTool('cortex.thing').requiresApproval).toBe(true);
  });

  it('logs an error naming both modules, so the collision is findable', () => {
    // Silently taking the safer option would hide a real bug. Something has to
    // say which two things collided.
    const registry = makeRegistry();

    registry.register(tool('cortex.thing', 4, 'actions'));
    registry.register(tool('cortex.thing', 2, 'safe-db'));

    expect(registry.errors.join(' ')).toMatch(/actions/);
    expect(registry.errors.join(' ')).toMatch(/safe-db/);
  });

  it('still uses the newer handler, so a genuine re-registration works', () => {
    // Organ adapters legitimately re-register on reload. Keeping the higher
    // tier must not mean keeping a stale implementation.
    const registry = makeRegistry();
    const replacement = tool('cortex.thing', 2, 'safe-db');

    registry.register(tool('cortex.thing', 4, 'actions'));
    registry.register(replacement);

    expect(registry.getTool('cortex.thing').handler).toBe(replacement.handler);
  });

  it('does not interfere when the tiers agree', () => {
    const registry = makeRegistry();
    const replacement = tool('cortex.thing', 2, 'safe-db');

    registry.register(tool('cortex.thing', 2, 'actions'));
    registry.register(replacement);

    expect(registry.getTool('cortex.thing')).toBe(replacement);
    expect(registry.errors).toEqual([]);
  });
});
