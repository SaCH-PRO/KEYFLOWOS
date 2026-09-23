import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { IdentityService } from '../../modules/identity/identity.service';
import {
  CANONICAL_MODULES,
  DEFAULT_APPROVAL_TIERS,
  ROLE_DEFAULT_SCOPES,
  defaultScopesForRole,
} from './module-vocabulary';

/**
 * The gate that would have caught C1.
 *
 * Before KF-EXEC-AUTH-001 two tables claimed to be the module vocabulary and neither
 * knew about the other. `IdentityService` wrote 11 keys, `ModuleScopeGuard` enforced
 * 13, and the routes required 14. Nothing compared them, so the divergence sat in main
 * denying invited members on 72 routes with no test failing anywhere.
 *
 * These are equivalence and coverage assertions, not examples: they fail if a writer,
 * an enforcer and a route ever disagree again, including for a key nobody has thought
 * of yet.
 */
const SERVER_SRC = path.resolve(__dirname, '../..');

/** Every module key the routes actually demand, read from the source, not a list. */
function requiredModuleKeys(): Set<string> {
  const out = execSync(
    `grep -rho "@RequireModuleScope('[a-zA-Z_]*'" ${SERVER_SRC} --include=*.ts || true`,
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const keys = new Set<string>();
  for (const line of out.split('\n')) {
    const m = line.match(/@RequireModuleScope\('([a-zA-Z_]*)'/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe('canonical module vocabulary', () => {
  it('is the single table the identity writer also uses', () => {
    // Not "they happen to have the same contents" — the same object.
    expect(IdentityService.PERMISSION_MODULES).toBe(CANONICAL_MODULES);
    expect(IdentityService.DEFAULT_SCOPES).toBe(ROLE_DEFAULT_SCOPES);
    expect(IdentityService.DEFAULT_APPROVAL_TIERS).toBe(DEFAULT_APPROVAL_TIERS);
  });

  it('covers every module key any route actually requires', () => {
    const required = requiredModuleKeys();
    expect(required.size).toBeGreaterThan(5); // the grep found something at all

    const unknown = [...required].filter((k) => !(CANONICAL_MODULES as readonly string[]).includes(k));
    // `connect` was exactly this: demanded by 7 integration-hub routes and present in
    // no scope table, so every principal but SUPER_ADMIN was refused, permanently.
    expect(unknown).toEqual([]);
  });

  it('gives OWNER and ADMIN the operations and analytics defaults the guard already declared', () => {
    // The C1 outage: these two keys were absent from the writer's table, so every
    // invited member was written a map without them and the guard read 'none'.
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(defaultScopesForRole(role).operations).toBe('admin');
      expect(defaultScopesForRole(role).analytics).toBe('admin');
    }
    expect(defaultScopesForRole('STAFF').operations).toBe('read');
    expect(defaultScopesForRole('STAFF').analytics).toBe('read');
  });

  it('preserves the pre-existing role defaults for the 13 keys the guard already had', () => {
    // Convergence must not have quietly re-written role policy. These are the values
    // ModuleScopeGuard shipped before this packet, asserted literally.
    const owner = defaultScopesForRole('OWNER');
    const admin = defaultScopesForRole('ADMIN');
    const staff = defaultScopesForRole('STAFF');

    const legacy13 = [
      'crm', 'revenue', 'bookings', 'projects', 'content', 'expenses',
      'automations', 'storefront', 'settings', 'ai', 'team', 'analytics', 'operations',
    ] as const;

    for (const m of legacy13) {
      expect(owner[m]).toBe('admin');
      expect(admin[m]).toBe(m === 'team' ? 'write' : 'admin');
      expect(staff[m]).toBe(['settings', 'team', 'ai'].includes(m) ? 'none' : 'read');
    }
  });

  it('denies connect by role default for every role', () => {
    // CG-REVIEW: connect is a canonical key with default NONE, reachable only through
    // an explicit validated grant. Never aliased to settings or operations.
    for (const role of ['OWNER', 'ADMIN', 'STAFF'] as const) {
      expect(defaultScopesForRole(role).connect).toBe('none');
    }
  });

  it('falls back to STAFF for an unrecognised role, as both tables always did', () => {
    // Membership.role is a free-text String column; this is not hypothetical.
    expect(defaultScopesForRole('CONTRACTOR')).toBe(ROLE_DEFAULT_SCOPES.STAFF);
    expect(defaultScopesForRole('')).toBe(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it('gives every role a level for every canonical key', () => {
    // A key present in the vocabulary but missing from a role default would reproduce
    // C1 exactly: `scopes[module] || 'none'` silently denies.
    for (const role of ['OWNER', 'ADMIN', 'STAFF'] as const) {
      for (const module of CANONICAL_MODULES) {
        expect(defaultScopesForRole(role)[module]).toBeDefined();
      }
    }
  });
});
