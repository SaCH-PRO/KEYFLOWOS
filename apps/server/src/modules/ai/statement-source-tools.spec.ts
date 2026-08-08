/**
 * KEY can now connect a statement source, and that is a sharper thing to hand
 * an assistant than it first looks.
 *
 * Every other reconcile tool is reversible by a human in a minute: an unmatched
 * line can be rematched, an auto-match rerun. Connecting a source is different
 * because it is *durable and unattended* — a wrong folder or an over-broad
 * Gmail query keeps being wrong at 5am every morning, importing into a ledger
 * nobody is watching. The cost of the mistake is paid nightly, long after the
 * conversation that caused it.
 *
 * So these assertions are about three things the tool must never do:
 *
 *   - claim a bank feed it does not have
 *   - report numbers it invented rather than the ones the sweep returned
 *   - leave a "disconnected" source still connected
 *
 * The last one is the one that came out of building the UI. Both the screen and
 * the tool clear a source by sending an empty string, so `''` MUST read as
 * "not configured" all the way through to the nightly cron. If it did not, a
 * disconnected account would keep being swept and would fail every night into
 * a log nobody reads.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';
import { StatementSourceService } from '../finance/statement-source.service';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const registry = readFileSync(join(__dirname, 'flow-tool-registry.ts'), 'utf8');

const TOOLS = [
  'reconcile_list_statement_sources',
  'reconcile_connect_statement_source',
  'reconcile_sweep_statements',
];

/** The body of one `case` clause in executeToolAction. */
function handlerBody(name: string): string {
  const start = orchestrator.indexOf(`case '${name}': {`);
  expect(start, `${name} has no handler`).toBeGreaterThan(-1);
  const next = orchestrator.indexOf("\n      case '", start + 10);
  return orchestrator.slice(start, next === -1 ? start + 4000 : next);
}

describe('the tools exist and are wired', () => {
  it('all three are declared, handled, and point at the reconciliation screen', () => {
    for (const name of TOOLS) {
      const tool = getToolByName(name);
      expect(tool, `${name} is not in FLOW_TOOLS`).toBeTruthy();
      expect(orchestrator.includes(`case '${name}':`), `${name} has no handler`).toBe(true);
      expect(tool!.manualEquivalentRoute).toBe('/app/finance/reconciliation');
    }
  });

  it('the two that change something are tier 2, and neither is tier 1', () => {
    // Connecting a source and running a sweep both write. Tier 1 is the
    // read tier and would let them auto-execute for every role.
    for (const name of ['reconcile_connect_statement_source', 'reconcile_sweep_statements']) {
      const tool = getToolByName(name)!;
      expect(tool.riskTier, `${name} must not be tier 1`).toBeGreaterThanOrEqual(2);
      expect(tool.family).toBe('execute');
    }
    expect(getToolByName('reconcile_list_statement_sources')!.family).toBe('read');
  });
});

describe('no tool claims a bank feed', () => {
  it('no statement tool describes itself as connecting to a bank', () => {
    // There is no aggregator coverage for this market. A description that says
    // "connect your bank" would be the single most expensive lie in the
    // product: a user would stop uploading and assume it was handled.
    for (const name of TOOLS) {
      const description = getToolByName(name)!.description.toLowerCase();
      expect(
        /connect (to )?(your |the )?bank\b|bank feed|live bank|直/.test(description),
        `${name} implies a bank feed that does not exist`,
      ).toBe(false);
    }
  });

  it('the sweep says out loud that it reads Drive or Gmail, not the bank', () => {
    const description = getToolByName('reconcile_sweep_statements')!.description;
    expect(description).toMatch(/does not contact the bank/i);
  });

  it('the registry comment no longer claims ingestion is not a tool', () => {
    // It said so, correctly, until Drive and Gmail sweeps existed. A stale
    // rationale is how the next person re-adds a tool that already exists, or
    // refuses to add one believing it was ruled out.
    expect(registry.includes('Ingestion is deliberately NOT a tool')).toBe(false);
  });
});

describe('the handlers return what happened, not what was asked for', () => {
  it('the sweep returns the service result rather than literals', () => {
    // The defect class this whole spec family exists for: `await` a service,
    // discard it, and return an object assembled from `args`. Here it would
    // mean KEY reporting "imported 0" or "imported 1" without either being
    // measured.
    const body = handlerBody('reconcile_sweep_statements');
    expect(body).toMatch(/imported:\s*result\.imported/);
    expect(body).toMatch(/filesConsidered:\s*result\.filesConsidered/);
    expect(body).toMatch(/errors:\s*result\.errors/);
    expect(body).not.toMatch(/imported:\s*\d/);
    expect(body).not.toMatch(/success:\s*true/);
  });

  it('the sweep refuses a source it cannot run instead of silently doing nothing', () => {
    const body = handlerBody('reconcile_sweep_statements');
    expect(body).toMatch(/BadRequestException/);
  });

  it('connecting nothing is an error, not a no-op that reports success', () => {
    // `{accountId}` alone would otherwise save an empty patch and return the
    // existing config, which reads exactly like a successful connection.
    const body = handlerBody('reconcile_connect_statement_source');
    expect(body).toMatch(/driveFolderId === undefined && args\.gmailQuery === undefined/);
    expect(body).toMatch(/BadRequestException/);
  });

  it('the listing returns the projection, not the raw rows', () => {
    // metadata also holds importProfile — the account's CSV column layout.
    // Returning the blob would spend tokens on it every call and would hand
    // whatever lands in metadata later straight to a model.
    //
    // The assertion has to be about what the handler RETURNS. An earlier
    // version checked only that the projection existed, which stayed true
    // when the return was changed to hand back the raw query result — the
    // projection sat there unused and the test passed. It also spelled the
    // defect as `accounts: accounts` and so missed the shorthand `{ accounts }`
    // that the break actually produced.
    const body = handlerBody('reconcile_list_statement_sources');
    expect(body).toMatch(/driveFolderId: s\?\.driveFolderId/);

    // The handler's own return is the LAST one in the body — the first belongs
    // to the .map() callback that builds the projection.
    const returns = [...body.matchAll(/return \{[\s\S]*?\};/g)].map((m) => m[0]);
    expect(returns.length, 'the handler must return something').toBeGreaterThan(0);
    const returned = returns[returns.length - 1];
    expect(returned, 'must return the projected rows').toMatch(/accounts:\s*rows\b/);
    expect(body).not.toMatch(/metadata: a\.metadata/);
  });

  it('the listing scopes its own query by businessId', () => {
    // Cron and tool paths have no HTTP request, so the tenant interceptor is
    // inert here by construction. The WHERE has to carry it.
    const body = handlerBody('reconcile_list_statement_sources');
    expect(body).toMatch(/where: \{ businessId/);
  });
});

describe('an empty string disconnects a source, everywhere', () => {
  /** Minimal service over an in-memory account. */
  function makeService(metadata: unknown) {
    const account = { id: 'acc_A', businessId: 'biz_1', name: 'Republic', metadata };
    const prisma: any = {
      client: {
        financialAccount: {
          findFirst: vi.fn(async () => account),
          findMany: vi.fn(async () => [account]),
          update: vi.fn(async ({ data }: any) => {
            account.metadata = data.metadata;
            return account;
          }),
        },
      },
    };
    const drive: any = { listFiles: vi.fn(), downloadBinary: vi.fn() };
    const gmail: any = { searchMessages: vi.fn(), getMessageWithAttachments: vi.fn(), getAttachment: vi.fn() };
    const bankImport: any = { ingest: vi.fn() };
    return { service: new StatementSourceService(prisma, drive, gmail, bankImport), account, drive, gmail };
  }

  it('clearing the folder stops the nightly sweep from touching the account', async () => {
    const { service, drive, gmail } = makeService({
      statementSources: { driveFolderId: 'folder_1' },
    });

    await service.setSources('biz_1', 'acc_A', { driveFolderId: '' });
    const r = await service.sweepAll();

    expect(r, 'a disconnected account must not be swept').toEqual({ swept: 0, imported: 0 });
    expect(drive.listFiles).not.toHaveBeenCalled();
    expect(gmail.searchMessages).not.toHaveBeenCalled();
  });

  it('clearing one source leaves the other connected', async () => {
    // The screen submits both fields together, so saving after clearing only
    // the Gmail box must not take the Drive folder down with it.
    const { service, account } = makeService({
      statementSources: { driveFolderId: 'folder_1', gmailQuery: 'from:fcb.co.tt' },
    });

    await service.setSources('biz_1', 'acc_A', { driveFolderId: 'folder_1', gmailQuery: '' });

    const saved = (account.metadata as any).statementSources;
    expect(saved.driveFolderId).toBe('folder_1');
    expect(saved.gmailQuery).toBe('');

    const r = await service.sweepAll();
    expect(r.swept, 'the Drive side is still configured').toBe(1);
  });

  it('saving sources does not discard the import profile sitting beside them', async () => {
    // Both live under FinancialAccount.metadata. A `data: { metadata: {...} }`
    // write replaces the whole column, so a careless merge would silently drop
    // the CSV column mapping and the next import would go back to guessing.
    const { service, account } = makeService({
      importProfile: { dateColumn: 'Posted', amountColumn: 'Value (TTD)' },
      statementSources: {},
    });

    await service.setSources('biz_1', 'acc_A', { driveFolderId: 'folder_1' });

    expect((account.metadata as any).importProfile).toEqual({
      dateColumn: 'Posted',
      amountColumn: 'Value (TTD)',
    });
  });
});

describe('the arsenal still adds up', () => {
  it('every reconcile tool has a handler', () => {
    const reconcile = FLOW_TOOLS.filter((t) => t.name.startsWith('reconcile_'));
    expect(reconcile.length).toBeGreaterThanOrEqual(6);
    for (const tool of reconcile) {
      expect(orchestrator.includes(`case '${tool.name}':`), `${tool.name} has no handler`).toBe(true);
    }
  });
});
