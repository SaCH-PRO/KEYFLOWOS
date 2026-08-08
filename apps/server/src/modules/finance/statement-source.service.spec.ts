/**
 * Automated statement sources — the failures worth testing are the ones that
 * would go unnoticed for a month.
 *
 * A sweep that throws gets seen. A sweep that quietly posts one bank's
 * statement into another bank's ledger, or silently skips the file it was
 * supposed to import, is discovered at year end by an accountant.
 *
 * So the assertions here are about routing and refusal, not about happy-path
 * plumbing:
 *
 *   - a file is never ingested into an account that did not name its source
 *   - a non-statement in the same folder is skipped, not parsed
 *   - one business's broken connection does not stop the estate sweep
 *   - the nightly job only touches accounts that opted in
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatementSourceService } from './statement-source.service';

const OFX = `OFXHEADER:100
<OFX><STMTTRN>
<DTPOSTED>20260703
<TRNAMT>-100.00
<FITID>FIT-1
<NAME>SHOP
</STMTTRN></OFX>`;

function makeService(accounts: any[]) {
  const state = { accounts: accounts.map((a) => ({ ...a })) };

  const prisma: any = {
    client: {
      financialAccount: {
        findMany: vi.fn(async ({ where }: any) =>
          state.accounts.filter((a) => !where?.businessId || a.businessId === where.businessId),
        ),
        findFirst: vi.fn(async ({ where }: any) =>
          state.accounts.find((a) => a.id === where.id && a.businessId === where.businessId) ?? null,
        ),
        update: vi.fn(async ({ where, data }: any) => {
          const a = state.accounts.find((x) => x.id === where.id);
          if (a) a.metadata = data.metadata;
          return a;
        }),
      },
    },
  };

  const drive: any = {
    listFiles: vi.fn(async () => ({ files: [{ id: 'f1', name: 'statement.ofx' }] })),
    downloadBinary: vi.fn(async () => ({ base64: Buffer.from(OFX).toString('base64') })),
  };

  const gmail: any = {
    searchMessages: vi.fn(async () => [{ id: 'm1', threadId: 't1' }]),
    getMessageWithAttachments: vi.fn(async () => ({
      id: 'm1', subject: 'Statement', from: 'bank@example.com', date: new Date(),
      attachments: [{ attachmentId: 'a1', filename: 'july.ofx', mimeType: 'text/plain', size: 100 }],
    })),
    getAttachment: vi.fn(async () => Buffer.from(OFX)),
  };

  const bankImport: any = {
    ingest: vi.fn(async () => ({
      accountId: 'acc_A', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
      errors: [], format: 'ofx', exactDedupe: true,
    })),
  };

  const service = new StatementSourceService(prisma, drive, gmail, bankImport);
  return { service, prisma, drive, gmail, bankImport, state };
}

const withDrive = { id: 'acc_A', businessId: 'biz_1', name: 'Republic', metadata: { statementSources: { driveFolderId: 'folder_1' } } };
const withGmail = { id: 'acc_B', businessId: 'biz_1', name: 'First Citizens', metadata: { statementSources: { gmailQuery: 'from:fcb.co.tt' } } };
const unconfigured = { id: 'acc_C', businessId: 'biz_1', name: 'Petty cash', metadata: {} };

describe('a statement only enters an account that asked for it', () => {
  it('refuses to sweep an account with no source configured', async () => {
    const { service, bankImport } = makeService([unconfigured]);

    const r = await service.sweepDrive('biz_1', 'acc_C');

    expect(r.imported).toBe(0);
    expect(r.errors.join(' ')).toMatch(/No Drive folder configured/);
    expect(bankImport.ingest, 'nothing may be ingested without a configured source').not.toHaveBeenCalled();
  });

  it('ingests into the account that named the folder, and no other', async () => {
    // withGmail is deliberately FIRST. An earlier version of this test put the
    // target account first, so it passed against an implementation that simply
    // took configuredAccounts()[0] — the assertion was true for the wrong
    // reason. Ordering the fixture against the implementation is the point.
    const { service, bankImport } = makeService([withGmail, withDrive, unconfigured]);

    await service.sweepDrive('biz_1', 'acc_A');

    expect(bankImport.ingest).toHaveBeenCalledTimes(1);
    // Routing is explicit: guessing the account from a number inside the file
    // would post a month of transactions to the wrong ledger, and the
    // reconciliation would then "succeed" against the wrong book.
    expect(bankImport.ingest.mock.calls[0][1]).toBe('acc_A');
  });

  it('passes each account its own businessId rather than trusting ambient scope', async () => {
    // The nightly sweep has no tenant context — the interceptor is HTTP-only —
    // so businessId must travel as an argument.
    const { service, bankImport } = makeService([withDrive]);

    await service.sweepAll();

    expect(bankImport.ingest.mock.calls[0][0]).toBe('biz_1');
  });
});

describe('a folder contains more than statements', () => {
  it('skips a file that is not one, without parsing it', async () => {
    const { service, drive, bankImport } = makeService([withDrive]);
    drive.listFiles.mockResolvedValue({ files: [{ id: 'f9', name: 'team-photo.png' }] });

    const r = await service.sweepDrive('biz_1', 'acc_A');

    expect(r.skipped + r.filesConsidered).toBeGreaterThan(0);
    expect(bankImport.ingest).not.toHaveBeenCalled();
  });

  it('skips a .csv with no date-shaped header rather than feeding the parser junk', async () => {
    const { service, drive, bankImport } = makeService([withDrive]);
    drive.listFiles.mockResolvedValue({ files: [{ id: 'f8', name: 'contacts.csv' }] });
    drive.downloadBinary.mockResolvedValue({ base64: Buffer.from('name,email\nAda,a@b.c').toString('base64') });

    await service.sweepDrive('biz_1', 'acc_A');

    expect(bankImport.ingest).not.toHaveBeenCalled();
  });

  it('accepts an OFX regardless of what the file is called', async () => {
    // Banks emit OFX as .txt constantly. Detection reads the content.
    const { service, drive, bankImport } = makeService([withDrive]);
    drive.listFiles.mockResolvedValue({ files: [{ id: 'f7', name: 'download.txt' }] });

    await service.sweepDrive('biz_1', 'acc_A');

    expect(bankImport.ingest).toHaveBeenCalledTimes(1);
  });
});

describe('Gmail sweep', () => {
  it('reads attachments and ingests them', async () => {
    const { service, gmail, bankImport } = makeService([withGmail]);

    const r = await service.sweepGmail('biz_1', 'acc_B');

    expect(gmail.searchMessages).toHaveBeenCalled();
    expect(bankImport.ingest).toHaveBeenCalledTimes(1);
    expect(r.imported).toBe(1);
  });

  it('bounds the search so it does not walk the whole mailbox', async () => {
    // A first sweep of a ten-year mailbox with no bound is a very slow, very
    // expensive no-op that mostly finds nothing.
    const { service, gmail } = makeService([withGmail]);

    await service.sweepGmail('biz_1', 'acc_B');

    expect(gmail.searchMessages.mock.calls[0][1]).toMatch(/newer_than:/);
  });

  it('narrows the window once the account has been swept before', async () => {
    const swept = { ...withGmail, metadata: { statementSources: { gmailQuery: 'from:fcb.co.tt', lastSweptAt: '2026-08-01T00:00:00Z' } } };
    const { service, gmail } = makeService([swept]);

    await service.sweepGmail('biz_1', 'acc_B');

    expect(gmail.searchMessages.mock.calls[0][1]).toMatch(/newer_than:7d/);
  });
});

describe('the nightly sweep', () => {
  it('only touches accounts that opted in', async () => {
    const { service, bankImport } = makeService([withDrive, withGmail, unconfigured]);

    const r = await service.sweepAll();

    expect(r.swept, 'the unconfigured account must not be swept').toBe(2);
    expect(bankImport.ingest).toHaveBeenCalledTimes(2);
  });

  it('one business failing does not stop the rest', async () => {
    // An expired Gmail token on one tenant is routine. It must not mean nobody
    // else gets their statements that night.
    const { service, gmail, bankImport } = makeService([withGmail, withDrive]);
    gmail.searchMessages.mockRejectedValue(new Error('Gmail not connected'));

    const r = await service.sweepAll();

    expect(r.swept).toBe(2);
    expect(bankImport.ingest, 'the Drive account should still have imported').toHaveBeenCalled();
  });

  it('does nothing at all when no account is configured', async () => {
    const { service, drive, gmail } = makeService([unconfigured]);

    const r = await service.sweepAll();

    expect(r).toEqual({ swept: 0, imported: 0 });
    expect(drive.listFiles).not.toHaveBeenCalled();
    expect(gmail.searchMessages).not.toHaveBeenCalled();
  });
});
