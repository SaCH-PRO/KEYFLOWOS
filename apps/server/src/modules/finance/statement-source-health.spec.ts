/**
 * An unattended job has to be able to notice its own silence.
 *
 * Two real defects shipped in this feature and both produced a SILENT ZERO
 * rather than an error:
 *
 *   - the Drive sweep asked Google for a FILENAME containing the folder id
 *     instead of the folder's contents, and matched nothing
 *   - concurrent imports raced past an in-memory dedupe and duplicated rows
 *
 * Neither raised anything. The nightly job reported "0 files considered",
 * which is indistinguishable from a bank that sent nothing that month. Both
 * would have run to year end.
 *
 * So the sweep now reports its own health into the awareness feed — the one
 * path where a background process reaches a human unprompted. The assertions
 * below are about the three ways that reporting could itself fail silently:
 *
 *   1. writing a row the feed cannot read (it JSON.parses `value` and drops
 *      anything that throws with only a debug log — this bug was written and
 *      caught during this very change)
 *   2. leaving a resolved alarm up, until the feed stops being read
 *   3. crying wolf at a merely quiet account, which has the same effect
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatementSourceService } from './statement-source.service';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function makeService(sources: Record<string, unknown>, opts: { driveThrows?: string; files?: any[] } = {}) {
  const account = { id: 'acc_A', businessId: 'biz_1', name: 'Republic', metadata: { statementSources: sources } };
  const memory: any[] = [];

  const prisma: any = {
    client: {
      financialAccount: {
        findMany: vi.fn(async () => [account]),
        findFirst: vi.fn(async () => account),
        update: vi.fn(async ({ data }: any) => { account.metadata = data.metadata; return account; }),
      },
      keyCortexMemory: {
        findFirst: vi.fn(async ({ where }: any) =>
          memory.find((m) => m.businessId === where.businessId && m.type === where.type && m.key === where.key) ?? null,
        ),
        create: vi.fn(async ({ data }: any) => { const row = { id: `mem_${memory.length}`, ...data }; memory.push(row); return row; }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = memory.find((m) => m.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        delete: vi.fn(async ({ where }: any) => {
          const i = memory.findIndex((m) => m.id === where.id);
          if (i >= 0) memory.splice(i, 1);
          return {};
        }),
      },
    },
  };

  const drive: any = {
    listFiles: opts.driveThrows
      ? vi.fn(async () => { throw new Error(opts.driveThrows); })
      : vi.fn(async () => ({ files: opts.files ?? [] })),
    downloadBinary: vi.fn(async () => ({ base64: Buffer.from('not a statement').toString('base64') })),
  };
  const gmail: any = { searchMessages: vi.fn(async () => []), getMessageWithAttachments: vi.fn(), getAttachment: vi.fn() };
  const bankImport: any = { ingest: vi.fn() };

  return { service: new StatementSourceService(prisma, drive, gmail, bankImport), memory, account, prisma };
}

/** The single health row for an account, decoded the way the feed decodes it. */
function healthRow(memory: any[]) {
  const row = memory.find((m) => m.type === 'integration_health');
  if (!row) return null;
  // getAwareness does exactly this and silently drops the row if it throws.
  return { ...row, parsed: JSON.parse(row.value) };
}

describe('a broken intake reaches a human', () => {
  it('a failing sweep writes an awareness row', async () => {
    const { service, memory } = makeService({ driveFolderId: 'f1' }, { driveThrows: 'Google Drive not connected' });

    await service.sweepAll();

    const row = healthRow(memory);
    expect(row, 'a sweep that threw recorded nothing a human can see').toBeTruthy();
    expect(row!.type).toBe('integration_health');
    expect(row!.parsed.summary).toMatch(/Republic/);
    expect(row!.parsed.summary).toMatch(/not connected/);
    expect(row!.parsed.reason).toBe('error');
  });

  it('the row is JSON the feed can actually parse', async () => {
    // KeyCortexAwarenessService.getAwareness does JSON.parse(row.value) inside
    // a try/catch whose catch is a debug log. A plain-string value would be
    // written to the database and then discarded by the reader in silence —
    // an alert about silent failure, failing silently.
    const { service, memory } = makeService({ driveFolderId: 'f1' }, { driveThrows: 'boom' });

    await service.sweepAll();

    const raw = memory.find((m) => m.type === 'integration_health');
    expect(() => JSON.parse(raw.value), 'the feed would drop this row').not.toThrow();
    expect(JSON.parse(raw.value).summary, 'headlineFor reads `summary`').toBeTruthy();
  });

  it('belongs to the business, not to whoever was in the chat', async () => {
    const { service, memory } = makeService({ driveFolderId: 'f1' }, { driveThrows: 'boom' });

    await service.sweepAll();

    const raw = memory.find((m) => m.type === 'integration_health');
    expect(raw.businessId).toBe('biz_1');
    expect(raw.userId, 'a userId would hide the alert from everyone else').toBeUndefined();
  });

  it('a second failure updates the row rather than stacking duplicates', async () => {
    const { service, memory } = makeService({ driveFolderId: 'f1' }, { driveThrows: 'boom' });

    await service.sweepAll();
    await service.sweepAll();
    await service.sweepAll();

    expect(memory.filter((m) => m.type === 'integration_health')).toHaveLength(1);
  });
});

describe('a source that has gone quiet', () => {
  it('is reported once the silence is longer than a statement cycle', async () => {
    // The exact disguise both real defects wore: the sweep runs, succeeds, and
    // imports nothing, forever.
    const { service, memory } = makeService({
      driveFolderId: 'f1',
      lastSweptAt: iso(1),
      lastImportAt: iso(60),
    });

    await service.sweepAll();

    const row = healthRow(memory);
    expect(row, '60 days of nothing from a configured source must surface').toBeTruthy();
    expect(row!.parsed.reason).toBe('quiet');
    expect(row!.parsed.summary).toMatch(/60 days/);
  });

  it('is NOT reported when the account is merely between statements', async () => {
    // A month of quiet is what a monthly statement looks like. Crying wolf
    // here would train someone to ignore the feed, which costs more than the
    // alert is worth.
    const { service, memory } = makeService({
      driveFolderId: 'f1',
      lastSweptAt: iso(1),
      lastImportAt: iso(20),
    });

    await service.sweepAll();

    expect(healthRow(memory), '20 days is a normal gap between statements').toBeNull();
  });

  it('a newly connected source is not immediately accused of being broken', async () => {
    // No lastImportAt yet, because nothing has ever arrived. Measuring from
    // lastSweptAt keeps a source connected this morning out of the feed.
    const { service, memory } = makeService({ driveFolderId: 'f1', lastSweptAt: iso(0) });

    await service.sweepAll();

    expect(healthRow(memory)).toBeNull();
  });
});

describe('a recovered intake stops complaining', () => {
  it('clears the row once a sweep imports again', async () => {
    const { service, memory, prisma } = makeService({ driveFolderId: 'f1' }, { driveThrows: 'boom' });

    await service.sweepAll();
    expect(healthRow(memory), 'precondition: the failure was recorded').toBeTruthy();

    // The connection is fixed and a statement arrives.
    const svc: any = service;
    svc.drive.listFiles = vi.fn(async () => ({ files: [{ id: 'f1', name: 's.ofx' }] }));
    svc.drive.downloadBinary = vi.fn(async () => ({
      base64: Buffer.from('OFXHEADER:100\n<OFX><STMTTRN>\n<DTPOSTED>20260703\n<TRNAMT>-1.00\n<FITID>F1\n<NAME>X\n</STMTTRN></OFX>').toString('base64'),
    }));
    svc.bankImport.ingest = vi.fn(async () => ({
      accountId: 'acc_A', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
      errors: [], format: 'ofx', exactDedupe: true,
    }));

    await service.sweepAll();

    expect(
      healthRow(memory),
      'a resolved alarm left standing is how a feed stops being read',
    ).toBeNull();
    expect(prisma.client.keyCortexMemory.delete).toHaveBeenCalled();
  });

  it('records when an import last actually happened, not just when it looked', async () => {
    // lastSweptAt alone cannot distinguish "working" from "running and finding
    // nothing" — which is the whole reason the quiet check has anything to
    // measure against.
    const { service, account } = makeService({ driveFolderId: 'f1' }, { files: [{ id: 'f1', name: 's.ofx' }] });
    const svc: any = service;
    svc.drive.downloadBinary = vi.fn(async () => ({
      base64: Buffer.from('OFXHEADER:100\n<OFX><STMTTRN>\n<DTPOSTED>20260703\n<TRNAMT>-1.00\n<FITID>F1\n<NAME>X\n</STMTTRN></OFX>').toString('base64'),
    }));
    svc.bankImport.ingest = vi.fn(async () => ({
      accountId: 'acc_A', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
      errors: [], format: 'ofx', exactDedupe: true,
    }));

    await service.sweepDrive('biz_1', 'acc_A');

    const saved = (account.metadata as any).statementSources;
    expect(saved.lastImportAt, 'an import must be datable').toBeTruthy();
    expect(saved.lastSweptAt).toBeTruthy();
  });

  it('a sweep that finds nothing does not stamp lastImportAt', async () => {
    const { service, account } = makeService({ driveFolderId: 'f1' }, { files: [] });

    await service.sweepDrive('biz_1', 'acc_A');

    const saved = (account.metadata as any).statementSources;
    expect(saved.lastSweptAt, 'it did look').toBeTruthy();
    expect(saved.lastImportAt, 'but nothing arrived, so nothing may be claimed').toBeFalsy();
  });
});

describe('reporting health never breaks the sweep', () => {
  it('a sweep that imported still succeeds when the feed write fails', async () => {
    // The health row is a courtesy. If recording it fails, the import that
    // actually happened must still be reported as having happened.
    const { service, prisma } = makeService({ driveFolderId: 'f1' }, { files: [{ id: 'f1', name: 's.ofx' }] });
    prisma.client.keyCortexMemory.findFirst = vi.fn(async () => { throw new Error('feed unavailable'); });
    const svc: any = service;
    svc.drive.downloadBinary = vi.fn(async () => ({
      base64: Buffer.from('OFXHEADER:100\n<OFX><STMTTRN>\n<DTPOSTED>20260703\n<TRNAMT>-1.00\n<FITID>F1\n<NAME>X\n</STMTTRN></OFX>').toString('base64'),
    }));
    svc.bankImport.ingest = vi.fn(async () => ({
      accountId: 'acc_A', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
      errors: [], format: 'ofx', exactDedupe: true,
    }));

    const r = await service.sweepDrive('biz_1', 'acc_A');

    expect(r.imported).toBe(1);
    expect(r.errors).toEqual([]);
  });
});
