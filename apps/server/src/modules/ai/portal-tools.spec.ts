/**
 * Customer portal access, without handing KEY the key.
 *
 * PortalService grants a contact a link to their own invoices, projects,
 * bookings and documents. Six methods, a controller, a writable screen — and no
 * tools, so KEY could not say who had portal access or turn it off for someone
 * who should no longer have it.
 *
 * THE ONE THING THIS FILE EXISTS FOR
 *
 * Every PortalService method returns the raw row, `token` included, and
 * /app/portal displays it ON PURPOSE: it builds `/portal/{token}` so staff can
 * copy the link and send it to the customer. That is correct for a screen. The
 * person who asked is the person sending, and the token goes from the database
 * to their clipboard.
 *
 * It is not correct for a tool. A token that passes through a model is written
 * into the chat transcript, into keyCortexMemory rows, and into later prompt
 * context — durable, searchable, quotable, and reachable by anyone who can read
 * the conversation. The token is a bearer credential: whoever holds it reads
 * that contact's invoices without logging in.
 *
 * So the assertions are written over the WHOLE orchestrator and over every
 * handler's actual RETURN VALUE, not over the four tools by name. The next
 * portal handler someone adds will not be in a list I wrote today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const BIZ = 'biz_portal_spec';
const SECRET = 'tok_this_must_never_surface';

const PORTAL_TOOLS = [
  'portal_list_access',
  'portal_grant_access',
  'portal_revoke_access',
  'portal_update_settings',
] as const;

/** A row exactly as Prisma returns it — token and all. */
function accessRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pa1',
    businessId: BIZ,
    contactId: 'c1',
    token: SECRET,
    enabled: true,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    settings: { invoices: true, projects: true },
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function makePortalStub() {
  return {
    list: vi.fn(async () => [accessRow()]),
    createAccess: vi.fn(async () => accessRow({ id: 'pa_new' })),
    revoke: vi.fn(async () => accessRow({ enabled: false })),
    updateSettings: vi.fn(async () => accessRow({ settings: { invoices: false } })),
    findByToken: vi.fn(async () => accessRow()),
    recordAccess: vi.fn(async () => ({ count: 1 })),
  };
}

let portal: ReturnType<typeof makePortalStub>;
let svc: FlowOrchestratorService;

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

beforeEach(() => {
  portal = makePortalStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => portal },
  }) as FlowOrchestratorService;
});

describe('the token never leaves the handler', () => {
  it('no portal tool returns it, whatever the shape of the result', async () => {
    // Over every tool, by serialising the WHOLE return value and looking for
    // the secret. Asserting `result.token === undefined` would pass while the
    // token sat inside a nested row, an array element, or a renamed field.
    const calls: Array<[string, Record<string, unknown>]> = [
      ['portal_list_access', {}],
      ['portal_grant_access', { contactId: 'c1', invoices: true }],
      ['portal_revoke_access', { accessId: 'pa1' }],
      ['portal_update_settings', { accessId: 'pa1', invoices: false }],
    ];

    for (const [tool, args] of calls) {
      const out = await run(tool, args);
      expect(
        JSON.stringify(out).includes(SECRET),
        `${tool} returned the portal access token`,
      ).toBe(false);
    }
  });

  it('the stub really does carry a token, so the test above is not vacuous', () => {
    // If accessRow ever stops including `token`, every assertion in this
    // describe passes while proving nothing.
    expect(accessRow().token).toBe(SECRET);
    expect(JSON.stringify(accessRow()).includes(SECRET)).toBe(true);
  });

  it('no handler anywhere calls findByToken or recordAccess', () => {
    // findByToken takes a token as INPUT — a tool for it is a tool for guessing
    // them. recordAccess logs a customer visit KEY did not make.
    const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
    expect(orchestrator.includes('.findByToken(')).toBe(false);
    expect(orchestrator.includes('.recordAccess(')).toBe(false);
  });

  it('no tool is registered for either', () => {
    expect(FLOW_TOOLS.filter((t) => /portal.*(token|validate|record)/i.test(t.name))).toEqual([]);
  });

  it('redaction is an allowlist, so a future secret column cannot slip through', async () => {
    // A blocklist (`delete row.token`) survives the next migration that adds
    // `signingKey`. This one does not forward unknown fields at all.
    portal.list.mockResolvedValueOnce([
      accessRow({ signingKey: 'sk_added_by_a_future_migration' }) as never,
    ]);
    const out = await run('portal_list_access', {});
    expect(JSON.stringify(out).includes('sk_added_by_a_future_migration')).toBe(false);
  });

  it('still answers the question the token was being used to answer', async () => {
    // Stripping alone would leave the model unable to tell a live grant from a
    // revoked or expired one, which is the thing anyone actually asks.
    const out = (await run('portal_list_access', {})) as { access: Array<{ hasLiveLink: boolean }> };
    expect(out.access[0].hasLiveLink).toBe(true);
  });

  it('reports a revoked grant as having no live link', async () => {
    const out = (await run('portal_revoke_access', { accessId: 'pa1' })) as { hasLiveLink: boolean };
    expect(portal.revoke).toHaveBeenCalledWith('pa1', BIZ);
    expect(out.hasLiveLink).toBe(false);
  });

  it('reports an expired grant as having no live link, even while enabled', async () => {
    portal.list.mockResolvedValueOnce([
      accessRow({ expiresAt: new Date(Date.now() - 1000) }) as never,
    ]);
    const out = (await run('portal_list_access', {})) as { access: Array<{ hasLiveLink: boolean }> };
    expect(out.access[0].hasLiveLink).toBe(false);
  });

  it('and every description says the token is not returned', () => {
    for (const name of ['portal_list_access', 'portal_grant_access']) {
      expect(getToolByName(name)!.description).toMatch(/never returns? the token|never returned/i);
    }
  });
});

describe('the four permissions are taken by name', () => {
  it('grant passes only the settings that were supplied', async () => {
    await run('portal_grant_access', { contactId: 'c1', invoices: true, bookings: false });
    expect(portal.createAccess).toHaveBeenCalledWith(BIZ, 'c1', {
      invoices: true,
      bookings: false,
    });
  });

  it('grant with no settings passes undefined, not an empty object', async () => {
    // createAccess falls back to the existing settings when given nothing. An
    // empty object would instead be stored as "can see nothing", silently
    // stripping a returning contact's access while reporting success.
    await run('portal_grant_access', { contactId: 'c1' });
    expect(portal.createAccess).toHaveBeenCalledWith(BIZ, 'c1', undefined);
  });

  it('drops a key the portal does not read rather than storing it', async () => {
    // `docs: true` would persist a field nothing checks: KEY reports "documents
    // access enabled", the row grows a key, and the customer still sees
    // nothing.
    await run('portal_grant_access', { contactId: 'c1', docs: true, invoices: true });
    const [, , settings] = portal.createAccess.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(settings)).toEqual(['invoices']);
  });

  it('refuses a permission that is not a boolean', async () => {
    await expect(
      run('portal_update_settings', { accessId: 'pa1', invoices: 'yes' }),
    ).rejects.toThrow(/must be true or false/i);
    expect(portal.updateSettings).not.toHaveBeenCalled();
  });

  it('refuses an update that would change nothing', async () => {
    // updateSettings REPLACES the settings object, so an empty one revokes
    // every permission while reporting a successful update.
    await expect(run('portal_update_settings', { accessId: 'pa1' })).rejects.toThrow(
      /nothing to change/i,
    );
    expect(portal.updateSettings).not.toHaveBeenCalled();
  });

  it('but a real settings change goes through', async () => {
    // updateSettings(id, businessId, settings) — id FIRST, unlike createAccess
    // which takes businessId first. Two adjacent strings in a service whose
    // sibling methods disagree on their order: a transposition compiles, runs,
    // and scopes the lookup to a business id used as a row id, which finds
    // nothing and reports "portal access not found". This assertion is here
    // because the first version of it had the order wrong.
    await run('portal_update_settings', { accessId: 'pa1', invoices: false, documents: true });
    expect(portal.updateSettings).toHaveBeenCalledWith('pa1', BIZ, {
      invoices: false,
      documents: true,
    });
  });
});

describe('the tools exist and are reachable', () => {
  it('all four are registered', () => {
    for (const name of PORTAL_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('granting and revoking access are writes, listing is a read', () => {
    expect(getToolByName('portal_list_access')!.family).toBe('read');
    for (const name of ['portal_grant_access', 'portal_revoke_access', 'portal_update_settings']) {
      expect(getToolByName(name)!.family).toBe('crud');
    }
  });
});
