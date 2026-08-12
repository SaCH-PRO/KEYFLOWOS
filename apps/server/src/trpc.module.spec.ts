/**
 * The tRPC surface, which is currently unreachable and was one routing fix away
 * from disclosing OAuth tokens.
 *
 * WHAT WAS FOUND. `social.listConnections` took a `businessId` straight from the
 * client and ran `ctx.db.socialConnection.findMany({ where: { businessId } })`
 * with no access check. `protectedProcedure` establishes only that the caller is
 * somebody. Three things that would normally stop this do not apply here:
 *
 *   - the router is mounted as Express middleware, so the APP_INTERCEPTOR that
 *     fills the tenant AsyncLocalStorage never runs — Nest interceptors need a
 *     controller, and /trpc has none;
 *   - SocialConnection is not in BUSINESS_ID_MODELS, so the Prisma extension
 *     would not have scoped it even if the ALS were populated;
 *   - token-encryption.ts *decrypts* socialConnection on findMany, so the rows
 *     come back with live access and refresh tokens in plaintext.
 *
 * Any authenticated user naming any businessId would have received that
 * business's Facebook, Instagram, LinkedIn and Twitter tokens.
 *
 * WHY IT WAS NOT EXPLOITABLE. The middleware is mounted with
 * `.forRoutes({ path: '/trpc', method: RequestMethod.ALL })`, which matches that
 * path EXACTLY and not below it. Measured against production:
 *
 *   GET /trpc                         -> tRPC's own error, `No "query"-procedure
 *                                        on path "trpc"` — the handler is there
 *   GET /trpc/social.listConnections  -> Nest 404, never reaches tRPC
 *
 * So all 82 procedures are dead, and the vulnerability was latent: it would have
 * gone live the moment somebody corrected the mount path to a wildcard, as a
 * routing fix, with no reason to think they were touching security. That is the
 * dangerous shape — an access-control hole parked behind an unrelated bug.
 *
 * This spec is what makes fixing the mount safe. It does not assert the router
 * stays unmounted; mounting it is a legitimate product decision. It asserts that
 * whenever that happens, every procedure taking a businessId has already checked
 * the caller is entitled to it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const ROUTERS = path.join(ROOT, 'packages', 'api', 'src', 'routers');
const SERVER_SRC = path.join(ROOT, 'apps', 'server', 'src');

interface Procedure {
  file: string;
  name: string;
  kind: string;
  body: string;
}

/**
 * Slice each procedure from its declaration to the start of the next one.
 *
 * The first version of this brace-matched forward from the first `(` after the
 * name — which is `.input(`, so every "body" was just the zod schema. It
 * reported zero procedures touching the database AND zero access checks, and the
 * second number is the one that makes it look like good news. Both were the
 * extractor. Hence the sanity assertions below.
 */
function procedures(): Procedure[] {
  const out: Procedure[] = [];
  for (const file of fs.readdirSync(ROUTERS).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(ROUTERS, file), 'utf8');
    const re = /^\s{2,}(\w+):\s*(publicProcedure|protectedProcedure|superAdminProcedure)\b/gm;
    const marks = [...src.matchAll(re)].map((m) => ({
      name: m[1],
      kind: m[2],
      index: m.index!,
    }));
    marks.forEach((m, i) => {
      out.push({
        file,
        name: m.name,
        kind: m.kind,
        body: src.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
      });
    });
  }
  return out;
}

const touchesDb = (p: Procedure) => /ctx\.db\./.test(p.body);
const namesBusinessId = (p: Procedure) => /businessId/.test(p.body);
const checksAccess = (p: Procedure) => /assertBusinessAccess|assertBusinessRole/.test(p.body);

/**
 * Procedures that read a businessId from input without an access check.
 * Shrink-only. An entry is a known hole, not an approved one.
 */
const ACKNOWLEDGED_UNCHECKED: Record<string, string> = {};

/**
 * Procedures that call `assertBusinessRole`, which reads `ctx.business` —
 * populated from `req.business`, which nothing in apps/server ever assigns. Each
 * of these throws Forbidden for every caller.
 *
 * Listed rather than fixed: making them work means deciding where a tRPC request
 * declares its business (a header? an input field?), and the router is not
 * reachable today, so the choice has no forcing function behind it. Shrink-only
 * — the point is that an eleventh cannot be added without a decision.
 */
const BROKEN_BY_MISSING_CTX_BUSINESS = [
  'key-connector.ts:getProviders',
  'key-connector.ts:getProviderDetail',
  'key-connector.ts:connectProvider',
  'key-connector.ts:disconnectProvider',
  'key-connector.ts:getConnections',
  'key-connector.ts:triggerSync',
  'key-connector.ts:getSyncHistory',
  'key-connector.ts:getConnectionHealth',
  'key-connector.ts:getAuditLog',
  'key-connector.ts:processAiCommand',
];

describe('the tRPC routers cannot be mounted into a tenant leak', () => {
  const procs = procedures();

  it('the extractor sees whole procedure bodies — not just their input schemas', () => {
    expect(procs.length, 'no procedures parsed').toBeGreaterThan(70);
    expect(
      procs.filter(touchesDb).length,
      'no procedure appears to touch ctx.db — the bodies are being truncated',
    ).toBeGreaterThan(40);
    expect(
      procs.filter(checksAccess).length,
      'no procedure appears to check access — the bodies are being truncated',
    ).toBeGreaterThan(40);
  });

  it('every procedure taking a businessId verifies the caller may use it', () => {
    const unchecked = procs
      .filter((p) => touchesDb(p) && namesBusinessId(p) && !checksAccess(p))
      .filter((p) => !(`${p.file}:${p.name}` in ACKNOWLEDGED_UNCHECKED))
      .map((p) => `${p.file}:${p.name} (${p.kind})`);

    expect(
      unchecked,
      'these read a client-supplied businessId and query the database without ' +
        'establishing the caller is entitled to that business. The tenant ' +
        'extension does NOT cover /trpc — it is middleware, so no interceptor ' +
        'populates the tenant context. Call assertBusinessAccess(ctx, businessId).',
    ).toEqual([]);
  });

  it('no unauthenticated procedure reads the database', () => {
    const open = procs
      .filter((p) => p.kind === 'publicProcedure' && touchesDb(p))
      .map((p) => `${p.file}:${p.name}`);
    expect(open, 'publicProcedure has no auth at all; these query the database').toEqual([]);
  });

  it('assertBusinessRole is only used if something actually populates ctx.business', () => {
    // ctx.business comes from `req.business` in trpc.module.ts's createContext.
    // Nothing in the server sets it, so assertBusinessRole — which reads
    // ctx.business?.id and throws Forbidden when absent — can never succeed.
    // Ten key-connector procedures depend on it and would fail closed for every
    // caller. Fails safe, but the feature does not work, and the reason is two
    // packages away from where it is felt.
    const users = procs
      .filter((p) => /assertBusinessRole/.test(p.body))
      .map((p) => `${p.file}:${p.name}`);

    const populated = walk(SERVER_SRC).some((f) =>
      /(?:req|request)(?:\s+as\s+any)?\s*(?:\)|)\s*\.business\s*=|\['business'\]\s*=/.test(
        fs.readFileSync(f, 'utf8'),
      ),
    );

    if (populated) {
      // Someone wired req.business. These procedures now work, so the ledger is
      // a lie and has to go — otherwise it quietly outlives the problem.
      expect(
        BROKEN_BY_MISSING_CTX_BUSINESS,
        'req.business is now populated, so these procedures work. Empty ' +
          'BROKEN_BY_MISSING_CTX_BUSINESS.',
      ).toEqual([]);
      return;
    }

    const surprises = users.filter((u) => !BROKEN_BY_MISSING_CTX_BUSINESS.includes(u));
    expect(
      surprises,
      'these call assertBusinessRole, which reads ctx.business. Nothing in ' +
        'apps/server assigns req.business, so they throw Forbidden for every ' +
        'caller. Either populate req.business in middleware that runs before ' +
        'the tRPC handler, or take an explicit businessId and use ' +
        'assertBusinessAccess.',
    ).toEqual([]);

    const fixed = BROKEN_BY_MISSING_CTX_BUSINESS.filter((u) => !users.includes(u));
    expect(fixed, 'these are listed as broken but no longer call assertBusinessRole — remove them').toEqual(
      [],
    );
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist'].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts') && !/\.spec\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}
