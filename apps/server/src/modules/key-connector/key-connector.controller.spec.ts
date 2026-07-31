/**
 * KeyConnectorController — guard wiring.
 *
 * This controller was unguarded, and every route resolved its tenant via
 * `extractBusinessId(req)` reading `req.businessId` — a property nothing in the
 * codebase ever sets. So every route threw a raw Error and returned 500.
 *
 * Adding guards alone would NOT have fixed it: BusinessGuard resolves businessId
 * from params/body/query, and no route supplied it in any of those places, so
 * every request would have been rejected with 403 instead. The routes had to
 * take `businessId` where the guard can actually see it.
 *
 * These tests pin all three halves of that so the controller cannot regress into
 * either failure mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyConnectorController } from './key-connector.controller';

const SOURCE = readFileSync(join(__dirname, 'key-connector.controller.ts'), 'utf8');

describe('KeyConnectorController — guard wiring', () => {
  it('is guarded by AuthGuard and BusinessGuard', () => {
    expect(SOURCE).toMatch(/@UseGuards\(\s*AuthGuard\s*,\s*BusinessGuard\s*\)/);
  });

  it('never reads req.businessId — nothing in the codebase sets it', () => {
    expect(SOURCE).not.toMatch(/req\.businessId/);
    expect(SOURCE).not.toMatch(/\['businessId'\]/);
  });

  it('no longer defines the extract helpers that threw raw Errors', () => {
    expect(SOURCE).not.toContain('extractBusinessId');
    expect(SOURCE).not.toContain('extractUserId');
  });

  it('throws no raw Error — those surface as 500 rather than 401/403', () => {
    expect(SOURCE).not.toMatch(/throw new Error\(/);
  });

  it('every route takes businessId where BusinessGuard can resolve it', () => {
    // BusinessGuard reads req.params / req.body / req.query. A route that takes
    // businessId nowhere would be rejected by the guard on every request.
    const routes = SOURCE.match(/@(Get|Post|Delete|Patch|Put)\(/g) ?? [];
    const queryParams = SOURCE.match(/@Query\('businessId'\)/g) ?? [];
    expect(routes.length).toBeGreaterThan(0);
    expect(queryParams.length).toBe(routes.length);
  });

  it('exposes the expected route surface', () => {
    const controller = KeyConnectorController.prototype;
    for (const method of [
      'getProviders',
      'getProviderDetail',
      'connectProvider',
      'disconnectProvider',
    ]) {
      expect(typeof (controller as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
